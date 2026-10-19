// tests/capability-docs-guide.test.ts
// ★★★决策 #1084（2026-10-19）：能力页「人话描述 + 端实现边界」的判据。
//
// 【用户原话（立此判据）】「能力描述太过专业化，能力原语 C77 · capability.beacon · 返回 BeaconAPI ·
//   Hook 已实现（API 就绪，双端桥见下表）。这一句话还是不知道这个能力是做什么的。
//   还有就是文档没有把我们端实现边界写清楚。」
//
// 【这条测试防什么（三类退化）】
//   ① **新增能力没写人话说明** ⇒ 页面退回只显示机器标识（用户看不懂）⇒ `assertGuideCoverage` 硬失败；
//   ② **说明写成了技术腔**（出现 API 名/返回类型/"Hook"/原语编号）⇒ 等于没说，用词表挡住；
//   ③ **端边界缺失或含糊**（只说"未接线"不说原因/替代）⇒ 用结构化检查（必须含"原因/不可用"语义词）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { PRIMITIVE_CATALOG } from '../packages/component-ir/src/primitives'
import {
  CAPABILITY_GUIDE,
  CAPABILITY_END_NOTE,
  assertGuideCoverage,
  capabilityIntro,
} from '../website/scripts/lib/capability-docs.mjs'

const CAPS = PRIMITIVE_CATALOG.filter((c) => c.kind === 'capability')

describe('★#1084 ① 覆盖：84 个能力都必须有人话说明', () => {
  it('缺一条就硬失败（新增能力不补说明 = 页面退回机器标识）', () => {
    expect(() => assertGuideCoverage(CAPS)).not.toThrow()
  })

  it('没有多余/拼错的键（键必须与 PRIMITIVE_CATALOG 的 semantic 一一对应）', () => {
    const sem = new Set(CAPS.map((c) => c.semantic))
    const extra = Object.keys(CAPABILITY_GUIDE).filter((k) => !sem.has(k))
    expect(extra, `这些键不在能力目录里（拼错或能力已删）：${extra.join(', ')}`).toEqual([])
  })

  it('每条说明都有中英两版且非空（官网双语同源）', () => {
    for (const c of CAPS) {
      const g = CAPABILITY_GUIDE[c.semantic]
      expect(g, `${c.semantic} 缺说明`).toBeTruthy()
      for (const lang of ['zh', 'en'] as const) {
        expect(g![lang].what.length, `${c.semantic}.${lang}.what 太短（不够说明用途）`).toBeGreaterThan(6)
        expect(g![lang].use.length, `${c.semantic}.${lang}.use 太短（要给出使用场景）`).toBeGreaterThan(6)
      }
    }
  })
})

