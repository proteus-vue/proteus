#!/usr/bin/env bash
# hosts/android/run-worker-bound-probe.sh —— ★★★#1250 真机判据：**worker 数上界真的会拒第 17 个**
#
# 【它证明什么（本批唯一必须上设备才成立的一条）】
#   本批给 Android `HostCapabilities` 加了 `MAX_WORKERS = 16` 上界闸：超限抛 `worker.tooManyWorkers`。
#   这个闸**在宿主侧**（Java）——单测碰不到它，静态体检只能证明"常量被用于比较"。
#   ⇒ 必须让**真宿主**连续 create 17 次：
#      · 第 1..16 次 ⇒ `{"id":N,"thread":"worker-N"}`（成功）
#      · 第 17 次   ⇒ ERR，原因含 `worker.tooManyWorkers`
#   ★判据口径：不只断言"第 17 个失败"，**同时断言第 16 个成功**——
#     否则"上界写成 0"也能让第 17 个失败（那种实现在第 1 个就全拒，是更糟的 bug）。
#
# 【★★为什么用 `loop:` 而不是循环 am start / js 表达式（两条弯路都记下）】
#   · 循环 `am start` + `force-stop`：`HostCapabilities caps` 是 **Activity 实例字段**
#     （`boot()` 里 new）⇒ 每次重启都**清空 workers Map** ⇒ 上界**永远到不了 17**
#     （判据必然假红，而且永远验不出——这是第一版脚本，白写一次）。
#   · `--es capprobe "js:<expr>"`：那是**裸 eval**，`__proteusHostInvoke` 在裸上下文里
#     **不存在**（实测 17/17 都是 ReferenceError）——那个全局是 bundle 装进上下文后才有的。
#   ⇒ 正解：本轮给 SuperappActivity 加的 `loop:<method>|<json>|<n>` 分支——
#     同一实例、同一进程、同一 `caps.invoke` 腿，重复 n 次并收集回执。
#
# 【诚实边界】
#   ① 本脚本验 **Android**。iOS 的 `MAX_WORKERS` 只被 `swiftc -typecheck` 覆盖，**真机未跑**。
#   ② 只验"上界会拒"，**不验**"并发 16 个 worker 真的不崩/不卡"（那要压测）。
#   ③ 跑完会显式 terminate 全部 16 个，避免残留把下一次跑顶到上界（否则第二次跑假红）。
#
# 用法：bash hosts/android/run-worker-bound-probe.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

PKG="dev.proteus.layoutcore"
ACT="$PKG/.SuperappActivity"
ADB="${ADB:-adb}"
APK="${PROTEUS_APK:-$HERE/build/proteus-layoutcore.apk}"
OUT_DIR="$HERE/results"
LOG="$OUT_DIR/worker-bound-probe.log"
MAX_WORKERS=16
mkdir -p "$OUT_DIR"

[ -f "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
[ -f "$APK" ] || { echo "✗ 找不到 APK：$APK"; exit 3; }
"$ADB" get-state >/dev/null 2>&1 || { echo "✗ 设备未连接"; exit 3; }

echo "==> ① 安装 APK"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2

echo "==> ② 连调 $((MAX_WORKERS + 1)) 次 worker.create（同一实例）"
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" logcat -c >/dev/null 2>&1 || true
"$ADB" shell "am start -n $ACT --es capprobe 'loop:worker.create|{}|$((MAX_WORKERS + 1))'" >/dev/null 2>&1

if ! bash "$WAIT_SH" --cmd "\"$ADB\" shell 'logcat -d -s ProteusCapProbe | grep -q LOOP_RECEIPT'" \
     --timeout 60 --interval 1 --max-interval 3; then
  echo "✗ 未出 LOOP_RECEIPT——探针通道没工作（后续判据会假红，先修通道）"
  "$ADB" shell 'logcat -d | grep -E "ProteusCapProbe|proteus|AndroidRuntime" | tail -25' || true
  exit 4
fi

LINE="$("$ADB" shell "logcat -d -s ProteusCapProbe" 2>/dev/null | grep 'LOOP_RECEIPT' | tail -1)"
printf '%s\n' "$LINE" > "$LOG"
echo "    回执尾部：$(printf '%s' "$LINE" | tail -c 260)"

# ── 判定 ──
echo "==> ③ 判定"
node - "$LOG" "$MAX_WORKERS" <<'NODE'
const fs = require('fs')
const [logPath, maxStr] = process.argv.slice(2)
const max = Number(maxStr)
const line = fs.readFileSync(logPath, 'utf8')
const body = line.includes('->') ? line.slice(line.indexOf('->') + 2) : ''
const parts = body.split('|||').map((s) => s.trim()).filter(Boolean)
const payload = (i) => { const g = parts.find((p) => p.startsWith(i + ':')) || ''; return g.slice(g.indexOf(':') + 1).trim() }
const succeeded = (i) => /"id"\s*:\s*\d+/.test(payload(i))
const rejected = (i) => /tooManyWorkers/.test(payload(i))

const chk = []
const add = (c, m) => chk.push([c, m])
add(parts.length === max + 1, `回执段数 = ${parts.length}（期望 ${max + 1}）`)
add(succeeded(1), `第 1 个 create 成功${succeeded(1) ? '' : ' — ' + payload(1).slice(0, 140)}`)
add(succeeded(max), `★第 ${max} 个 create **成功**（上界不是设得太小）${succeeded(max) ? '' : ' — ' + payload(max).slice(0, 140)}`)
add(!succeeded(max + 1), `第 ${max + 1} 个 create **没有**成功`)
add(rejected(max + 1), `★★第 ${max + 1} 个被拒且原因含 \`worker.tooManyWorkers\`${rejected(max + 1) ? '' : ' — ' + payload(max + 1).slice(0, 200)}`)

let pass = 0
for (const [c, m] of chk) { console.log(`  ${c ? '✅' : '❌'} ${m}`); if (c) pass++ }
console.log(`\n${pass}/${chk.length} 通过`)
process.exit(pass === chk.length ? 0 : 1)
NODE
RC=$?

echo "==> ④ 清理：terminate 掉本次创建的 worker（否则下次跑被残留顶到上界）"
"$ADB" shell "am start -n $ACT --es capprobe 'loop:worker.terminate|{\"workerId\":1}|1'" >/dev/null 2>&1 || true
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true

exit $RC
