#!/usr/bin/env bash
# hosts/ios/run-cache-probe.sh —— ★★★#1149：**HTTP 条件请求缓存**真机判据（iOS）
#
# 【与 Android 同判据、同服务端记账】① 新鲜期命中（服务端零请求）② `If-None-Match` 真发出 +
#   304 合成 200 + 同一份 body ③ `no-store` 不缓存 ④ 未开缓存零回归。
#
# 【★这一端为何尤其必须实测】
#   iOS 腿用 `URLSessionConfiguration.default` ⇒ 系统 `URLCache` 可能：
#     · 自己发条件请求（我们看不到）；
#     · 把 304 合成 200（那我们拿到的 200 可能是系统给的，不是我们合的）；
#     · 直接回本地缓存（那样服务端零请求也说明不了框架层缓存生效）。
#   ⇒ 判据三件同时看：`meta.cache.status` + 服务端 `hits` + 服务端 `conditional`（收到的条件头原文）。
#
# 【差异】没有 adb reverse ⇒ 服务绑 0.0.0.0，设备经局域网 IP 访问。
#
# 用法：bash hosts/ios/run-cache-probe.sh [port]
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
source "$HERE/lib/xcode-env.sh"

PORT="${1:-8803}"
# ★★★#1148 同款纪律：读数必须落成**独立**证据文件。
#   原写 `superapp.json`（通用报告名）⇒ **任何一次 superapp 运行都会覆盖它** ⇒ 事后无法复核。
#   与 Android 侧对齐同名文件（`hosts/android/results/cache-probe.json`），两端同形态。
LOCAL_REPORT="$HERE/results/cache-probe.json"
SUPERAPP_REPORT="$HERE/results/superapp.json"
SERVER_LOG="$HERE/results/cache-probe-server-ios.log"
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

echo "==> 构建 + 安装 + 启动（superapp --cache-probe）"
bash "$HERE/run-selfdraw.sh" --superapp "--cache-probe=${BASE}" 2>&1 | grep -viE "^warning|unused variable" | tail -12

[ -f "$SUPERAPP_REPORT" ] || { echo "✗ 报告未取回（${SUPERAPP_REPORT}）"; exit 4; }
cp -f "$SUPERAPP_REPORT" "$LOCAL_REPORT"
echo "    证据已落盘：$LOCAL_REPORT"

echo "==> 判定"
node - "$LOCAL_REPORT" <<'NODE'
const fs = require('fs')
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
// iOS 的报告是单槽（`superapp.json`）⇒ 探针读数在 `cache_probe` 字符串里
let p = r.probe
if (typeof r.cache_probe === 'string') {
  try { p = JSON.parse(r.cache_probe) } catch { /* 保留 r.probe */ }
}
if (!p) { console.log('✗ 报告里没有 cache_probe 读数：' + JSON.stringify(r).slice(0, 800)); process.exit(1) }

const chk = []
const add = (ok, msg) => chk.push([ok, msg])
add(p.ok === true, '整体 ok（cache_probe.ok）')
add(p.fresh_hit_ok === true, `★新鲜期第二次命中缓存（实得 ${JSON.stringify(p.fresh_second_cache || {})}）`)
add(p.fresh_no_network_ok === true, `★★命中时服务端**没有新请求**（first=${p.fresh_hits_after_first} second=${p.fresh_hits_after_second}）`)
add(p.fresh_same_body_ok === true, '命中返回的是同一份 body')
add(p.etag_if_none_match_ok === true, `★304 校验真的发了 If-None-Match（服务端收到 ${p.etag_conditional_seen || '空'}）`)
add(p.etag_revalidated_ok === true, `★304 后被判为 revalidated（实得 ${JSON.stringify(p.etag_second_cache || {})}）`)
add(p.etag_status_200_ok === true, `★★304 被合成 200（实得 ${p.etag_second_status}）——业务看不到 304`)
add(p.etag_same_body_ok === true, '304 后用缓存体（gen 不变）')
add(p.nostore_ok === true, `★no-store 不缓存（first=${p.nostore_hits_after_first} second=${p.nostore_hits_after_second}）`)
add(p.off_meta_has_cache === false, '★未开缓存 ⇒ meta.cache 不出现（零回归）')
add(p.off_both_ok === true, '★未开缓存 ⇒ 两次请求都成功')
// ★端差异读数（**不是判据**）：iOS 的 `URLCache` 在未开框架缓存时也会拦 `/fresh`（服务端 hits 不增）。
//   这是平台既有行为（本轮未改 iOS 默认 cachePolicy），也是"缓存必须收进框架层"的立论证据。
console.log(`  ℹ 端差异读数：未开框架缓存时服务端 hits delta=${p.off_hits_delta}（平台缓存介入=${p.off_platform_cache_intervened === true}）`)

let bad = 0
for (const [ok, msg] of chk) { console.log(`  ${ok ? '✅' : '✗'} ${msg}`); if (!ok) bad++ }
console.log(`\n  读数：${JSON.stringify({
  fresh: { second: p.fresh_second_cache, hits: [p.fresh_hits_after_first, p.fresh_hits_after_second] },
  etag: { status: p.etag_second_status, cache: p.etag_second_cache, cond: p.etag_conditional_seen },
  nostore: [p.nostore_hits_after_first, p.nostore_hits_after_second],
})}`)
if (bad) {
  console.log('\n  ★诊断提示（iOS 特有）：')
  console.log('    fresh_no_network=false 但 fresh_hit=hit ⇒ 系统 URLCache 也在缓存（两套缓存并存，需确认语义）')
  console.log('    etag_conditional_seen 里有值但我们报 miss ⇒ 条件头是 URLSession 自己发的（不是框架层）')
  console.log('    etag_second_status=304 ⇒ 304 没被合成 200')
  console.log('  报告原文：' + JSON.stringify(p).slice(0, 1600))
  process.exit(1)
}
console.log('\n✅ 条件请求缓存（iOS：新鲜命中 / 304 复用 / no-store 不缓存 / 零回归 全部到位）')
NODE
