#!/usr/bin/env bash
# hosts/ios/run-persist-probe.sh —— ★★★#1151：**缓存持久层（L2）**真机判据（iOS）
#
# 【与 Android 同判据、同两阶段】① write：请求 → 落盘 → 进程退出；② read：**新进程** → 必须命中。
#   硬证据在**服务端记账**：第二次若真发了请求，`hits` 会 +1。
#
# 【★iOS 侧尤其值得测】
#   iOS 的文件通路是 `FileTransferCapability.writeBytes`（**原子写** `Data.write(.atomic)`），
#   返回值是 `{path,size}`（不是字节）；而 `readBytes` 返回 `{bytes:[number[]]}`。
#   ⇒ "写进去的字节下次读得回来"这条链路要么实测、要么永远是推断。
#
# 【差异】无 adb reverse ⇒ 服务绑 0.0.0.0，设备经局域网 IP 访问。
#
# 用法：bash hosts/ios/run-persist-probe.sh [port]
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
source "$HERE/lib/xcode-env.sh"

PORT="${1:-8805}"
LOCAL_REPORT="$HERE/results/persist-probe.json"
SUPERAPP_REPORT="$HERE/results/superapp.json"
WRITE_REPORT="$HERE/results/persist-probe-write.json"
SERVER_LOG="$HERE/results/persist-probe-server-ios.log"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

[ -x "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
if [ -z "$LAN_IP" ]; then echo "✗ 取不到本机局域网 IP"; exit 2; fi
BASE="http://${LAN_IP}:${PORT}"
echo "==> 服务基址（设备侧）：$BASE"

mkdir -p "$HERE/results"
rm -f "$LOCAL_REPORT" "$WRITE_REPORT" "$SUPERAPP_REPORT" "$SERVER_LOG"

node "$ROOT/hosts/android/tools/cache-echo-server.mjs" "$PORT" 0.0.0.0 > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT

if ! bash "$WAIT_SH" --port "127.0.0.1:${PORT}" --timeout 15 --interval 1 --max-interval 2; then
  echo "✗ 服务未就绪（见 ${SERVER_LOG}）"; exit 3
fi
echo "    服务已就绪"

# ★★★必须**先清掉设备上的缓存目录**（Android 侧同样做了这一步）。
#   【为什么这是判据的生死线】首版漏了这步，实测读到 `ageMs=91620`（约 25 小时）——
#   那是**前一天调试留下的旧条目**，而两次运行只差 92 秒。
#   ⇒ 不清盘时，任何残留都能让"重启后命中"通过 ⇒ 判据**假绿**（证明不了"这次的 write 生效了"）。
#   ★实现：宿主没有暴露"删目录"，只能逐文件 remove；这里清掉本层用到的固定目录。
#     用一次 `write` 阶段的探针之外的独立动作太绕 ⇒ 直接让**探针自己**在 write 阶段前清盘：
#     见 `entry-superapp-probes-persist.ts` 的 `clearBeforeWrite`（两阶段都以它为准，端无关）。
echo "    注：清盘由探针内部执行（write 阶段前 clear，端无关；见 entry-superapp-probes-persist.ts）"

hits_of() {
  curl -s "http://127.0.0.1:${PORT}/__stats" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log(o.hits['/persist']||0)})
"
}

# ── 阶段①：write（run-selfdraw 自带 --console + PROTEUS_EXIT_AFTER_REPORT ⇒ 报告落盘即进程退出）──
echo "==> ③ 阶段 ①（write）：请求 → 落盘 → 进程自退"
bash "$HERE/run-selfdraw.sh" --superapp "--persist-probe=${BASE},write" 2>&1 | grep -viE "^warning|unused variable" | tail -8
[ -f "$SUPERAPP_REPORT" ] || { echo "✗ write 阶段报告未取回"; exit 4; }
cp -f "$SUPERAPP_REPORT" "$WRITE_REPORT"
HITS_AFTER_WRITE="$(hits_of)"
echo "    write 阶段完成；服务端 /persist hits = ${HITS_AFTER_WRITE}"

# ★★进程已由 PROTEUS_EXIT_AFTER_REPORT 自退 ⇒ 内存 LRU 必然消失（这就是"冷启动"）
rm -f "$SUPERAPP_REPORT"

# ── 阶段②：read（新进程）──
echo "==> ④ 阶段 ②（read）：**重新启动** → 必须命中"
bash "$HERE/run-selfdraw.sh" --superapp "--persist-probe=${BASE},read" 2>&1 | grep -viE "^warning|unused variable" | tail -8
[ -f "$SUPERAPP_REPORT" ] || { echo "✗ read 阶段报告未取回"; exit 4; }
cp -f "$SUPERAPP_REPORT" "$LOCAL_REPORT"
HITS_AFTER_READ="$(hits_of)"
echo "    read 阶段完成；服务端 /persist hits = ${HITS_AFTER_READ}"

