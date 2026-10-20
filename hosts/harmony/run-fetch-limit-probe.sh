#!/usr/bin/env bash
# hosts/harmony/run-fetch-limit-probe.sh —— ★★★#1117 鸿蒙响应体上限（S2）真机判据
#
# 【要证明什么（三条，缺一条都不算 S2）】
#   ① **上限真的接上了**：`/huge`（declared + chunked 两种）必须回 `fetch.tooLarge`，
#      且**恰好 32 MiB 的响应必须成功**（同一份判据里的正例——只测超限会把"上限写成 1KB"也判绿）。
#   ② **是"边读边掐"而不是"读完再拒"**：回执 `limit` 里 `chunks > 1` 且 `cancelCalled == true`。
#      ★这条是本判据的核心：只看错误码，`读完 64 MiB 再拒绝` 与 `读到 32 MiB 就中止` **完全同形**。
#   ③ **内存有界**：`kept <= cap`（越线后不再累积）。
#
# 【本机服务如何被设备访问】鸿蒙没有 adb reverse，但有 `hdc rport`（远端端口 → 本机）；
#   设备侧用 `http://127.0.0.1:<port>` 访问（本脚本先建 rport、退出时删除）。
#
# 【完成信号 = 报告落盘】App 侧 `scene=superapp-http` 落 `<filesDir>/http-probe.json` 并打
#   `PROTEUS_HTTP_PROBE_DONE`；本脚本条件等待文件出现（零 sleep 盲等）。
#
# 前置：bash hosts/harmony/build-host-app.sh
# 用法：bash hosts/harmony/run-fetch-limit-probe.sh [--size 40] [--skip-build]
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
HDC() { bash "$HERE/hdc.sh" "$@"; }

BUNDLE="dev.proteus.host"
PORT="${PROTEUS_FETCH_LIMIT_PORT:-8791}"
HAP_DIR="$HERE/host-app/entry/build/default/outputs/default"
RESULTS="$HERE/results"
FILES_DEV="/data/app/el2/100/base/$BUNDLE/haps/entry/files"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
SERVER_LOG="$RESULTS/fetch-limit-probe-server.log"
SIZE_MIB="${PROTEUS_FETCH_LIMIT_SIZE:-40}"   # > 32 MiB 上限
SKIP_BUILD=0

while [ $# -gt 0 ]; do
  case "$1" in
    --size) SIZE_MIB="$2"; shift 2 ;;
    --size=*) SIZE_MIB="${1#--size=}"; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    *) echo "未知参数：$1"; exit 2 ;;
  esac
done

[ -f "$WAIT" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
mkdir -p "$RESULTS"

STATE="$(HDC list targets -v 2>/dev/null | head -1)"
case "$STATE" in *Connected*) ;; *) echo "✗ 无设备/未授权（${STATE}）"; exit 2 ;; esac

# ★★★前置：锁屏时 `aa start` 直接失败（Error 10106102 "device screen is locked"）——
#   与 Android 验收"灭屏时只渲染个位数帧"同族：**设备状态是判据前提，必须先查**。
#   `power-shell wakeup` 幂等，成功即返回（不是盲等）。
HDC shell "power-shell wakeup" >/dev/null 2>&1 || true
LAUNCH_PROBE="$(HDC shell "aa start -a EntryAbility -b dev.proteus.host --ps scene superapp-http --ps url about:blank" 2>&1 || true)"
case "$LAUNCH_PROBE" in
  *"screen is locked"*) echo "✗ 屏幕仍锁（开发者模式下无法自动解锁）——请手动解锁后重跑"; exit 2 ;;
esac
echo "==> 设备=$STATE  上限=32 MiB  超限样本=${SIZE_MIB} MiB"

if [ "$SKIP_BUILD" = "0" ]; then
  echo "==> 构建 HAP（含 HAR native）"
  bash "$HERE/build-host-app.sh" > "$RESULTS/fetch-limit-build.log" 2>&1 \
    || { echo "✗ 构建失败（见 ${RESULTS}/fetch-limit-build.log）"; tail -20 "$RESULTS/fetch-limit-build.log"; exit 1; }
