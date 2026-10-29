#!/usr/bin/env bash
# hosts/android/run-document-probe.sh —— ★★★#1384 C84 `openDocument` Android 真机判据
#
# 【它证明什么（单测碰不到的部分）】
#   单测只能证明"JS 层打了 `document.open` 且传了归一化载荷"；宿主那段（ACTION_VIEW +
#   自建 ContentProvider 的 content:// URI）在 JVM 上跑不了 ⇒ 必须真机验：
#     ① **沙箱内合法 PDF** ⇒ 宿主回执 `{dispatched:true}`
#        ★同时核对**系统真的收到了**：`dumpsys` 顶层 Activity 不再停留在本 App
#        （只信宿主回执 = 本仓最忌的"桥说成功"）；
#     ② **越界路径**（绝对路径 / `..`）⇒ 宿主拒绝；
#     ③ **非白名单扩展名**（`.exe`，文件真实存在）⇒ 宿主拒绝（不降级 octet-stream）；
#     ④ 沙箱内不存在的文件 ⇒ 宿主拒绝（不是假成功）。
#
# 【★为什么用 `capprobe`（同步派发）而不是走 JS 桥】
#   本判据要验的是**宿主方法本身**。JS 桥层校验已由 `tests/capability-app-document.test.ts` 覆盖；
#   这条要验"宿主自己也校验"（两层各自独立）。`capprobe` 直调 `caps.invoke`，正好隔离出宿主层。
#
# 【★为什么 capprobe 每次都要 force-stop】
#   `capprobe` 在 `SuperappActivity.onCreate` 里跑，而 `am start` 对**已在前台**的 Activity
#   不会重走 onCreate ⇒ 第二次探针会读到上一次的 logcat（#1237 实测踩过）。
#
# 【★夹具怎么造】非 root 写不进别的 App 私有沙箱 ⇒ 用宿主自己的 `fs.writeBytes`
#   （同一个 `capprobe` 通道，只是换方法名）。`.exe` 也要真造出来——否则扩展名白名单那条
#   会被"文件不存在"提前拦下（判据会通过，但通过的理由是错的，属**假绿**）。
#
# 【诚实边界】
#   ① 本脚本验 **Android**。iOS / 鸿蒙各有自己的脚本（同一份业务语义）。
#   ② "预览器真的出现"用 `dumpsys` 的顶层 Activity 判定：预览器包名各 ROM 不同
#      （WPS / 系统预览 / 浏览器都可能接 PDF）⇒ 判据是"**不再是本 App**"，并打印实得值供人工核对。
#   ③ 需要先有 APK：`bash hosts/android/build-and-run.sh --no-install`。
#
# 用法：bash hosts/android/run-document-probe.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

PKG="dev.proteus.layoutcore"
ACT="$PKG/.SuperappActivity"
ADB="${ADB:-adb}"
APK="${PROTEUS_APK:-$HERE/build/proteus-layoutcore.apk}"
OUT_DIR="$HERE/results"
LOG="$OUT_DIR/document-probe.txt"
mkdir -p "$OUT_DIR"

