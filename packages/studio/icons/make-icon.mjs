#!/usr/bin/env node
// packages/studio/icons/make-icon.mjs —— 生成 Studio 应用图标（决策 #1224）
//
// 【为什么用浏览器渲染，而不是手写 PNG 像素】上一版是 python 手绘图元（深底 + 方块 + 竖线），
//   改一次形状要把几何翻译成像素循环——那只能做出"能看"的图标，做不出"对"的图标。
//   这里改成 **SVG 是唯一真源**，用 Chromium 在目标尺寸上**矢量栅格化**（不是缩放位图：
//   16px 的图标是按 16px 重新算的，不是 1024 缩下去糊成一团）。
//
// 【★为什么要两份 artwork】macOS 在 16/32px 只认剪影：主图标里的选中框在这个尺寸会糊成四团灰。
//   Apple 自己的图标也是分尺寸出图，不是一张缩到底。所以：
//     16/32 → icon-small.svg（立方体放大到 72%、去掉选中框）
//     ≥64   → icon.svg（完整标记：立方体 + 选中框）
//
// 用法：node packages/studio/icons/make-icon.mjs   （需要仓库根的 playwright，判据脚本已在用）
// 产物：icon.png（1024）+ AppIcon.iconset/*（十档）+ icon.icns（iconutil 打包）
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const master = fs.readFileSync(path.join(HERE, 'icon.svg'), 'utf8')
const small = fs.readFileSync(path.join(HERE, 'icon-small.svg'), 'utf8')

/** 每个像素尺寸用哪份 artwork —— 改这里等于改"从多大开始显示细节" */
const ART = { 16: small, 32: small, 64: master, 128: master, 256: master, 512: master, 1024: master }

/** iconset 的十档（Apple 规定）：文件名 → 像素尺寸 */
const ICONSET = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 })

async function shot(svg, size, out) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<html><body style="margin:0;background:transparent">` +
      svg.replace('<svg ', `<svg style="width:${size}px;height:${size}px;display:block" `) +
      `</body></html>`,
  )
  await page.screenshot({ path: out, omitBackground: true })
}

// 先出 1024 主图（打包与文档都用它）
await shot(master, 1024, path.join(HERE, 'icon.png'))

// iconset：同一尺寸只渲染一次（16/32/64… 里 32 既做 16@2x 也做 32x32）
const cache = new Map()
const dir = path.join(HERE, 'AppIcon.iconset')
fs.mkdirSync(dir, { recursive: true })
for (const [name, size] of ICONSET) {
  const out = path.join(dir, name)
  if (!cache.has(size)) {
    await shot(ART[size], size, out)
    cache.set(size, out)
  }
  fs.copyFileSync(cache.get(size), out)
}
console.log(`▸ iconset：${ICONSET.length} 档（16/32 用简化版，≥64 用完整版）`)

execFileSync('iconutil', ['-c', 'icns', dir, '-o', path.join(HERE, 'icon.icns')])
const kb = (n) => `${Math.round(n / 1024)} KB`
console.log(`▸ icon.icns：${kb(fs.statSync(path.join(HERE, 'icon.icns')).size)}`)
console.log(`▸ icon.png：${kb(fs.statSync(path.join(HERE, 'icon.png')).size)}`)
await browser.close()
