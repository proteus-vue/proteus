#!/usr/bin/env bash
# hosts/harmony/run-transport-probe.sh —— ★★★#1156：**鸿蒙传输层事实取证**（第三端）
#
# 【它回答什么（与 Android/iOS 完全同一套判据）】
#   同一 `host:port` 连发 N 个请求 ⇒ 由**服务端**按「对端 socket」记账，判**连接复用**。
#   证据：`hosts/harmony/results/transport-probe.json`（+ runner 打印服务端读数）。
#
# 【为什么这轮才做（#1155 曾把它记成"未跑"）】
#   #1155 的真实原因是 **`hdc` 不在 PATH**，被我误判成"无设备"——而设备一直连着
#   （`bash hosts/harmony/hdc.sh list targets` 可证）。按纪律「下否定结论前先跑一条取证命令」补齐。
#
# 【★源码取证先于动手（它决定了这轮值不值得做）】
#   `proteus_http.h` 的 `handle()` 是 **建 session → 请求 → 关 session**
#   ⇒ 每个 `http.request` 都是新 RCP session。若连接池随 session 生灭 ⇒ **完全不复用**
#   （与 #1154 在 Android 引入的回归同族：功能全绿、零日志）。
#   ⇒ 这不是"补个读数"，而是一个**可能存在的真缺陷**，必须实测。
#
# 【★只测明文端口（诚实边界）】
#   鸿蒙宿主当前**没有**接线自定义 CA / TLS pinning（`Rcp_SecurityConfiguration` 有字段但未用），
#   而 h2 需要 TLS+ALPN ⇒ **HTTP/2 不在本轮取证范围**。不测就不写结论。
#   ⇒ 服务端起 `--plain-port`（`h2-echo-server.mjs` 自带），探针只打这条明文通道。
#
# 【★设备怎么访问本机服务】鸿蒙机与 Mac 在同一局域网（wlan0 192.168.0.x）⇒ 直接用 LAN IP。
#   （Android 走 `adb reverse` 到 127.0.0.1；iOS 走 LAN IP——三端路径不同，读数口径相同。）
#
# 用法：bash hosts/harmony/run-transport-probe.sh [rounds]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
HDC() { bash "$HERE/hdc.sh" "$@"; }

ROUNDS="${1:-3}"
# ★★★#1156：sync（生产路径 · HMS_Rcp_FetchSync）/ async（取证：判"连接池是否只在异步 Fetch 生效"）
#   用法：PROTEUS_TRANSPORT_MODE=async bash hosts/harmony/run-transport-probe.sh 3
MODE="${PROTEUS_TRANSPORT_MODE:-sync}"
BUNDLE="dev.proteus.host"
HAP_DIR="$HERE/host-app/entry/build/default/outputs/default"
RESULTS="$HERE/results"
FILES_DEV="/data/app/el2/100/base/$BUNDLE/haps/entry/files"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
GEN_DIR="$HERE/results/h2-certs"
SERVER_LOG="$HERE/results/transport-probe-server.log"

[ -f "$WAIT" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
mkdir -p "$RESULTS" "$GEN_DIR"

# ── ① 设备 + 局域网 IP（★USB 直连时设备访问不到 127.0.0.1，必须用 LAN）──
STATE="$(HDC list targets -v 2>/dev/null | head -1)"
case "$STATE" in *Connected*) ;; *) echo "✗ 无设备/未授权（${STATE}）——先跑 bash hosts/harmony/hdc.sh check"; exit 2 ;; esac
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
[ -n "$LAN_IP" ] || { echo "✗ 取不到本机局域网 IP"; exit 2; }
DEV_IP="$(HDC shell "ifconfig wlan0 2>/dev/null | grep 'inet addr'" 2>/dev/null | sed -n 's/.*inet addr:\([0-9.]*\).*/\1/p' | head -1)"
[ -n "$DEV_IP" ] || echo "  ⚠ 取不到设备 wlan0 地址（不影响：判据只看本机服务端是否被访问到）"

