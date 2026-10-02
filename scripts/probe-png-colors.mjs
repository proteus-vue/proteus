#!/usr/bin/env node
// PNG 特征色探针（L4 采集脚本的"渲染完成"判据）——不做阈值/统计算法，只回答：
//   "这些特征色在图上出现了吗？"（出现 ⇒ 目标页确实画出来了，而不是黑屏/旧页/错误页）
//
// 用法：node scripts/probe-png-colors.mjs <png> <r,g,b> [<r,g,b> ...]
// 退出码：全部命中 ⇒ 0；任一缺失 / 解码失败 ⇒ 1（打印 JSON 诊断）
import fs from 'node:fs'
import { decodePng, assertPixelsPresent, convertToSrgb } from '../packages/consistency/dist/index.js'

const [file, ...specs] = process.argv.slice(2)
if (!file || specs.length === 0) {
  console.error('用法: node scripts/probe-png-colors.mjs <png> <r,g,b> [<r,g,b> ...]')
  process.exit(2)
}
const probes = specs.map((s) => {
  const [r, g, b] = s.split(',').map((n) => Number(n.trim()))
  return { name: s, rgb: [r, g, b] }
})
if (probes.some((p) => p.rgb.some((n) => !Number.isFinite(n)))) {
  console.error('特征色格式应为 r,g,b（如 47,111,237）')
  process.exit(2)
}
try {
  // ★色彩归一（P3→sRGB）：Android 真机截图内嵌 Display P3 ICC ⇒ 同一声明色像素值天然不同
  //   （实测 #2f6fed → (64,110,229)）——不归一会让正确的截图被判"特征色未命中"（假红）。
  const raw = await decodePng(new Uint8Array(fs.readFileSync(file)))
  const img = convertToSrgb(raw)
  const r = assertPixelsPresent(img, probes)
  console.log(JSON.stringify({ file, size: `${img.width}x${img.height}`, colorSpace: raw.colorSpace ?? 'undeclared', ok: r.ok, hit: r.hit, missed: r.missed }))
  process.exit(r.ok ? 0 : 1)
} catch (e) {
  console.log(JSON.stringify({ file, ok: false, error: String(e && e.message ? e.message : e) }))
  process.exit(1)
}
