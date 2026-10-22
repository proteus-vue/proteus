#!/usr/bin/env bash
# hosts/harmony/run-http-probe.sh —— ★★★T-app-fetch 真机判据：鸿蒙宿主 HTTP 二进制腿
#
# 【要证明什么（三层，缺一层都不算通）】
#   ① **跨语言契约在设备上成立**：帧由 **ArkTS 自己编码**（`entry/src/main/ets/runtime/InvokeWire.ts`）
#      → 交给 C++ 解（`invoke_wire.h`）→ 回程帧由 C++ 编 → JS 拿到 `Uint8Array` → C++ 再解。
#      （本机 `check:invoke-wire-parity` 已验同一性质；真机上再验一次，防"本机绿、设备端不一致"）
#   ② **JS 字节交接真的通**：走 `proteusHost.invokeBytes(Uint8Array)`，不是 JSON 回落。
#   ③ **宿主 HTTP 真的发出去**：回执里的 `status`/`bodyBytes` 来自**真实响应**（不是宿主自报常量）。
#
# 【完成信号 = 报告落盘】App 侧 `superapp-http` 场景落 `<filesDir>/http-probe.json` 并打
#   `PROTEUS_HTTP_PROBE_DONE`；本脚本**条件等待文件出现**（零 sleep / 零轮询超时链）。
#
# 【诚实边界】本探针不 boot 应用（空 VM + 只装 invokeBytes）⇒ 证明三段通路真实；
#   **不**证明 `useFetch` 的业务封装（那由 `tests/capability-app-fetch.test.ts` 等覆盖）。
#
# 前置：bash hosts/harmony/build-host-app.sh   （含 HAR native；HMS RCP 头需在 SDK 里）
# 用法：bash hosts/harmony/run-http-probe.sh [--url https://...]
#       （缺省 url = https://httpbin.org/get；国内网络不通时可用 --url 指向可达地址）
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
HDC() { bash "$HERE/hdc.sh" "$@"; }

BUNDLE="dev.proteus.host"
HAP_DIR="$HERE/host-app/entry/build/default/outputs/default"
RESULTS="$HERE/results"
FILES_DEV="/data/app/el2/100/base/$BUNDLE/haps/entry/files"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

URL=""
DNS_IP=""
DNS_HOST=""
for arg in "$@"; do
  case "$arg" in
    --url=*) URL="${arg#--url=}" ;;
    --url) shift_next=1 ;;  # 兼容 `--url <value>`：下面单独处理
    --dns-ip=*) DNS_IP="${arg#--dns-ip=}" ;;
    --dns-ip) shift_next_dns=1 ;;
    --dns-host=*) DNS_HOST="${arg#--dns-host=}" ;;
    --dns-host) shift_next_host=1 ;;
    *) if [ "${shift_next:-0}" = "1" ]; then URL="$arg"; shift_next=0;
       elif [ "${shift_next_dns:-0}" = "1" ]; then DNS_IP="$arg"; shift_next_dns=0;
       elif [ "${shift_next_host:-0}" = "1" ]; then DNS_HOST="$arg"; shift_next_host=0; fi ;;
  esac
done
[ -n "$URL" ] || URL="https://httpbin.org/get"

[ -f "$WAIT" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
mkdir -p "$RESULTS"

HAP="$(ls -t "$HAP_DIR"/*-signed.hap 2>/dev/null | head -1)"
[ -n "$HAP" ] || { echo "✗ 缺签名 hap——先跑 bash hosts/harmony/build-host-app.sh"; exit 2; }
STATE="$(HDC list targets -v 2>/dev/null | head -1)"
case "$STATE" in *Connected*) ;; *) echo "✗ 无设备/未授权（${STATE}）"; exit 2 ;; esac
echo "==> hap=${HAP##*/}  设备=$STATE  url=$URL"

