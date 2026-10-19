#!/usr/bin/env bash
# hosts/android/run-transfer-probe.sh —— ★★★决策 #1095：C29/C30 **上传/下载真机判据**（Android）
#
# 【它证明什么】下载落盘 → 读回 → 上传 → 服务端逐字节摘要核对（详见 dev/TransferProbe.java）。
#   另验沙箱安全边界（绝对路径 / '..' 必须被拒）与 fs.remove 幂等。
#
# 【为什么本地起服务】判据要可复现：公网会限流/断连，而"连不上"与"宿主腿有 bug"无法区分。
#   设备经 adb reverse 访问 127.0.0.1（不经公网）——与 run-ws-probe.sh 同款。
#
# 前置：APK 已构建（bash hosts/android/build-and-run.sh --no-install）· 设备已连接
# 用法：bash hosts/android/run-transfer-probe.sh [port]
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
PKG="dev.proteus.layoutcore"
APK="$HERE/build/proteus-layoutcore.apk"
PORT="${1:-8788}"
REPORT="/sdcard/Android/data/$PKG/files/transfer-probe.json"
LOCAL_REPORT="$HERE/results/transfer-probe.json"
SERVER_LOG="$HERE/results/transfer-probe-server.log"

[ -x "$ADB" ] || { echo "✗ 缺 adb（${ADB}）"; exit 2; }
[ -f "$APK" ] || { echo "✗ 缺 APK——先跑：bash hosts/android/build-and-run.sh --no-install"; exit 2; }
"$ADB" shell true >/dev/null 2>&1 || { echo "✗ 无设备（adb devices）"; exit 2; }

WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
[ -x "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }

mkdir -p "$HERE/results"
rm -f "$LOCAL_REPORT" "$SERVER_LOG"

echo "==> ① 起本地 HTTP 服务（echo upload / download，port=${PORT}）"
node "$ROOT/hosts/android/tools/transfer-echo-server.mjs" "$PORT" 127.0.0.1 > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  "$ADB" reverse --remove "tcp:${PORT}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! bash "$WAIT_SH" --port "127.0.0.1:${PORT}" --timeout 15 --interval 1 --max-interval 2; then
  echo "✗ 服务未就绪（见 ${SERVER_LOG}）"; exit 3
fi
echo "    服务已就绪"

echo "==> ② adb reverse（设备 127.0.0.1:${PORT} → 本机 ${PORT}）"
"$ADB" reverse "tcp:${PORT}" "tcp:${PORT}" >/dev/null 2>&1 || { echo "✗ adb reverse 失败"; exit 3; }

echo "==> ③ 安装 + 触发 transfer-probe"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "rm -f ${REPORT}" >/dev/null 2>&1
if "$ADB" shell "test -f ${REPORT}" >/dev/null 2>&1; then
  echo "✗ 旧报告删不掉（${REPORT}）——判据会读到陈旧结果"; exit 4
fi
"$ADB" shell "am start -n $PKG/.MainActivity --es path transfer-probe" >/dev/null 2>&1
bash "$WAIT_SH" --cmd "\"$ADB\" logcat -d -s 'proteus:I' | grep -q run-receiver-ready" --timeout 30 --interval 1 --max-interval 3 || echo "  ⚠ 未见 run-receiver-ready（30s）"
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path transfer-probe --es transferUrl 'http://127.0.0.1:${PORT}' -p $PKG" >/dev/null 2>&1

if ! bash "$WAIT_SH" --cmd "\"$ADB\" shell \"test -f ${REPORT}\" >/dev/null 2>&1" --timeout 120 --interval 1 --max-interval 2; then
  echo "✗ 报告未生成——看 logcat / 服务日志"
  cat "$SERVER_LOG" | tail -20
  exit 4
fi

"$ADB" pull "$REPORT" "$LOCAL_REPORT" >/dev/null 2>&1 || { echo "✗ 拉取报告失败"; exit 4; }

echo "==> ④ 判定"
node - "$LOCAL_REPORT" <<'NODE'
const fs = require('fs')
let r
try { r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) } catch (e) { console.error(`✗ 报告非 JSON：${e.message}`); process.exit(1) }
const p = r.probe || {}
const checks = [
  ['引擎加载', r.engine_available === true],
  ['渲染/boot', r.boot_ok === true && r.render_ok === true],
  ['★沙箱拒绝绝对路径', r.abs_path_rejected === true],
  ['★沙箱拒绝 ..', r.dotdot_rejected === true],
  ['下载落盘', p.download_ok === true && typeof p.download_path === 'string' && p.download_path.length > 0],
  ['下载 status=200', p.download_status === 200],
  ['上传成功', p.upload_ok === true && p.upload_status === 200],
  ['★往返逐字节正确（4096B / first=0 / last=255 / fields.tag=probe）', p.roundtrip_ok === true],
]
let bad = 0
for (const [name, ok] of checks) { console.log(`  ${ok ? '✓' : '✗'} ${name}`); if (!ok) bad++ }
console.log('  读数：' + JSON.stringify({
  path: p.download_path, rounds: r.probe_rounds,
  reply: p.upload_reply, download_error: p.download_error, upload_error: p.upload_error,
}))
process.exit(bad === 0 ? 0 : 1)
NODE
RC=$?

if [ $RC -eq 0 ]; then
  echo "✅ 上传/下载真机判据通过（落盘/读回/往返逐字节/沙箱边界 全通）"
else
  echo "❌ 判据失败（见上）· 服务日志：${SERVER_LOG}"
fi
exit $RC
