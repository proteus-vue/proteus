// tests/capability-app-element.test.ts
// ★★★决策 #1081（2026-10-19）：`useElement` 选择器通路的四层判据。
//
// 【为什么这条测试必须存在（本切片的核心风险）】
//   用户 2026-10-19：「这个选择器正常应该是通过 vue 自定义渲染通道做映射吧？因为拿到的肯定是
//   vue 元素信息不是原生元素信息」+「验证通路没问题后真正落地就需要和 web 的查询结构保持同步了」。
//   ⇒ 本文件的判据分四层，**逐层都能独立破坏**：
//     ① **编译器**：模板静态 `id` 必须进产物（`LayoutNode.elementId`）；动态 `:id` 必须产诊断（不静默丢）；
//     ② **实例化**：`elementId` 必须透传到 `InstantiatedNode`（漏透传 = 静默查不到）；
//     ③ **索引**：`#id`/裸 id 解析、按屏分桶、重复 id 取文档序第一个、整桶替换（不留幽灵条目）、
//        Vue 渲染链与 Vapor 链共用一套查询；
//     ④ **能力层**：`createElementQuery(...)` 用**注入的索引**解析 → 调宿主 `element.rect` →
//        归一成 **Web `getBoundingClientRect()` 的视口坐标语义**（内容坐标 − scrollY）。
//   ★ ④ 里的坐标归一尤其重要：三端宿主只报各自的 scrollY，减法是**一份共享实现**——
//     若这里写错，三端会"一致地错"（正是本仓 CSS 章节记录过的"三端自洽但偏离 Web"形态）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { buildLayoutTemplate } from '@proteus-vue/compiler'
import { instantiateTemplate } from '@proteus-vue/slot-runtime'
import {
  parseIdSelector,
  parseSelector,
  selectorSupport,
  datasetKeyOf,
  registerScreenElements,
  clearScreenElements,
  registerVueElement,
  registerVueElementParent,
  registerVueElementId,
  clearVueElementIds,
  resolveElement,
  firstScreenElementId,
  elementRegistryStats,
  resetElementRegistry,
} from '@proteus-vue/render-backend'
import { createAppElementCapabilities, createAppElementQuery, installElementResolver } from '../packages/api/src/capability-app-element'
import type { ElementRect } from '../packages/api/src/capability-types'

const sfc = (template: string, script = ''): string =>
  `<template>\n${template}\n</template>\n\n<script setup lang="ts">\n${script}\n</script>\n`

const SFC_WITH_IDS = sfc(
  `<p-view id="page-root" style="flex-direction: column; padding-top: 20px">\n` +
    `  <p-view id="hero" style="height: 120px; flex-shrink: 0" />\n` +
    `  <p-view class="plain" style="height: 40px" />\n` +
    `  <p-text id="title">标题</p-text>\n` +
    `</p-view>`,
)

const SFC_DYNAMIC_ID = sfc(`<p-view :id="dyn" style="height: 20px" />`, `const dyn = ref('x')\n`)