describe('★#1084 ② 反技术腔：人话说明里不该出现内部标识', () => {
  // ★这些词是"机器标识"的语言。出现在 what/use 里说明又写回了技术腔（用户抱怨的正是这个）。
  const TECH = [/capacity|capa\b/i, /\bAPI\b/, /\bHook\b/, /\bC\d{2}\b/, /Result</, /use[A-Z]\w+\(/, /capability\./]

  it('zh/en 的 what/use 都不含 API 名 / 原语编号 / Hook / 返回类型', () => {
    const hits: string[] = []
    for (const c of CAPS) {
      const g = CAPABILITY_GUIDE[c.semantic]!
      for (const lang of ['zh', 'en'] as const) {
        for (const field of ['what', 'use'] as const) {
          const text = g[lang][field]
          for (const re of TECH) {
            if (re.test(text)) hits.push(`${c.semantic}.${lang}.${field} 命中 ${re}`)
          }
        }
      }
    }
    expect(hits, `人话说明里出现了技术标识（应改为业务语言）：\n${hits.join('\n')}`).toEqual([])
  })
})

describe('★#1084 ③ 端边界：登记必须说清原因，不是重复状态标记', () => {
  it('每条边界都同时有中英两版', () => {
    for (const [sem, note] of Object.entries(CAPABILITY_END_NOTE)) {
      expect(note.zh.length, `${sem} 中文边界太短`).toBeGreaterThan(20)
      expect(note.en.length, `${sem} 英文边界太短`).toBeGreaterThan(20)
    }
  })

  it('边界必须给出**原因或替代路径**（不能只写"未接线"）', () => {
    const WHY = ['无', '不支持', '未支持', '禁止', '限制', '需', '依赖', '只能', '没有', 'not', 'no ', 'requires', 'limited', 'forbid', 'only', 'without', 'missing']
    const bad: string[] = []
    for (const [sem, note] of Object.entries(CAPABILITY_END_NOTE)) {
      for (const lang of ['zh', 'en'] as const) {
        const t = note[lang]
        if (!WHY.some((w) => t.toLowerCase().includes(w.toLowerCase()))) bad.push(`${sem}.${lang}`)
      }
    }
    expect(bad, `这些边界说明没给出原因/替代路径：${bad.join(', ')}`).toEqual([])
  })

  it('源码里没有重复键（对象字面量重复键会静默覆盖——本轮实测踩到）', () => {
    const src = readFileSync(new URL('../website/scripts/lib/capability-docs.mjs', import.meta.url), 'utf8')
    for (const block of ['CAPABILITY_GUIDE', 'CAPABILITY_END_NOTE']) {
      const start = src.indexOf(`export const ${block} = {`)
      expect(start, `${block} 未找到`).toBeGreaterThan(-1)
      const end = src.indexOf('\n}', start)
      const body = src.slice(start, end)
      const keys = [...body.matchAll(/^  '([^']+)':/gm)].map((m) => m[1])
      const dup = keys.filter((k, i) => keys.indexOf(k) !== i)
      expect([...new Set(dup)], `${block} 有重复键（后者会静默覆盖前者）`).toEqual([])
    }
  })

  it('键必须在能力目录里（防拼错后静默不生效）', () => {
    const sem = new Set(CAPS.map((c) => c.semantic))
    const extra = Object.keys(CAPABILITY_END_NOTE).filter((k) => !sem.has(k))
    expect(extra).toEqual([])
  })
})

describe('★#1084 ④ 渲染顺序：人话在前、技术标识在后', () => {
  it('中文页：先 "它能做什么" + "什么时候用"，技术标识行在其后', () => {
    const c = CAPS.find((x) => x.semantic === 'capability.beacon')!
    const lines = capabilityIntro(c, { en: false })
    const whatAt = lines.findIndex((l) => l.startsWith('**它能做什么**'))
    const whenAt = lines.findIndex((l) => l.startsWith('**什么时候用**'))
    const techAt = lines.findIndex((l) => l.startsWith('> 技术标识'))
    expect(whatAt).toBeGreaterThanOrEqual(0)
    expect(whenAt).toBeGreaterThan(whatAt)
    expect(techAt, '技术标识行必须在人话说明之后（用户抱怨的就是它被当成开场白）').toBeGreaterThan(whenAt)
  })

  it('英文页用英文标签（不能中英混排）', () => {
    const c = CAPS.find((x) => x.semantic === 'capability.beacon')!
    const text = capabilityIntro(c, { en: true }).join('\n')
    expect(text).toContain('**What it does**')
    expect(text).not.toContain('它能做什么')
  })

  it('有端边界的能力会渲染出边界段；没有的不硬凑', () => {
    const withNote = CAPS.find((x) => x.semantic === 'capability.beacon')!
    expect(capabilityIntro(withNote, { en: false }).join('\n')).toContain('**端实现边界**')
    const without = CAPS.find((x) => x.semantic === 'capability.vibrate')!
    expect(CAPABILITY_END_NOTE[without.semantic]).toBeUndefined()
    expect(capabilityIntro(without, { en: false }).join('\n')).not.toContain('**端实现边界**')
  })
})

describe('★#1084 ⑤ 用户点名的那个例子：useBeacon 页面能说清"是什么"', () => {
  it('beacon 的说明提到 iBeacon / 信标 / 室内（业务语言，不是 API 名）', () => {
    const g = CAPABILITY_GUIDE['capability.beacon']!
    expect(g.zh.what).toContain('iBeacon')
    expect(g.zh.what).toContain('信标')
    expect(g.zh.use).toContain('室内')
  })

  it('beacon 的端边界点名了"缺 startBeaconDiscovery"（真根因，不是笼统的"未接线"）', () => {
    const note = CAPABILITY_END_NOTE['capability.beacon']!
    expect(note.zh).toContain('startBeaconDiscovery')
    expect(note.zh).toContain('11004')
  })
})
