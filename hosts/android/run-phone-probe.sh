#!/usr/bin/env bash
# hosts/android/run-phone-probe.sh —— ★★★#1258 真机判据：`phone.call` 真的拉起拨号盘，且非法号码被拒
#
# 【它证明什么（单测碰不到的部分）】
#   单测只能证明"JS 层打了 `phone.call` 且传了对的号码"；宿主那段（`Intent.ACTION_DIAL`）
#   在 JVM 上跑不了。⇒ 必须真机验三件：
#     ① **合法号码** ⇒ 宿主回执 `{dispatched:true, uri:"tel:..."}`
#        ★同时核对**系统真的收到了**：`dumpsys activity activities` 里出现拨号界面
#        （只信宿主回执 = 本仓最忌的"桥说成功"）；
#     ② **非法号码**（`12/34`）⇒ 宿主**拒绝**（`ok:false`，reason 含"号码非法"）；
#     ③ 白名单边界：`*100#`（USSD）能过、`12?x=1` 不能过。
#
# 【★为什么用 `capprobe`（同步派发）而不是走 JS 桥】
#   本判据要验的是**宿主方法本身**。JS 桥层的校验已由 `tests/capability-app-phone.test.ts` 覆盖；
#   这条要验"宿主自己也校验"（两层各自独立）。`capprobe` 直调 `caps.invoke`，正好隔离出宿主层。
#
# 【诚实边界】
#   ① 本脚本验 **Android**。iOS 的 `PhoneCallCapability` 只被 `swiftc -typecheck` 覆盖，**真机未跑**；
#      鸿蒙走动作队列（`accepted:true` 已入队），需 hdc 设备，本机当前未连。
#   ② "拨号盘真的出现在屏幕上"用 `dumpsys` 的顶层 Activity 判定；若设备厂商定制了拨号器
#      （包名不同），会如实打印实际包名而**不判红**（`*` 匹配 `dialer|phone` 关键词）。
#
# 用法：bash hosts/android/run-phone-probe.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

PKG="dev.proteus.layoutcore"
ACT="$PKG/.SuperappActivity"
ADB="${ADB:-adb}"
APK="${PROTEUS_APK:-$HERE/build/proteus-layoutcore.apk}"
OUT_DIR="$HERE/results"
LOG="$OUT_DIR/phone-probe.txt"
mkdir -p "$OUT_DIR"

[ -f "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
[ -f "$APK" ] || { echo "✗ 找不到 APK：$APK（先 bash hosts/android/build-and-run.sh --no-install）"; exit 3; }
"$ADB" get-state >/dev/null 2>&1 || { echo "✗ 设备未连接"; exit 3; }

: > "$LOG"

echo "==> ① 安装 APK"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2

# 探针调用：每次 force-stop 确保 onCreate 重跑（见 #1237 的教训：前台 Activity 不重走 onCreate）
probe() {
  local label="$1" args="$2"
  "$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
  "$ADB" logcat -c >/dev/null 2>&1 || true
  "$ADB" shell "am start -n $ACT --es capprobe 'phone.call|$args'" >/dev/null 2>&1
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

echo "==> ② 合法号码 +86 138 0013 8000"
R_OK="$(probe '合法号码' '{"number":"+86 138 0013 8000"}')" || exit 4
printf '合法号码回执：%s\n' "${R_OK##*-> }" | tee -a "$LOG"

echo "    ★核对系统真的收到了（顶层 Activity 应为拨号器）"
topActivity() { "$ADB" shell 'dumpsys activity activities | grep -m3 -E "topResumedActivity|ResumedActivity"' 2>/dev/null | head -3; }
TOP="$(topActivity)"
printf '顶层 Activity：\n%s\n' "$TOP" | tee -a "$LOG"

echo "==> ③ 非法号码 12/34（应被**宿主**拒绝）"
R_BAD="$(probe '非法号码' '{"number":"12/34"}')" || exit 4
printf '非法号码回执：%s\n' "${R_BAD##*-> }" | tee -a "$LOG"

echo "==> ④ 白名单边界：*100# 应通过"
R_USSD="$(probe 'USSD' '{"number":"*100#"}')" || exit 4
printf 'USSD 回执：%s\n' "${R_USSD##*-> }" | tee -a "$LOG"

echo "==> ⑤ 白名单边界：12?x=1 应被拒"
R_Q="$(probe '查询串注入' '{"number":"12?x=1"}')" || exit 4
printf '查询串回执：%s\n' "${R_Q##*-> }" | tee -a "$LOG"

"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true

echo ""
echo "==> ⑥ 判定"
node - "$LOG" "$TOP" <<'NODE'
const fs = require('fs')
const [logPath, top] = process.argv.slice(2)
const raw = fs.readFileSync(logPath, 'utf8')

/**
 * 从一段文本里取 `-> ` 之后的内容：
 *   · 正常回执 ⇒ JSON 对象
 *   · 宿主抛错 ⇒ `ERR:<ExceptionClass>: <message>`（capprobe 的既有形态，见 #1237）
 * ★必须两种都认：否则"被拒绝"会被读成"没回执"（本仓判据反复踩的形态）。
 */
function payloadOf(s) {
  const at = s.indexOf('-> ')
  if (at < 0) return null
  const body = s.slice(at + 3).trim()
  if (body.startsWith("ERR:")) return { ok: false, err: body }
  try { return JSON.parse(body) } catch { return null }
}

// 按顺序取四条回执（合法 / 非法 / USSD / 查询串）
const lines = raw.split('\n').filter((l) => l.includes('-> '))
const [okR, badR, ussdR, qR] = lines.map(payloadOf)

const chk = []
const add = (c, m) => chk.push([c, m])

add(!!okR, '合法号码有回执')
add(okR && okR.ok === true, `合法号码宿主受理（${JSON.stringify(okR && okR.data)}）`)
add(!!(okR && okR.data && okR.data.dispatched === true), '★回执 dispatched=true')
add(!!(okR && okR.data && /^tel:\+86 138 0013 8000$/.test(String(okR.data.uri))), `★uri 正确（${okR && okR.data && okR.data.uri}）`)
// ★系统侧取证：顶层 Activity 应是拨号器（厂商包名各异 ⇒ 只要求含 dialer/phone/inCallScreen 关键词之一）
const topOk = /dialer|phone|incallscreen|telecom/i.test(String(top))
add(topOk, `★★系统真的拉起了拨号界面（顶层：${String(top).replace(/\s+/g, ' ').slice(0, 120)}）`)

add(!!badR, '非法号码有回执')
add(!!(badR && (badR.ok === false || badR.err)), '★非法号码被宿主拒绝（ok=false 或 ERR 回执）')
add(!!(badR && /号码非法/.test(JSON.stringify(badR))), '★拒绝原因含「号码非法」')

add(!!(ussdR && ussdR.ok === true), '★白名单边界：*100#（USSD）放行')
add(!!(qR && (qR.ok === false || qR.err)), '★白名单边界：12?x=1（查询串）被拒')

let pass = 0
for (const [c, m] of chk) { console.log(`  ${c ? '✅' : '❌'} ${m}`); if (c) pass++ }
console.log(`\n${pass}/${chk.length} 通过`)
process.exit(pass === chk.length ? 0 : 1)
NODE