describe('★#1081 ① 编译器：模板静态 id → LayoutNode.elementId', () => {
  it('静态 id 进产物，且与引擎节点 id 分属两个空间', () => {
    const res = buildLayoutTemplate(SFC_WITH_IDS, 'ids.vue')
    expect(res.ok, `模板应可用；诊断：${res.diagnostics.map((d) => d.message).join(' | ')}`).toBe(true)
    const byElement = res.template.nodes.filter((n) => n.elementId)
    expect(byElement.map((n) => n.elementId)).toEqual(['page-root', 'hero', 'title'])
    // ★elementId 是模板上的名字；id 是引擎节点 id —— 两者不能相同语义（同名同值也不构成证据）
    const hero = res.template.nodes.find((n) => n.elementId === 'hero')!
    expect(typeof hero.id).toBe('number')
    // 没有 id 的节点**不产**该字段（既有产物逐字节不变）——class="plain" 的盒子必须没有 elementId
    const plain = res.template.nodes.find((n) => n.tag === 'p-view' && n.elementId === undefined)
    expect(plain, '应存在一个无 elementId 的 p-view（class=plain）').toBeTruthy()
  })

  it('★#1082 静态 class / data-* 进产物（`.foo` / `[data-k]` 选择器的数据源）', () => {
    const res = buildLayoutTemplate(SFC_WITH_IDS, 'ids.vue')
    const hero = res.template.nodes.find((n) => n.elementId === 'hero')!
    expect(hero.elementClasses).toBeUndefined() // 模板里 hero 没有 class
    const plain = res.template.nodes.find((n) => n.elementId === undefined)!
    expect(plain.elementClasses).toEqual(['plain'])

    // data-*（HTML dataset 命名：data-foo-bar ⇒ fooBar）
    const sfc2 = sfc('<p-view id="x" data-kind="a" data-foo-bar="2" style="height: 20px" />')
    const r2 = buildLayoutTemplate(sfc2, 'ds.vue')
    const nx = r2.template.nodes.find((n) => n.elementId === 'x')!
    expect(nx.elementDataset).toEqual({ kind: 'a', fooBar: '2' })
  })

  it('★#1082 `:class` 字面量形态折成静态类；对象/数组形态产诊断', () => {
    const lit = sfc(`<p-view :class="'a b'" style=\"height: 20px\" />`)
    const r1 = buildLayoutTemplate(lit, 'lit.vue')
    expect(r1.template.nodes[0]!.elementClasses).toEqual(['a', 'b'])
    expect(r1.diagnostics.some((d) => d.code === 'VAPOR_DYNAMIC_CLASS_QUERY_UNSUPPORTED')).toBe(false)

    const obj = sfc(`<p-view :class=\"{ on: x }\" style=\"height: 20px\" />`, 'const x = ref(true)\n')
    const r2 = buildLayoutTemplate(obj, 'obj.vue')
    expect(r2.diagnostics.some((d) => d.code === 'VAPOR_DYNAMIC_CLASS_QUERY_UNSUPPORTED')).toBe(true)
  })

  it('★#1082 动态 :data-* 产诊断（不静默丢）', () => {
    const dyn = sfc(`<p-view :data-k=\"v\" style=\"height: 20px\" />`, 'const v = ref(1)\n')
    const r = buildLayoutTemplate(dyn, 'dyn-data.vue')
    expect(r.diagnostics.some((d) => d.code === 'VAPOR_DYNAMIC_DATASET_UNSUPPORTED')).toBe(true)
    expect(r.template.nodes.some((n) => n.elementDataset !== undefined)).toBe(false)
  })

  it('★#1082 实例化透传 class / dataset', () => {
    const sfc3 = sfc('<p-view id="p" class="a b" data-k="v" style="height: 20px" />')
    const res = buildLayoutTemplate(sfc3, 'inst.vue')
    const inst = instantiateTemplate(res.template, { viewport: { width: 390, height: 844 }, read: () => undefined })
    const n = inst.nodes.find((x) => (x as { elementId?: string }).elementId === 'p') as unknown as { elementClasses?: string[]; elementDataset?: Record<string, string> }
    expect(n.elementClasses).toEqual(['a', 'b'])
    expect(n.elementDataset).toEqual({ k: 'v' })
  })

  it('动态 :id 产精确诊断（不静默丢——静默丢会让 useElement 无声失效）', () => {
    const res = buildLayoutTemplate(SFC_DYNAMIC_ID, 'dyn.vue')
    const d = res.diagnostics.find((x) => x.code === 'VAPOR_DYNAMIC_ID_UNSUPPORTED')
    expect(d, `期望 VAPOR_DYNAMIC_ID_UNSUPPORTED；实得：${res.diagnostics.map((x) => x.code).join(',')}`).toBeTruthy()
    expect(d!.message).toContain(':id')
    // 动态 id 的值不可知 ⇒ 产物里不得出现伪造的 elementId
    expect(res.template.nodes.some((n) => n.elementId !== undefined)).toBe(false)
  })
})