pick_free_port() {
  local p="$1"
  while [ "$p" -lt $(( $1 + 100 )) ]; do
    lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 || { printf '%s' "$p"; return 0; }
    p=$((p + 1))
  done
  return 1
}
PLAIN_PORT="$(pick_free_port 9400)" || { echo "✗ 找不到空闲端口"; exit 3; }

echo "==> ① 起 h2 服务（明文对照端口 ${PLAIN_PORT}，监听 0.0.0.0；本机 ${LAN_IP} · 设备 ${DEV_IP:-?}）"
# ★TLS 端口给一个**不冲突**的占位（本探针只用明文；服务端要求第 1 个参数是 TLS 端口）
TLS_PORT="$(pick_free_port $((PLAIN_PORT + 1)))" || { echo "✗ 找不到 TLS 占位端口"; exit 3; }
node "$ROOT/hosts/android/tools/h2-echo-server.mjs" "$TLS_PORT" "--gen-dir=$GEN_DIR" \
  "--san=DNS:localhost,IP:127.0.0.1,IP:${LAN_IP}" "--plain-port=$PLAIN_PORT" > "$SERVER_LOG" 2>&1 &
SRV=$!
cleanup() { kill "$SRV" 2>/dev/null || true; }
trap cleanup EXIT

bash "$WAIT" --port "127.0.0.1:${PLAIN_PORT}" --timeout 20 --interval 1 --max-interval 2 \
  || { echo "✗ 明文端口未就绪（见 ${SERVER_LOG}）"; exit 3; }

# ★连通性前置：设备必须能访问到本机端口（否则"不复用"会是"连不上"的假象）
if bash "$WAIT" --cmd "bash '$HERE/hdc.sh' shell 'curl -s -m 5 -o /dev/null -w %{http_code} http://${LAN_IP}:${PLAIN_PORT}/__pin' 2>/dev/null | grep -q 200" \
     --timeout 20 --interval 2 --max-interval 4; then
  echo "    设备可达本机服务 ✅"
else
  echo "  ⚠ 设备侧 curl 探测未通过（设备可能无 curl）——继续，最终以服务端读数判"
fi

# ── ② 构建 + 安装 + 启动 ──
HAP="$(ls -t "$HAP_DIR"/*-signed.hap 2>/dev/null | head -1)"
[ -n "$HAP" ] || { echo "✗ 缺签名 hap——先跑 bash hosts/harmony/build-host-app.sh"; exit 2; }
echo "==> ② 安装 + 清场：hap=${HAP##*/}"
HDC install "$HAP" 2>&1 | grep -qiE "successfully|Success" || { echo "✗ 安装失败"; exit 1; }
HDC shell "aa force-stop $BUNDLE" >/dev/null 2>&1 || true
HDC shell "hilog -r" >/dev/null 2>&1 || true
HDC shell "rm -f $FILES_DEV/transport-probe.json" >/dev/null 2>&1 || true
if HDC shell "test -f $FILES_DEV/transport-probe.json && echo STILL_EXISTS" 2>/dev/null | grep -q STILL_EXISTS; then
  echo "✗ 旧报告删不掉——等待信号会命中陈旧文件，拒绝继续"; exit 4
fi

echo "==> ③ 启动（scene=superapp-transport · ${ROUNDS} 轮）"
HDC shell "aa start -a EntryAbility -b $BUNDLE --ps scene superapp-transport --ps transportUrl http://${LAN_IP}:${PLAIN_PORT} --ps rounds ${ROUNDS} --ps mode ${MODE}" 2>&1 \
  | grep -qi "successfully" || { echo "✗ 启动失败"; exit 1; }

echo "==> ④ 等报告落盘（完成信号 = 文件存在；零盲等）"
if ! bash "$WAIT" --cmd "bash '$HERE/hdc.sh' shell 'test -f $FILES_DEV/transport-probe.json && echo READY' | grep -q READY" --timeout 180 --interval 3 --max-interval 6; then
  echo "✗ 180s 内未见 transport-probe.json" >&2
  HDC shell "hilog -x | grep -E 'TRANSPORT_PROBE|HTTP_REQUEST|INVOKE_BYTES|cppcrash' | tail -12" 2>&1 | sed 's/^/  /' >&2
  exit 4
