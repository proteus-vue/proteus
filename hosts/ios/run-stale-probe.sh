#!/usr/bin/env bash
# hosts/ios/run-stale-probe.sh —— ★★★#1150：**RFC 5861（SWR / SIE）**真机判据（iOS）
#
# 【与 Android 同判据、同服务端记账】① SWR 窗口内立即回旧值 + 后台校验真发出（+ 条件头 + 新值进缓存）
#   ② SWR 窗口=0 不得回 stale ③ SIE 源站 503 用旧值兜底 ④ Age 头。
#
# 【★这一端尤其必须实测】iOS 的 `URLCache` 会自己发条件请求 / 合成 304（#1149 已证）；
#   SWR 的**后台校验**是"并发第二条请求"，若被系统缓存拦掉，我们会看到
#   `swr_background_sent=false` 而服务端 hits 不增 —— 那必须当场暴露，不能靠推断。
#
# 【差异】无 adb reverse ⇒ 服务绑 0.0.0.0，设备经局域网 IP 访问。
#
# 用法：bash hosts/ios/run-stale-probe.sh [port]
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
source "$HERE/lib/xcode-env.sh"

PORT="${1:-8804}"
# ★#1148 纪律：读数落**独立**证据文件（不用通用 superapp.json——任何一次运行都会覆盖它）
LOCAL_REPORT="$HERE/results/stale-probe.json"
SUPERAPP_REPORT="$HERE/results/superapp.json"
SERVER_LOG="$HERE/results/stale-probe-server-ios.log"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

[ -x "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
if [ -z "$LAN_IP" ]; then echo "✗ 取不到本机局域网 IP"; exit 2; fi
BASE="http://${LAN_IP}:${PORT}"
echo "==> 服务基址（设备侧）：$BASE"

mkdir -p "$HERE/results"
rm -f "$LOCAL_REPORT" "$SUPERAPP_REPORT" "$SERVER_LOG"

node "$ROOT/hosts/android/tools/cache-echo-server.mjs" "$PORT" 0.0.0.0 > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT

if ! bash "$WAIT_SH" --port "127.0.0.1:${PORT}" --timeout 15 --interval 1 --max-interval 2; then
  echo "✗ 服务未就绪（见 ${SERVER_LOG}）"; exit 3
fi
echo "    服务已就绪"

echo "==> 构建 + 安装 + 启动（superapp --stale-probe）"
bash "$HERE/run-selfdraw.sh" --superapp "--stale-probe=${BASE}" 2>&1 | grep -viE "^warning|unused variable" | tail -12

[ -f "$SUPERAPP_REPORT" ] || { echo "✗ 报告未取回（${SUPERAPP_REPORT}）"; exit 4; }
cp -f "$SUPERAPP_REPORT" "$LOCAL_REPORT"
echo "    证据已落盘：$LOCAL_REPORT"

echo "==> 判定"
node - "$LOCAL_REPORT" <<'NODE'
const fs = require('fs')
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
// iOS 报告是单槽 ⇒ 探针读数在 `stale_probe` 字符串里
let p = r.probe
if (typeof r.stale_probe === 'string') {
  try { p = JSON.parse(r.stale_probe) } catch { /* 保留 r.probe */ }
}
if (!p) { console.log('✗ 报告里没有 stale_probe 读数：' + JSON.stringify(r).slice(0, 900)); process.exit(1) }

const chk = []
const add = (ok, msg) => chk.push([ok, msg])
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
  console.log('\n  ★诊断提示（iOS 特有）：')
  console.log('    swr_background_sent=false 但条件头有值 ⇒ 后台校验被系统 URLCache 拦了（确认 bypassPlatformCache 生效）')
  console.log('    sie_rescued=false ⇒ 5xx 未按 isErrorRescuable 判定（runFetch 的 5xx 是 ok:true+status）')
  console.log('  报告原文：' + JSON.stringify(p).slice(0, 1800))
  process.exit(1)
}
console.log('\n✅ RFC 5861（iOS：SWR 立即返回+后台校验 / SIE 兜底 / Age 头 全部到位）')
NODE
