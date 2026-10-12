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

echo "==> ② 合成 backdrop + spec（固定样例，两端同输入）"
# 300x300 backdrop：横竖彩色条带（含高对比边界——最能暴露采样/坐标错位）
node - "$WORK/spec.json" <<'NODE'
const fs = require('fs')
const out = process.argv[2]
const W = 180, H = 180            // backdrop = 盒(130) + 2*pad(25)
const rgba = []
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const band = Math.floor(y / 20) % 3
  const c = [[220,60,60],[60,200,110],[70,120,230]][band]
  rgba.push(c[0], c[1], c[2], 255)
}
const spec = {
  backdrop: { width: W, height: H, rgba },
  params: { size_px: [130,130], pad: 25, radius: 65, blur: 16, refract_depth: 28.6,
            specular: 0.18, saturation: 1.0, tint: [1,1,1,0.149], light_dir: [-0.35,-0.94] },
  out: { width: 130, height: 130 },
}
fs.writeFileSync(out, JSON.stringify(spec))
console.log('  spec: backdrop 180x180, out 130x130')
NODE

echo "==> ③ Rust CPU 参考渲染（oracle）"
( cd "$ROOT/packages/shader-codegen-rust" && cargo run --release --offline --quiet -- --render-ref "$WORK/spec.json" > "$WORK/ref.json" ) || { echo "✗ CPU 参考渲染失败"; exit 3; }
[ -s "$WORK/ref.json" ] || { echo "✗ 参考渲染无输出"; exit 3; }
echo "  参考：$(node -e "const d=require('$WORK/ref.json');console.log(d.width+'x'+d.height+' rgba '+d.rgba.length)")"

echo "==> ④ macOS Metal 渲染生成物 MSL（同输入）"
xcrun -sdk macosx swift "$HERE/lib/glass-metal-parity.swift" "$WORK" || { echo "✗ Metal 渲染失败"; exit 4; }
[ -s "$WORK/gpu.json" ] || { echo "✗ GPU 渲染无输出"; exit 4; }

echo "==> ⑤ 逐像素比对（容差内相等）"
node "$HERE/lib/compare-rgba.mjs" "$WORK/ref.json" "$WORK/gpu.json"
RC=$?
if [ "$RC" = "0" ]; then echo "✅ 玻璃像素等价（Metal 落地 == Rust 算法真源）"; else echo "✗ 像素不等价"; fi
exit $RC
