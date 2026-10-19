#!/usr/bin/env bash
# hosts/ios/run-transfer-probe.sh —— ★★★决策 #1095：C29/C30 **上传/下载真机判据**（iOS）
#
# 【与 Android 版的关键差异】没有 adb reverse ⇒ 服务绑 0.0.0.0，设备经**局域网 IP** 访问；
#   URL 经 PROTEUS_TRANSFER_PROBE_URL 注入（run-selfdraw.sh 拼进 devicectl 环境变量）。
#
# 用法：bash hosts/ios/run-transfer-probe.sh [port]
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
source "$HERE/lib/xcode-env.sh"

PORT="${1:-8789}"
LOCAL_REPORT="$HERE/results/superapp.json"
SERVER_LOG="$HERE/results/transfer-probe-server-ios.log"
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

echo "==> 构建 + 安装 + 启动（superapp --drive，注入 PROTEUS_TRANSFER_PROBE_URL）"
PROTEUS_TRANSFER_PROBE_URL="$BASE" bash "$HERE/run-selfdraw.sh" --superapp --drive 2>&1 | tail -12

[ -f "$LOCAL_REPORT" ] || { echo "✗ 报告未取回（${LOCAL_REPORT}）"; exit 4; }

echo "==> 判定"
node - "$LOCAL_REPORT" <<'NODE'
const fs = require('fs')
let r
try { r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) } catch (e) { console.error(`✗ 报告非 JSON：${e.message}`); process.exit(1) }
// ★★★#1095 / 决策 #1065 的判据落点纪律：`reportBody()` 是**单相位**结构，
//   真实网络回推要等宿主主循环转起来 ⇒ 在里面等一次 http 响应必然卡死。
//   ⇒ iOS 判据 = ① 宿主 fs 往返（**同步**，不依赖网络）② 派发通路。
//     完整 4096B 往返由 **Android 真机探针**覆盖（已全绿，服务端逐字节核对）。
let fsProbe = r.transfer_fs
if (typeof fsProbe === 'string') { try { fsProbe = JSON.parse(fsProbe) } catch { fsProbe = null } }
const checks = [
  ['探针已注入（PROTEUS_TRANSFER_PROBE_URL）', r.transfer_url !== undefined],
  ['★宿主 fs: writeBytes', fsProbe && fsProbe.writeOk === true],
  ['★宿主 fs: readBytes', fsProbe && fsProbe.readOk === true],
  ['★宿主 fs: 读回字节逐字节一致 [1,2,3,255]', fsProbe && fsProbe.same === true],
  ['派发通路（transfer 钩子已受理）', r.transfer_dispatch_ok === true],
  ['综合 transfer_ok', r.transfer_ok === true],
]
let bad = 0
for (const [name, ok] of checks) { console.log(`  ${ok ? '✓' : '✗'} ${name}`); if (!ok) bad++ }
console.log('  读数：' + JSON.stringify({ fs: fsProbe, dispatch: r.transfer_dispatch, note: r.transfer_note }))
process.exit(bad === 0 ? 0 : 1)
NODE
RC=$?

if [ $RC -eq 0 ]; then echo "✅ iOS 上传/下载真机判据通过"; else echo "❌ iOS 判据失败 · 服务日志：${SERVER_LOG}"; fi
exit $RC
