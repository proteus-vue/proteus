#!/usr/bin/env node
// hosts/ios/lib/gen-parity-spec.mjs —— 生成玻璃像素等价门禁的固定样例 spec（决策 #834 · B6）
//
// 产出 `{ backdrop:{width,height,rgba}, params:{…}, out:{width,height} }`——**两端同输入**
// （Rust CPU oracle 与设备/本机 GPU 都用它）⇒ 差异只可能来自"落地"而非输入。
import fs from 'node:fs'

const out = process.argv[2]
const mode = process.argv[3] || 'rest'   // ★#966：rest=常态 / press=按下态（覆盖 SDF 充气路径）
                                          // ★#1007：nest2=外层预模糊(nest=2,浅底) / nest3=内层(nest=3,浅底)
if (!out) { console.error('用法：node gen-parity-spec.mjs <out.json> [rest|press|nest2|nest3]'); process.exit(2) }

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
    // ★#1007：nest2/nest3 用浅底（0.95）——覆盖 VEIL_A0 浅端分支（rest/press 的 0.42 只覆盖深端）。
    bg_lum: (mode === 'nest2' || mode === 'nest3') ? 0.95 : 0.42,
    specular: 0.18, saturation: 1.0, tint: [1, 1, 1, 0.149], light_dir: [-0.35, -0.94],
    // ★#966：按下态样例——叠加层 + 满按 + 触点偏右上（触达 SDF 充气/法线重算/Oracle 全链）
    overlay: mode === 'press' ? 1.0 : 0.0,
    press: mode === 'press' ? 1.0 : 0.0,
    touch: mode === 'press' ? [82.0, 60.0] : [-1.0e6, -1.0e6],
    // ★#1004：nest 模式——内层玻璃（跳面纱 + 小残差 tap）路径覆盖（GPU 与 oracle 同输入逐像素对拍）。
    // ★#1007：分两档——nest2（外层预模糊 d=0.07 分支）/ nest3（内层 d=0.04 分支），且 bg_lum 提亮到 0.95
    //   （浅端 α 0.80 分支——rest/press 的 0.42 只覆盖深端；不覆盖新系数 ⇒ 门禁抓不到回归）。
    nest: mode === 'nest2' ? 2.0 : (mode === 'nest3' ? 3.0 : 0.0),
  },
  out: { width: 130, height: 130 },
}
fs.writeFileSync(out, JSON.stringify(spec))
console.log(`  spec(${mode}): backdrop ${W}x${H}, out 130x130`)
