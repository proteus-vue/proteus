#!/usr/bin/env bash
# hosts/ios/check-glass-pixel-parity.sh —— ★★★玻璃像素等价门禁（决策 #834 · B6）
#
# 【它证明什么（OS 级一致性的硬证据）】新架构下玻璃算法真源在 Rust WGSL；iOS 落 MDL 由 Metal 编译生成物 MSL。
#   本脚本在**本机（macOS Metal）**用同一份生成物 MSL + 同一合成 backdrop 渲染，与 **Rust CPU 参考实现**
#   （`proteus-shader-gen --render-ref`）逐像素比对——容差内相等 ⇒ "生成的 MSL 落地 = 算法真源"。
#   ★这是"在 Mac 上离线跑 Metal"的等价性判据（真机端另有 iOS 宿主 --glass 截图取证）。
#
# 【为什么可离线】macOS 有 Metal（与 iOS 同 MSL 语言）⇒ 生成物 MSL 在本机即可编译/渲染/比对，无需设备。
#
# 用法：bash hosts/ios/check-glass-pixel-parity.sh   退出码 0/1
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
export PATH="$HOME/.cargo/bin:$PATH"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> ① 抽出生成物 MSL（顶点 + 片元）"
node "$ROOT/scripts/extract-generated-shader.mjs" ts glass msl.frag.metal "$WORK/glass.frag.metal" || exit 1
node "$ROOT/scripts/extract-generated-shader.mjs" ts glass msl.vert.metal "$WORK/glass.vert.metal" || exit 2

# ★#966：两态各跑一遍——rest（常态）/ press（按下：SDF 充气 + 法线重算 + 叠加层）
#   ★为什么要两态：新代码路径（sd_glass 触点充气）**只在 press>0 生效**；
#     只跑 rest 等于"自测没对准消费方契约"（本仓已踩过）。两态同输入分别比对 ⇒ 新路径被真正执行。
# ★#1004：加第三态 nest（内层玻璃：跳面纱 + 小残差 tap）——同理由，新分支（veil_skip / bsig 分档）只在
#   nest>0 生效，只跑 rest/press 覆盖不到。
OVERALL=0
for MODE in rest press nest; do
  echo "========== 样例：$MODE =========="
  echo "==> ② 合成 backdrop + spec（固定样例，两端同输入）"
  node "$ROOT/hosts/ios/lib/gen-parity-spec.mjs" "$WORK/spec_$MODE.json" "$MODE" || exit 2

  echo "==> ③ Rust CPU 参考渲染（oracle）"
  ( cd "$ROOT/packages/shader-codegen-rust" && cargo run --release --offline --quiet -- --render-ref "$WORK/spec_$MODE.json" > "$WORK/ref_$MODE.json" ) || { echo "✗ CPU 参考渲染失败"; exit 3; }
  [ -s "$WORK/ref_$MODE.json" ] || { echo "✗ 参考渲染无输出"; exit 3; }
  echo "  参考：$(node -e "const d=require('$WORK/ref_$MODE.json');console.log(d.width+'x'+d.height+' rgba '+d.rgba.length)")"

  echo "==> ④ macOS Metal 渲染生成物 MSL（同输入）"
  xcrun -sdk macosx swift "$HERE/lib/glass-metal-parity.swift" "$WORK" "$MODE" || { echo "✗ Metal 渲染失败"; exit 4; }
  [ -s "$WORK/gpu_$MODE.json" ] || { echo "✗ GPU 渲染无输出"; exit 4; }

  echo "==> ⑤ 逐像素比对（容差内相等）"
  node "$HERE/lib/compare-rgba.mjs" "$WORK/ref_$MODE.json" "$WORK/gpu_$MODE.json" || OVERALL=1
  echo ""
done
if [ "$OVERALL" = "0" ]; then echo "✅ 玻璃像素等价（Metal 落地 == Rust 算法真源；rest + press + nest 三态）"; else echo "✗ 像素不等价"; fi
exit $OVERALL
