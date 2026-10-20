#!/usr/bin/env bash
# hosts/android/run-fetch-limit-probe.sh —— ★★★决策 #1115：C26 **响应体上限**的真机判据（Android）
#
# 【它证明什么】请求 64 MiB 响应（两倍于两端 32 MiB 上限），必须拿到 `code === 'fetch.tooLarge'`。
#   两道闸各测一次：`chunked=0`（带 content-length ⇒ 预判闸）/ `chunked=1`（分块 ⇒ 累计闸）。
#   ★"成功返回"也算失败（= 上限没生效）。
#
# 【装置】本地 HTTP 服务（`transfer-echo-server.mjs` 的 /huge 端点）+ adb reverse（设备访问 127.0.0.1）
#   ——全部走 127.0.0.1，不经公网（公网限流/断连会与"宿主腿有 bug"混淆）。
#
# 用法：bash hosts/android/run-fetch-limit-probe.sh [port] [sizeMiB]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

PORT="${1:-8791}"
SIZE_MIB="${2:-64}"
PKG="dev.proteus.layoutcore"
ADB="${ADB:-adb}"
APK="${PROTEUS_APK:-$ROOT/build/proteus-layoutcore.apk}"
REPORT="/sdcard/Android/data/$PKG/files/fetch-limit-probe.json"
LOCAL_REPORT="$HERE/results/fetch-limit-probe.json"
SERVER_LOG="$HERE/results/fetch-limit-probe-server.log"
mkdir -p "$HERE/results"

[ -f "$APK" ] || { echo "✗ 找不到 APK：$APK（先 build，或用 PROTEUS_APK= 指路径）"; exit 3; }
"$ADB" get-state >/dev/null 2>&1 || { echo "✗ 设备未连接"; exit 3; }

echo "==> ① 起本地服务（port ${PORT}）"
node "$HERE/tools/transfer-echo-server.mjs" "$PORT" 0.0.0.0 > "$SERVER_LOG" 2>&1 &
SRV=$!
cleanup() {
  kill "$SRV" 2>/dev/null || true
  "$ADB" reverse --remove "tcp:${PORT}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! bash "$WAIT_SH" --port "127.0.0.1:${PORT}" --timeout 15 --interval 1 --max-interval 2; then
  echo "✗ 服务未就绪（见 ${SERVER_LOG}）"; exit 3
fi
echo "    服务已就绪"

echo "==> ② adb reverse（设备 127.0.0.1:${PORT} → 本机 ${PORT}）"
"$ADB" reverse "tcp:${PORT}" "tcp:${PORT}" >/dev/null 2>&1 || { echo "✗ adb reverse 失败"; exit 3; }

echo "==> ③ 安装 + 触发 fetch-limit-probe（size=${SIZE_MIB}MiB）"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "rm -f ${REPORT}" >/dev/null 2>&1
if "$ADB" shell "test -f ${REPORT}" >/dev/null 2>&1; then
  echo "✗ 旧报告删不掉（${REPORT}）——判据会读到陈旧结果"; exit 4
fi
# ★★参数必须走 `am start --es/--ei`（进**启动 intent**）——
#   广播的 extra **不会**进 `MainActivity.getIntent()`（实测踩到：探针读到默认 base 8788）。
"$ADB" shell "am start -n $PKG/.MainActivity --es path fetch-limit-probe --es base 'http://127.0.0.1:${PORT}' --ei size_mib ${SIZE_MIB}" >/dev/null 2>&1
bash "$WAIT_SH" --cmd "\"$ADB\" logcat -d -s 'proteus:I' | grep -q run-receiver-ready" --timeout 30 --interval 1 --max-interval 3 \
  || echo "  ⚠ 未见 run-receiver-ready（30s）"
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path fetch-limit-probe -p $PKG" >/dev/null 2>&1

if ! bash "$WAIT_SH" --cmd "\"$ADB\" shell \"test -f ${REPORT}\" >/dev/null 2>&1" --timeout 180 --interval 1 --max-interval 3; then
  echo "✗ 报告未生成——看 logcat / 服务日志"
  tail -20 "$SERVER_LOG" || true
  exit 4
fi

"$ADB" pull "$REPORT" "$LOCAL_REPORT" >/dev/null 2>&1 || { echo "✗ 拉取报告失败"; exit 4; }

echo "==> ④ 判定"
node - "$LOCAL_REPORT" <<'NODE'
const fs = require('fs')
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const p = r.probe || {}
const checks = [
  ['探针已启动', String(r.probe_kick || '').includes('started')],
  ['★声明长度闸：fetch.tooLarge', p.declared_code === 'fetch.tooLarge'],
  ['★chunked 累计闸：fetch.tooLarge', p.chunked_code === 'fetch.tooLarge'],
  ['整体 ok', p.ok === true],
]
let bad = 0
for (const [name, ok] of checks) { console.log(`  ${ok ? '✅' : '✗'} ${name}`); if (!ok) bad++ }
if (bad) {
  console.log('\n  报告原文：')
  console.log(JSON.stringify(r, null, 2).slice(0, 2000))
  console.log('\n  ★诊断提示：declared_code/chunked_code 若为 fetch.failed ⇒ 错误码没到位；')
  console.log('    若为 undefined 且请求成功 ⇒ 上限没生效；若 probe 为空 ⇒ 装置问题（超时/hook 缺失）')
  process.exit(1)
}
console.log('\n✅ 响应体上限真机生效（两道闸都返回 fetch.tooLarge）')
NODE
