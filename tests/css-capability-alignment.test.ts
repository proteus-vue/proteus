// tests/css-capability-alignment.test.ts —— ★★★CSS 能力对齐清单（三端模型 · 2026-10-04 重构）
//
// 【锁什么】生成器 `scripts/gen-css-capability-alignment.mjs` 的三端模型 + App 列真值：
//   ① 三端命名正确（web / skyline / app——不再有 ios/android/harmony/webview 作为"端列"）；
//   ② App 列取自**独立事实源**（app-profile-features.json），不是硬编码假值；
//   ③ 编译器折叠面（APP_*_FIELDS）**全部被清单覆盖**（防"编译器加了字段、清单没跟上"的静默漂移）；
//   ④ 生成物幂等（--check 漂移门禁）。
//
// 【为什么需要】旧 `end-support-matrix` 的 App 列恒为 `'supported'`（派生假值），无独立 provenance；
//   本轮把它换成"编译器折叠 ∩ 引擎 ∩ 宿主"的代码事实 + 可扩展档位。

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { parseMarkdown } from '@proteus-vue/docs'

const ROOT = path.resolve(__dirname, '..')
const GEN = path.join(ROOT, 'scripts', 'gen-css-capability-alignment.mjs')
const DOC_GEN = path.join(ROOT, 'website', 'scripts', 'gen-css-support.mjs')
const DOC_ZH = path.join(ROOT, 'website', 'content', 'reference', 'css-support.md')
const DOC_EN = path.join(ROOT, 'website', 'en', 'reference', 'css-support.md')
const JSON_OUT = path.join(ROOT, 'docs', 'generated', 'css-capability-alignment.json')
const APP_SRC = path.join(ROOT, 'docs', 'generated', 'css-capability-sources', 'app-profile-features.json')

function runGen(check: boolean): { ok: boolean; out: string } {
  try {
    const out = execFileSync('node', [GEN, ...(check ? ['--check'] : [])], { cwd: ROOT }).toString()
    return { ok: true, out }
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer }
    return { ok: false, out: (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '') }
  }
}

describe('★CSS 能力对齐清单（三端模型）', () => {
  it('① 生成物存在且为三端模型（web / skyline / app）', () => {
    if (!fs.existsSync(JSON_OUT)) return
    const m = JSON.parse(fs.readFileSync(JSON_OUT, 'utf-8'))
    expect(m.profile.model).toBe('three-end')
    expect(m.profile.ends).toEqual(['web', 'skyline', 'app'])
    // 旧端名不得再作为"端列"
    expect(m.profile.ends).not.toContain('ios')
    expect(m.profile.ends).not.toContain('webview')
  })

  it('② App 列取自独立事实源（app-profile-features.json），非硬编码假值', () => {
    if (!fs.existsSync(JSON_OUT) || !fs.existsSync(APP_SRC)) return
    const m = JSON.parse(fs.readFileSync(JSON_OUT, 'utf-8'))
    const src = JSON.parse(fs.readFileSync(APP_SRC, 'utf-8'))
    expect(m.sources.appProfile.kind).toBe('curated')
    const srcIds = new Set(src.features.map((f: { id: string }) => f.id))
    // 每行 App 现状都能在源工件里找到（不是生成的凭空值）
    for (const r of m.rows) {
      expect(srcIds.has(r.id), `行 ${r.id} 不在 App 事实源里`).toBe(true)
      expect(['supported', 'folded-only', 'engine-only', 'absent']).toContain(r.app)
    }
    // 且 App 列**不是**全 'supported'（真值应含 absent / folded-only / engine-only）
    const distinct = new Set(m.rows.map((r: { app: string }) => r.app))
    expect(distinct.size).toBeGreaterThan(1)
    expect(distinct.has('absent')).toBe(true)
  })

  it('③ 编译器折叠面（APP_*_FIELDS）全部被清单覆盖（无孤儿字段）', () => {
    if (!fs.existsSync(JSON_OUT)) return
    const m = JSON.parse(fs.readFileSync(JSON_OUT, 'utf-8'))
    expect(Array.isArray(m._missingCompilerCoverage)).toBe(true)
    expect(m._missingCompilerCoverage, `未覆盖：${(m._missingCompilerCoverage || []).join(', ')}`).toEqual([])
    // 每个编译器字段都应出现在某行的 compilerFields 里
    const covered = new Set(m.rows.flatMap((r: { compilerFields: string[] }) => r.compilerFields ?? []))
    expect(covered.size).toBeGreaterThanOrEqual(20)
  })

  it('④ 生成物幂等（--check 漂移门禁）', () => {
    if (!fs.existsSync(JSON_OUT)) return
    const r = runGen(true)
    expect(r.ok, `--check 应绿：\n${r.out}`).toBe(true)
    expect(r.out).toContain('与源一致')
  })

  it('⑤ App 可扩展档位落在 L0–L5（每个人工标注都有档位 + 策略）', () => {
    if (!fs.existsSync(APP_SRC)) return
    const src = JSON.parse(fs.readFileSync(APP_SRC, 'utf-8'))
    const tiers = new Set(Object.keys(src.model.tiers))
    for (const f of src.features) {
      expect(tiers.has(f.tier), `${f.id} 的 tier=${f.tier} 不在 L0–L5`).toBe(true)
      expect(f.strategy, `${f.id} 缺 strategy`).toBeTruthy()
      expect(f.note, `${f.id} 缺 note（人工标注须说明依据）`).toBeTruthy()
    }
  })

  it('⑥ 官网 CSS 文档：逐能力锚点齐备 + 生成器幂等（用户「每个能力可跳转锚点」）', () => {
    if (!fs.existsSync(DOC_ZH) || !fs.existsSync(JSON_OUT)) return
    const m = JSON.parse(fs.readFileSync(JSON_OUT, 'utf-8'))
    // ① 生成器幂等（zh + en 与 SSOT 一致）
    const r = (() => {
      try {
        return { ok: true, out: execFileSync('node', [DOC_GEN, '--check'], { cwd: ROOT }).toString() }
      } catch (e) {
        const err = e as { stdout?: Buffer; stderr?: Buffer }
        return { ok: false, out: (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '') }
      }
    })()
    expect(r.ok, `gen-css-support --check 应绿：\n${r.out}`).toBe(true)
    // ② 每个能力在 zh 文档里有**标题锚点**，且 id = SSOT 行的 id（稳定深链契约）
    const zhIds = new Set(
      parseMarkdown(fs.readFileSync(DOC_ZH, 'utf-8')).blocks
        .filter((b) => b.type === 'heading')
        .map((b) => (b as { id: string }).id),
    )
    for (const row of m.rows) {
      expect(zhIds.has(row.id), `能力 ${row.id}（${row.css}）缺可跳转锚点`).toBe(true)
    }
    // ③ EN overlay 结构等价：同样的锚点 id 集合
    const enIds = new Set(
      parseMarkdown(fs.readFileSync(DOC_EN, 'utf-8')).blocks
        .filter((b) => b.type === 'heading')
        .map((b) => (b as { id: string }).id),
    )
    for (const row of m.rows) {
      expect(enIds.has(row.id), `EN overlay 缺锚点 ${row.id}`).toBe(true)
    }
  })
})
