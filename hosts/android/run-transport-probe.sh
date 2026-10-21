#!/usr/bin/env bash
# hosts/android/run-transport-probe.sh —— ★★★#1155：**传输层事实取证**（Android）
#
# 【它要回答的问题（不猜，实测）】
#   矩阵 P1 写着「HTTP/2 + 连接池：需 Android 引入 OkHttp（APK +Δ）」。
#   但 **Android 的 `HttpURLConnection` 底层就是 OkHttp**（AOSP 4.4+ `com.android.okhttp`）
#   ⇒ 这两项能力**可能早就在工作**，缺的只是"我们看不见"（没有可观测字段）。
#   ⇒ 用 h2 服务端记账判：**协议版本** + **TCP 连接数 vs 请求数**。
#
# 【为什么这条先于"引 OkHttp"】为一个**已经工作**的能力把 APK 涨 1MB 是纯亏。
#
# 用法：bash hosts/android/run-transport-probe.sh [rounds]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

ROUNDS="${1:-3}"
PKG="dev.proteus.layoutcore"
ADB="${ADB:-adb}"
APK="${PROTEUS_APK:-$HERE/build/proteus-layoutcore.apk}"
REPORT="/sdcard/Android/data/$PKG/files/transport-probe.json"
LOCAL_REPORT="$HERE/results/transport-probe.json"
GEN_DIR="$HERE/results/h2-certs"
SERVER_LOG="$HERE/results/transport-probe-server.log"
mkdir -p "$HERE/results" "$GEN_DIR"

