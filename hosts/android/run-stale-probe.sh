#!/usr/bin/env bash
# hosts/android/run-stale-probe.sh —— ★★★#1150：**RFC 5861（SWR / SIE）**真机判据（Android）
#
# 【它证明什么（Node 层判据证明不了）】
#   `tests/fetch-stale.test.ts` 验的是框架层语义；真机上多一层风险：
#   App 引擎**没有 setTimeout、没有全局 fetch** ⇒ SWR 的**后台校验**能否真发出去只能实测。
#   若发不出去，SWR 就退化成"永远返回旧值"——比不做更糟。
#
# 【判据（服务端记账为准）】
#   ① SWR 窗口内：status=stale/staleReason=swr + 立即返回 + 服务端随后收到**一次条件校验**
#      + 新值进缓存（第三次拿到更新的代）+ Age 头存在
#   ② SWR 窗口=0 ⇒ 不得返回 stale
#   ③ SIE：源站 503 ⇒ 用旧值兜底（业务看不到错误）
#
# 用法：bash hosts/android/run-stale-probe.sh [port]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

PORT="${1:-8804}"
PKG="dev.proteus.layoutcore"
ADB="${ADB:-adb}"
APK="${PROTEUS_APK:-$HERE/build/proteus-layoutcore.apk}"
REPORT="/sdcard/Android/data/$PKG/files/stale-probe.json"
LOCAL_REPORT="$HERE/results/stale-probe.json"
SERVER_LOG="$HERE/results/stale-probe-server.log"
mkdir -p "$HERE/results"

[ -f "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
[ -f "$APK" ] || { echo "✗ 找不到 APK：$APK"; exit 3; }
"$ADB" get-state >/dev/null 2>&1 || { echo "✗ 设备未连接"; exit 3; }

echo "==> ① 起本地服务（port ${PORT}，含 /swr /sie /swr-zero + 故障注入）"
node "$HERE/tools/cache-echo-server.mjs" "$PORT" 0.0.0.0 > "$SERVER_LOG" 2>&1 &
SRV=$!
cleanup() {
  kill "$SRV" 2>/dev/null || true
  "$ADB" reverse --remove "tcp:${PORT}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! bash "$WAIT_SH" --port "127.0.0.1:${PORT}" --timeout 15 --interval 1 --max-interval 2; then
  echo "✗ 服务未就绪（见 ${SERVER_LOG}）"; exit 3
fi
"$ADB" reverse "tcp:${PORT}" "tcp:${PORT}" >/dev/null 2>&1 || { echo "✗ adb reverse 失败"; exit 3; }
echo "    服务就绪 + reverse 已建"

echo "==> ② 安装 + 触发 stale-probe"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "rm -f ${REPORT}" >/dev/null 2>&1
if "$ADB" shell "test -f ${REPORT}" >/dev/null 2>&1; then
  echo "✗ 旧报告删不掉（等待信号会命中陈旧文件）"; exit 4
fi
"$ADB" shell "am start -n $PKG/.MainActivity --es path stale-probe --es base 'http://127.0.0.1:${PORT}'" >/dev/null 2>&1
bash "$WAIT_SH" --cmd "\"$ADB\" logcat -d -s 'proteus:I' | grep -q run-receiver-ready" --timeout 30 --interval 1 --max-interval 3 \
  || echo "  ⚠ 未见 run-receiver-ready（30s）"
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path stale-probe -p $PKG" >/dev/null 2>&1

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
const p = r.stale_probe || {}
const chk = []
const add = (ok, msg) => chk.push([ok, msg])

add(String(r.probe_kick || '').includes('started'), '探针已启动')
add(p.ok === true, '整体 ok（stale_probe.ok）')
add(p.swr_stale_ok === true, `★SWR 窗口内返回旧值（实得 ${JSON.stringify(p.swr_second_cache || {})}）`)
add(p.swr_immediate_ok === true, `★★SWR **立即返回**，没等后台校验（耗时 ${p.swr_second_elapsed_ms}ms）`)
add(p.swr_background_sent === true, `★★后台校验**真的发出去了**（服务端收到条件头即证）`)
add(p.swr_background_conditional_ok === true, `★后台校验是**条件请求**（服务端收到 ${p.swr_conditional_seen || '空'}）`)
add(p.swr_age_ok === true, `★缓存生成的响应带 Age 头（实得 "${p.swr_age_header}"；RFC 9111 §5.1 MUST）`)
add(p.swr_refreshed_ok === true, `★后台校验结果进了缓存（第三次拿到 ver=${p.swr_third_ver}，首次为 ver=1）`)
// ★#1150 修的真缺陷回归：`responseType:json` + 非 JSON 体（5xx 错误页）必须**结算**而不是挂起
add(p.sie_plain_503_ok === true, `★5xx 的 status/body 能完整回到 JS（status=${p.sie_plain_503_status}）`)
add(p.sie_json_503_no_hang === true, `★★json 模式 + 非 JSON 体**不挂起**（回归：曾致请求永久僵尸）`)
add(p.swr_zero_ok === true, `★SWR 窗口=0 ⇒ 不回 stale（实得 ${JSON.stringify(p.swr_zero_second_cache || {})}）`)
add(p.sie_rescued_ok === true, `★★源站 503 ⇒ 用旧值兜底（实得 ${JSON.stringify(p.sie_second_cache || {})}）`)
add(p.sie_same_body_ok === true, '兜底返回的是同一份旧 body')

let bad = 0
for (const [ok, msg] of chk) { console.log(`  ${ok ? '✅' : '✗'} ${msg}`); if (!ok) bad++ }
console.log(`\n  读数：${JSON.stringify({
  swr: { elapsed: p.swr_second_elapsed_ms, cache: p.swr_second_cache, cond: p.swr_conditional_seen, age: p.swr_age_header },
  sie: { status: p.sie_second_status, cache: p.sie_second_cache },
})}`)
if (bad) {
  console.log('\n  ★诊断提示：')
  console.log('    swr_background_sent=false ⇒ 后台校验没发出（App 引擎无 setTimeout？检查 makeDelay / 后台任务调度）')
  console.log('    swr_refreshed=false ⇒ 后台校验发了但结果没进缓存（settle 的写法有问题）')
  console.log('    sie_rescued=false ⇒ 5xx 未按 isErrorRescuable 判定（runFetch 的 5xx 是 ok:true+status）')
  console.log('  报告原文：' + JSON.stringify(r).slice(0, 1800))
  process.exit(1)
}
console.log('\n✅ RFC 5861（SWR 立即返回+后台校验 / SIE 兜底 / Age 头 全部到位）')
NODE
