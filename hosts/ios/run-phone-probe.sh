#!/usr/bin/env bash
# hosts/ios/run-phone-probe.sh —— ★★★#1285 C21 `makePhoneCall` iOS 真机判据
#
# 【它证明什么（iOS 侧，与 Android/鸿蒙同一份业务语义）】
#   ① 合法号码 ⇒ `usePhoneCall` 返回 ok（宿主受理，`UIApplication.open(tel:)` 派发）；
#   ② **非法号码必须被拒**（`12/34`、`12?x=1`、超长、只有 `+`）——安全边界：拼进 `tel:` URL
#      前必须拦注入字符，且**宿主自己也校验一遍**（不信任 JS 侧）；
#   ③ 拨号盘是否真的弹出由**设备侧取证**（本脚本只判报告；模拟器无拨号能力 ⇒ 如实 unsupported）。
#
# 【★为什么用 `--phone-probe`（JS 探针）而不是直调 Swift】
#   直调只验 `PhoneCallCapability.dial` 本体，验不到
#   `usePhoneCall → bridge.makePhoneCall → invokeHost("phone.call") → 宿主` 这条业务链。
#
# 【前提（两条，脚本会检查并给指引）】
#   1) 描述文件有效：`bash hosts/ios/signing.sh status`（过期就 `provision.sh` 重新申请）；
#   2) 设备已**手动信任**开发者证书（iOS 强制步骤，脚本无法代做）。
#
# 用法：bash hosts/ios/run-phone-probe.sh [--udid <UDID>]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
REPORT="$HERE/results/superapp.json"   # ★superapp 模式的落点（第一版误写成 phone-probe.json）
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

# ★★必须带 `--superapp`：`SA_ARGS`（含探针参数的转发）**只在该模式分支里组装**；
#   不带它 ⇒ `--phone-probe=1` 被静默丢弃（首跑实测：App 起来了、却没跑探针）。
# ★`PROTEUS_EXIT_AFTER_REPORT=1` ⇒ 报告落盘后 App 自退 ⇒ 本命令**返回即完成**（零轮询）
if ! PROTEUS_EXIT_AFTER_REPORT=1 bash "$HERE/run-selfdraw.sh" --superapp --phone-probe=1 $UDID_ARG 2>&1 | tail -12; then
  echo "✗ run-selfdraw 失败（看上方输出；常见：描述文件过期 / 设备未信任证书 / 旧包 team 不同）"
  exit 4
fi

[ -f "$REPORT" ] || { echo "✗ 报告未生成：${REPORT}"; exit 4; }
echo "==> ③ 报告：${REPORT}（$(wc -c < "${REPORT}" | tr -d ' ') 字节）"

echo "==> ④ 判定"
node - "$REPORT" <<'NODE'
const fs = require('fs')
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const raw = String(r.phone_probe ?? 'null')
let p = null
try { p = JSON.parse(raw) } catch { /* 下面统一报 */ }

if (!p || typeof p !== 'object') {
  console.log(`  ❌ 探针回执不可解析：${raw.slice(0, 200)}`)
  console.log(`     报告键：${Object.keys(r).join(', ').slice(0, 300)}`)
  process.exit(1)
}

const chk = []
const add = (c, m) => chk.push([c, m])
add(p.ok === true, `整体 ok（phone_probe.ok）`)
add(p.good_ok === true, `★合法号码被受理（+86 138 0013 8000）${p.good_error ? ' — ' + p.good_error : ''}`)
add(p.bad_slash_rejected === true, `★★非法号码 12/34 被拒（安全边界：斜杠能改 URL 结构）${p.bad_slash_code ? ' code=' + p.bad_slash_code : ''}`)
add(p.bad_query_rejected === true, `★★非法号码 12?x=1 被拒（查询串注入）`)
add(p.too_long_rejected === true, `超长号码（33 位）被拒`)
add(p.no_digits_rejected === true, `只有 + 无数字 被拒`)
add(p.host_direct_slash_rejected === true, `★★宿主层也校验：直调 phone.call 传 12/34 被拒（绕过 JS 白名单）`)
add(p.host_direct_good_ok === true, `★宿主层直调合法号码成功`)

let pass = 0
for (const [c, m] of chk) { console.log(`  ${c ? '✅' : '❌'} ${m}`); if (c) pass++ }
console.log(`\n${pass}/${chk.length} 通过`)
if (p.error) console.log(`探针 error：${p.error}`)
process.exit(pass === chk.length ? 0 : 1)
NODE