describe('★#1081 ② 实例化：elementId 随 InstantiatedNode 透传', () => {
  it('实例化产物带 elementId（漏透传 = 元素查询静默查不到）', () => {
    const res = buildLayoutTemplate(SFC_WITH_IDS, 'ids.vue')
    const inst = instantiateTemplate(res.template, { viewport: { width: 390, height: 844 }, read: () => undefined })
    const ids = inst.nodes.map((n) => (n as { elementId?: string }).elementId).filter(Boolean)
    expect(ids).toEqual(['page-root', 'hero', 'title'])
  })
})

describe('★#1081 ③ 索引：选择器解析 / 按屏分桶 / 重复 id / 整桶替换', () => {
  beforeEach(() => resetElementRegistry())
  afterEach(() => resetElementRegistry())

  it('选择器支持面：id/class/tag/复合/后代/子/列表/属性 支持；兄弟/伪类/伪元素/属性运算符 明确拒绝', () => {
    // 裸 id 与 `#id` 同义（本仓既有约定）
    expect(parseIdSelector('#hero')).toBe('hero')
    expect(parseIdSelector('  #hero ')).toBe('hero')
    expect(parseIdSelector('hero')).toBe('hero')
    expect(parseIdSelector('.hero')).toBeNull() // 已扩面：不再是 id

    // ★支持面（与 Web querySelector 同一子集）
    for (const ok of [
      '#hero', '.card', 'p-view', '*',
      'p-view.card', '.a.b', '#hero.card', '[data-k]', '[data-k="v"]', "[data-k='v']",
      '.list .item', '.list > .item', 'p-view .x', '.a, .b', 'p-view#hero.card[data-k="v"]',
    ]) {
      expect(selectorSupport(ok).ok, `应支持：${ok}`).toBe(true)
    }

    // ★拒绝面：给出**可操作原因**，且绝不退化成"当成 id 查"
    for (const [bad, hint] of [
      ['.a + .b', '兄弟选择器'],
      ['.a ~ .b', '兄弟选择器'],
      ['li:nth-child(2)', '伪类'],
      ['p::before', '伪元素'],
      ['[data-k^="v"]', '属性运算符'],
      ['[data-k~="v"]', '属性运算符'],
    ]) {
      const r = selectorSupport(bad)
      expect(r.ok, `应拒绝：${bad}`).toBe(false)
      if (!r.ok) expect(r.reason).toContain(hint)
      // ★解析失败 ⇒ 查询必须**返回 null**（不能落到"按 id 查"的近似分支）
      expect(resolveElement(bad, 'index')).toBeNull()
    }
    expect(selectorSupport('').ok).toBe(false)
    expect(parseSelector('').reason).toBeTruthy()
  })

  it('datasetKeyOf 与 HTML dataset 命名一致（data-foo-bar ⇒ fooBar）', () => {
    expect(datasetKeyOf('data-k')).toBe('k')
    expect(datasetKeyOf('data-foo-bar')).toBe('fooBar')
    expect(datasetKeyOf('data-a-b-c')).toBe('aBC')
  })

  it('按屏分桶：同名 id 不串屏；当前屏优先于其它屏', () => {
    registerScreenElements('index', [{ id: 5, elementId: 'hero' }])
    registerScreenElements('mine', [{ id: 9, elementId: 'hero' }])
    expect(resolveElement('#hero', 'index')).toEqual({ nodeId: 5, source: 'screen' })
    expect(resolveElement('#hero', 'mine')).toEqual({ nodeId: 9, source: 'screen' })
    expect(resolveElement('#hero', 'other')).toBeNull()
    expect(elementRegistryStats().screens).toEqual({ index: 1, mine: 1 })
  })

  it('firstScreenElementId：拿当前屏第一个元素 id（探针跨页用）', () => {
    expect(firstScreenElementId('index')).toBeNull()
    registerScreenElements('index', [{ id: 1, elementId: 'a' }, { id: 2, elementId: 'b' }])
    expect(firstScreenElementId('index')).toBe('a')
    clearScreenElements('index')
    expect(firstScreenElementId('index')).toBeNull()
  })

  it('重复 id 取文档序第一个，并如实报 duplicates', () => {
    const r = registerScreenElements('index', [
      { id: 3, elementId: 'dup' },
      { id: 7, elementId: 'dup' },
    ])
    expect(resolveElement('#dup', 'index')).toEqual({ nodeId: 3, source: 'screen' })
    expect(r.duplicates).toEqual(['dup'])
  })

  it('★class / data-* / tag / 复合 / 后代 / 子 / 列表 / 文档序（Web querySelector 语义）', () => {
    // 一棵小树：0(根 p-view) → {1(card), 2(card 无 id)}；1 → 3(item)；3 → 4(deep)
    const tree = [
      { id: 10, tag: 'p-view', parentId: null, elementId: 'root' },
      { id: 11, tag: 'p-view', parentId: 10, elementClasses: ['card'], elementDataset: { kind: 'a' } },
      { id: 12, tag: 'p-view', parentId: 10, elementClasses: ['card', 'wide'], elementDataset: { kind: 'b' } },
      { id: 13, tag: 'p-text', parentId: 11, elementId: 'title', elementClasses: ['item'] },
      { id: 14, tag: 'p-text', parentId: 13, elementClasses: ['deep'] },
    ]
    registerScreenElements('index', tree)

    // .class：文档序第一个
    expect(resolveElement('.card', 'index')).toEqual({ nodeId: 11, source: 'screen' })
    expect(resolveElement('.wide', 'index')).toEqual({ nodeId: 12, source: 'screen' })
    // tag
    expect(resolveElement('p-text', 'index')).toEqual({ nodeId: 13, source: 'screen' })
    expect(resolveElement('*', 'index')).toEqual({ nodeId: 10, source: 'screen' })
    // 复合（同一元素多个条件同时满足）
    expect(resolveElement('p-view.wide', 'index')).toEqual({ nodeId: 12, source: 'screen' })
    expect(resolveElement('#title.item', 'index')).toEqual({ nodeId: 13, source: 'screen' })
    expect(resolveElement('.card#root', 'index')).toBeNull() // root 没有 card
    // 属性（dataset 语义）
    expect(resolveElement('[data-kind]', 'index')).toEqual({ nodeId: 11, source: 'screen' })
    expect(resolveElement('[data-kind="b"]', 'index')).toEqual({ nodeId: 12, source: 'screen' })
    expect(resolveElement('[data-kind="zzz"]', 'index')).toBeNull()
    // 后代 / 子
    expect(resolveElement('.card .item', 'index')).toEqual({ nodeId: 13, source: 'screen' })
    expect(resolveElement('.card > .item', 'index')).toEqual({ nodeId: 13, source: 'screen' })
    // ★`>` 只认直接父：`.item > .deep` 成立，`.root > .deep` 不成立（deep 的父是 title）
    expect(resolveElement('.item > .deep', 'index')).toEqual({ nodeId: 14, source: 'screen' })
    expect(resolveElement('.card > .deep', 'index')).toBeNull()
    // 选择器列表：**文档序**取第一个（不是按列表顺序）。
    //   ★本树 DFS 序 = 10(root) → 11(card) → 13(title) → 14(deep) → 12(card.wide)
    expect(resolveElement('.deep, .card', 'index')).toEqual({ nodeId: 11, source: 'screen' }) // card 在 deep 之前
    expect(resolveElement('.deep, .wide', 'index')).toEqual({ nodeId: 14, source: 'screen' }) // deep 在 wide 之前
    expect(resolveElement('.wide, .deep', 'index')).toEqual({ nodeId: 14, source: 'screen' }) // 列表顺序不影响
  })
  it('整桶替换：重建后旧 id 不再可查（不留幽灵条目）', () => {
    registerScreenElements('index', [{ id: 11, elementId: 'old' }])
    expect(resolveElement('#old', 'index')).toEqual({ nodeId: 11, source: 'screen' })
    registerScreenElements('index', [{ id: 12, elementId: 'new' }])
    expect(resolveElement('#old', 'index')).toBeNull()
    expect(resolveElement('#new', 'index')).toEqual({ nodeId: 12, source: 'screen' })
    clearScreenElements('index')
    expect(resolveElement('#new', 'index')).toBeNull()
  })

  it('Vue 渲染链：`patchProp` 写桶 → 无屏上下文时也可解析（source=vue）', () => {
    registerVueElementId('vue-box', 42)
    expect(resolveElement('#vue-box')).toEqual({ nodeId: 42, source: 'vue' })
    // 屏幕桶命中优先（它就是屏幕上那棵树）
    registerScreenElements('index', [{ id: 43, elementId: 'vue-box' }])
    expect(resolveElement('#vue-box', 'index')).toEqual({ nodeId: 43, source: 'screen' })
    clearVueElementIds()
    expect(resolveElement('#vue-box')).toBeNull()
  })
})

