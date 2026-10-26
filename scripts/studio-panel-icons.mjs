#!/usr/bin/env node
// scripts/studio-panel-icons.mjs —— Studio 图标判据的**采集段**（决策 #1247 从 check-studio-panel 拆出）
//
// 【为什么这条判据值得存在（决策 #1224）】图标是"外面看不出来"的典型：改了 `icon.svg`
//   却把旧 icns 打进包，跑起来一切正常，只有 Dock 里那个图标是旧的 —— 和"包里是三天前的 UI"
//   同一类假象。⇒ 两条：① icns 必须比任一份源 SVG 新；② iconset 各档像素尺寸必须对。
//
// 【两个通道】正式（紫/蓝）与预览（绿/青）：通道靠**色相**区分，判据要同时盯住两套。
// 【查产物不查中间物】读 icns 的**分块**，不读 `AppIcon.iconset/`——那是 gitignore 的中间物，
//   CI 里根本不存在（"判据依赖一个本地才有、且被忽略的目录"是典型的假绿来源）。
import fs from 'node:fs'
import path from 'node:path'

const CHANNELS = [
  { name: 'release', icns: 'icon.icns', src: ['icon.svg', 'icon-small.svg'], png: 'icon.png' },
  { name: 'preview', icns: 'icon-preview.icns', src: ['icon-preview.svg', 'icon-preview-small.svg'], png: 'icon-preview.png' },
]

// ★16/32 在真文件里是 ic04/ic05 的 ARGB 分块（不是 PNG）——所以不能只认 PNG 头。
const ICNS_TYPE = {
  ic04: 16, ic05: 32, icp4: 16, icp5: 32, icp6: 64,
  ic07: 128, ic08: 256, ic09: 512, ic10: 1024,
  ic11: 32, ic12: 64, ic13: 256, ic14: 512,
}
const NEED_SIZES = [16, 32, 64, 128, 256, 512, 1024]

/** 解析 icns 分块：PNG 分块宽高取 PNG 头，ARGB 分块查类型表 */
function readIcns(file) {
  const b = fs.readFileSync(file)
  const out = []
  let off = 8
  while (off + 8 <= b.length) {
    const type = b.toString('ascii', off, off + 4)
    const len = b.readUInt32BE(off + 4)
    if (len < 8 || off + len > b.length) break
    const isPng = b.toString('hex', off + 8, off + 12) === '89504e47'
    if (ICNS_TYPE[type]) out.push([type, isPng ? b.readUInt32BE(off + 8 + 16) : ICNS_TYPE[type]])
    off += len
  }
  return out
}

/**
 * @param {string} studioDir `packages/studio`
 * @returns {{ report: object[], ok: boolean }} 每个通道的明细 + 是否全过
 */
export function iconReport(studioDir) {
  const iconsDir = path.join(studioDir, 'icons')
  const report = CHANNELS.map((c) => {
    const icnsPath = path.join(iconsDir, c.icns)
    const exists = fs.existsSync(icnsPath)
    const srcNewest = Math.max(...c.src.map((f) => fs.statSync(path.join(iconsDir, f)).mtimeMs))
    const ageMin = exists ? Math.round((srcNewest - fs.statSync(icnsPath).mtimeMs) / 60000) : NaN
    const slices = exists ? readIcns(icnsPath) : []
    const missing = NEED_SIZES.filter((n) => !slices.some(([, w]) => w === n))
    const pngOk = fs.existsSync(path.join(iconsDir, c.png))
      ? fs.readFileSync(path.join(iconsDir, c.png)).readUInt32BE(16) === 1024
      : false
    return { ...c, exists, ageMin, slices: slices.length, missing, pngOk }
  })
  return { report, ok: report.every((r) => r.exists && r.ageMin <= 0 && r.missing.length === 0 && r.pngOk) }
}
