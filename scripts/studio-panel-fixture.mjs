#!/usr/bin/env node
// scripts/studio-panel-fixture.mjs —— "fixture 与原始采集输出必须一致"（决策 #1247 从门禁拆出）
//
// 【为什么需要】`fixtures/panel-source.json` 是判据的**输入**，`results/panel-source.json` 是
//   那次真实跑机的**原始输出**。两者若可各自漂移，"改 fixture 让判据变绿"就是一条静默假绿通道。
//   ⇒ 用 5 个关键数值钉住：帧数 / fps / 延迟 p50 / CPU / AU 数。
import fs from 'node:fs'
import path from 'node:path'

/**
 * @param {{ fixture: object, root: string, studio: string }} a
 *   `fixture` = 读进来的 fixtures/panel-source.json，`studio` = packages/studio 绝对路径
 * @returns {{ ok: boolean, why: string }}
 */
export function checkFixture({ fixture, root, studio }) {
  const rawPath = path.join(studio, 'results', 'panel-source.json')
  const rel = path.relative(root, rawPath)
  if (!fs.existsSync(rawPath)) return { ok: false, why: `缺原始采集输出 ${rel}` }
  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'))
  const diffs = []
  if (fixture.frames_presented !== raw.frames_presented) diffs.push('frames_presented')
  if (fixture.measured_fps !== raw.measured_fps) diffs.push('measured_fps')
  if (fixture.latency_ms?.p50 !== raw.latency_ms?.p50) diffs.push('latency_ms.p50')
  if (fixture.cpu?.single_core_pct !== raw.cpu?.single_core_pct) diffs.push('cpu.single_core_pct')
  if (fixture.aus !== raw.aus) diffs.push('aus')
  return diffs.length
    ? { ok: false, why: `与 ${rel} 不一致：${diffs.join(', ')}` }
    : { ok: true, why: '' }
}
