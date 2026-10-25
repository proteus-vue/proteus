#!/usr/bin/env node
// packages/studio/icons/make-icon.mjs —— 生成 Studio 应用图标（决策 #1224 / #1228）
//
// 【为什么用浏览器渲染】上一版是 python 手绘图元（深底 + 方块 + 竖线），改一次形状要把几何
//   翻译成像素循环——那只能做出"能看"的图标。现在 **SVG 是唯一真源**，用 Chromium 在目标尺寸上
//   **矢量栅格化**（16px 的图是按 16px 重新算的，不是 1024 缩下去糊成一团）。
//
// 【★为什么一份图标要有两份 artwork】macOS 在 16/32px 只认剪影：完整版的投影/扫带在这个尺寸
//   会糊成脏点。Apple 自己的图标也是分尺寸出图。所以：
//     16/32 → *-small.svg（字形放大、去投影、去扫带、补光加强）
//     ≥64   → *.svg（完整版）
//
// 【★两个通道】通道靠**色相**，不靠角标（角标在 16px 就是噪点；VS Code Insiders / Chrome Canary
//   都是换色）：release = 紫/蓝，preview = 绿/青。两个通道各出一份 icns，
//   `package-app.sh --channel preview` 会装成「Proteus Studio Preview」（bundle id 带 .preview，
//   两个通道可以同时装）。
//
// 用法：node packages/studio/icons/make-icon.mjs   （需要仓库根的 playwright）
// 产物：icon.icns / icon-preview.icns + 各自的 *.png（1024，文档用）
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (f) => fs.readFileSync(path.join(HERE, f), 'utf8')

/** 每个像素尺寸用哪份 artwork —— 改这里等于改"从多大开始显示细节" */
const art = (small, full) => ({ 16: small, 32: small, 64: full, 128: full, 256: full, 512: full, 1024: full })

const CHANNELS = [
  {
    name: 'release',
    icns: 'icon.icns',
    png: 'icon.png',
    art: art(read('icon-small.svg'), read('icon.svg')),
  },
  {
    name: 'preview',
    icns: 'icon-preview.icns',
    png: 'icon-preview.png',
    art: art(read('icon-preview-small.svg'), read('icon-preview.svg')),
  },
]

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

const ICONSET_DIR = path.join(HERE, 'AppIcon.iconset') // gitignore 的构建中间物，两个通道复用/覆盖

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

for (const ch of CHANNELS) {
  // 1024 主图（文档/打包入口用）
  await shot(ch.art[1024], 1024, path.join(HERE, ch.png))

  fs.mkdirSync(ICONSET_DIR, { recursive: true })
  const cache = new Map()
  for (const [name, size] of ICONSET) {
    const out = path.join(ICONSET_DIR, name)
    if (!cache.has(size)) {
      await shot(ch.art[size], size, out)
      cache.set(size, out)
    }
    fs.copyFileSync(cache.get(size), out)
  }
  execFileSync('iconutil', ['-c', 'icns', ICONSET_DIR, '-o', path.join(HERE, ch.icns)])

  const kb = (n) => `${Math.round(n / 1024)} KB`
  console.log(
    `▸ ${ch.name.padEnd(7)} ${ch.icns}：${kb(fs.statSync(path.join(HERE, ch.icns)).size)}` +
      ` · ${ch.png}：${kb(fs.statSync(path.join(HERE, ch.png)).size)}`,
  )
}

await browser.close()