echo "==> ⑤ 判定（两阶段 + 服务端记账）"
node - "$WRITE_REPORT" "$LOCAL_REPORT" "$HITS_AFTER_WRITE" "$HITS_AFTER_READ" <<'NODE'
const fs = require('fs')
const [writePath, readPath, hw, hr] = process.argv.slice(2)
const parse = (p) => {
  const d = JSON.parse(fs.readFileSync(p, 'utf8'))
  let v = d.persist_probe
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { v = null } }
  // ★把报告顶层的 `run_ts`（进程启动时刻）随载荷带出 —— 年龄断言要用它算期望值
  const body = v || d.probe || {}
  body.__runTs = Number(d.run_ts ?? 0)
  return body
}
const w = parse(writePath)
const r = parse(readPath)
const hitsWrite = Number(hw)
const hitsRead = Number(hr)

const chk = []
const add = (ok, msg) => chk.push([ok, msg])
add(w.phase === 'write', `write 阶段探针已跑（phase=${w.phase}）`)
add(r.phase === 'read', `read 阶段探针已跑（phase=${r.phase}）`)
add(w.backend_kind === 'file', `★App 端选的是**文件**后端（实得 ${w.backend_kind} / ${w.backend_reason}）`)
add(w.degraded === false, '持久化介质可用（没有降级成内存）')
add(w.write_ok === true, `write 阶段请求成功（status=${w.write_status}）`)
add(w.write_persisted_ok === true, `★★写盘成功（writes=${(w.persist_stats || {}).writes} · errors=${(w.persist_stats || {}).writeErrors}）`)
add(r.read_ok === true, `read 阶段请求成功（status=${r.read_status}）`)
add(r.read_hit_ok === true, `★★重启后**命中缓存**（实得 ${JSON.stringify(r.read_cache || {})}）`)
add(r.read_from_disk_ok === true, `★★命中来自**盘上**（loads=${(r.persist_stats || {}).loads} > 0）`)
add(r.read_gen === w.write_gen, `体内容与首次一致（gen ${w.write_gen} === ${r.read_gen}）`)
add(hitsRead === hitsWrite, `★★服务端 /persist hits **没有增加**（${hitsWrite} → ${hitsRead}）`)

// ★★★#1151：**"命中的必须是本次写入的条目"** —— 防"读到旧残留"造成的假绿。
//   【为什么要机器化】我人工看数字时把 `ageMs=126522`（**毫秒**）误读成"35 小时"，
//   以为读到了前一天残留；实际 126522ms = 126s ≈ 两阶段间隔，完全合理。
//   ⇒ 这类判断不能靠人读数字。
//   ★口径与 Android 一致：**绝对上限 5 分钟**（两阶段合计远小于它；跨天残留是小时级）。
//     ★为什么不用 `run_ts` 算期望年龄：iOS 的 `run_ts` 是进程启动时刻，而条目 flush 更晚，
//       两者差值会引入三段误差；绝对上限同样能区分"本次"与"跨天"，且端无关、不易假红。
const actualAgeMs = Number((r.read_cache || {}).ageMs ?? -1)
const AGE_LIMIT_MS = 300000 // 5 分钟
const ageSane = actualAgeMs >= 0 && actualAgeMs < AGE_LIMIT_MS
add(
  ageSane,
  `★命中的是**本次写入**的条目（ageMs=${actualAgeMs} 应 < ${AGE_LIMIT_MS}ms；跨天残留会是小时级）`,
)

let bad = 0
for (const [ok, msg] of chk) { console.log(`  ${ok ? '✅' : '✗'} ${msg}`); if (!ok) bad++ }
console.log(`\n  读数：${JSON.stringify({
  write: { hits: hitsWrite, gen: w.write_gen, stats: w.persist_stats, backend: w.backend_kind },
  read: { hits: hitsRead, gen: r.read_gen, cache: r.read_cache, stats: r.persist_stats },
})}`)
if (bad) {
  console.log('\n  ★诊断提示（iOS 特有）：')
  console.log('    write_persisted_ok=false ⇒ FileTransferCapability.writeBytes 失败（查沙箱路径 resolve）')
  console.log('    read_from_disk_ok=false 但 read_hit_ok=true ⇒ 命中来自内存（装置没真重启？）')
  console.log('  write 报告：' + JSON.stringify(w).slice(0, 1200))
  console.log('  read  报告：' + JSON.stringify(r).slice(0, 1200))
  process.exit(1)
}
console.log('\n✅ 缓存持久层（L2）：跨进程真命中 + 服务端零请求（iOS 文件后端）')
NODE
