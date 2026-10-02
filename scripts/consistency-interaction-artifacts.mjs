#!/usr/bin/env node
// scripts/consistency-interaction-artifacts.mjs —— 把装置采集的原始 rect 转成 VC3-a 快照工件
// 输入：spike/vc0-skyline-geom/results/l25-{before,after}-<end>.txt · l26-scrolled-<end>.txt
// 输出：results/interaction-<end>.json = { before, afterTap, scrolled }（VC3-a 快照）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(ROOT, 'spike', 'vc0-skyline-geom', 'results')
const FIXTURE = [
  ['c-root', '', 'p-view'], ['c-box', '0', 'p-box'], ['c-text', '1', 'p-text'],
  ['c-nested', '2', 'p-box'], ['c-nested-box', '2.0', 'p-box'], ['c-abs', '3', 'p-box'], ['c-tap', '4', 'p-box'],
]

function readRaw(file) {
  const s = fs.readFileSync(file, 'utf-8')
  const d = JSON.parse(s.slice(s.indexOf('{')))
  return JSON.parse(d.result.result.result)
}
function toSnap(data, end) {
  const byPath = {}
  for (const [nid, p, sk] of FIXTURE) {
    const r = data.rects?.[nid] ?? {}
    byPath[p] = {
      nodeId: nid,
      // ★★`path` 与 `depth` 必须写（首版漏了 ⇒ 所有节点在比对时按 `undefined` 键**塌缩成 1 个**
      //   ⇒ "样本 1 节点"的空比假绿。这是 VC3-a 格式的必填字段——转换器不能省。）
      path: p,
      depth: p === '' ? 0 : p.split('.').length,
      semanticKey: sk,
      x: Math.round((r.left ?? 0) * 1000) / 1000, y: Math.round((r.top ?? 0) * 1000) / 1000,
      w: Math.round((r.width ?? 0) * 1000) / 1000, h: Math.round((r.height ?? 0) * 1000) / 1000,
      children: [],
    }
  }
  const root = byPath['']
  // 子按 path 层级挂载（父在前——fixture 顺序保证）
  for (const [nid, p] of FIXTURE) {
    if (p === '') continue
    const parent = p.includes('.') ? p.slice(0, p.lastIndexOf('.')) : ''
    byPath[parent].children.push(byPath[p])
    void nid
  }
  return {
    format: 'proteus-geometry-snapshot', version: 1, end,
    viewport: { width: 400, height: 600 }, root,
  }
}

for (const end of ['skyline', 'webview']) {
  const before = toSnap(readRaw(path.join(DIR, `l25-before-${end}.txt`)), end)
  const afterTap = toSnap(readRaw(path.join(DIR, `l25-after-${end}.txt`)), end)
  // ★L2.6 的"滚动后"取自 l26-s1（滚动 200/500 后的采集）——若缺则回落旧路径
  const scrollFile = fs.existsSync(path.join(DIR, `l26-s1-${end}.txt`))
    ? path.join(DIR, `l26-s1-${end}.txt`)
    : path.join(DIR, `l26-scrolled-${end}.txt`)
  const scrolled = toSnap(readRaw(scrollFile), end)
  fs.writeFileSync(
    path.join(DIR, `interaction-${end}.json`),
    JSON.stringify({ before, afterTap, scrolled }, null, 2) + '\n',
  )
  console.log(`[interaction-artifacts] ✅ interaction-${end}.json（滚动源：${path.basename(scrollFile)}）`)
}
