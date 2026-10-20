#!/usr/bin/env bash
# hosts/ios/run-fetch-limit-probe.sh —— ★★★决策 #1115：C26 **响应体上限**真机判据（iOS）
#
# 【它证明什么】请求 64 MiB 响应（两倍于两端 32 MiB 上限），两道闸都必须返回 `fetch.tooLarge`：
#   · declared：带 content-length ⇒ 走**预判**闸
#   · chunked ：不声明长度 ⇒ 走**逐块累计**闸（且必须 `task.cancel()` 真中止）
#
# 【★与 Android 版的关键差异】
#   ① 无 adb reverse ⇒ 服务绑 0.0.0.0，设备经**局域网 IP** 访问；
#   ② iOS 的回推是 `DispatchQueue.main.async` ⇒ **绝不能**在主线程循环等待（会饿死回推）。
#      壳里 `--fetch-limit-probe=` 分支用 **asyncAfter 链**推进（确定性事件，不是盲等）。
#
# 用法：bash hosts/ios/run-fetch-limit-probe.sh [port] [sizeMiB]
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
source "$HERE/lib/xcode-env.sh"

PORT="${1:-8792}"
SIZE_MIB="${2:-64}"
LOCAL_REPORT="$HERE/results/superapp.json"
SERVER_LOG="$HERE/results/fetch-limit-probe-server-ios.log"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

[ -x "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
if [ -z "$LAN_IP" ]; then echo "✗ 取不到本机局域网 IP"; exit 2; fi
BASE="http://${LAN_IP}:${PORT}"
echo "==> 服务基址（设备侧）：$BASE"

mkdir -p "$HERE/results"
rm -f "$LOCAL_REPORT" "$SERVER_LOG"

node "$ROOT/hosts/android/tools/transfer-echo-server.mjs" "$PORT" 0.0.0.0 > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT

if ! bash "$WAIT_SH" --port "127.0.0.1:${PORT}" --timeout 15 --interval 1 --max-interval 2; then
  echo "✗ 服务未就绪（见 ${SERVER_LOG}）"; exit 3
fi
echo "    服务已就绪"

echo "==> 构建 + 安装 + 启动（superapp --fetch-limit-probe=${BASE},${SIZE_MIB}）"
bash "$HERE/run-selfdraw.sh" --superapp "--fetch-limit-probe=${BASE},${SIZE_MIB}" 2>&1 | tail -12

[ -f "$LOCAL_REPORT" ] || { echo "✗ 报告未取回（${LOCAL_REPORT}）"; exit 4; }

echo "==> 判定"
node - "$LOCAL_REPORT" <<'NODE'
const fs = require('fs')
let r
try { r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) } catch (e) { console.error(`✗ 报告非 JSON：${e.message}`); process.exit(1) }
let p = r.fetch_limit_probe
if (typeof p === 'string') { try { p = JSON.parse(p) } catch { p = null } }
const checks = [
  ['探针已执行（有 rounds 读数）', typeof r.fetch_limit_probe_rounds === 'number'],
  ['★声明长度闸：fetch.tooLarge', p && p.declared_code === 'fetch.tooLarge'],
  ['★chunked 累计闸：fetch.tooLarge', p && p.chunked_code === 'fetch.tooLarge'],
  ['整体 fetch_limit_ok', r.fetch_limit_ok === true],
]
let bad = 0
for (const [name, ok] of checks) { console.log(`  ${ok ? '✓' : '✗'} ${name}`); if (!ok) bad++ }
console.log('  读数：' + JSON.stringify({ rounds: r.fetch_limit_probe_rounds, base: r.fetch_limit_base, size_mib: r.fetch_limit_size_mib, probe: p }))
if (bad) {
  console.log('\n  ★诊断：declared_code/chunked_code 为 fetch.failed ⇒ 错误码没到位；')
  console.log('    为 undefined 且请求成功 ⇒ 上限未生效；probe 为空 ⇒ 装置问题（超时/hook 缺失）')
}
process.exit(bad === 0 ? 0 : 1)
NODE
RC=$?

if [ $RC -eq 0 ]; then echo "✅ iOS 响应体上限真机生效（两道闸都返回 fetch.tooLarge）"; else echo "❌ iOS 判据失败 · 服务日志：${SERVER_LOG}"; fi
exit $RC
