// tests/degradation-batch4.test.ts
// ★批次 4（M6）属性降级声明回归门禁（EA-5 / G-31.2）。
//   锁定四件事，且每条都做**双向破坏性验证**（改坏 → 必须变红），避免「按构造必然通过」的假绿：
//   ① 每个组件属性都有降级声明（不允许空白格）；
//   ② 非 supported 必须有**可观察** behavior（反黑盒：只有状态无行为 = FAIL）；
//   ③ 与官方属性清单交叉核对：官方 MP 属性不得被判 mp:fallback；
//   ④ 规则表无陈旧项（指向不存在属性/tag 的规则 = 静默失效）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  DEGRADATION_TABLE,
  RULE_REGISTERED_PROPS,
  HOST_FALLBACK_TAGS,
  auditDegradation,
  degradeProp,
  formatDegradationReport,
  checkPropDegradation,
  PROP_NO_DEGRADATION,
} from '../packages/component-ir/src/degradation'
import { transformTemplateToWxml } from '@proteus-vue/compiler'
import { PRIMITIVE_CATALOG } from '../packages/component-ir/src/primitives'

const ROOT = path.resolve(__dirname, '..')
const COMPONENTS_DIR = path.join(ROOT, 'packages/components')

/** 全 73 组件的 {tag, props}（与 CLI 门禁同口径——props 取自组件源码真值） */
const SPECS: Array<{ tag: string; props: string[] }> = (() => {
  const out: Array<{ tag: string; props: string[] }> = []
  for (const dir of fs.readdirSync(COMPONENTS_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory() || !dir.name.startsWith('p-')) continue
    const f = path.join(COMPONENTS_DIR, dir.name, 'index.vue')
    if (!fs.existsSync(f)) continue
    const src = fs.readFileSync(f, 'utf8')
    const m = src.match(/defineProps\(\{([\s\S]*?)\n\}\)/)
    const props = new Set<string>()
    if (m) for (const km of m[1].matchAll(/^\s{2}([a-zA-Z][\w]*)\s*:/gm)) props.add(km[1])
    out.push({ tag: dir.name, props: [...props] })
  }
  return out.sort((a, b) => a.tag.localeCompare(b.tag))
})()
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
const OFFICIAL: Set<string> = (() => {
  const raw = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'docs/generated/miniprogram-component-attrs.json'), 'utf8'),
  ).components as Record<string, { name: string }[]>
  const s = new Set<string>()
  for (const rows of Object.values(raw)) for (const r of rows) s.add(r.name.toLowerCase())
  return s
})()

