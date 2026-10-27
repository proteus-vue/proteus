#!/usr/bin/env bash
# hosts/android/run-fs-append-probe.sh —— ★★★#1237 真机判据：**原生追加真的追加，不是覆盖**
#
# 【它证明什么（单测碰不到的部分）】
#   单测能证明 JS 层"打的是 `fs.appendBytes` 而不是 `fs.writeBytes`"，但证明不了
#   **宿主那边真的是 O_APPEND**：如果 Java 侧写成 `new FileOutputStream(f, false)`（覆盖），
#   单测照样全绿（它只看方法名），而真机行为是"第二次追加把文件覆盖成 3 字节"。
#   ⇒ 必须让**真宿主**跑两次追加再读回来：
#      · 第 1 次 append `abc` ⇒ `size=3, appended=3`
#      · 第 2 次 append `abc` ⇒ `size=6, appended=3`   ★这一条才是"追加而非覆盖"
#      · 读回 ⇒ `abcabc`（6 字节，顺序正确）
#   ★判据口径：不只看 size 字段（宿主可以乱填），**必须读回内容断言 `abcabc`**。
#
# 【为什么用 `loop:` + `js:` 两条腿】
#   · `fs.appendBytes` 是宿主方法 ⇒ 用 `capprobe` 的 `method|json` 形式（走真派发）；
#     但同一个 Activity 实例里要连打两次且中间读回 ⇒ 用 `loop:` 只能重复同一条，
#     参数不能变 ⇒ 改用三段独立 `am start` 不行（每次重开会清空？——不会：文件在磁盘上）。
#     ★追加的**持久性**正是本单要验的：两个独立进程各 append 一次，文件仍应累计到 6 字节。
#     所以这里**刻意**用多次 `am start`（与 worker 上界那种"必须同实例"的场景相反），
#     因为它验的是"跨进程累计"，不是"内存计数"。
#
# 【诚实边界】
#   ① 本脚本验 **Android**。iOS 的 appendBytes 只被 `swiftc -typecheck` 覆盖，**真机未跑**。
#   ② 验的是"追加语义"，不验"极端并发下不交错"（多进程并发写在 POSIX 层由 O_APPEND 保证，
#      但那属压测，不在本判据）。
#
# 用法：bash hosts/android/run-fs-append-probe.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

PKG="dev.proteus.layoutcore"
ACT="$PKG/.SuperappActivity"
ADB="${ADB:-adb}"
APK="${PROTEUS_APK:-$HERE/build/proteus-layoutcore.apk}"
OUT_DIR="$HERE/results"
LOG="$OUT_DIR/fs-append-probe.txt"
TARGET="probe-1237-append.txt"
mkdir -p "$OUT_DIR"

