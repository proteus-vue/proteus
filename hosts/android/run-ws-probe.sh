#!/usr/bin/env bash
# hosts/android/run-ws-probe.sh —— ★★★决策 #1093：C27 WebSocket **端到端真机判据**（Android）
#
# 【它证明什么（缺一即红）】`ws.open` 真的连上（不是"受理即返"就算）· 文本往返 · **二进制往返**
#   （掩码/长度编码错了这里必炸）· 大消息（>125 字节触发 2 字节长度扩展）· 对端关闭的 close code
#   · 关闭后活跃连接归零。详见 `dev/WebSocketProbe.java`。
#
# 【为什么本地起 echo 服务（而不是连公网）】
#   判据要**可复现**：公网服务不可控（限流/断连/内容变化），且会引入外网依赖。
#   本脚本用仓内已有的 `ws` 包起一个 echo 服务，设备经 `adb reverse` 访问 `127.0.0.1:<port>`。
#
# 前置：① APK 已构建（`bash hosts/android/build-and-run.sh --no-install`）② 设备已连接
# 用法：bash hosts/android/run-ws-probe.sh [port]
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
PKG="dev.proteus.layoutcore"
APK="$HERE/build/proteus-layoutcore.apk"
PORT="${1:-8787}"
REPORT="/sdcard/Android/data/$PKG/files/ws-probe.json"
LOCAL_REPORT="$HERE/results/ws-probe.json"
SERVER_LOG="$HERE/results/ws-probe-server.log"

[ -x "$ADB" ] || { echo "✗ 缺 adb（${ADB}）"; exit 2; }
[ -f "$APK" ] || { echo "✗ 缺 APK——先跑：bash hosts/android/build-and-run.sh --no-install"; exit 2; }
"$ADB" shell true >/dev/null 2>&1 || { echo "✗ 无设备（adb devices）"; exit 2; }

WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
[ -x "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }

mkdir -p "$HERE/results"
rm -f "${LOCAL_REPORT}" "${SERVER_LOG}"

echo "==> ① 起本地 WebSocket echo 服务（port=${PORT}）"
node "$HERE/tools/ws-echo-server.mjs" "$PORT" > "${SERVER_LOG}" 2>&1 &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  "$ADB" reverse --remove "tcp:$PORT" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# 有界等待服务就绪（★探**端口连通性**，不是盲等；--file+--grep 不适用于本 wait_for 实现）
if ! bash "$WAIT_SH" --port "127.0.0.1:${PORT}" --timeout 15 --interval 1 --max-interval 2; then
  echo "✗ echo 服务未就绪（见 ${SERVER_LOG}）"; exit 3
fi
echo "    服务已就绪"

echo "==> ② adb reverse（设备 127.0.0.1:${PORT} → 本机 ${PORT}）"
"$ADB" reverse "tcp:$PORT" "tcp:$PORT" >/dev/null 2>&1 || { echo "✗ adb reverse 失败"; exit 3; }

echo "==> ③ 安装 + 触发 ws-probe"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
# ★删旧报告**必须在启动前**且**不能吞错**：吞错会让上一轮的旧报告冒充本轮结果
#   （实测：首版 `|| true` ⇒ 判据读到上一轮的文件，白跑一轮）
"$ADB" shell "rm -f ${REPORT}" >/dev/null 2>&1
if "$ADB" shell "test -f ${REPORT}" >/dev/null 2>&1; then
  echo "✗ 旧报告删不掉（${REPORT}）——判据会读到陈旧结果"; exit 4
fi
# ★探针由**广播**触发（与 run-element-probe.sh 同一纪律：onCreate 不自动跑，§9.2 起点=显式触发）
"$ADB" shell "am start -n $PKG/.MainActivity --es path ws-probe" >/dev/null 2>&1
bash "$WAIT_SH" --cmd "\"$ADB\" logcat -d -s 'proteus:I' | grep -q run-receiver-ready" --timeout 30 --interval 1 --max-interval 3 || echo "  ⚠ 未见 run-receiver-ready（30s）——广播可能丢"
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path ws-probe --es wsUrl 'ws://127.0.0.1:${PORT}' -p $PKG" >/dev/null 2>&1

# 有界等待报告落盘（产物出现即完成信号，零轮询盲等）
if ! bash "$WAIT_SH" --cmd "\"$ADB\" shell \"test -f $REPORT\" >/dev/null 2>&1" --timeout 90 --interval 1 --max-interval 2; then
  echo "✗ 报告未生成（90s）——看 logcat："
  "$ADB" logcat -d -s 'proteus-ws:I' 'proteus-cap:I' | tail -30
  exit 4
fi

"$ADB" pull "$REPORT" "${LOCAL_REPORT}" >/dev/null 2>&1 || { echo "✗ 拉取报告失败"; exit 4; }

echo "==> ④ 判定"
node - "${LOCAL_REPORT}" <<'NODE'
const fs = require('fs')
const p = process.argv[2]
let r
try { r = JSON.parse(fs.readFileSync(p, 'utf8')) } catch (e) { console.error(`✗ 报告非 JSON：${e.message}`); process.exit(1) }
const probe = r.probe || {}
const checks = [
  ['引擎加载', r.engine_available === true],
  ['渲染/boot', r.boot_ok === true && r.render_ok === true],
  ['ws.open 受理', probe.connect_ok === true],
  ['open 事件到达', probe.open_ok === true],
  ['文本 echo 往返', probe.echo_ok === true],
  ['二进制 echo 往返', probe.binary_ok === true],
  ['大消息（300B）往返', probe.big_ok === true],
  ['close 事件（code）', probe.close_ok === true],
]
let bad = 0
for (const [name, ok] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}`)
  if (!ok) bad++
}
console.log('  读数：' + JSON.stringify({
  echo: probe.echo, binary: probe.binary, big_len: probe.big_len,
  close_code: probe.close_code, steps: probe.steps,
}))
if (r.error) console.log(`  错误：${r.error}`)
if (probe.error) console.log(`  探针错误：${probe.error}`)
process.exit(bad === 0 ? 0 : 1)
NODE
RC=$?

if [ $RC -eq 0 ]; then
  echo "✅ WebSocket 真机判据通过（连接/文本/二进制/大消息/关闭 全通）"
  echo "   报告：${LOCAL_REPORT}"
else
  echo "❌ WebSocket 真机判据失败（见上方逐项）"
  echo "   报告：${LOCAL_REPORT} · 服务日志：${SERVER_LOG}"
fi
exit $RC
