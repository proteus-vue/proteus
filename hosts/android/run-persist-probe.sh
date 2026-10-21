#!/usr/bin/env bash
# hosts/android/run-persist-probe.sh —— ★★★#1151：**缓存持久层（L2）**真机判据（Android）
#
# 【它证明什么（Node 判据证不了的部分）】
#   `tests/fetch-cache-persist.test.ts` 用"新 store 实例"模拟重启，只证明代码路径对。
#   真机上还有一环只能实测：**宿主真的把条目写到沙箱盘上了吗？下一次进程读得回来吗？**
#   （链路：JS → invokeHostAsync('fs.writeBytes') → FileTransferCapability → 沙箱文件）
#
# 【★★两阶段（这是本判据的核心）】
#   ① `phase=write`：启动 App → 请求一次（落盘）→ 报告 → **force-stop（进程真死）**；
#   ② `phase=read` ：**重新启动** → 请求同一 URL ⇒ 必须命中；
#   ★硬证据在**服务端记账**：第二次如果真发了请求，`hits` 会 +1（客户端自述不算）。
#
# 用法：bash hosts/android/run-persist-probe.sh [port]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

PORT="${1:-8805}"
PKG="dev.proteus.layoutcore"
ADB="${ADB:-adb}"
APK="${PROTEUS_APK:-$HERE/build/proteus-layoutcore.apk}"
REPORT="/sdcard/Android/data/$PKG/files/persist-probe.json"
LOCAL_REPORT="$HERE/results/persist-probe.json"
SERVER_LOG="$HERE/results/persist-probe-server.log"
mkdir -p "$HERE/results"

[ -f "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
[ -f "$APK" ] || { echo "✗ 找不到 APK：$APK"; exit 3; }
"$ADB" get-state >/dev/null 2>&1 || { echo "✗ 设备未连接"; exit 3; }

echo "==> ① 起本地服务（port ${PORT}，含 /persist 端点 + 服务端记账）"
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

echo "==> ② 安装（只装一次，两个阶段复用同一个 APK）"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2

# ★★关键：先清掉设备上的缓存目录与旧报告，确保"第二次启动"读的是**本次**写入的盘
#   （若不清，上一次运行留下的条目会让 judge 假绿——那证明不了"这次的 write 生效了"）
CACHE_DIR="/sdcard/Android/data/$PKG/files/cache"
"$ADB" shell "rm -rf ${CACHE_DIR}" >/dev/null 2>&1 || true
"$ADB" shell "rm -f ${REPORT}" >/dev/null 2>&1 || true
if "$ADB" shell "test -f ${REPORT}" >/dev/null 2>&1; then
  echo "✗ 旧报告删不掉（等待信号会命中陈旧文件）"; exit 4
fi
echo "    已清空：${CACHE_DIR} + 旧报告"

# ── 阶段①：write ──
echo "==> ③ 阶段 ①（write）：启动 → 请求 → 落盘 → 进程退出"
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "am start -n $PKG/.MainActivity --es path persist-probe --es base 'http://127.0.0.1:${PORT}' --es phase write" >/dev/null 2>&1
bash "$WAIT_SH" --cmd "\"$ADB\" logcat -d -s 'proteus:I' | grep -q run-receiver-ready" --timeout 30 --interval 1 --max-interval 3 \
  || echo "  ⚠ 未见 run-receiver-ready（30s）"
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path persist-probe -p $PKG" >/dev/null 2>&1

if ! bash "$WAIT_SH" --cmd "\"$ADB\" shell \"test -f ${REPORT}\" >/dev/null 2>&1" --timeout 180 --interval 1 --max-interval 3; then
  echo "✗ write 阶段报告未生成——看 logcat / 服务日志"
  "$ADB" logcat -d -s 'proteus:I' | tail -15 || true
  exit 4
fi
"$ADB" pull "$REPORT" "$HERE/results/persist-probe-write.json" >/dev/null 2>&1 || { echo "✗ 拉取 write 报告失败"; exit 4; }
HITS_AFTER_WRITE=$(curl -s "http://127.0.0.1:${PORT}/__stats" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log(o.hits['/persist']||0)})
")
echo "    write 阶段完成；服务端 /persist hits = ${HITS_AFTER_WRITE}"

# ★★进程真死：force-stop 是"杀进程"，不是"清状态"——内存 LRU 必然消失
echo "==> ④ 杀掉进程（模拟冷启动；内存 LRU 随之消失）"
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "rm -f ${REPORT}" >/dev/null 2>&1 || true
if "$ADB" shell "test -f ${REPORT}" >/dev/null 2>&1; then
  echo "✗ 报告在 force-stop 后仍存在（无法区分两次阶段）"; exit 4
fi

