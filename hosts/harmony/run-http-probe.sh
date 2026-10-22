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
SAVE_PATH=""   # ★#1187：savePath（沙箱相对路径）
STREAM=""     # ★#1187：1 = 传 stream:true（应被如实拒绝）
EXPECT_REJECT=""   # ★#1192：1 = 预期被拒（路径穿越/非法 savePath 的**可重放**判据）
for arg in "$@"; do
  case "$arg" in
    --url=*) URL="${arg#--url=}" ;;
    --url) shift_next=1 ;;  # 兼容 `--url <value>`：下面单独处理
    --dns-ip=*) DNS_IP="${arg#--dns-ip=}" ;;
    --dns-ip) shift_next_dns=1 ;;
    --dns-host=*) DNS_HOST="${arg#--dns-host=}" ;;
    --save-path=*) SAVE_PATH="${arg#--save-path=}" ;;   # ★#1187
    --stream) STREAM=1 ;;                              # ★#1187
    --expect-reject) EXPECT_REJECT=1 ;;                  # ★#1192
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
# ★★★#1187：savePath（逐块落盘）/ stream（应被如实拒绝）
# ★★★#1187 真机踩坑（实测）：`aa start --ps savePath download/x.txt` 的**斜杠会被 aa 吃掉**
#   ⇒ `want.parameters` 里根本没有 `savePath` 这个键（而 scene/url 都在）。
#   加引号也无效（试过）⇒ 探针侧传 `%2F`，ArkTS 侧解回 `/`。
SAVE_PATH_ENC="$(printf '%s' "$SAVE_PATH" | sed 's|/|%2F|g')"
[ -n "$SAVE_PATH" ] && DNS_ARG="$DNS_ARG --ps savePath $SAVE_PATH_ENC"
[ "$STREAM" = "1" ] && DNS_ARG="$DNS_ARG --ps stream 1"
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

EXPECT_REJECT="${EXPECT_REJECT:-}" python3 - "$RESULTS/http-probe.json" <<'PY'
import json, os, sys
EXPECT_REJECT = os.environ.get("EXPECT_REJECT") == "1"
d = json.load(open(sys.argv[1]))
ok = True
# ★★★#1187：两种**预期失败**的形态（是设计，不是错误）：
#   · 传了 savePath ⇒ 回 `{path,size}` 摘要（★注意 `kept` 是恒真式，不作判据；看 saveWritten == seen）
#   · 传了 stream   ⇒ 必须 `fetch.unsupported` 且点明根因
diag = {}
try:
    diag = json.loads(d.get("probe_diag") or "{}")
except Exception:
    pass
save_path = diag.get("savePath") or ""
stream_on = (diag.get("stream") or "") == "1"
if EXPECT_REJECT:
    # ★#1192（J-J6-2）：**预期被拒**模式——让"路径穿越被拒"这份证据可重放
    # ★#1194（J-R5）：与 save/stream 分支同口径，必须校验 host/bridge/frameSource，
    #   否则探针跑在别的宿主或非 ArkTS 帧路径上也会绿
    if d.get("host") != "harmony":
        print(f"✗ host 应为 harmony，实得 {d.get('host')}"); sys.exit(1)
    if d.get("bridge") != "invokeBytes":
        print(f"✗ bridge 应为 invokeBytes，实得 {d.get('bridge')}"); sys.exit(1)
    if d.get("frameSource") != "arkts":
        print(f"✗ frameSource 应为 arkts，实得 {d.get('frameSource')}"); sys.exit(1)
    if d.get("ok") is not False:
        print("✗ 期望被拒但请求成功了"); sys.exit(1)
    if (d.get("limit") or {}).get("saveMode") is not False:
        print("✗ 被拒却仍进了落盘分支"); sys.exit(1)
    r = str(d.get("reason") or "")
    if "savePath 非法" not in r:
        print(f"✗ 拒绝原因不是路径非法：{r[:100]}"); sys.exit(1)
    print(f"✅ 路径被如实拒绝：{r[:110]}")
    sys.exit(0)
