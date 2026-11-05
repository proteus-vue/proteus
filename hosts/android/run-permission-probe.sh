#!/usr/bin/env bash
# hosts/android/run-permission-probe.sh —— ★★★C16 真机判据：`permission.check` 查的是**系统真状态**
#
# 【它证明什么（单测碰不到的部分）】
#   单测只能证明"JS 层打了 permission.check 且解析了对的形状"；宿主那段
#   （`Context.checkSelfPermission` + `requestedPermissions`）在 JVM 上跑不了。
#   ⇒ 必须真机验四件：
#     ① 三个 scope 都能查，且回执带 `declared`；
#     ② ★**宿主读数与系统读数一致**：用 `pm grant` / `pm revoke` 改真实授权，
#        再查一次，回执必须跟着变（只信宿主回执 = "桥说成功"，本仓最忌）；
#     ③ 未知 scope ⇒ 宿主**拒绝**（不是回 denied）；
#     ④ probe 探测回 ok（`appPermissionAvailable()` 依赖它）。
#
# 【★为什么必须做 ②（这条是本脚本的核心）】
#   `checkSelfPermission` 很容易被写成"恒读某个缓存"或"恒回 DENIED"——两种错法在
#   **只查一次的判据下都全绿**。只有"授权态真的翻转 ⇒ 回执跟着翻转"才能证明它读的是系统状态。
#   ★改变授权用 `pm grant/revoke`（adb shell 可做，无需点 UI）——这是本机的可控变量。
#   ★基线恢复：跑完把权限恢复成初始状态（见末尾 cleanup），不把设备留在改过的状态。
#
# 【诚实边界】
#   ① 本脚本验 **Android**；iOS/鸿蒙各有自己的探针（`run-permission-probe.sh` 同名，不同目录）。
#   ② `pm grant` 只能改**已声明**的权限；未声明的权限它会报错——所以这里改的是清单里有的三项。
#   ③ 本脚本**不改**应用代码，只改设备授权态 ⇒ 不影响后续其它判据（但跑完会恢复）。
#
# 用法：bash hosts/android/run-permission-probe.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

PKG="dev.proteus.layoutcore"
ACT="$PKG/.SuperappActivity"
ADB="${ADB:-adb}"
APK="${PROTEUS_APK:-$HERE/build/proteus-layoutcore.apk}"
OUT_DIR="$HERE/results"
LOG="$OUT_DIR/permission-probe.txt"
mkdir -p "$OUT_DIR"

