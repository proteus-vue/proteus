#!/usr/bin/env bash
# hosts/android/run-cache-probe.sh —— ★★★#1149：**HTTP 条件请求缓存**真机判据（Android）
#
# 【它证明什么（每条都以服务端记账闭环）】
#   ① 新鲜期内的第二次请求**没有打到服务器**（服务端 hits 不增）——"省网络"唯一硬证据；
#   ② `max-age=0 + ETag` 的第二次请求**带上了 `If-None-Match`**，且拿回同一份 body
#      （`gen` 不变 ⇒ 304 后用缓存体，不是重新生成）；
#   ③ `no-store` 端点第二次仍回源；
#   ④ 未开缓存的管线 `meta.cache` 不出现（零回归）。
#
# 【★为什么必须在真机跑】本腿是裸 `HttpURLConnection`（未装 ResponseCache）——
#   "条件头能出去、304 能原样回来"是本端的事实，不能从 Web（浏览器自带缓存）推断。
#
# 用法：bash hosts/android/run-cache-probe.sh [port]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

PORT="${1:-8803}"
PKG="dev.proteus.layoutcore"
ADB="${ADB:-adb}"
APK="${PROTEUS_APK:-$HERE/build/proteus-layoutcore.apk}"
REPORT="/sdcard/Android/data/$PKG/files/cache-probe.json"
LOCAL_REPORT="$HERE/results/cache-probe.json"
SERVER_LOG="$HERE/results/cache-probe-server.log"
mkdir -p "$HERE/results"

[ -f "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
[ -f "$APK" ] || { echo "✗ 找不到 APK：$APK"; exit 3; }
"$ADB" get-state >/dev/null 2>&1 || { echo "✗ 设备未连接"; exit 3; }

echo "==> ① 起本地服务（port ${PORT}，带 ETag/304 + 服务端记账）"
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

echo "==> ② 安装 + 触发 cache-probe"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "rm -f ${REPORT}" >/dev/null 2>&1
if "$ADB" shell "test -f ${REPORT}" >/dev/null 2>&1; then
  echo "✗ 旧报告删不掉（等待信号会命中陈旧文件）"; exit 4
fi
"$ADB" shell "am start -n $PKG/.MainActivity --es path cache-probe --es base 'http://127.0.0.1:${PORT}'" >/dev/null 2>&1
bash "$WAIT_SH" --cmd "\"$ADB\" logcat -d -s 'proteus:I' | grep -q run-receiver-ready" --timeout 30 --interval 1 --max-interval 3 \
  || echo "  ⚠ 未见 run-receiver-ready（30s）"
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path cache-probe -p $PKG" >/dev/null 2>&1

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
const p = r.cache_probe || {}
const chk = []
const add = (ok, msg) => chk.push([ok, msg])

add(String(r.probe_kick || '').includes('started'), '探针已启动')
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
// ★端差异读数（**不是判据**）：服务端 hits 没增 ⇒ 该端**平台自带缓存**在起作用。
//   iOS 的系统 `URLCache` 会（/fresh 有 max-age=60）；Android 裸 HttpURLConnection 不会。
//   这正是"为什么缓存要收进框架层"的证据 ⇒ 打印出来，不判红。
console.log(`  ℹ 端差异读数：未开框架缓存时服务端 hits delta=${p.off_hits_delta}（平台缓存介入=${p.off_platform_cache_intervened === true}）`)

let bad = 0
for (const [ok, msg] of chk) { console.log(`  ${ok ? '✅' : '✗'} ${msg}`); if (!ok) bad++ }
console.log(`\n  读数：${JSON.stringify({
  fresh: { second: p.fresh_second_cache, hits: [p.fresh_hits_after_first, p.fresh_hits_after_second] },
  etag: { status: p.etag_second_status, cache: p.etag_second_cache, cond: p.etag_conditional_seen },
  nostore: [p.nostore_hits_after_first, p.nostore_hits_after_second],
})}`)
if (bad) {
  console.log('\n  ★诊断提示：')
  console.log('    fresh_hit 非 hit ⇒ 缓存没生效（管线 opts.cache 没开 / 响应头没被解析）')
  console.log('    etag_if_none_match 空 ⇒ 条件头没发出去（宿主吞了 if-none-match？）')
  console.log('    etag_second_status=304 ⇒ 304 没被合成 200（业务会看到空体）')
  console.log('    etag_same_body=false ⇒ 服务端重新生成了响应（304 其实没发生）')
  console.log('  报告原文：' + JSON.stringify(r).slice(0, 1600))
  process.exit(1)
}
console.log('\n✅ 条件请求缓存（新鲜命中 / 304 复用 / no-store 不缓存 / 零回归 全部到位）')
NODE