# ── 阶段②：read（新进程）──
echo "==> ⑤ 阶段 ②（read）：**重新启动** → 请求同一 URL ⇒ 必须命中"
"$ADB" shell "am start -n $PKG/.MainActivity --es path persist-probe --es base 'http://127.0.0.1:${PORT}' --es phase read" >/dev/null 2>&1
bash "$WAIT_SH" --cmd "\"$ADB\" logcat -d -s 'proteus:I' | grep -q run-receiver-ready" --timeout 30 --interval 1 --max-interval 3 \
  || echo "  ⚠ 未见 run-receiver-ready（30s）"
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path persist-probe -p $PKG" >/dev/null 2>&1

if ! bash "$WAIT_SH" --cmd "\"$ADB\" shell \"test -f ${REPORT}\" >/dev/null 2>&1" --timeout 180 --interval 1 --max-interval 3; then
  echo "✗ read 阶段报告未生成——看 logcat / 服务日志"
  "$ADB" logcat -d -s 'proteus:I' | tail -15 || true
  exit 4
fi
"$ADB" pull "$REPORT" "$LOCAL_REPORT" >/dev/null 2>&1 || { echo "✗ 拉取 read 报告失败"; exit 4; }
HITS_AFTER_READ=$(curl -s "http://127.0.0.1:${PORT}/__stats" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log(o.hits['/persist']||0)})
")
echo "    read 阶段完成；服务端 /persist hits = ${HITS_AFTER_READ}"

echo "==> ⑥ 判定（两阶段 + 服务端记账）"
node - "$HERE/results/persist-probe-write.json" "$LOCAL_REPORT" "$HITS_AFTER_WRITE" "$HITS_AFTER_READ" <<'NODE'
const fs = require('fs')
const [writePath, readPath, hw, hr] = process.argv.slice(2)
const W = JSON.parse(fs.readFileSync(writePath, 'utf8'))
const R = JSON.parse(fs.readFileSync(readPath, 'utf8'))
const w = W.persist_probe || {}
const r = R.persist_probe || {}
const hitsWrite = Number(hw)
const hitsRead = Number(hr)

const chk = []
const add = (ok, msg) => chk.push([ok, msg])
add(w.phase === 'write', `write 阶段探针已跑（phase=${w.phase}）`)
add(r.phase === 'read', `read 阶段探针已跑（phase=${r.phase}）`)
add(w.backend_kind === 'file', `★App 端选的是**文件**后端（实得 ${w.backend_kind} / ${w.backend_reason}）——它没有 getStorage`)
add(w.degraded === false, '持久化介质可用（没有降级成内存）')
add(w.write_ok === true, `write 阶段请求成功（status=${w.write_status}）`)
add(w.write_persisted_ok === true, `★★写盘成功（writes=${(w.persist_stats || {}).writes} · errors=${(w.persist_stats || {}).writeErrors}）`)
add(r.read_ok === true, `read 阶段请求成功（status=${r.read_status}）`)
add(r.degraded === false, 'read 阶段介质仍可用')
add(r.read_hit_ok === true, `★★重启后**命中缓存**（实得 ${JSON.stringify(r.read_cache || {})}）`)
add(r.read_from_disk_ok === true, `★★命中来自**盘上**（loads=${(r.persist_stats || {}).loads} > 0，不是内存碰巧有）`)
add(r.read_gen === w.write_gen, `体内容与首次一致（gen ${w.write_gen} === ${r.read_gen}）`)
add(hitsRead === hitsWrite, `★★服务端 /persist hits **没有增加**（${hitsWrite} → ${hitsRead}）——这是"真省了网络"的硬证据`)

// ★★★#1151：**"命中的必须是本次写入的条目"** —— 这条防的是"读到旧残留"造成的假绿。
//   【为什么要机器化】我人工看数字时把 `ageMs=126522`（**毫秒**）误读成"35 小时"，
//   以为读到了前一天残留；实际 126522ms = 126s ≈ 两阶段间隔，完全合理。
//   ⇒ 这类判断不能靠人读数字。
//   ★★口径：Android 报告**没有** `run_ts`（那是 iOS 的 `reportBody()` 才有）⇒ 不用"期望年龄 ± 容差"
//     （会退化成 NaN 假红），改用**绝对上限**：两次阶段合计远小于 5 分钟，
//     而"跨天残留"必然是**小时级** ⇒ `ageMs < 300000` 足以区分两者，且不依赖时钟对齐。
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
  console.log('\n  ★诊断提示：')
  console.log('    backend_kind=kv/none ⇒ 该端探测错了（App 应走 file）')
  console.log('    write_persisted_ok=false ⇒ fs.writeBytes 没成功（查宿主 fs.* 与沙箱路径）')
  console.log('    read_from_disk_ok=false 但 read_hit_ok=true ⇒ 命中来自内存（装置没真重启？）')
  console.log('    hitsRead > hitsWrite ⇒ 重启后仍回源 ⇒ 持久层没生效')
  console.log('  write 报告：' + JSON.stringify(W).slice(0, 1200))
  console.log('  read  报告：' + JSON.stringify(R).slice(0, 1200))
  process.exit(1)
}
console.log('\n✅ 缓存持久层（L2）：跨进程真命中 + 服务端零请求（Android 文件后端）')
NODE