fi
rm -f "$RESULTS/transport-probe.json"
HDC file recv "$FILES_DEV/transport-probe.json" "$RESULTS/transport-probe.json" >/dev/null 2>&1 \
  || { echo "✗ file recv 失败"; exit 4; }
[ -s "$RESULTS/transport-probe.json" ] || { echo "✗ 报告为空"; exit 4; }
echo "    transport-probe.json $(wc -c < "$RESULTS/transport-probe.json" | tr -d ' ') 字节"

# ── ★★★#1156：把**服务端记账**并进证据文件（门禁要能复算，不能只靠 runner 打印）──
#   【为什么必须落盘】先前服务端读数只出现在 runner 的 stdout ⇒ 证据文件里只有设备侧读数，
#     `check:cache-evidence` 无法离线复算"复用成立"（与 Android/iOS 的证据形态不一致，
#     而三端同判据是本仓纪律）。⇒ 在判据步骤之前查询并合并进 JSON。
node - "$RESULTS/transport-probe.json" "$PLAIN_PORT" <<'NODE'
const fs = require('fs')
const http = require('http')
const file = process.argv[2]
const port = Number(process.argv[3])
const get = (p) =>
  new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => {
      let b = ''
      res.setEncoding('utf8')
      res.on('data', (d) => { b += d })
      res.on('end', () => resolve(b))
    }).on('error', reject)
  })
get('/__stats')
  .then((text) => {
    const stats = JSON.parse(text)
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
    const plain = (stats.channels || {}).plain || {}
    doc.server_stats = stats
    doc.server_requests = Number(plain.requests || 0)
    doc.server_connections = Number(plain.connections || 0)
    doc.conn_reused_ok = plain.reused === true
    // ★对齐三端证据的**字段名**（`firstOk` → `first_ok`）：判据 `check:cache-evidence` 用
    //   snake_case 读三端证据（Android/iOS 探针的既有形态）。两个名字并存会让"首轮成功"这条
    //   在鸿蒙上永远读不到（本轮实测：报「首轮请求失败（?）」）。
    doc.first_ok = doc.firstOk === true
    /**
     * ★★★#1158：把逐轮 `transport` 对齐成三端统一的 `transport_first` / `transport_last`。
     * ★鸿蒙的读数来自**宿主的 `Rcp_TimeInfo`**（探针只解码宿主真实回程帧里的 `Transport=22` tag），
     *   所以这条读数同时证明了「宿主采集」+「线格式编码」两端。
     * ★诚实边界：鸿蒙的探针走 `hostTransportProbe`（C++ napi，同步在 VM 内发请求），
     *   **不经过 JS `useFetch`** ⇒ 这条读数证明"宿主能测且能编码"，**不**证明 JS 侧 `meta.transport`
     *   拿得到（那由 iOS/Android 的 JS 探针 + `check:cache-evidence` 断言）。
     */
    if (Array.isArray(doc.transport_per_round)) {
      doc.transport_first = doc.transport_per_round[0] ?? null
      doc.transport_last = doc.transport_per_round[doc.transport_per_round.length - 1] ?? null
    }
    if (doc.mode === 'async' && doc.async) {
      // async 取证模式的读数在 `async` 子对象里 ⇒ 顶层也镜像一份，便于三端同判据读取
      const a = doc.async
      doc.statuses = a.statuses
      doc.bytes = a.bytes
      doc.ms = a.ms
    }
    // ★HTTP/2：本轮**不测**（明文端口 · 宿主未接 CA/pinning）⇒ 显式写 null 而不是省略，
    //   避免"字段缺失"被误读成"没协商"。三端比对时鸿蒙这一项如实为 null。
    doc.http2_ok = null
    doc.http2_note = '未测：需 TLS+ALPN，鸿蒙宿主尚未接自定义 CA/pinning'
    fs.writeFileSync(file, JSON.stringify(doc) + '\n')
    console.log('    已并入服务端记账：' + JSON.stringify({ requests: doc.server_requests, connections: doc.server_connections, reused: doc.conn_reused_ok }))
  })
  .catch((e) => {
    console.error('✗ 读服务端记账失败（证据将不完整）：' + e.message)
    process.exit(1)
  })
