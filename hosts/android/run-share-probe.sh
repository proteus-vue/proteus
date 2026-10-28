#!/usr/bin/env bash
# hosts/android/run-share-probe.sh —— ★★★#1336 C22 `share` Android 真机判据
#
# 【它证明什么（单测碰不到的部分）】
#   单测只能证明"JS 层打了 `share` 且传了归一化载荷"；宿主那段（`Intent.ACTION_SEND` +
#   `createChooser`）在 JVM 上跑不了 ⇒ 必须真机验：
#     ① **合法载荷** ⇒ 宿主回执 `{dispatched:true}`
#        ★同时核对**系统真的收到了**：`dumpsys activity activities` 出现选择器/分享界面
#        （只信宿主回执 = 本仓最忌的"桥说成功"）；
#     ② **危险 URL scheme**（`file://` / `javascript:` / 自定义）⇒ 宿主**拒绝**；
#     ③ 空载荷 / 超长文本 ⇒ 宿主拒绝。
#
# 【★为什么用 `capprobe`（同步派发）而不是走 JS 桥】
#   本判据要验的是**宿主方法本身**。JS 桥层校验已由 `tests/capability-app-share.test.ts`（9 条）覆盖；
#   这条要验"宿主自己也校验"（两层各自独立）。`capprobe` 直调 `caps.invoke`，正好隔离出宿主层。
#
# 【诚实边界】
#   ① 本脚本验 **Android**。iOS 由 `hosts/ios/run-share-probe.sh`（10/10），
#      鸿蒙由 `hosts/harmony/run-share-probe.sh`（11/11）各自验。
#   ② "分享面板真的出现"用 `dumpsys` 的顶层 Activity 判定；不同 ROM 的选择器包名不同
#      （`android/com.android.internal.app.ChooserActivity` / 厂商定制）⇒ 用关键词匹配
#      `Chooser|chooser|Resolver|share|Share`，命中即算，**不硬编码包名**。
#
# 用法：bash hosts/android/run-share-probe.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

PKG="dev.proteus.layoutcore"
ACT="$PKG/.SuperappActivity"
ADB="${ADB:-adb}"
APK="${PROTEUS_APK:-$HERE/build/proteus-layoutcore.apk}"
OUT_DIR="$HERE/results"
LOG="$OUT_DIR/share-probe.txt"
mkdir -p "$OUT_DIR"