[ -f "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
[ -f "$APK" ] || { echo "✗ 找不到 APK：$APK（先 bash hosts/android/build-and-run.sh --no-install）"; exit 3; }
"$ADB" get-state >/dev/null 2>&1 || { echo "✗ 设备未连接"; exit 3; }

: > "$LOG"

echo "==> ① 安装 APK"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2

# cap <标签> <宿主方法名> <args-json>
#   每次 force-stop 确保 onCreate 重跑（否则读到上一次的回执）。
#   ★日志行格式：`<标签>\t<CAP_RECEIPT 原始行>` —— 判定侧按标签取值后再剥 `-> `，
#     不在写日志时剥（首版就是这么错的：写进去的已是剥过的摘要，判定侧再剥一次就永远
#     命中不了，于是"被拒"被读成"无回执"）。
cap() {
  local label="$1" method="$2" args="$3"
  "$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
  "$ADB" logcat -c >/dev/null 2>&1 || true
  "$ADB" shell "am start -n $ACT --es capprobe '$method|$args'" >/dev/null 2>&1
  if ! bash "$WAIT_SH" --cmd "\"$ADB\" shell 'logcat -d -s ProteusCapProbe | grep -q CAP_RECEIPT'" --timeout 60 --interval 1 --max-interval 3; then
    echo "✗ ${label}：无回执（启动/装机失败？）"
    "$ADB" shell 'logcat -d | grep -E "ProteusCapProbe|AndroidRuntime|ProteusLayout" | tail -25' || true
    return 1
  fi
  local raw
  raw="$("$ADB" shell "logcat -d -s ProteusCapProbe" | grep 'ProteusCapProbe: CAP_RECEIPT' | tail -1)"
  printf '%s\t%s\n' "$label" "$raw" >> "$LOG"
  printf '%s：%s\n' "$label" "$(printf '%s' "$raw" | sed 's/.*-> //' | cut -c1-160)"
}

topActivity() { "$ADB" shell 'dumpsys activity activities | grep -m1 topResumedActivity' 2>/dev/null | head -1; }

# 最小 PDF：`%PDF-1.4\n%%EOF\n`
PDF_BYTES='[37,80,68,70,45,49,46,52,10,37,37,69,79,70,10]'

echo "==> ② 造夹具（fs.writeBytes → __DOC_PROBE__/{sample.pdf,evil.exe}）"
cap '夹具-PDF' fs.writeBytes "{\"path\":\"__DOC_PROBE__/sample.pdf\",\"bytes\":$PDF_BYTES}" || exit 4
cap '夹具-exe' fs.writeBytes '{"path":"__DOC_PROBE__/evil.exe","bytes":[77,90,144,0]}' || exit 4

echo "==> ③ 合法载荷（沙箱内 PDF）"
cap '合法-PDF' document.open '{"path":"__DOC_PROBE__/sample.pdf","mimeType":"application/pdf","title":"sample"}' || exit 4
echo "    ★核对系统真的收到了（有界等待顶层 Activity 离开本 App）"
bash "$WAIT_SH" --cmd "\"$ADB\" shell 'dumpsys activity activities | grep -m1 topResumedActivity' | grep -qv 'dev.proteus.layoutcore'" --timeout 20 --interval 1 --max-interval 2 >/dev/null 2>&1 || true
TOP1="$(topActivity)"
printf '    %s\n' "$TOP1"

echo "==> ④ 越界路径：绝对路径（应被宿主拒绝）"
cap '绝对路径' document.open '{"path":"/etc/passwd.pdf","mimeType":"application/pdf"}' || exit 4
echo "==> ⑤ 越界路径：.. 穿越（应被拒）"
cap '目录穿越' document.open '{"path":"../escape.pdf","mimeType":"application/pdf"}' || exit 4
echo "==> ⑥ 非白名单扩展名 .exe（文件真实存在；应被拒）"
cap 'exe扩展名' document.open '{"path":"__DOC_PROBE__/evil.exe","mimeType":"application/pdf"}' || exit 4
echo "==> ⑦ 沙箱内不存在的文件（应被拒）"
cap '不存在' document.open '{"path":"__DOC_PROBE__/not-there.pdf","mimeType":"application/pdf"}' || exit 4

"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true

echo ""
echo "==> ⑧ 判定"
node - "$LOG" "$TOP1" <<'NODE'
const fs = require('fs')
const [logPath, top] = process.argv.slice(2)
const raw = fs.readFileSync(logPath, 'utf8')

/** 按标签取回执原文（`<标签>\t<CAP_RECEIPT 行>`），再剥 `-> ` 之后的内容 */
function receipt(label) {
  const line = raw.split('\n').find((l) => l.startsWith(label + '\t'))
  if (!line) return ''
  const i = line.indexOf('-> ')
  return i >= 0 ? line.slice(i + 3).trim() : ''
}
function isOk(p) {
  try { const d = JSON.parse(p); return d.ok === true } catch { return false }
}
function isRejected(p) {
  if (/^ERR:/.test(p)) return true
  try { const d = JSON.parse(p); return d.ok === false } catch { return false }
}

const chk = []
const add = (c, m) => chk.push([c, m])

add(isOk(receipt('夹具-PDF')), `夹具 PDF 写入成功（沙箱可写）— ${receipt('夹具-PDF').slice(0, 90)}`)
add(isOk(receipt('夹具-exe')), '夹具 exe 写入成功（供扩展名白名单用例使用）')

const good = receipt('合法-PDF')
// ★合法载荷：Android 回 `{dispatched:true}`；鸿蒙形态是 `{accepted:true}`——这里只认 Android 形态
//   但**不**把"受理"当"用户看完"（见文件头语义边界）。
let goodDispatched = false
try { goodDispatched = JSON.parse(good).data?.dispatched === true } catch { /* 下面报 */ }
add(goodDispatched, `★沙箱内合法 PDF 被受理（dispatched:true）${goodDispatched ? '' : ' — ' + good.slice(0, 140)}`)

add(isRejected(receipt('绝对路径')), '★★绝对路径被拒（宿主层自己校验，不靠 JS）')
add(isRejected(receipt('目录穿越')), '★★.. 穿越被拒')
add(isRejected(receipt('exe扩展名')), '★非白名单扩展名被拒（不降级 octet-stream）')
add(isRejected(receipt('不存在')), '沙箱内不存在的文件被拒（不是假成功）')

// ★系统侧取证：只信回执 = 假绿。预览器拉起后顶层 Activity 应不再是本 App。
const left = !/dev\.proteus\.layoutcore/.test(String(top || ''))
add(left, `★★系统真的收到了：顶层 Activity 不再停留在本 App（实得：${String(top || '').trim().slice(0, 130)}）`)

let pass = 0
for (const [c, m] of chk) { console.log(`  ${c ? '✅' : '❌'} ${m}`); if (c) pass++ }
console.log(`\n${pass}/${chk.length} 通过`)
process.exit(pass === chk.length ? 0 : 1)
NODE