describe('★#1081 ④ 能力层：selector → nodeId → 宿主 element.rect → Web 视口坐标', () => {
  /** 假宿主：记录调用并回固定几何（用来验证**归一逻辑**，不验证平台 API） */
  const makeHost = (reply: Record<string, unknown>) => {
    const calls: Array<{ method: string; args: string }> = []
    ;(globalThis as Record<string, unknown>).proteusHost = {
      invoke: (method: string, args: string) => {
        calls.push({ method, args })
        return JSON.stringify({ ok: true, data: reply })
      },
    }
    return calls
  }

  beforeEach(() => {
    resetElementRegistry()
    delete (globalThis as Record<string, unknown>).__proteusHostInvoke
    delete (globalThis as Record<string, unknown>).__proteusHostInvokeBytes
    delete (globalThis as Record<string, unknown>).proteusHost
  })
  afterEach(() => {
    installElementResolver(null)
    resetElementRegistry()
    delete (globalThis as Record<string, unknown>).proteusHost
  })

  it('boundingClientRect：内容坐标 − scrollY = Web 视口坐标', async () => {
    registerScreenElements('index', [{ id: 77, elementId: 'hero' }])
    installElementResolver({
      resolve: (s: string | null | undefined) => (resolveElement(s, 'index')),
      support: (s: string | null | undefined) => selectorSupport(s),
    })
    // 宿主给**内容坐标** + 自己的滚动偏移（Web 语义由 JS 侧归一）
    const calls = makeHost({ x: 16, y: 200, width: 358, height: 120, scrollY: 50 })
    const q = createAppElementQuery()
    const r = await q.boundingClientRect('#hero')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.id).toBe('hero')
    expect(r.data.left).toBe(16)
    expect(r.data.top).toBe(150) // 200 − 50
    expect(r.data.bottom).toBe(270) // 150 + 120
    expect(r.data.width).toBe(358)
    expect(calls).toEqual([{ method: 'element.rect', args: JSON.stringify({ nodeId: 77 }) }])
  })

  it('size / batch / fields 共用同一解析（batch 里查不到的元素回 null，不整批失败）', async () => {
    registerScreenElements('index', [
      { id: 1, elementId: 'a' },
      { id: 2, elementId: 'b' },
    ])
    installElementResolver({
      support: (s: string | null | undefined) => selectorSupport(s),
      resolve: (s: string | null | undefined) => {
        const id = parseIdSelector(s)
        if (id === 'a') return { nodeId: 1, source: 'screen' }
        if (id === 'b') return { nodeId: 2, source: 'screen' }
        return null
      },
    })
    makeHost({ x: 0, y: 10, width: 100, height: 20, scrollY: 10 })
    const q = createAppElementQuery()
    const size = await q.size('#a')
    expect(size.ok && size.data).toEqual({ width: 100, height: 20 })
    const batch = await q.batch(['#a', '#missing', '#b'])
    expect(batch.ok).toBe(true)
    if (!batch.ok) return
    expect(batch.data.map((x: ElementRect | null) => (x ? x.id : null))).toEqual(['a', null, 'b'])
    const fields = await q.fields({ rect: true, scrollOffset: true }, '#a')
    expect(fields.ok).toBe(true)
    if (!fields.ok) return
    expect(fields.data.width).toBe(100)
    expect(fields.data.scrollTop).toBe(0) // App 端滚动是整内容层，元素级恒 0
  })

  it('三档错误分得开：not-found / unsupported（非 id 选择器）/ unsupported（未装配索引）', async () => {
    const q0 = createAppElementQuery()
    const noIndex = await q0.boundingClientRect('#hero')
    expect(!noIndex.ok && noIndex.error.code).toBe('element.unsupported')

    registerScreenElements('index', [{ id: 1, elementId: 'hero' }])
    installElementResolver({ resolve: () => null, support: (s) => selectorSupport(s) })
    const q = createAppElementQuery()
    const notFound = await q.boundingClientRect('#hero')
    expect(!notFound.ok && notFound.error.code).toBe('element.not-found')
    // ★class 选择器自 #1082 起**受支持**：没注册带该 class 的元素 ⇒ not-found（不是 unsupported）
    const classMiss = await q.boundingClientRect('.hero')
    expect(!classMiss.ok && classMiss.error.code).toBe('element.not-found')
    // 真正不受支持的形态（伪类）⇒ unsupported + 可操作原因
    const badSel = await q.boundingClientRect('li:hover')
    expect(!badSel.ok && badSel.error.code).toBe('element.unsupported')
    expect(!badSel.ok && badSel.error.message).toContain('伪类')
  })

  it('宿主未实现 element.rect ⇒ element.unsupported（不是 failed）；宿主报错 ⇒ failed', async () => {
    registerScreenElements('index', [{ id: 5, elementId: 'hero' }])
    installElementResolver({ resolve: () => ({ nodeId: 5, source: 'screen' }), support: (s) => selectorSupport(s) })
    const q = createAppElementQuery()

    // ① 壳完全没有能力通道 ⇒ invokeHost 的 missing 分档
    const noChannel = await q.boundingClientRect('#hero')
    expect(!noChannel.ok && noChannel.error.code).toBe('element.unsupported')

    // ② 通道在、宿主明确说"未实现"（missing）
    ;(globalThis as Record<string, unknown>).proteusHost = {
      invoke: () => JSON.stringify({ ok: false, missing: true, reason: '未实现的原生方法：element.rect' }),
    }
    const missing = await q.boundingClientRect('#hero')
    expect(!missing.ok && missing.error.code).toBe('element.unsupported')

    // ③ 有 API 但真失败
    ;(globalThis as Record<string, unknown>).proteusHost = {
      invoke: () => {
        throw new Error('boom')
      },
    }
    const failed = await q.boundingClientRect('#hero')
    expect(!failed.ok && failed.error.code).toBe('element.failed')
  })

  it('useIntersection 如实不支持（不做"observe 回调一次"的假观察）', () => {
    // ★`createIntersection` 是**桥成员**（CapabilityBridge 上的 createIntersection），不在 ElementQuery 上
    const bridge = createAppElementCapabilities(Error as unknown as new (c: string, m: string) => Error)
    const handle = bridge.createIntersection({ thresholds: [0.5] })
    let called = 0
    handle.relativeToViewport().observe('#hero', () => { called++ })
    expect(called).toBe(0)
  })
})