[ -f "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
[ -f "$APK" ] || { echo "✗ 找不到 APK：$APK（先 bash hosts/android/build-and-run.sh --no-install）"; exit 3; }
"$ADB" get-state >/dev/null 2>&1 || { echo "✗ 设备未连接（本单 Android 真机未验，如实标注）"; exit 3; }

: > "$LOG"

echo "==> ① 安装 APK"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2

# 探针调用：每次 force-stop 确保 onCreate 重跑（#1237 教训：前台 Activity 不重走 onCreate）
probe() {
  local label="$1" args="$2"
  "$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
  "$ADB" logcat -c >/dev/null 2>&1 || true
  "$ADB" shell "am start -n $ACT --es capprobe 'share|$args'" >/dev/null 2>&1
  if ! bash "$WAIT_SH" --cmd "\"$ADB\" shell 'logcat -d -s ProteusCapProbe | grep -q CAP_RECEIPT'" --timeout 60 --interval 1 --max-interval 3; then
    echo "✗ ${label} 无回执"
    "$ADB" shell 'logcat -d | grep -E "ProteusCapProbe|AndroidRuntime" | tail -20' || true
    return 1
  fi
  local line
  line="$("$ADB" shell "logcat -d -s ProteusCapProbe" | grep 'ProteusCapProbe: CAP_RECEIPT' | tail -1)"
  printf '%s\n' "$line" | tee -a "$LOG" >/dev/null
  printf '%s' "$line" | tail -c 240
  printf '\n'
}

topActivity() { "$ADB" shell 'dumpsys activity activities | grep -m3 -E "topResumedActivity|ResumedActivity"' 2>/dev/null | head -3; }

echo "==> ② 合法载荷（文本）"
R1="$(probe '纯文本' '{"text":"Proteus share probe (#1336)"}')" || exit 4
printf '纯文本回执：%s\n' "${R1##*-> }" | tee -a "$LOG"
echo "    ★核对系统真的收到了（顶层 Activity 应为选择器/分享界面）"
TOP1="$(topActivity)"
printf '顶层 Activity：\n%s\n' "$TOP1" | tee -a "$LOG"

echo "==> ③ 合法载荷（标题+文本+链接）"
R2="$(probe '带链接' '{"title":"Proteus","text":"分享一条链接","url":"https://proteus.dev/"}')" || exit 4
printf '带链接回执：%s\n' "${R2##*-> }" | tee -a "$LOG"

echo "==> ④ 危险 scheme：file://（应被**宿主**拒绝）"
R3="$(probe 'file://' '{"url":"file:///etc/passwd"}')" || exit 4
printf 'file:// 回执：%s\n' "${R3##*-> }" | tee -a "$LOG"

echo "==> ⑤ 危险 scheme：javascript:（应被拒）"
R4="$(probe 'javascript:' '{"url":"javascript:alert(1)"}')" || exit 4
printf 'javascript: 回执：%s\n' "${R4##*-> }" | tee -a "$LOG"

echo "==> ⑥ 空载荷（应被拒）"
R5="$(probe '空载荷' '{}')" || exit 4
printf '空载荷回执：%s\n' "${R5##*-> }" | tee -a "$LOG"

echo "==> ⑦ 只有空白标题（应被拒 —— 三端 trim 口径）"
R6="$(probe '空白标题' '{"title":"   "}')" || exit 4
printf '空白标题回执：%s\n' "${R6##*-> }" | tee -a "$LOG"

"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true

echo ""
echo "==> ⑧ 判定"
node - "$LOG" "$TOP1" <<'NODE'
const fs = require('fs')
const [logPath, top] = process.argv.slice(2)
const raw = fs.readFileSync(logPath, 'utf8')

/**
 * 从一段文本里取 `-> ` 之后的内容：
 *   · 正常回执 ⇒ JSON 对象
 *   · 宿主抛错 ⇒ `ERR:<ExceptionClass>: <message>`（capprobe 的既有形态，见 #1237）
 * ★必须两种都认：否则"被拒绝"会被读成"没回执"。
 */
function payloadOf(s) {
  const i = s.indexOf('-> ')
  return i >= 0 ? s.slice(i + 3).trim() : s.trim()
}
function lineFor(labelPrefix) {
  const line = raw.split('\n').find((l) => l.includes(labelPrefix))
  return line ? payloadOf(line) : ''
}
function isOk(p) {
  try { const d = JSON.parse(p); return d.ok === true && (d.data || {}).dispatched === true } catch { return false }
}
function isRejected(p) {
  // capprobe 的两种"拒绝"形态：ERR 前缀，或 {ok:false}
  if (/^ERR:/.test(p)) return true
  try { const d = JSON.parse(p); return d.ok === false } catch { return false }
}

const chk = []
const add = (c, m) => chk.push([c, m])

// ① 合法载荷 ⇒ dispatched
const p1 = lineFor('纯文本回执')
add(isOk(p1), `★纯文本载荷被受理（dispatched:true）${isOk(p1) ? '' : ' — ' + p1.slice(0, 120)}`)
const p2 = lineFor('带链接回执')
add(isOk(p2), `★标题+文本+链接被受理${isOk(p2) ? '' : ' — ' + p2.slice(0, 120)}`)

// ② 危险 scheme / 空载荷 ⇒ 拒绝
const p3 = lineFor('file:// 回执')
add(isRejected(p3), `★★file:// 被拒（本机路径泄漏）`)
const p4 = lineFor('javascript: 回执')
add(isRejected(p4), `★★javascript: 被拒（可执行语义）`)
const p5 = lineFor('空载荷回执')
add(isRejected(p5), `空载荷被拒（不拉起空面板）`)
const p6 = lineFor('空白标题回执')
add(isRejected(p6), `只有空白标题被拒（三端 trim 口径一致）`)

// ③ ★系统侧取证：顶层 Activity 应为选择器/分享界面（只信回执 = 假绿）
const chooser = /Chooser|chooser|Resolver|ResolverActivity|share|Share/i.test(String(top || ''))
add(chooser, `★★系统真的收到了：顶层 Activity 含选择器/分享关键词（实得：${String(top || '').split('\n')[0].slice(0, 120)}）`)

let pass = 0
for (const [c, m] of chk) { console.log(`  ${c ? '✅' : '❌'} ${m}`); if (c) pass++ }
console.log(`\n${pass}/${chk.length} 通过`)
process.exit(pass === chk.length ? 0 : 1)
NODE