fi

HAP="$(ls -t "$HAP_DIR"/*-signed.hap 2>/dev/null | head -1)"
[ -n "$HAP" ] || { echo "✗ 缺签名 hap——先跑 bash hosts/harmony/build-host-app.sh"; exit 2; }

echo "==> ① 起本地服务 + 建 rport（设备侧 127.0.0.1:${PORT} → 本机 ${PORT}）"
rm -f "$SERVER_LOG"
node "$ROOT/hosts/android/tools/transfer-echo-server.mjs" "$PORT" 127.0.0.1 > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!
RPPORT_SET=0
cleanup() {
  if [ "$RPPORT_SET" = "1" ]; then HDC rport rm "tcp:${PORT} tcp:${PORT}" >/dev/null 2>&1 || true; fi
  kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT

if ! bash "$WAIT" --port "127.0.0.1:${PORT}" --timeout 15 --interval 1 --max-interval 2; then
  echo "✗ 服务未就绪（见 ${SERVER_LOG}）"; exit 3
fi
HDC rport "tcp:${PORT}" "tcp:${PORT}" >/dev/null 2>&1 || { echo "✗ hdc rport 失败"; exit 3; }
RPPORT_SET=1
echo "    服务就绪 + rport 已建"

echo "==> ② 安装 + 清场"
HDC install "$HAP" 2>&1 | grep -qiE "successfully|Success" || { echo "✗ 安装失败"; exit 1; }
HDC shell "aa force-stop $BUNDLE" >/dev/null 2>&1 || true
HDC shell "rm -f $FILES_DEV/http-probe.json" >/dev/null 2>&1 || true
if HDC shell "test -f $FILES_DEV/http-probe.json && echo STILL_EXISTS" 2>/dev/null | grep -q STILL_EXISTS; then
  echo "✗ 旧报告删不掉（等待信号会命中陈旧文件）"; exit 1
fi

run_case() {
  local name="$1" url="$2"
  echo "==> ③ [$name] $url"
  # ★★★必须 force-stop：`aa start` 对**已运行**的应用只会前置，不会重跑 `aboutToAppear`
  #   ⇒ 第二个用例开始就**不会落新报告**（实测：删了旧报告后干等 120s，日志里只有上一条 DONE）。
  #   这是"等待条件永远不可能满足"——比超时更糟的是它会看起来像网络/上限问题。
  HDC shell "aa force-stop $BUNDLE" >/dev/null 2>&1 || true
  HDC shell "rm -f $FILES_DEV/http-probe.json" >/dev/null 2>&1 || true
  HDC shell "aa start -a EntryAbility -b $BUNDLE --ps scene superapp-http --ps url '$url'" 2>&1 \
    | grep -qi "successfully" || { echo "✗ 启动失败"; return 1; }
  if ! bash "$WAIT" --cmd "bash '$HERE/hdc.sh' shell 'test -f $FILES_DEV/http-probe.json && echo READY' | grep -q READY" --timeout 120 --interval 3; then
    echo "✗ 120s 内未见 http-probe.json" >&2
    HDC shell "hilog -x | grep -E 'HTTP_PROBE|PROTEUS_HTTP' | tail -10" 2>&1 | sed 's/^/  /' >&2
    return 1
  fi
  local out="$RESULTS/fetch-limit-$name.json"
  rm -f "$out"
  HDC file recv "$FILES_DEV/http-probe.json" "$out" >/dev/null 2>&1 || { echo "✗ file recv 失败"; return 1; }
  [ -s "$out" ] || { echo "✗ 报告为空"; return 1; }
  echo "    回执：$(cat "$out")"
  return 0
}

BASE="http://127.0.0.1:${PORT}"
run_case declared "${BASE}/huge?size=$((SIZE_MIB * 1024 * 1024))&chunked=0" || exit 1
run_case chunked  "${BASE}/huge?size=$((SIZE_MIB * 1024 * 1024))&chunked=1" || exit 1
run_case exact    "${BASE}/huge?size=$((32 * 1024 * 1024))&chunked=0" || exit 1

echo "==> ④ 断言"
node - "$RESULTS" <<'NODE'
const fs = require('fs'), path = require('path')
const dir = process.argv[2]
const CAP = 32 * 1024 * 1024
const load = (n) => JSON.parse(fs.readFileSync(path.join(dir, `fetch-limit-${n}.json`), 'utf8'))
let bad = 0
// ★文案写"通过条件"（本轮踩过：写成失败条件后 ✓ 与文字互相矛盾，读日志的人会误判）
const chk = (ok, msg) => { console.log(`  ${ok ? '✓' : '✗'} ${msg}`); if (!ok) bad++ }

for (const n of ['declared', 'chunked']) {
  const d = load(n)
  const lim = d.limit || {}
  chk(d.ok === false, `[${n}] 超限被拒绝`)
  chk(/^fetch\.tooLarge:/.test(d.reason || ''), `[${n}] reason = fetch.tooLarge`)
  chk(lim.gateInstalled === true, `[${n}] 逐块回调已安装（不是事后拒绝）`)
  chk((lim.chunks || 0) > 1, `[${n}] 回调被逐块调用（${lim.chunks} 次）`)
  chk(lim.exceeded === true, `[${n}] 越线已标记`)
  chk(lim.cancelCalled === true, `[${n}] CancelRequest 已调用`)
  chk(lim.cancelRc === 0, `[${n}] CancelRequest 受理成功（rc=${lim.cancelRc}）`)
  chk((lim.kept || 0) <= CAP, `[${n}] 内存有界：保留 ${lim.kept} ≤ 上限 ${CAP}`)
  chk((lim.seen || 0) > CAP, `[${n}] 判据真触发：网络侧到达 ${lim.seen} > 上限`)
}
const ex = load('exact')
chk(ex.ok === true, `[exact] 恰好 32 MiB 放行（边界是 > 不是 >=）`)
chk((ex.limit || {}).exceeded === false, '[exact] 恰好上限不标记越线')
chk((ex.limit || {}).kept === CAP, `[exact] 载荷完整：保留 ${(ex.limit || {}).kept} = 32 MiB`)

// ★★诚实边界（不冒充"网络层真中止"）：本判据能证明的是**内存上界**（kept ≤ cap），
//   不能证明"cancel 之后网络上不再有字节到达"——本地回环上一份 40 MiB 响应可能已全部到达回调
//   （本轮实测 seen = 全量 41943040）。对 S2 而言关键是"不 OOM"，故判据断言 kept；
//   "网络侧止血"能力需要限速链路才能观测，属后续项（不在此处假装已验）。
const seenNote = ['declared', 'chunked'].map((n) => (load(n).limit || {}).seen)
console.log(`  ℹ 网络侧到达字节（cancel 后仍可能全量）：${seenNote.join(' / ')} —— 判据只断言内存上界`)
process.exit(bad === 0 ? 0 : 1)
NODE
RC=$?

if [ "$RC" = "0" ]; then
  echo "✅ 鸿蒙响应体上限（S2）真机判据通过：逐块回调 + 内存有界 + 边界放行"
  echo "   ★诚实边界：本判据证明的是**内存上界**（kept ≤ cap）与 cancel 受理（rc=0）；"
  echo "     不能证明「网络上不再有字节到达」——本地回环太快，40 MiB 已全部到达回调（见上方读数）。"
  echo "     要验网络层止血需限速链路，属后续项（已登记，不在此处假装已验）。"
else
  echo "❌ 鸿蒙响应体上限判据失败 · 服务日志：${SERVER_LOG}"
fi
exit "$RC"
