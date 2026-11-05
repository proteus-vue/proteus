#!/usr/bin/env bash
# hosts/ios/run-permission-probe.sh —— ★★★C16 `permission.check` iOS 真机判据
#
# 【它证明什么（与 Android/鸿蒙同一份业务语义）】
#   ① 三个 scope（camera / microphone / geolocation）都查得回来，且是**两态之一**
#      （`granted` / `denied`，**永不返回 prompt**——iOS 的 notDetermined 归 denied，见桥头注释）；
#   ② 回执带 `declared` 位（Info.plist 缺 UsageDescription 时它是 false；
#      ★这一位在 iOS 上尤其关键：缺用途说明**真申请会让系统直接杀进程**）；
#   ③ 小程序 scope 写法（`scope.record`）能归一，且 Hook 层**回显原始名字**；
#   ④ 未知 scope / 空名字 ⇒ 报错（不是回 denied）；
#   ⑤ ★★直调宿主（绕过 JS 归一）也拒绝未知 scope —— 只改宿主的变异否则会**假绿**。
#
# 【不证明什么】
#   · **不证明授权态会随系统设置翻转**——那要人工在「设置 → 隐私」里改，脚本无法代做
#     （Android 有 `pm grant/revoke`，iOS 没有对等命令）。⇒ iOS 侧"真读数"的证据强度
#     低于 Android（Android 有 grant→granted / revoke→denied 的翻转取证）。
#   · 不证明"申请会弹框"——本能力只查不申请。
#
# 【前提】描述文件有效 + 设备已手动信任开发者证书（见 run-document-probe.sh 头注释）。
# 用法：bash hosts/ios/run-permission-probe.sh [--udid <UDID>]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORT="$HERE/results/superapp.json"   # ★superapp 模式的落点（与 phone/share/document 探针同）
mkdir -p "$HERE/results"

echo "==> ① 签名档检查"
bash "$HERE/signing.sh" status 2>&1 | grep -E "证书|描述文件" | head -3
if ! bash "$HERE/signing.sh" status 2>&1 | grep -q "✓ 描述文件"; then
  echo "✗ 描述文件无效/过期 ⇒ 先跑：bash hosts/ios/experiments/device/provision.sh"
  exit 3
fi

echo "==> ② 跑探针（阻塞到报告落盘；App 自退 = 完成信号）"
rm -f "$REPORT"
UDID_ARG=""
[ "${1:-}" = "--udid" ] && UDID_ARG="${2:-}"

# ★必须带 `--superapp`：`SA_ARGS`（含探针参数转发）只在该模式分支里组装。
# ★`PROTEUS_EXIT_AFTER_REPORT=1` ⇒ 报告落盘后 App 自退 ⇒ 本命令**返回即完成**（零轮询）
if ! PROTEUS_EXIT_AFTER_REPORT=1 bash "$HERE/run-selfdraw.sh" --superapp --permission-probe=1 $UDID_ARG 2>&1 | tail -12; then
  echo "✗ run-selfdraw 失败（看上方输出；常见：描述文件过期 / 设备未信任证书 / 旧包 team 不同）"
  exit 4
fi

[ -f "$REPORT" ] || { echo "✗ 报告未生成：${REPORT}"; exit 4; }
echo "==> ③ 报告：${REPORT}（$(wc -c < "${REPORT}" | tr -d ' ') 字节）"

echo "==> ④ 判定"
node - "$REPORT" <<'NODE'
const fs = require('fs')
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const raw = String(r.permission_probe ?? 'null')
let p = null
try { p = JSON.parse(raw) } catch { /* 下面统一报 */ }

if (!p || typeof p !== 'object') {
  console.log(`  ❌ 探针回执不可解析：${raw.slice(0, 200)}`)
  console.log(`     报告键：${Object.keys(r).join(', ').slice(0, 300)}`)
  process.exit(1)
}

const chk = []
const add = (c, m) => chk.push([c, m])
add(p.all_two_state === true, `★三个 scope 都是两态之一（${JSON.stringify(p.states)}）`)
add(p.never_prompt === true, `★★永不返回 prompt（App 端口径）`)
add(p.declared && typeof p.declared === 'object', `★带回执 declared 位（${JSON.stringify(p.declared)}）`)
add(p.alias_ok === true, '小程序 scope 写法 scope.record 可归一')
add(p.alias_echo === 'scope.record', `★Hook 层回显原始名字（实得 ${p.alias_echo}）`)
add(p.unknown_rejected === true, `未知 scope 被拒（不是回 denied）${p.unknown_code ? ' code=' + p.unknown_code : ''}`)
add(p.empty_rejected === true, '空名字被拒')
add(p.host_direct_unknown_rejected === true, '★★宿主层也拒未知 scope（绕过 JS 归一）')
add(p.host_direct_empty_rejected === true, '★★宿主层拒缺 scope')
add(p.host_direct_good_ok === true, `★宿主层直调合法 scope 成功（state=${p.host_direct_good_state}）`)

let pass = 0
for (const [c, m] of chk) { console.log(`  ${c ? '✅' : '❌'} ${m}`); if (c) pass++ }
console.log(`\n${pass}/${chk.length} 通过`)
if (p.error) console.log(`探针 error：${p.error}`)
process.exit(pass === chk.length ? 0 : 1)
NODE
