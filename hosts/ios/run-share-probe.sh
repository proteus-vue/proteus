#!/usr/bin/env bash
# hosts/ios/run-share-probe.sh —— ★★★#1336 C22 `share` iOS 真机判据
#
# 【它证明什么（与 Android/鸿蒙同一份业务语义）】
#   ① 合法载荷 ⇒ `useShare` 返回 ok（宿主受理，`UIActivityViewController` 派发）；
#   ② **危险 URL scheme 必须被拒**（`file://` / `javascript:` / 自定义 scheme）——安全边界：
#      分享会把链接递给**别的 App / 扩展**，`file:` 等于把本机私有路径泄漏出去；
#   ③ 空载荷被拒（不拉起"空面板"）；
#   ④ ★★**宿主层也校验**：直调 `share` 传 `file://` / 空载荷必须被拒（绕过 JS 白名单）。
#      ★为什么必须有这条：走 `useShare` 时 JS 层先拦，宿主即使不校验也看不出来
#      ⇒ 只改宿主的破坏性变异会**假绿**（#1285 phone 探针 ⑤ 同款教训）。
#
# 【不证明什么】
#   · 不证明"用户真的选了某个目标并发送成功"（那属系统 UI 内的行为）；
#   · 不证明面板**肉眼可见**——本脚本只判报告。面板是否弹出由设备截图/人工确认。
#
# 【前提（两条，脚本会检查并给指引）】
#   1) 描述文件有效：`bash hosts/ios/signing.sh status`（过期就 `provision.sh` 重新申请）；
#   2) 设备已**手动信任**开发者证书（iOS 强制步骤，脚本无法代做）。
#
# 用法：bash hosts/ios/run-share-probe.sh [--udid <UDID>]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
REPORT="$HERE/results/superapp.json"   # ★superapp 模式的落点（与 phone 探针同）
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
#   不带它 ⇒ `--share-probe=1` 被静默丢弃（#1285 首跑实测过这个坑）。
# ★`PROTEUS_EXIT_AFTER_REPORT=1` ⇒ 报告落盘后 App 自退 ⇒ 本命令**返回即完成**（零轮询）
if ! PROTEUS_EXIT_AFTER_REPORT=1 bash "$HERE/run-selfdraw.sh" --superapp --share-probe=1 $UDID_ARG 2>&1 | tail -12; then
  echo "✗ run-selfdraw 失败（看上方输出；常见：描述文件过期 / 设备未信任证书 / 旧包 team 不同）"
  exit 4
fi

[ -f "$REPORT" ] || { echo "✗ 报告未生成：${REPORT}"; exit 4; }
echo "==> ③ 报告：${REPORT}（$(wc -c < "${REPORT}" | tr -d ' ') 字节）"

echo "==> ④ 判定"
node - "$REPORT" <<'NODE'
const fs = require('fs')
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const raw = String(r.share_probe ?? 'null')
let p = null
try { p = JSON.parse(raw) } catch { /* 下面统一报 */ }

if (!p || typeof p !== 'object') {
  console.log(`  ❌ 探针回执不可解析：${raw.slice(0, 200)}`)
  console.log(`     报告键：${Object.keys(r).join(', ').slice(0, 300)}`)
  process.exit(1)
}

const chk = []
const add = (c, m) => chk.push([c, m])
add(p.ok === true, `整体 ok（share_probe.ok）`)
add(p.good_text_ok === true, `★纯文本载荷被受理${p.good_text_error ? ' — ' + p.good_text_error : ''}`)
add(p.good_url_ok === true, `★标题+文本+链接载荷被受理${p.good_url_error ? ' — ' + p.good_url_error : ''}`)
add(p.bad_file_rejected === true, `★★file:// 被拒（安全边界：本机路径泄漏）${p.bad_file_code ? ' code=' + p.bad_file_code : ''}`)
add(p.bad_js_rejected === true, `★★javascript: 被拒（可执行语义）`)
add(p.bad_custom_rejected === true, `自定义 scheme myapp:// 被拒`)
add(p.empty_rejected === true, `空载荷被拒（不拉起空面板）`)
add(p.host_direct_file_rejected === true, `★★宿主层也校验：直调 share 传 file:// 被拒（绕过 JS 白名单）`)
add(p.host_direct_empty_rejected === true, `★★宿主层：直调 share 传空载荷被拒`)
add(p.host_direct_good_ok === true, `★宿主层直调合法载荷成功`)

let pass = 0
for (const [c, m] of chk) { console.log(`  ${c ? '✅' : '❌'} ${m}`); if (c) pass++ }
console.log(`\n${pass}/${chk.length} 通过`)
if (p.error) console.log(`探针 error：${p.error}`)
process.exit(pass === chk.length ? 0 : 1)
NODE