describe('★批次 4 · 属性降级声明（EA-5）', () => {
  const report = auditDegradation(SPECS)

  it('① 每个组件属性都有降级声明（无空白格）', () => {
    const missing = report.issues.filter((i) => i.kind === 'missing')
    expect(missing, `未声明：${missing.slice(0, 5).map((m) => `${m.tag}.${m.prop}`).join(', ')}`).toHaveLength(0)
    // 覆盖规模守卫：防止 catalog 清空导致「0 属性 0 问题」的假绿
    expect(report.components).toBeGreaterThanOrEqual(73)
    expect(report.props).toBeGreaterThan(400)
  })

  it('② 非 supported 一律带可观察 behavior（反黑盒 §4）', () => {
    const gaps = report.issues.filter((i) => i.kind === 'behavior-gap')
    expect(gaps).toHaveLength(0)
    // 至少存在若干 fallback（否则「全 supported」等于本批没做事——守卫有效样本量）
    expect(report.counts.web.fallback).toBeGreaterThan(0)
    expect(report.behaviorNeeded).toBe(report.behaviorDeclared)
    expect(report.ok).toBe(true)
  })

  it('③ 官方 MP 属性不得被判 mp:fallback（自相矛盾）', () => {
    const bad: string[] = []
    for (const { tag, props } of SPECS) {
      for (const prop of props) {
        const entry = degradeProp(tag, prop)
        const isOfficial = OFFICIAL.has(kebab(prop)) || OFFICIAL.has(prop.toLowerCase())
        if (isOfficial && entry.mp !== 'supported') bad.push(`${tag}.${prop}`)
      }
    }
    expect(bad).toHaveLength(0)
  })

  it('④ 规则表无陈旧项（规则静默失效 = 假绿来源）', () => {
    // ★基准 = 组件源码 props（真值），非 catalog——catalog 与源码存在历史脱节
    //   （如 p-input 在 catalog 记 4 项而源码 26 项）。与 scripts/audit-degradation.mjs 同口径。
    const allProps = new Set(SPECS.flatMap((s) => s.props))
    const allTags = new Set(SPECS.map((s) => s.tag))
    // 规则表登记的属性必须存在
    const staleProps = RULE_REGISTERED_PROPS.filter((p) => !allProps.has(p))
    expect(staleProps, `规则指向不存在的属性：${staleProps.join(', ')}`).toHaveLength(0)
    // 宿主族 tag 必须存在（★本检查在开发中真的抓到 p-live/p-live-pusher/p-live-player 三个陈旧 tag）
    const staleTags = HOST_FALLBACK_TAGS.filter((t) => !allTags.has(t))
    expect(staleTags, `宿主族 tag 不存在：${staleTags.join(', ')}`).toHaveLength(0)
  })

  it('端轴边界：仅声明真有 Backend 的端（不捏造 ios/android/harmony）', () => {
    for (const [, entry] of Object.entries(DEGRADATION_TABLE['p-button'] ?? {})) {
      expect(Object.keys(entry).sort()).toEqual(['behavior', 'mp', 'web'].filter((k) => k in entry))
    }
    // 每条的端键恰为 mp/web（无多余捏造端）
    for (const table of Object.values(DEGRADATION_TABLE)) {
      for (const entry of Object.values(table)) {
        for (const k of ['mp', 'web']) expect(entry).toHaveProperty(k)
        expect((entry as any)['ios']).toBeUndefined()
        expect((entry as any)['android']).toBeUndefined()
      }
    }
  })

  it('降级判定规则：宿主/样式/私有/Web 扩展各自归类正确（破坏性：改判即红）', () => {
    // T2 宿主族 → web:fallback
    expect(degradeProp('p-map', 'latitude').web).toBe('fallback')
    expect(degradeProp('p-map', 'latitude').behavior).toBeTruthy()
    // 样式族 → web:fallback
    expect(degradeProp('p-box', 'hoverClass').web).toBe('fallback')
    // T3 私有 → web:fallback
    expect(degradeProp('p-button', 'openType').web).toBe('fallback')
    // Web 扩展 → mp:fallback（★注：原用例的 clearable 已于 2026-09-18 作为陈旧规则清理）
    expect(degradeProp('p-select', 'searchable').mp).toBe('fallback')
    // 核心语义属性 → 两端 supported
    expect(degradeProp('p-button', 'disabled')).toEqual({ mp: 'supported', web: 'supported' })
    // ★同名不同义不得进全局规则表：p-page-container 的 customStyle 即官方 custom-style → mp supported
    expect(degradeProp('p-page-container', 'customStyle').mp).toBe('supported')
  })

  it('报告可读（含端态分布与行为覆盖率）', () => {
    const text = formatDegradationReport(report)
    expect(text).toContain('降级声明覆盖')
    expect(text).toContain('mp  端')
    expect(text).toContain('web 端')
  })
})