echo "==> ① 安装 + 清场 + 删旧报告"
HDC install "$HAP" 2>&1 | grep -qiE "successfully|Success" || { echo "✗ 安装失败"; exit 1; }
HDC shell "aa force-stop $BUNDLE" >/dev/null 2>&1 || true
HDC shell "hilog -r" >/dev/null 2>&1 || true
HDC shell "rm -f $FILES_DEV/http-probe.json" >/dev/null 2>&1 || true
if HDC shell "test -f $FILES_DEV/http-probe.json && echo STILL_EXISTS" 2>/dev/null | grep -q STILL_EXISTS; then
  echo "✗ 旧报告删不掉（$FILES_DEV/http-probe.json）——等待信号会命中陈旧文件，拒绝继续"; exit 1
fi

echo "==> ② 启动（scene=superapp-http）"
DNS_ARG=""
[ -n "$DNS_IP" ] && DNS_ARG="--ps dnsIp $DNS_IP"
# ★#1169：dnsHost + dnsIp 配对 ⇒ 往帧里塞 httpDns 表（验证宿主表解析生效）
[ -n "$DNS_HOST" ] && DNS_ARG="$DNS_ARG --ps dnsHost $DNS_HOST"
HDC shell "aa start -a EntryAbility -b $BUNDLE --ps scene superapp-http --ps url $URL $DNS_ARG" 2>&1 \
  | grep -qi "successfully" || { echo "✗ 启动失败"; exit 1; }

echo "==> ③ 等报告落盘（完成信号 = 文件存在；零盲等）"
if ! bash "$WAIT" --cmd "bash '$HERE/hdc.sh' shell 'test -f $FILES_DEV/http-probe.json && echo PROTEUS_HTTP_PROBE_READY' | grep -q PROTEUS_HTTP_PROBE_READY" --timeout 90 --interval 3; then
  echo "✗ 90s 内未见 http-probe.json" >&2
  HDC shell "hilog -x | grep -E 'HTTP_PROBE|HTTP_REQUEST|INVOKE_BYTES|cppcrash' | tail -12" 2>&1 | sed 's/^/  /' >&2
  exit 1
fi

echo "==> ④ 取回报告 + 断言"
rm -f "$RESULTS/http-probe.json"
HDC file recv "$FILES_DEV/http-probe.json" "$RESULTS/http-probe.json" >/dev/null 2>&1 \
  || { echo "✗ file recv 失败"; exit 1; }
[ -s "$RESULTS/http-probe.json" ] || { echo "✗ 报告为空"; exit 1; }
echo "    http-probe.json $(wc -c < "$RESULTS/http-probe.json" | tr -d ' ') 字节"
cat "$RESULTS/http-probe.json"; echo

python3 - "$RESULTS/http-probe.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
ok = True
if d.get("host") != "harmony":
    print(f"✗ host 应为 harmony，实得 {d.get('host')}"); ok = False
if d.get("bridge") != "invokeBytes":
    print(f"✗ bridge 应为 invokeBytes（二进制腿），实得 {d.get('bridge')}"); ok = False
if d.get("frameSource") != "arkts":
    print(f"✗ frameSource 应为 arkts（跨语言契约未真验），实得 {d.get('frameSource')}"); ok = False
if d.get("ok") is not True:
    print(f"✗ 请求未成功：{d.get('error') or d.get('reason')}"); ok = False
else:
    st = d.get("status") or 0
    n = d.get("bodyBytes") or 0
    if not (200 <= st < 300):
        print(f"✗ HTTP 状态码异常：{st}"); ok = False
    if n <= 0:
        print(f"✗ 响应体为空（bodyBytes={n}）——通路可疑"); ok = False
    if ok:
        print(f"✅ 鸿蒙 HTTP 二进制腿通：ArkTS 编帧 → C++ 解 → 真实请求 → status={st} · body={n}B")
        prev = (d.get("preview") or "")[:100]
        if prev:
            print(f"   响应体前 100 字符：{prev}")
sys.exit(0 if ok else 1)
PY
RC=$?
[ "$RC" = "0" ] && echo "  ✓ 鸿蒙 T-app-fetch 真机判据通过" || { echo "  ✗ 判据失败"; exit "$RC"; }