[ -f "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
[ -f "$APK" ] || { echo "✗ 找不到 APK：$APK（先 bash hosts/android/build-and-run.sh --no-install）"; exit 3; }
"$ADB" get-state >/dev/null 2>&1 || { echo "✗ 设备未连接"; exit 3; }

: > "$LOG"

echo "==> ① 安装 APK"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2

# 探针调用：每次 force-stop 确保 onCreate 重跑（前台 Activity 不重走 onCreate）
probe() {
  local label="$1" args="$2"
  "$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
  "$ADB" logcat -c >/dev/null 2>&1 || true
  "$ADB" shell "am start -n $ACT --es capprobe 'permission.check|$args'" >/dev/null 2>&1
  if ! bash "$WAIT_SH" --cmd "\"$ADB\" shell 'logcat -d -s ProteusCapProbe | grep -q CAP_RECEIPT'" --timeout 60 --interval 1 --max-interval 3; then
    echo "✗ ${label} 无回执"
    "$ADB" shell 'logcat -d | grep -E "ProteusCapProbe|AndroidRuntime" | tail -20' || true
    return 1
  fi
  local line
  line="$("$ADB" shell "logcat -d -s ProteusCapProbe" | grep 'ProteusCapProbe: CAP_RECEIPT' | tail -1)"
  printf '%s\n' "$line" | tee -a "$LOG" >/dev/null
  printf '%s' "$line" | tail -c 300
  printf '\n'
}

echo "==> ② probe 探测（appPermissionAvailable 依赖它）"
R_PROBE="$(probe 'probe' '{"probe":true}')" || exit 4
printf 'probe 回执：%s\n' "${R_PROBE##*-> }" | tee -a "$LOG"

echo "==> ③ 三个 scope 的初始状态"
R_CAM0="$(probe 'camera-初始' '{"scope":"camera"}')" || exit 4
R_MIC0="$(probe 'microphone-初始' '{"scope":"microphone"}')" || exit 4
R_GEO0="$(probe 'geolocation-初始' '{"scope":"geolocation"}')" || exit 4
printf 'camera：%s\n' "${R_CAM0##*-> }" | tee -a "$LOG"
printf 'microphone：%s\n' "${R_MIC0##*-> }" | tee -a "$LOG"
printf 'geolocation：%s\n' "${R_GEO0##*-> }" | tee -a "$LOG"

echo "==> ④ ★真授权翻转：grant CAMERA ⇒ 再查"
# 记录初始态以便恢复
CAM_INITIAL="$("$ADB" shell "dumpsys package $PKG | grep -c 'android.permission.CAMERA: granted=true'" | tr -d '\r' | head -1)"
"$ADB" shell "pm grant $PKG android.permission.CAMERA" 2>&1 | head -2
R_CAM1="$(probe 'camera-授权后' '{"scope":"camera"}')" || exit 4
printf 'camera（grant 后）：%s\n' "${R_CAM1##*-> }" | tee -a "$LOG"

echo "==> ⑤ ★真授权翻转：revoke CAMERA ⇒ 再查"
"$ADB" shell "pm revoke $PKG android.permission.CAMERA" 2>&1 | head -2
R_CAM2="$(probe 'camera-撤销后' '{"scope":"camera"}')" || exit 4
printf 'camera（revoke 后）：%s\n' "${R_CAM2##*-> }" | tee -a "$LOG"

echo "==> ⑥ 未知 scope（应被**宿主**拒绝，不是回 denied）"
R_BAD="$(probe '未知 scope' '{"scope":"notifications"}')" || exit 4
printf '未知 scope 回执：%s\n' "${R_BAD##*-> }" | tee -a "$LOG"

echo "==> ⑦ 缺 scope（应被拒）"
R_NONE="$(probe '缺 scope' '{}')" || exit 4
printf '缺 scope 回执：%s\n' "${R_NONE##*-> }" | tee -a "$LOG"

"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
# ★恢复初始态：初始未授予 ⇒ 保持 revoked（已在 ⑤ 做）；初始已授予 ⇒ 补一次 grant
if [ "${CAM_INITIAL:-0}" != "0" ]; then
  "$ADB" shell "pm grant $PKG android.permission.CAMERA" >/dev/null 2>&1 || true
fi

echo ""
echo "==> ⑧ 判定"
node - "$LOG" <<'NODE'
const fs = require('fs')
const raw = fs.readFileSync(process.argv[2], 'utf8')

/**
 * 从一段文本里取 `-> ` 之后的内容：
 *   · 正常回执 ⇒ JSON 对象
 *   · 宿主抛错 ⇒ `ERR:<ExceptionClass>: <message>`（capprobe 的既有形态）
 * ★必须两种都认：否则"被拒绝"会被读成"没回执"。
 */
function payloadOf(s) {
  const at = s.indexOf('-> ')
  if (at < 0) return null
  const body = s.slice(at + 3).trim()
  if (body.startsWith('ERR:')) return { ok: false, err: body }
  try { return JSON.parse(body) } catch { return null }
}

const lines = raw.split('\n').filter((l) => l.includes('-> '))
const [probeR, cam0, mic0, geo0, cam1, cam2, badR, noneR] = lines.map(payloadOf)

const chk = []
const add = (c, m) => chk.push([c, m])

// ① probe
add(!!probeR && probeR.ok === true, 'probe 回执 ok（appPermissionAvailable 可用）')
add(!!(probeR && probeR.data && Array.isArray(probeR.data.scopes)), '★probe 回执带 scopes 列表')

// ② 三个 scope 都能查，且带 declared
for (const [name, r] of [['camera', cam0], ['microphone', mic0], ['geolocation', geo0]]) {
  add(!!r && r.ok === true, `${name} 查询 ok`)
  add(!!(r && r.data && (r.data.state === 'granted' || r.data.state === 'denied')), `${name} state 是两态之一（${r && r.data && r.data.state}）`)
  add(!!(r && r.data && typeof r.data.declared === 'boolean'), `${name} ★带回执 declared 位`)
  add(!!(r && r.data && Array.isArray(r.data.manifestPermissions) && r.data.manifestPermissions.length > 0), `${name} ★带回执 manifestPermissions（诊断读数）`)
}

// ★★★ ③ 真授权翻转：grant ⇒ granted，revoke ⇒ denied
//   这是本脚本的核心判据：只查一次的判据对"恒读缓存/恒回 DENIED"两种错法**都全绿**。
add(!!(cam1 && cam1.ok && cam1.data && cam1.data.state === 'granted'), `★★grant 后 camera 变 granted（实得 ${cam1 && cam1.data && cam1.data.state}）`)
add(!!(cam2 && cam2.ok && cam2.data && cam2.data.state === 'denied'), `★★revoke 后 camera 变 denied（实得 ${cam2 && cam2.data && cam2.data.state}）`)
add(!!(cam0 && cam0.ok && cam1 && cam1.ok && cam0.data && cam1.data && cam0.data.state !== cam1.data.state), '★★状态确实翻转了（不是恒读一个值）')

// ④ 拒绝路径
add(!!badR && badR.ok === false, '未知 scope 被拒（不是回 denied）')
add(!!badR && /不认识|not|scope/i.test(String(badR.err || (badR && badR.reason) || '')), `★拒绝原因点名 scope（${badR && (badR.err || badR.reason)}）`)
add(!!noneR && noneR.ok === false, '缺 scope 被拒')

const fail = chk.filter(([c]) => !c)
for (const [c, m] of chk) console.log(`${c ? '✅' : '❌'} ${m}`)
console.log('')
if (fail.length) {
  console.error(`❌ ${fail.length}/${chk.length} 条判据未过`)
  process.exit(1)
}
console.log(`✅ 全部 ${chk.length} 条通过`)
NODE