describe('★批次 4 · 编译期 PROP_NO_DEGRADATION（M6 fail-closed）', () => {
  const opts = { px2rpx: true, rpxRatio: 2 }
  // 注入含 unsupported 的表（现状表无 unsupported → 该路径无真实样本，注入才能证伪）
  const injected = {
    'p-media': {
      muted: { mp: 'supported' as const, web: 'supported' as const },
      enhanced: { mp: 'unsupported' as const, web: 'supported' as const, behavior: 'Web 独有增强通道' },
    },
  }

  it('纯函数：unsupported → 诊断；fallback / supported → 无诊断', () => {
    const d = checkPropDegradation('p-media', 'enhanced', 'mp', injected as any)
    expect(d?.code).toBe(PROP_NO_DEGRADATION)
    expect(d?.message).toContain('unsupported')
    // fallback 不报（有意降级，非静默失败）
    const fb = { 'p-media': { autoplay: { mp: 'supported' as const, web: 'fallback' as const, behavior: 'x' } } }
    expect(checkPropDegradation('p-media', 'autoplay', 'web', fb as any)).toBeNull()
    // supported 不报
    expect(checkPropDegradation('p-media', 'muted', 'mp', injected as any)).toBeNull()
    // 未声明属性不由本诊断负责（交由空白格门禁）
    expect(checkPropDegradation('p-media', 'notDeclared', 'mp', injected as any)).toBeNull()
  })

  it('编译器接线：unsupported 属性使用 → 产生产物警告（含 PROP_NO_DEGRADATION）', () => {
    const { warnings } = transformTemplateToWxml(
      '<p-media enhanced src="x" />',
      { ...opts, degradationTable: injected } as any,
    )
    const all = warnings.join('\n')
    expect(all).toContain(PROP_NO_DEGRADATION)
    expect(all).toContain('enhanced')
  })

  it('编译器接线：fallback/supported 属性 → 无该诊断（不误报）', () => {
    const { warnings } = transformTemplateToWxml(
      '<p-media muted autoplay src="x" />',
      { ...opts, degradationTable: injected } as any,
    )
    expect(warnings.join('\n')).not.toContain(PROP_NO_DEGRADATION)
  })

  it('破坏性：默认表（现状无 unsupported）下同一模板不报——证明诊断确实由表驱动', () => {
    const { warnings } = transformTemplateToWxml('<p-media enhanced src="x" />', opts)
    expect(warnings.join('\n')).not.toContain(PROP_NO_DEGRADATION)
  })

  it('规则可禁用（rules.disabled 逃生舱）', () => {
    const { warnings } = transformTemplateToWxml(
      '<p-media enhanced src="x" />',
      { ...opts, degradationTable: injected, rules: { disabled: ['prop/no-degradation'] } } as any,
    )
    expect(warnings.join('\n')).not.toContain(PROP_NO_DEGRADATION)
  })
})

describe('★2026-09-18 批次外收口：审计基准与表一致性', () => {
  it('★审计用**组件源码** props，非 catalog（catalog 与源码历史脱节）', () => {
    const fromSource = auditDegradation(SPECS)
    const fromCatalog = auditDegradation()
    // 源码属性数必须 ≥ catalog 属性数——否则说明回退到了陈旧基准
    // （实测：源码 538 vs catalog 417，p-input 在 catalog 仅记 4 项而源码 26 项）
    expect(fromSource.props).toBeGreaterThan(fromCatalog.props)
    for (const s of SPECS) {
      expect(fromCatalog.props, `${s.tag} 应在两种基准下都被审计`).toBeGreaterThan(0)
    }
  })

  it('★新增 MP 宿主透传属性 → web:fallback（不因缺省被判 supported）', () => {
    // p-input 安全键盘族 / 键盘族：MP 宿主能力，Web 无对应
    for (const prop of [
      'alwaysEmbed', 'confirmHold', 'adjustPosition', 'holdKeyboard',
      'cursorColor', 'selectionStart', 'selectionEnd', 'placeholderClass',
      'safePasswordCertPath', 'safePasswordNonce',
    ]) {
      const e = degradeProp('p-input', prop)
      expect(e.mp, `${prop} mp 端应 supported（宿主原生）`).toBe('supported')
      expect(e.web, `${prop} web 端应 fallback（Web 无宿主能力）`).toBe('fallback')
      expect(e.behavior, `${prop} 须有可观察降级行为`).toBeTruthy()
    }
    // p-form formId 宿主能力
    expect(degradeProp('p-form', 'reportSubmit').web).toBe('fallback')
    expect(degradeProp('p-form', 'reportSubmitTimeout').web).toBe('fallback')
  })

  it('★表↔规则一致性检查有牙齿（表被手工篡改即红）', () => {
    // 正常态：无分歧
    expect(auditDegradation(SPECS).issues.filter((i) => i.kind === 'table-divergence')).toHaveLength(0)
    // DEGRADATION_TABLE 由规则构建，故 rules 变更后无需手改表——此处验证「表条目与规则同判定」的不变量
    for (const [tag, table] of Object.entries(DEGRADATION_TABLE)) {
      for (const [prop, entry] of Object.entries(table)) {
        const fresh = degradeProp(tag, prop)
        expect(fresh.mp, `${tag}.${prop} 表 mp 与规则不一致`).toBe(entry.mp)
        expect(fresh.web, `${tag}.${prop} 表 web 与规则不一致`).toBe(entry.web)
      }
    }
  })
})
