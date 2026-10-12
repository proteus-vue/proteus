#!/usr/bin/env node
// hosts/ios/lib/compare-rgba.mjs —— 像素等价比对（决策 #834 · B6）
//
// 逐像素比较两幅 RGBA（同尺寸）；容差内相等 ⇒ 退出 0，否则打印最大差/超差比例 ⇒ 退出 1。
// ★容差考量：GPU 与 CPU 的浮点/采样插值有微小差异 ⇒ 允许每种通道 ≤ TOL（默认 8/255 ≈ 3%）；
//   超差像素比例 > RATIO（默认 2%）才判红（避免单点噪声误判）。
import fs from 'node:fs'

const [refPath, gpuPath] = process.argv.slice(2)
const TOL = Number(process.env.PARITY_TOL ?? 10)      // 每通道最大可接受差（0-255）
const RATIO = Number(process.env.PARITY_RATIO ?? 0.03) // 超差像素比例上限

const ref = JSON.parse(fs.readFileSync(refPath, 'utf8'))
const gpu = JSON.parse(fs.readFileSync(gpuPath, 'utf8'))
if (ref.width !== gpu.width || ref.height !== gpu.height) {
  console.error(`✗ 尺寸不一致：ref ${ref.width}x${ref.height} vs gpu ${gpu.width}x${gpu.height}`)
  process.exit(1)
}
const n = ref.width * ref.height
let over = 0, maxDiff = 0, sumDiff = 0
for (let i = 0; i < n; i++) {
  let pxOver = false
  for (let c = 0; c < 4; c++) {
    const d = Math.abs(ref.rgba[i * 4 + c] - gpu.rgba[i * 4 + c])
    if (d > maxDiff) maxDiff = d
    sumDiff += d
    if (d > TOL) pxOver = true
  }
  if (pxOver) over++
}
const ratio = over / n
const meanDiff = sumDiff / (n * 4)
console.log(`  像素 ${n} · 最大差 ${maxDiff}/255 · 平均差 ${meanDiff.toFixed(2)} · 超差(>${TOL})像素 ${over}（${(ratio * 100).toFixed(2)}%）`)
if (ratio > RATIO) {
  console.error(`✗ 超差比例 ${(ratio * 100).toFixed(2)}% > 上限 ${(RATIO * 100).toFixed(0)}% ⇒ 落地与真源不等价`)
  process.exit(1)
}
process.exit(0)
