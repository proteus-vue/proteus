#!/usr/bin/env bash
# hosts/ios/run-document-probe.sh —— ★★★#1384 C84 `openDocument` iOS 真机判据
#
# 【它证明什么（与 Android/鸿蒙同一份业务语义）】
#   ① 沙箱内合法 PDF ⇒ `useOpenDocument` 返回 ok（宿主受理，`QLPreviewController` 派发）；
#   ② **越界路径必须被拒**（绝对路径 / `..`）——安全边界：预览会把文件字节交给预览器；
#   ③ **非白名单扩展名必须被拒**（`.exe` 不得降级成 octet-stream 试着打开）；
#   ④ 沙箱内不存在的文件 ⇒ 报错（不是假成功）；
#   ⑤ ★★**直调宿主层也校验**：绕过 JS 层的 `assertDocumentRequest` 直打 `document.open`，
#      越界/非白名单/缺失必须同样被拒。★为什么必须有这条：走 `useOpenDocument` 时 JS 层先拦，
#      宿主即使不校验也看不出来 ⇒ 只改宿主的破坏性变异会**假绿**（#1285 ⑤ / #1336 ④ 同款）。
#
# 【不证明什么】
#   · 不证明"用户真的看了文档"（QuickLook 没有"看完"回调；本能力语义只到"已拉起"）；
#   · 不证明预览器**肉眼可见**——本脚本只判报告。面板是否弹出由设备截图/人工确认。
#
# 【前提（两条，脚本会检查并给指引）】
#   1) 描述文件有效：`bash hosts/ios/signing.sh status`（过期就 `provision.sh` 重新申请）；
#   2) 设备已**手动信任**开发者证书（iOS 强制步骤，脚本无法代做）。
#
# 用法：bash hosts/ios/run-document-probe.sh [--udid <UDID>]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
REPORT="$HERE/results/superapp.json"   # ★superapp 模式的落点（与 phone/share 探针同）
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
#   不带它 ⇒ `--document-probe=1` 被静默丢弃（#1285 首跑实测过这个坑）。
# ★`PROTEUS_EXIT_AFTER_REPORT=1` ⇒ 报告落盘后 App 自退 ⇒ 本命令**返回即完成**（零轮询）
if ! PROTEUS_EXIT_AFTER_REPORT=1 bash "$HERE/run-selfdraw.sh" --superapp --document-probe=1 $UDID_ARG 2>&1 | tail -12; then
  echo "✗ run-selfdraw 失败（看上方输出；常见：描述文件过期 / 设备未信任证书 / 旧包 team 不同）"
  exit 4
fi

[ -f "$REPORT" ] || { echo "✗ 报告未生成：${REPORT}"; exit 4; }
echo "==> ③ 报告：${REPORT}（$(wc -c < "${REPORT}" | tr -d ' ') 字节）"

echo "==> ④ 判定"
node - "$REPORT" <<'NODE'
const fs = require('fs')
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const raw = String(r.document_probe ?? 'null')
let p = null
try { p = JSON.parse(raw) } catch { /* 下面统一报 */ }

if (!p || typeof p !== 'object') {
  console.log(`  ❌ 探针回执不可解析：${raw.slice(0, 200)}`)
  console.log(`     报告键：${Object.keys(r).join(', ').slice(0, 300)}`)
  process.exit(1)
}

const chk = []
const add = (c, m) => chk.push([c, m])
add(p.fixture_written === true, `夹具写入成功（沙箱可写）${p.fixture_error ? ' — ' + p.fixture_error : ''}`)
add(p.ok === true, '整体 ok（document_probe.ok）')
add(p.good_ok === true, `★沙箱内合法 PDF 被受理${p.good_error ? ' — ' + p.good_error : ''}`)
add(p.abs_rejected === true, `★★绝对路径被拒${p.abs_code ? ' code=' + p.abs_code : ''}`)
add(p.dotdot_rejected === true, `★★.. 穿越被拒${p.dotdot_code ? ' code=' + p.dotdot_code : ''}`)
add(p.exe_rejected === true, `★非白名单扩展名被拒（不降级 octet-stream）${p.exe_code ? ' code=' + p.exe_code : ''}`)
add(p.missing_rejected === true, `沙箱内不存在的文件被拒（不是假成功）${p.missing_code ? ' code=' + p.missing_code : ''}`)
add(p.host_direct_abs_rejected === true, `★★宿主层也校验：直调 document.open 传绝对路径被拒（绕过 JS 白名单）`)
add(p.host_direct_dotdot_rejected === true, `★★宿主层：.. 穿越被拒`)
add(p.host_direct_exe_rejected === true, `★★宿主层：非白名单扩展名被拒`)
add(p.host_direct_missing_rejected === true, `宿主层：不存在的文件被拒`)
add(p.host_direct_good_ok === true, `★宿主层直调合法载荷成功${p.host_direct_good_reason ? ' — ' + p.host_direct_good_reason : ''}`)

let pass = 0
for (const [c, m] of chk) { console.log(`  ${c ? '✅' : '❌'} ${m}`); if (c) pass++ }
console.log(`\n${pass}/${chk.length} 通过`)
if (p.error) console.log(`探针 error：${p.error}`)
process.exit(pass === chk.length ? 0 : 1)
NODE
