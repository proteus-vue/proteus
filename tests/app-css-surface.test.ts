// tests/app-css-surface.test.ts —— ★★★App 三端对齐 · 阶段 0：
//   **App 端 CSS 支持面 SSOT + 三表分层对照棘轮**（2026-10-04）
//
// 【这张测试锁什么（用户点名第 1 类「CSS 全兼容对齐」的度量前置）】
//   仓库里有**三张样式属性表**，此前互不引用、无门禁对照——App 端与 Web/MP 的 CSS 能力差距**不可见**：
//     ① `APP_LAYOUT_FIELDS`/`APP_PAINT_FIELDS`（compiler/vapor）—— **App 端编译期折叠面**（真正上端的）
//     ② `style-safety` 的 LENGTH/COLOR/NUMERIC/TRANSFORM + FORBIDDEN_PROPS —— **运行时 Validator**
//     ③ `contracts/style.ts` 的 STYLE_PROP_LEVELS —— **CSS 矩阵（G-21）**
//   ★关键厘清（本测试的判据设计由此而来）：② 是**语义/动态守卫层**（`:style` 绑定 + 动态 patch）；
//     ① 是**引擎字段层**（Layer-3：静态 CSS 折叠 + 框架 `p-*` 语义组件产出的目标字段）。**两层职责不同，
//     交集不构成缺陷**——但**新增未登记的交集** = 收敛模型新逃生口 ⇒ 必须显式登记（棘轮）。
//
// 【判据】
//   ① SSOT 完备：App 折叠面常量齐、无重复、非空（防生成器/导出腐化）
//   ② SSOT 与折叠实现同源：`parseStaticStyle` 对每个 App 布局字段**真折叠**（派生/特殊字段除外）
//   ③ **棘轮**：App 引擎接受面 ∩ FORBIDDEN ⊆ 已登记集（新增即红——这是本测试的核心）
//   ④ 派生/特殊字段语义正确（宽高百分比 → 比例字段；boxSizing 忠实记录）
//   ⑤ 门禁脚本与 SSOT 同源（脚本消费导出常量，不硬编码第二份清单）

import { describe, it, expect } from 'vitest'
import {
  APP_LAYOUT_FIELDS,
  APP_PAINT_FIELDS,
  APP_EDGE_FIELDS,
  APP_DERIVED_FIELDS,
  APP_SPECIAL_FIELDS,
  parseStaticStyle,
} from '@proteus-vue/compiler'
import { STYLE_PROP_LEVELS } from '@proteus-vue/contracts/style'
import { FORBIDDEN_PROPS } from '@proteus-vue/style-safety'
import fs from 'node:fs'
import path from 'node:path'

const APP_FIELDS = [...APP_LAYOUT_FIELDS, ...APP_PAINT_FIELDS, ...APP_EDGE_FIELDS, ...APP_DERIVED_FIELDS, ...APP_SPECIAL_FIELDS]
const FORBIDDEN = new Set<string>(FORBIDDEN_PROPS)
const MATRIX_KEYS = new Set<string>(Object.keys(STYLE_PROP_LEVELS))
/** ★已登记的分层差异（引擎字段层需要 FORBIDDEN 名的属性）——与 check-app-css-surface.mjs 同源维护 */
const APP_ENGINE_LEVEL_FIELDS = new Set(['display', 'position', 'overflow', 'boxShadow'])

