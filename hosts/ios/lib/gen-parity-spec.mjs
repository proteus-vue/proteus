#!/usr/bin/env node
// hosts/ios/lib/gen-parity-spec.mjs —— 生成玻璃像素等价门禁的固定样例 spec（决策 #834 · B6）
//
// 产出 `{ backdrop:{width,height,rgba}, params:{…}, out:{width,height} }`——**两端同输入**
// （Rust CPU oracle 与设备/本机 GPU 都用它）⇒ 差异只可能来自"落地"而非输入。
import fs from 'node:fs'

const out = process.argv[2]
if (!out) { console.error('用法：node gen-parity-spec.mjs <out.json>'); process.exit(2) }

// backdrop = 盒(130px) + 2×pad(25px) = 180；横竖彩色条带（高对比边界最能暴露采样/坐标错位）
const W = 180, H = 180
const rgba = []
const cols = [[220, 60, 60], [60, 200, 110], [70, 120, 230]]
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const c = cols[Math.floor(y / 20) % 3]
    rgba.push(c[0], c[1], c[2], 255)
  }
}
const spec = {
  backdrop: { width: W, height: H, rgba },
  params: {
    size_px: [130, 130], pad: 25, radius: 65, blur: 16, refract_depth: 28.6,
    specular: 0.18, saturation: 1.0, tint: [1, 1, 1, 0.149], light_dir: [-0.35, -0.94],
  },
  out: { width: 130, height: 130 },
}
fs.writeFileSync(out, JSON.stringify(spec))
console.log(`  spec: backdrop ${W}x${H}, out 130x130`)