if save_path:
    prev = d.get("preview") or ""
    if d.get("ok") is not True:
        print(f"✗ 落盘请求未成功：{d.get('error') or d.get('reason')}"); ok = False
    elif '"path"' not in prev or '"size"' not in prev:
        print(f"✗ 落盘回执不是 {{path,size}} 摘要：{prev[:120]}"); ok = False
    else:
        lim = d.get("limit") or {}
        print(f"✅ 落盘回执：{prev}")
        # ★★★#1190（独立验证 J4 修复）：`kept==0` 是**恒真式**（落盘分支不填 gate.body）
        #   ⇒ 换成可核对的三个量：saveMode / saveWritten / cap。
        if lim.get("saveMode") is not True:
            print("✗ limit.saveMode!=true（没走落盘分支）"); ok = False
        if (lim.get("saveWritten") or 0) <= 0:
            print("✗ limit.saveWritten=0（一个字节都没写进文件）"); ok = False
        if (lim.get("saveWritten") or 0) != (lim.get("seen") or 0):
            print(f"✗ saveWritten({lim.get('saveWritten')}) != seen({lim.get('seen')})（写盘量与收到量不符）"); ok = False
        # ★J5：落盘上限必须是 1 GiB，不是 32 MiB
        if (lim.get("cap") or 0) < 1024 * 1024 * 1024:
            print(f"✗ limit.cap={lim.get('cap')}（落盘应为 1 GiB；32 MiB = 硬编码错）"); ok = False
        else:
            print(f"   saveMode=1 · saveWritten={lim.get('saveWritten')}B · cap={lim.get('cap')}B（1GiB）")
    sys.exit(0 if ok else 1)
if stream_on:
    reason = str(d.get("reason") or "")
    if d.get("ok") is not False:
        print("✗ stream 未被拒绝（仍静默降级？）"); ok = False
    elif "fetch.unsupported" not in reason:
        print(f"✗ stream 拒绝码不是 fetch.unsupported：{reason[:100]}"); ok = False
    elif "一次性 VM" not in reason or "同步 napi" not in reason:
        print(f"✗ stream 拒绝信息没点明根因：{reason[:120]}"); ok = False
    else:
        print(f"✅ stream 如实拒绝：{reason[:110]}")
    sys.exit(0 if ok else 1)
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
        # ★★★#1186：**传输读数**（含 HTTPDNS 的每请求可观测面）
        #   ★为什么必须在探针侧判：鸿蒙探针走原生直调，JS 拿不到 `meta.transport`.
        tp = d.get("transport") or {}
        if not tp:
            print("✗ 回执缺 transport（#1186 未接线）"); ok = False
        else:
            print(f"   transport：{json.dumps(tp, ensure_ascii=False)}")
            # 装了表 ⇒ 必须能看到 dnsSource=table（这是"表真的生效"的每请求直接证据）
            dn = d.get("dns") or {}
            if (dn.get("tableRules") or 0) > 0:
                src = tp.get("dnsSource")
                if src != "table":
                    print(f"✗ 装了表但 dnsSource={src!r}（应为 table）"); ok = False
                if tp.get("dnsTableHit") != "1":
                    print(f"✗ dnsTableHit={tp.get('dnsTableHit')!r}（应为 \"1\"）"); ok = False
                if src == "table":
                    print("✅ 每请求可观测面成立：transport.dnsSource=table · dnsTableHit=1")
            else:
                # 没装表 ⇒ dnsSource 必须**不出现**（没发生解析 ≠ 走了系统 DNS）
                if "dnsSource" in tp:
                    print(f"✗ 未装表却报了 dnsSource={tp.get('dnsSource')!r}（伪造来源）"); ok = False
                else:
                    print("✅ 未装表：dnsSource 不出现（符合「缺键=不可得」）")
sys.exit(0 if ok else 1)
PY
RC=$?
# ★★★#1190（独立验证 J6 修复）：**设备侧 stat 校验**——不能只信探针自报的摘要。
#   原判据全程只读 `preview.size`，写入 0 字节但摘要报 219 也能全绿。
#   ⇒ 传了 savePath 时，用 hdc 在**设备上**核对文件真实存在且大小等于摘要。
# ★#1192：expect-reject 模式没有落盘文件可核对 ⇒ 跳过 stat
if [ "$RC" = "0" ] && [ -n "$SAVE_PATH" ] && [ -z "$EXPECT_REJECT" ]; then
  SIZE_REPORTED="$(python3 -c "
import json,sys,re
d=json.load(open('$RESULTS/http-probe.json'))
m=re.search(r'\"size\":(\d+)', d.get('preview') or '')
print(m.group(1) if m else '')" 2>/dev/null)"
  SIZE_ON_DEVICE="$(HDC shell "stat -c %s '$FILES_DEV/$SAVE_PATH'" 2>/dev/null | tr -d ' \r\n')"
  if [ -z "$SIZE_ON_DEVICE" ]; then
    echo "  ✗ 设备上找不到落盘文件：$FILES_DEV/$SAVE_PATH"; RC=1
  elif [ "$SIZE_ON_DEVICE" != "$SIZE_REPORTED" ]; then
    echo "  ✗ 设备文件大小($SIZE_ON_DEVICE) != 回执 size($SIZE_REPORTED)——摘要不可信"; RC=1
  else
    echo "  ✓ 设备侧核对：$SAVE_PATH 真实存在且大小 = $SIZE_ON_DEVICE B（与回执一致）"
  fi
fi
[ "$RC" = "0" ] && echo "  ✓ 鸿蒙 T-app-fetch 真机判据通过" || { echo "  ✗ 判据失败"; exit "$RC"; }