describe('★App CSS 支持面 · ① SSOT 完备性', () => {
  it('五组常量各自非空、各自无重复（防导出/生成器腐化）', () => {
    for (const [name, arr] of [
      ['APP_LAYOUT_FIELDS', APP_LAYOUT_FIELDS],
      ['APP_PAINT_FIELDS', APP_PAINT_FIELDS],
      ['APP_EDGE_FIELDS', APP_EDGE_FIELDS],
      ['APP_DERIVED_FIELDS', APP_DERIVED_FIELDS],
      ['APP_SPECIAL_FIELDS', APP_SPECIAL_FIELDS],
    ] as const) {
      expect(arr.length, `${name} 非空`).toBeGreaterThan(0)
      expect(new Set(arr).size, `${name} 无重复`).toBe(arr.length)
    }
    // ★跨组：layout 与 edge 有意重叠（margin/padding 既在 layout 判定集、又被单独提取四边）
    //    ——重叠仅限这两项（防未来误加其它重叠）
    const overlap = APP_LAYOUT_FIELDS.filter((f) => (APP_EDGE_FIELDS as readonly string[]).includes(f))
    expect([...overlap].sort(), '跨组重叠仅 margin/padding（有意，非缺陷）').toEqual(['margin', 'padding'])
  })

  it('SSOT 是**单一来源**（门禁脚本消费导出常量，不硬编码第二份清单）', () => {
    const script = fs.readFileSync(path.resolve(__dirname, '../scripts/check-app-css-surface.mjs'), 'utf-8')
    expect(script, '从 @proteus-vue/compiler 导入常量').toContain('APP_LAYOUT_FIELDS')
    expect(script, '★不得硬编码 `width`, `height`… 之类字面量清单').not.toMatch(/const APP_FIELDS = \['/)
  })
})

describe('★App CSS 支持面 · ② SSOT 与折叠实现同源（真折叠，不是"表里有")', () => {
  it('每个 App 布局/绘制字段（除派生/特殊）都**真被 parseStaticStyle 折叠**', () => {
    const derived = new Set<string>(APP_DERIVED_FIELDS)
    const special = new Set<string>(APP_SPECIAL_FIELDS)
    // 合法值样例（按需给具体值；未列到的一律用 0——px/数字面）
    const valueOf = (f: string): string => {
      if (f === 'flexDirection') return 'row'
      if (f === 'flexWrap') return 'wrap'
      if (f === 'justifyContent') return 'center'
      if (f === 'alignItems' || f === 'alignSelf') return 'center'
      if (f === 'display') return 'flex'
      if (f === 'position') return 'absolute'
      if (f === 'overflow') return 'hidden'
      if (['backgroundColor', 'color', 'borderColor'].includes(f)) return '#123456'
      if (f === 'boxSizing') return 'border-box'
      if (f === 'fontWeight') return 'bold'
      if (f === 'textAlign') return 'center'
      if (f === 'boxShadow') return '0 1px 2px #000000'
      if (f === 'gridTemplateColumns' || f === 'gridTemplateRows') return '1fr 1fr'
      if (f === 'lineHeight') return '1.5'
      if (f === 'textOverflow') return 'ellipsis'
      if (f === 'visibility') return 'hidden'
      if (f === 'aspectRatio') return '1.5'
      if (f === 'pointerEvents') return 'none'
      if (f === 'textDecoration') return 'underline'
      return '10'
    }
    const notFolded: string[] = []
    for (const f of [...APP_LAYOUT_FIELDS, ...APP_PAINT_FIELDS, ...APP_EDGE_FIELDS]) {
      if (derived.has(f) || special.has(f)) continue
      const out = parseStaticStyle(`${f}: ${valueOf(f)}`, () => {})
      if (!(f in out)) notFolded.push(f)
    }
    expect(notFolded, `这些字段列在 SSOT 里却没被折叠：${notFolded.join(', ')}`).toEqual([])
  })
})

describe('★App CSS 支持面 · ③ 棘轮：新增未登记分歧 ⇒ 红', () => {
  it('App 引擎接受面 ∩ FORBIDDEN ⊆ 已登记集（防"开发者能在 App 写语义层禁止的属性"）', () => {
    const hits = APP_FIELDS.filter((f) => FORBIDDEN.has(f)).sort()
    const unregistered = hits.filter((f) => !APP_ENGINE_LEVEL_FIELDS.has(f))
    expect(
      unregistered,
      `新增未登记的 FORBIDDEN 交集：${unregistered.join(', ')}——` +
        '若是引擎字段层确需 → 加进 APP_ENGINE_LEVEL_FIELDS（本测试 + check-app-css-surface.mjs 两处）；否则修正 App 折叠面',
    ).toEqual([])
    // 反向：已登记集不得是"僵尸"（登记了却不在交集 ⇒ 提示清理）
    const stale = [...APP_ENGINE_LEVEL_FIELDS].filter((f) => !(hits as string[]).includes(f))
    expect(stale, `已登记但已不在交集（应清理登记）：${stale.join(', ')}`).toEqual([])
  })

  it('已登记项本身仍是 FORBIDDEN（登记不改变语义层地位——display 等仍禁开发者裸写）', () => {
    for (const f of APP_ENGINE_LEVEL_FIELDS) {
      expect(FORBIDDEN.has(f), `${f} 仍是 FORBIDDEN（语义层）`).toBe(true)
    }
  })
})

describe('★App CSS 支持面 · ④ 派生/特殊字段语义', () => {
  it('宽高百分比 → 比例字段（widthRatio/heightRatio，内核原生支持，不乘密度）', () => {
    const out = parseStaticStyle('width: 50%; height: 25%', () => {})
    expect(out.widthRatio, 'width 50% → widthRatio 0.5').toBe(0.5)
    expect(out.heightRatio, 'height 25% → heightRatio 0.25').toBe(0.25)
    expect('width' in out, '不再落 width（比例是另一套键）').toBe(false)
  })

  it('px/数字 → 数值（长度按密度换算留给宿主，折叠面只交数值）', () => {
    const out = parseStaticStyle('width: 100px; padding: 16px', () => {})
    expect(out.width).toBe(100)
    expect(out.padding).toEqual({ top: 16, right: 16, bottom: 16, left: 16 })
  })

  it('boxSizing 忠实记录（App 两内核恒 border-box ⇒ 无副作用）', () => {
    const out = parseStaticStyle('box-sizing: border-box', () => {})
    expect(out.boxSizing).toBe('border-box')
  })

  it('认不出的键产出诊断（不静默吞——本仓纪律）', () => {
    const diags: string[] = []
    parseStaticStyle('column-count: 2', (m) => diags.push(m))
    expect(diags.length, 'column-count 不在 App 折叠面 ⇒ 有诊断').toBeGreaterThan(0)
  })
})

describe('★App CSS 支持面 · ⑤ 生成物与门禁一致（对照矩阵文档存在且判据分节齐）', () => {
  it('docs/generated/app-css-surface.md 存在，含三判据分节与诚实差异表', () => {
    const doc = path.resolve(__dirname, '../docs/generated/app-css-surface.md')
    expect(fs.existsSync(doc), '对照矩阵文档已生成（check:app-css-surface --update）').toBe(true)
    const md = fs.readFileSync(doc, 'utf-8')
    expect(md, '分层前提说明').toContain('引擎字段层')
    expect(md, '判据②棘轮').toContain('未登记')
    expect(md, '与 Web/MP 差异表').toContain('选择器 / 层叠 / 伪类 / 媒体查询')
    // 矩阵键与 SSOT 同源（文档里应出现 App 字段）
    expect(md).toContain(APP_LAYOUT_FIELDS[0])
    expect(md).toContain(APP_PAINT_FIELDS[0])
  })
})