NODE
[ "$?" = "0" ] || exit 4

# ── ⑤ 判据：以**服务端记账**为准（与 Android/iOS 同一实现）──
echo "==> ⑤ 取证结论（服务端记账）"
node - "$RESULTS/transport-probe.json" "$ROUNDS" "$PLAIN_PORT" <<'NODE'
const fs = require('fs')
const http = require('http')
const file = process.argv[2]
const rounds = Number(process.argv[3])
const port = Number(process.argv[4])
const r = JSON.parse(fs.readFileSync(file, 'utf8'))
const chk = []
const add = (ok, msg) => chk.push([ok, msg])

// ★★★#1156：async 模式的读数嵌在 `async` 下（两条路径形状不同是**刻意的**：
//   sync 走生产链路、async 只做取证对比）。判据按 mode 取对应分支，不假装形状一致。
const payload = r.mode === 'async' ? (r.async ?? {}) : r

add(r.host === 'harmony', `host=harmony（实得 ${r.host}）`)
add(r.bridge === 'invokeBytes', `走二进制腿（bridge=${r.bridge}）`)
add(r.ok === true, `探针自报成功〔error=${r.error || '-'}〕`)
add(Array.isArray(payload.statuses) && payload.statuses.length === rounds, `发出 ${payload.statuses?.length}/${rounds} 轮`)
add(r.firstOk === true, '首轮请求成功')
add(r.allOk === true, '全部轮次成功')

// 服务端记账（事实）
const get = (p) =>
  new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => {
      let b = ''
      res.setEncoding('utf8')
      res.on('data', (d) => { b += d })
      res.on('end', () => resolve(b))
    }).on('error', reject)
  })
get('/__stats')
  .then((text) => {
    const stats = JSON.parse(text)
    const ch = (stats.channels || {}).plain || {}
    const reqs = Number(ch.requests || 0)
    const conns = Number(ch.connections || 0)
    const reused = ch.reused === true
    console.log('')
    console.log('  服务端读数：' + JSON.stringify({ requests: reqs, connections: conns, reused, conns: ch.conns }))
    console.log('  设备侧读数：' + JSON.stringify({ mode: r.mode || 'sync', statuses: payload.statuses, bytes: payload.bytes, ms: payload.ms, sessionsCreated: r.sessionsCreated }))
    add(reqs >= rounds, `服务端收到 ${reqs}/${rounds} 个样本请求`)
    // ★★★核心判据：连接复用（与两端同口径，由**服务端**算）
    const reusedOk = reused === true
    console.log(`  ${reusedOk ? '✅' : '✗'} ★★连接复用：请求 ${reqs} 次 / TCP ${conns} 条`)
    // ★HTTP/2 不在本轮范围（见脚本头注：明文端口 + 宿主未接 CA）
    console.log('  ℹ HTTP/2：本轮**未测**（需 TLS+ALPN，鸿蒙宿主尚未接自定义 CA/pinning）')
    let bad = 0
    for (const [ok, msg] of chk) { console.log(`  ${ok ? '✅' : '✗'} ${msg}`); if (!ok) bad++ }
    if (!reusedOk) bad++
    if (bad) {
      console.log('\n  ✗ 取证未达标（报告：' + JSON.stringify(r).slice(0, 900) + '）')
      process.exit(1)
    }
    console.log('\n✅ 鸿蒙传输层取证完成：连接复用 = **已具备**；HTTP/2 = 未测（宿主未接 CA/pinning）')
  })
  .catch((e) => {
    console.error('✗ 读服务端记账失败：' + e.message)
    process.exit(1)
  })
NODE