[ -f "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
[ -f "$APK" ] || { echo "✗ 找不到 APK：$APK"; exit 3; }
"$ADB" get-state >/dev/null 2>&1 || { echo "✗ 设备未连接"; exit 3; }

# ★空闲端口（写死会撞别的进程）
pick_free_port() {
  local p="$1"
  while [ "$p" -lt $(( $1 + 100 )) ]; do
    lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 || { printf '%s' "$p"; return 0; }
    p=$((p + 1))
  done
  return 1
}
PORT="$(pick_free_port 9200)" || { echo "✗ 找不到空闲端口"; exit 3; }
# ★明文对照端口（连接复用基线）：判断"不复用"是不是 pinning 引入的
PLAIN_PORT="$(pick_free_port $((PORT + 1)))" || { echo "✗ 找不到空闲明文端口"; exit 3; }

rm -f "$GEN_DIR"/*.crt "$GEN_DIR"/*.key 2>/dev/null || true
echo "==> ① 起 h2 服务（TLS:${PORT} / 明文对照:${PLAIN_PORT}，自签证书 SAN 含 127.0.0.1）"
node "$HERE/tools/h2-echo-server.mjs" "$PORT" "--gen-dir=$GEN_DIR" "--san=DNS:localhost,IP:127.0.0.1" "--plain-port=$PLAIN_PORT" > "$SERVER_LOG" 2>&1 &
SRV=$!
cleanup() {
  kill "$SRV" 2>/dev/null || true
  "$ADB" reverse --remove "tcp:${PORT}" >/dev/null 2>&1 || true
  "$ADB" reverse --remove "tcp:${PLAIN_PORT}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

bash "$WAIT_SH" --port "127.0.0.1:${PORT}" --timeout 20 --interval 1 --max-interval 2 \
  || { echo "✗ 服务未就绪（见 ${SERVER_LOG}）"; exit 3; }
bash "$WAIT_SH" --port "127.0.0.1:${PLAIN_PORT}" --timeout 20 --interval 1 --max-interval 2 \
  || { echo "✗ 明文对照端口未就绪（见 ${SERVER_LOG}）"; exit 3; }
"$ADB" reverse "tcp:${PORT}" "tcp:${PORT}" >/dev/null 2>&1 || { echo "✗ adb reverse 失败"; exit 3; }
"$ADB" reverse "tcp:${PLAIN_PORT}" "tcp:${PLAIN_PORT}" >/dev/null 2>&1 || { echo "✗ adb reverse（明文）失败"; exit 3; }
PIN="$(curl -sk "https://127.0.0.1:${PORT}/__pin" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(JSON.parse(s).spki||''))}catch{}})" | tr -d '\r\n')"
[ -n "$PIN" ] || { echo "✗ 取不到 SPKI 指纹"; exit 3; }
echo "    服务就绪 + reverse 已建；pin=${PIN}"

# ★参数走文件（base 含 ':'、pin 是 base64 含 '='/'+'/'/'——经 adb shell 会掉字符，#1154 实测踩过）
ARGS_FILE="$GEN_DIR/args.json"
node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({ base: process.argv[2], pin: process.argv[3], rounds: Number(process.argv[4]), plainBase: process.argv[5] }))" \
  "$ARGS_FILE" "https://127.0.0.1:${PORT}" "$PIN" "$ROUNDS" "http://127.0.0.1:${PLAIN_PORT}"
"$ADB" push "$ARGS_FILE" "/sdcard/Android/data/$PKG/files/transport-probe-args.json" >/dev/null 2>&1 \
  || { echo "✗ push 参数文件失败"; exit 3; }

echo "==> ② 安装 + 触发 transport-probe（${ROUNDS} 轮）"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "rm -f ${REPORT}" >/dev/null 2>&1
if "$ADB" shell "test -f ${REPORT}" >/dev/null 2>&1; then
  echo "✗ 旧报告删不掉（等待信号会命中陈旧文件）"; exit 4
fi
"$ADB" shell "am start -n $PKG/.MainActivity --es path transport-probe" >/dev/null 2>&1
bash "$WAIT_SH" --cmd "\"$ADB\" logcat -d -s 'proteus:I' | grep -q run-receiver-ready" --timeout 30 --interval 1 --max-interval 3 \
  || echo "  ⚠ 未见 run-receiver-ready（30s）"
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path transport-probe -p $PKG" >/dev/null 2>&1

if ! bash "$WAIT_SH" --cmd "\"$ADB\" shell \"test -f ${REPORT}\" >/dev/null 2>&1" --timeout 180 --interval 1 --max-interval 3; then
  echo "✗ 报告未生成——看 logcat / 服务日志"
  "$ADB" logcat -d -s 'proteus:I' | tail -15 || true
  exit 4
fi
"$ADB" pull "$REPORT" "$LOCAL_REPORT" >/dev/null 2>&1 || { echo "✗ 拉取报告失败"; exit 4; }

echo "==> ③ 取证结论（以**服务端记账**为准）"
node - "$LOCAL_REPORT" "$ROUNDS" <<'NODE'
const fs = require('fs')
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const rounds = Number(process.argv[3])
const p = r.transport_probe || {}
const chk = []
const add = (ok, msg) => chk.push([ok, msg])

add(String(r.probe_kick || '').includes('started'), '探针已启动')
add(p.first_ok === true, `首轮请求成功（pinOnly + 自签）〔err=${p.req_error || '-'}〕`)
add(Array.isArray(p.client_protos) && p.client_protos.length === rounds, `客户端收到 ${p.client_protos?.length}/${rounds} 次响应`)

const protos = p.server_protocols || {}
const reqs = Number(p.server_requests || 0)
const conns = Number(p.server_connections || 0)
// ★★★HTTP/2 是**端差异读数**，不判红（实测 Android 全 http/1.1 —— AOSP 的 HttpURLConnection 默认不开 h2；
//   要 h2 必须换栈（OkHttp），属独立大单）。★若把它写成断言，Android 的判据会永远红 = 判据本身错。
const h2 = p.http2_ok === true
console.log(`  ${h2 ? '✅' : 'ℹ'} ★HTTP/2 读数：${h2 ? '已协商' : '**未协商**（AOSP 默认不开 h2；换栈属独立大单）'} — 协议分布 ${JSON.stringify(protos)}`)
add(p.conn_reused_ok === true, `★★连接复用：请求 ${reqs} 次 / TCP 连接 ${conns} 条（复用=${reqs > conns}）`)

let bad = 0
for (const [ok, msg] of chk) { console.log(`  ${ok ? '✅' : '✗'} ${msg}`); if (!ok) bad++ }
console.log(`\n  取证读数：${JSON.stringify({
  客户端看到的协议: p.client_protos,
  客户端看到的连接身份: p.client_peers,
  服务端协议分布: protos,
  服务端请求数: reqs,
  服务端TCP连接数: conns,
  逐连接请求数: ((p.server_stats || {}).channels || {}).tls?.conns,
})}`)
if (bad) {
  console.log('\n  ★若 http2_ok=false 或 conn_reused_ok=false：')
  console.log('    说明本端 `HttpURLConnection` **没有**协商 h2 / 不复用 ⇒ P1 才真的需要引 OkHttp（先评估 APK 体积）')
  console.log('  报告原文：' + JSON.stringify(r).slice(0, 1600))
  process.exit(1)
}
console.log('\n✅ 传输层取证完成（读数已入库）：连接复用 = **已具备**（无需换栈）；HTTP/2 = ' + (h2 ? '已协商' : '**未协商**（需换栈才可能有，属独立大单）'))
NODE
