#!/usr/bin/env bash
# hosts/android/run-redirect-probe.sh —— ★★★#1134：**重定向拦截**真机判据（Android）
#
# 【它证明什么（缺一不算"重定向可拦"）】
#   ① `redirect:'manual'` ⇒ 拿到 **302 + Location**（没有跳到终点）；
#   ② `onRedirect` 两跳链 ⇒ 回调 **2 次**，from/to/status 可读；
#   ③ `stop` ⇒ `fetch.redirectStopped` 且回调**只调 1 次**；
#   ④ 环 + `maxRedirects=2` ⇒ `fetch.tooManyRedirects`；
#   ⑤ ★**跨域跳转剥离 Authorization**（服务端 `/__seen` 视角取证——客户端说没带不算）。
#
# 【★为什么要两个端口】跨域判定看 scheme+host+port ⇒ 同一进程两个 listener 造"另一 origin"，
#   不依赖外网（判据可复现；公网无法区分"连不上"与"腿有 bug"）。
#
# 用法：bash hosts/android/run-redirect-probe.sh [portA] [portB]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

PORT_A="${1:-8801}"
PORT_B="${2:-8802}"
MAX_REDIRECTS="${PROTEUS_REDIRECT_PROBE_MAX:-2}"
PKG="dev.proteus.layoutcore"
ADB="${ADB:-adb}"
APK="${PROTEUS_APK:-$HERE/build/proteus-layoutcore.apk}"
REPORT="/sdcard/Android/data/$PKG/files/redirect-probe.json"
LOCAL_REPORT="$HERE/results/redirect-probe.json"
SERVER_LOG="$HERE/results/redirect-probe-server.log"
mkdir -p "$HERE/results"

[ -f "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
[ -f "$APK" ] || { echo "✗ 找不到 APK：$APK"; exit 3; }
"$ADB" get-state >/dev/null 2>&1 || { echo "✗ 设备未连接"; exit 3; }

echo "==> ① 起本地服务（A:${PORT_A} B:${PORT_B}，两个 origin）"
node "$HERE/tools/redirect-echo-server.mjs" "$PORT_A" "$PORT_B" > "$SERVER_LOG" 2>&1 &
SRV=$!
cleanup() {
  kill "$SRV" 2>/dev/null || true
  "$ADB" reverse --remove "tcp:${PORT_A}" >/dev/null 2>&1 || true
  "$ADB" reverse --remove "tcp:${PORT_B}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# 服务"主动上报"就绪（读 stdout 的 READY 行）——不盲等
if ! bash "$WAIT_SH" --port "127.0.0.1:${PORT_A}" --timeout 15 --interval 1 --max-interval 2; then
  echo "✗ 服务 A 未就绪（见 ${SERVER_LOG}）"; exit 3
fi
if ! bash "$WAIT_SH" --port "127.0.0.1:${PORT_B}" --timeout 15 --interval 1 --max-interval 2; then
  echo "✗ 服务 B 未就绪（见 ${SERVER_LOG}）"; exit 3
fi
"$ADB" reverse "tcp:${PORT_A}" "tcp:${PORT_A}" >/dev/null 2>&1 || { echo "✗ adb reverse A 失败"; exit 3; }
"$ADB" reverse "tcp:${PORT_B}" "tcp:${PORT_B}" >/dev/null 2>&1 || { echo "✗ adb reverse B 失败"; exit 3; }
echo "    两个服务就绪 + reverse 已建"

echo "==> ② 安装 + 触发 redirect-probe"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "rm -f ${REPORT}" >/dev/null 2>&1
if "$ADB" shell "test -f ${REPORT}" >/dev/null 2>&1; then
  echo "✗ 旧报告删不掉（等待信号会命中陈旧文件）"; exit 4
fi
"$ADB" shell "am start -n $PKG/.MainActivity --es path redirect-probe --es base 'http://127.0.0.1:${PORT_A}' --es cross_base 'http://127.0.0.1:${PORT_B}' --ei max_redirects ${MAX_REDIRECTS}" >/dev/null 2>&1
bash "$WAIT_SH" --cmd "\"$ADB\" logcat -d -s 'proteus:I' | grep -q run-receiver-ready" --timeout 30 --interval 1 --max-interval 3 \
  || echo "  ⚠ 未见 run-receiver-ready（30s）"
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path redirect-probe -p $PKG" >/dev/null 2>&1

if ! bash "$WAIT_SH" --cmd "\"$ADB\" shell \"test -f ${REPORT}\" >/dev/null 2>&1" --timeout 180 --interval 1 --max-interval 3; then
  echo "✗ 报告未生成——看 logcat / 服务日志"
  "$ADB" logcat -d -s 'proteus:I' | tail -20 || true
  exit 4
fi

"$ADB" pull "$REPORT" "$LOCAL_REPORT" >/dev/null 2>&1 || { echo "✗ 拉取报告失败"; exit 4; }

echo "==> ③ 判定"
node - "$LOCAL_REPORT" <<'NODE'
const fs = require('fs')
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const p = r.probe || {}
const chk = []
const add = (ok, msg) => chk.push([ok, msg])

add(String(r.probe_kick || '').includes('started'), '探针已启动')
add(p.ok === true, '整体 ok（probe.ok）')
add(p.manual_status === 302, `★manual 拿到 302（实得 ${p.manual_status}）——不是跳到终点`)
add(p.manual_has_location === true, `★响应带 Location（实得 ${p.manual_location || '空'}）`)
add(p.hop_count === 2, `★两跳链回调 2 次（实得 ${p.hop_count}）`)
add(p.hop_from_to_ok === true, '每跳 from/to 都可读且不同')
add(p.hop_final_ok === true, '逐跳跟随后成功到终点')
add(p.stop_ok === true, `★stop ⇒ fetch.redirectStopped（实得 ${p.stop_code}）`)
add(p.stop_single_call === true, `★stop 后不再调回调（实得 ${p.stop_calls} 次）`)
add(p.limit_ok === true, `★限额拦住环 ⇒ fetch.tooManyRedirects（实得 ${p.limit_code}）`)
add(p.cross_stripped === true, `★★跨域剥离 Authorization（服务端终点收到 "${p.cross_final_auth ?? ''}"）`)
add(p.cross_cookie_stripped === true, `★★跨域剥离 Cookie（服务端终点收到 "${p.cross_final_cookie ?? ''}"）—— #1257`)
add(p.cross_default_cookie_stripped === true, `★★默认跟随路径也不泄露 Cookie（终点收到 "${p.cross_default_final_cookie ?? ''}"）—— 修复前正是这条路泄露`)

let bad = 0
for (const [ok, msg] of chk) { console.log(`  ${ok ? '✅' : '✗'} ${msg}`); if (!ok) bad++ }
console.log(`\n  读数：${JSON.stringify({
  manual: p.manual_status,
  hops: p.hop_count,
  stop: p.stop_code,
  limit: p.limit_code,
  cross_auth: p.cross_final_auth,
})}`)
if (bad) {
  console.log('\n  ★诊断：manual_status=200 ⇒ 宿主仍在跟随（setInstanceFollowRedirects 没生效）；')
  console.log('          cross_final_auth 非空 ⇒ ★凭据泄露到第三方域（安全缺陷，必修）')
  console.log('          cross_final_cookie 含 SECRET_1257 ⇒ ★★会话 cookie 泄露（#1257 守卫失效）')
  console.log('  报告原文：' + JSON.stringify(r).slice(0, 1600))
  process.exit(1)
}
console.log('\n✅ 重定向可拦（manual / 逐跳拦截 / 限额 / 跨域剥离凭据 全部到位）')
NODE