[ -f "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
[ -f "$APK" ] || { echo "✗ 找不到 APK：$APK（先跑 bash hosts/android/build-and-run.sh --no-install）"; exit 3; }
"$ADB" get-state >/dev/null 2>&1 || { echo "✗ 设备未连接"; exit 3; }

echo "==> ① 安装 APK"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2

# ★每次跑都从空日志开始：判定按行序取第 1/2/3 条，上一次残留会让"第 1 次"读到旧回执（假绿）。
: > "$LOG"

echo "==> ② 清场：删掉上次的探针文件（否则累计值不可预期）"
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" logcat -c >/dev/null 2>&1 || true
"$ADB" shell "am start -n $ACT --es capprobe 'fs.remove|{\"path\":\"$TARGET\"}'" >/dev/null 2>&1
if ! bash "$WAIT_SH" --cmd "\"$ADB\" shell 'logcat -d -s ProteusCapProbe | grep -q CAP_RECEIPT'" --timeout 60 --interval 1 --max-interval 3; then
  echo "✗ 清场无回执——探针通道没工作（后续判据会假红，先修通道）"
  "$ADB" shell 'logcat -d | grep -E "ProteusCapProbe|AndroidRuntime" | tail -20' || true
  exit 4
fi
echo "    $(printf '%s' "$("$ADB" shell "logcat -d -s ProteusCapProbe" | grep 'CAP_RECEIPT' | tail -1)" | tail -c 200)"

run_append() {
  local label="$1"
  # ★★必须先 force-stop：`capprobe` 在 **onCreate** 里跑，而 `am start` 对已在前台的
  #    Activity 只是 bringToFront（**不重新 onCreate**）⇒ 第二次起就永远没回执
  #    （首跑实测：第 1 次追加 60s 超时，而清场那次成功——差别就是清场前 force-stop 过）。
  #   ★这不影响判据口径：文件在**磁盘**上，进程重启正是"跨进程累计"要验的形态。
  "$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
  "$ADB" logcat -c >/dev/null 2>&1 || true
  "$ADB" shell "am start -n $ACT --es capprobe 'fs.appendBytes|{\"path\":\"$TARGET\",\"bytes\":[97,98,99]}'" >/dev/null 2>&1
  if ! bash "$WAIT_SH" --cmd "\"$ADB\" shell 'logcat -d -s ProteusCapProbe | grep -q CAP_RECEIPT'" --timeout 60 --interval 1 --max-interval 3; then
    echo "✗ ${label} 无回执"
    "$ADB" shell 'logcat -d | grep -E "ProteusCapProbe|AndroidRuntime" | tail -20' || true
    return 1
  fi
  "$ADB" shell "logcat -d -s ProteusCapProbe" | grep 'ProteusCapProbe: CAP_RECEIPT' | tail -1
}

echo "==> ③ 第 1 次追加 'abc'"
R1="$(run_append '第 1 次')" || exit 4
printf '%s\n' "$(printf '%s' "$R1" | grep 'ProteusCapProbe: CAP_RECEIPT')" | tee -a "$LOG"
echo "    $(printf '%s' "$R1" | tail -c 220)"

echo "==> ④ 第 2 次追加 'abc'（跨进程 ⇒ 验的是磁盘累计，不是内存计数）"
R2="$(run_append '第 2 次')" || exit 4
printf '%s\n' "$(printf '%s' "$R2" | grep 'ProteusCapProbe: CAP_RECEIPT')" | tee -a "$LOG"
echo "    $(printf '%s' "$R2" | tail -c 220)"

echo "==> ⑤ 读回内容（★这条才是核心：size 字段可以乱填，内容不会）"
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" logcat -c >/dev/null 2>&1 || true
"$ADB" shell "am start -n $ACT --es capprobe 'fs.readBytes|{\"path\":\"$TARGET\"}'" >/dev/null 2>&1
if ! bash "$WAIT_SH" --cmd "\"$ADB\" shell 'logcat -d -s ProteusCapProbe | grep -q CAP_RECEIPT'" --timeout 60 --interval 1 --max-interval 3; then
  echo "✗ 读回无回执"
  exit 4
fi
R3="$("$ADB" shell "logcat -d -s ProteusCapProbe" | grep 'CAP_RECEIPT' | tail -1)"
printf '%s\n' "$(printf '%s' "$R3" | grep 'ProteusCapProbe: CAP_RECEIPT')" | tee -a "$LOG"
echo "    $(printf '%s' "$R3" | tail -c 260)"

"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true

echo ""
echo "==> ⑥ 判定"
node - "$LOG" <<'NODE'
const fs = require('fs')
// ★★只认**真日志行**：`wait_for.sh` 的 "READY: cmd=…grep -q CAP_RECEIPT…" 提示也含这个字面量，
//   若只按 CAP_RECEIPT 过滤，READY 行会被当成回执 ⇒ 行序错位（首跑实测：2/8，全 NaN）。
const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n')
  .filter((l) => l.includes('ProteusCapProbe: CAP_RECEIPT') && l.includes(' -> '))
// 每行形如：CAP_RECEIPT method=fs.appendBytes args=... -> {"ok":true,"data":{...}}
function receipt(i) {
  const line = lines[i] || ''
  const at = line.indexOf('-> ')
  return at >= 0 ? line.slice(at + 3).trim() : ''
}
function jsonOf(s) {
  try { return JSON.parse(s) } catch { return null }
}
const a1 = jsonOf(receipt(0))
const a2 = jsonOf(receipt(1))
const rd = jsonOf(receipt(2))

const size1 = a1 && a1.ok ? Number(a1.data && a1.data.size) : NaN
const appended1 = a1 && a1.ok ? Number(a1.data && a1.data.appended) : NaN
const size2 = a2 && a2.ok ? Number(a2.data && a2.data.size) : NaN
const appended2 = a2 && a2.ok ? Number(a2.data && a2.data.appended) : NaN
const bytes = rd && rd.ok && Array.isArray(rd.data && rd.data.bytes) ? rd.data.bytes : []
const text = bytes.map((b) => String.fromCharCode(b)).join('')

const chk = []
const add = (c, m) => chk.push([c, m])
add(lines.length >= 3, `三次回执齐（append×2 + read×1），实得 ${lines.length}`)
add(a1 && a1.ok === true, `第 1 次 append 成功${a1 ? '' : ' — 回执不可解析'}`)
add(size1 === 3 && appended1 === 3, `第 1 次 appended=3 且 size=3（实得 size=${size1} appended=${appended1}）`)
add(a2 && a2.ok === true, `第 2 次 append 成功`)
add(size2 === 6 && appended2 === 3, `★★第 2 次 appended=3 且 size=6（=3+3，**追加不是覆盖**；实得 size=${size2} appended=${appended2}）`)
add(rd && rd.ok === true, '读回成功')
add(text === 'abcabc', `★★读回内容 = "abcabc"（实得 ${JSON.stringify(text)}，${bytes.length} 字节）`)
add(bytes.length === 6, `读回字节数 = 6（实得 ${bytes.length}）`)

let pass = 0
for (const [c, m] of chk) { console.log(`  ${c ? '✅' : '❌'} ${m}`); if (c) pass++ }
console.log(`\n${pass}/${chk.length} 通过`)
process.exit(pass === chk.length ? 0 : 1)
NODE
