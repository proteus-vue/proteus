// tests/vapor-v2.test.ts
// ★Vapor for Proteus IR · V2：编译期响应式转换（方案 §4 + §5）
//
// 【本文件要证明的核心命题（对应里程碑 V2）】
//   ① Step 1 源识别：ref / reactive / computed / props / model 五类齐全，id 稳定可复现
//   ② Step 2 依赖分析：**:class / 插值 / v-if / v-for / 可选链 / 函数调用 / 列表相对路径**
//      各自的依赖集正确——**漏订会让 UI 静默不更新**（最危险失效模式）
//   ③ Step 3-5 依赖图 + 求值函数 + SubscriptionTable：可序列化、可复现
//   ④ Step 6 分层：★**L0/L1 混跑**（方案 §5.2「可在同一组件内共存」）
//   ⑤ 保守性：任何"没证明"的情形一律 L0（方案 §5.1「能证明才激进」）
import { describe, it, expect } from 'vitest'
import {
  scanReactiveSources,
  analyzeExprDeps,
  collectTemplateBindings,
  buildVaporSubscriptions,
  slotKindOf,
  normalizePropKey,
} from '@proteus-vue/compiler'

const sfc = (script: string, template: string): string => `<template>\n${template}\n</template>\n\n<script setup lang="ts">\n${script}\n</script>\n`

describe('V2 Step 1 · 响应式源识别', () => {
  it('★五类源全部识别（ref / reactive / computed / props / model）', () => {
    const src = sfc(
      `const count = ref(0)
const state = reactive({ n: 1 })
const double = computed(() => count.value * 2)
const props = defineProps<{ title: string }>()
const model = defineModel<string>()
`,
      '<p-view />',
    )
    const scan = scanReactiveSources(src, 'a.vue')
    expect(scan.ok).toBe(true)
    const kinds = Object.fromEntries(scan.sources.map((s) => [s.name, s.kind]))
    expect(kinds.count).toBe('ref')
    expect(kinds.state).toBe('reactive')
    expect(kinds.double).toBe('computed')
    expect(kinds.props).toBe('props')
    expect(kinds.model).toBe('model')
  })

  it('★sourceId 按声明顺序分配（产物可复现的前提）', () => {
    const src = sfc(`const a = ref(1)\nconst b = ref(2)\nconst c = ref(3)\n`, '<p-view />')
    const scan = scanReactiveSources(src, 'a.vue')
    expect(scan.sources.map((s) => [s.name, s.sourceId])).toEqual([['a', 0], ['b', 1], ['c', 2]])
  })

  it('★解构 props / defineModel 的每个绑定名都是独立源', () => {
    const src = sfc(`const { title, subtitle } = defineProps<{ title: string; subtitle: string }>()\nconst m = defineModel<number>('count')\n`, '<p-view />')
    const scan = scanReactiveSources(src, 'a.vue')
    const names = scan.sources.map((s) => s.name)
    expect(names).toContain('title')
    expect(names).toContain('subtitle')
    expect(names).toContain('m')
  })

  it('★无 script setup ⇒ 空集是合法结果（ok=true，不是失败）', () => {
    const scan = scanReactiveSources('<template><p-view /></template>', 'a.vue')
    expect(scan.ok).toBe(true)
    expect(scan.sources).toEqual([])
  })
})

describe('V2 Step 2 · 模板表达式依赖分析', () => {
  it('★成员访问取值：`item.name` → 依赖根 item', () => {
    const d = analyzeExprDeps('item.name')
    expect(d.roots).toContain('item')
    expect(d.parseFailed).toBe(false)
  })

  it('★对象字面量里的**键名**不算依赖（`:class="{ active: isActive }"` → 只依赖 isActive）', () => {
    const d = analyzeExprDeps("{ active: isActive }")
    expect(d.roots).toContain('isActive')
    expect(d.roots).not.toContain('active') // ★键名不是标识符引用
  })

  it('★字符串字面量里的同名文本不算依赖', () => {
    const d = analyzeExprDeps("'isActive' + realValue")
    expect(d.roots).toContain('realValue')
    expect(d.roots).not.toContain('isActive')
  })

  it('★可选链 / 三元 / 模板字符串的依赖都被收集', () => {
    expect(analyzeExprDeps('a?.b?.c').roots).toContain('a')
    expect(analyzeExprDeps("flag ? x : y").roots.sort()).toEqual(['flag', 'x', 'y'])
    expect(analyzeExprDeps('`值 ${n} 个`').roots).toContain('n')
  })

  it('★函数调用被记录（C1 纯函数判定的输入）', () => {
    const d = analyzeExprDeps("fmt(item.ts)")
    expect(d.hasCall).toBe(true)
    expect(d.calls).toContain('fmt')
    expect(d.roots).toContain('item')
  })

  it('★★回调参数不算响应式源（`list.map(x => x.name)` 只依赖 list）', () => {
    const d = analyzeExprDeps('list.map(x => x.name)')
    expect(d.roots).toContain('list')
    expect(d.roots).not.toContain('x') // 局部参数
  })

  it('★★v-for 作用域变量不算顶层源，且记录为**列表相对路径**', () => {
    const d = analyzeExprDeps('item.title', ['item'])
    expect(d.roots).not.toContain('item') // item 是 v-for 作用域，不是顶层源
    expect(d.listRelative).toEqual([{ scope: 'item', path: 'item.title' }])
  })

  it('★JS 内置全局不算依赖（Math.max(a, b) 只依赖 a、b）', () => {
    const d = analyzeExprDeps('Math.max(a, b)')
    expect(d.roots.sort()).toEqual(['a', 'b'])
    expect(d.roots).not.toContain('Math')
  })

  it('★解析失败必须显式标记（调用方据判 L0，不许静默当空依赖）', () => {
    const d = analyzeExprDeps('a +* b')
    expect(d.parseFailed).toBe(true)
  })
})

describe('V2 Step 2 · 模板遍历', () => {
  it('★收集 :prop / 插值 / v-if / v-for，并标注 propKey 与作用域', () => {
    const src = sfc(
      `const list = ref([])\nconst ok = ref(true)\nconst n = ref(1)\n`,
      `<p-view :class="{a: ok}">{{ n }}</p-view>\n<p-text v-for="item in list" :key="item.id">{{ item.title }}</p-text>`,
    )
    const bindings = collectTemplateBindings(src, 'a.vue')
    const keys = bindings.map((b) => b.propKey)
    expect(keys).toContain('paint.class')
    expect(keys).toContain('text.content')
    const forBinding = bindings.find((b) => b.where === 'v-for')
    expect(forBinding?.code).toBe('list')
    const itemBinding = bindings.find((b) => b.code === 'item.title')
    expect(itemBinding?.scopes).toContain('item')
  })

  it('★v-if 分支内的绑定被标记（C5 判定输入）', () => {
    const src = sfc(`const ok = ref(true)\n`, `<p-view v-if="ok"><p-text>{{ ok }}</p-text></p-view>`)
    const bindings = collectTemplateBindings(src, 'a.vue')
    const inner = bindings.find((b) => b.code === 'ok' && b.propKey === 'text.content')
    expect(inner?.inRuntimeBranch).toBe(true)
  })
})

describe('V2 Step 3-5 · 依赖图与订阅表', () => {
  it('★依赖图：源 → 槽位（可序列化 + 稳定顺序）', () => {
    const src = sfc(`const a = ref(1)\nconst b = ref(2)\n`, `<p-view :style="a">{{ b }}</p-view>`)
    const res = buildVaporSubscriptions(src, 'a.vue')
    expect(res.ok).toBe(true)
    const byName = Object.fromEntries(res.table.sources.map((s) => [s.sourceName, s.slots.map((x) => x.propKey)]))
    expect(byName.a).toEqual(['paint.style'])
    expect(byName.b).toEqual(['text.content'])
  })

  it('★求值函数：纯成员访问走 member（免解析），复杂表达式走 expr', () => {
    const src = sfc(`const item = ref({})\nconst n = ref(1)\n`, `<p-view :title="item.name">{{ n + 1 }}</p-view>`)
    const res = buildVaporSubscriptions(src, 'a.vue')
    const forms = res.table.evaluators.map((e) => e.form)
    expect(forms).toContain('member')
    expect(forms).toContain('expr')
  })

  it('★订阅表可 JSON 序列化（方案 §4.4：产物必须可下发，不能是源码字符串）', () => {
    const src = sfc(`const a = ref(1)\n`, `<p-view :style="a" />`)
    const res = buildVaporSubscriptions(src, 'a.vue')
    const json = JSON.stringify(res.table)
    expect(JSON.parse(json)).toEqual(res.table)
    expect(json).not.toContain('=>') // ★不含函数体源码（跨端禁 eval）
  })

  it('★★列表内绑定必须挂到**列表源**（本仓实测：首版漏了 ⇒ 该绑定从依赖图里消失）', () => {
    const src = sfc(
      `const list = ref<{ id: number; title: string }[]>([])\n`,
      `<p-text v-for="item in list" :key="item.id">{{ item.title }}</p-text>`,
    )
    const res = buildVaporSubscriptions(src, 'a.vue')
    const listSrc = res.table.sources.find((s) => s.sourceName === 'list')
    expect(listSrc, '列表源必须出现在订阅表里').toBeTruthy()
    // ★item.title 的槽位必须挂在 list 源上（否则运行时 list 变化不会写这个槽位 = 静默不更新）
    const propKeys = listSrc!.slots.map((x) => x.propKey)
    expect(propKeys).toContain('text.content')
    expect(listSrc!.slots.length).toBeGreaterThan(1)
  })

  it('★v-show 不算运行时分支（节点始终在树内，仅可见性切换）⇒ 仍可 L1', () => {
    const src = sfc(`const ok = ref(true)\n`, `<p-view v-show="ok" />`)
    const res = buildVaporSubscriptions(src, 'a.vue')
    const show = res.decisions.find((d) => d.snippet.includes('v-show'))
    expect(show?.tier).toBe('L1')
  })

  it('★同一 SFC 两次构建产物逐字节一致（可复现）', () => {
    const src = sfc(`const a = ref(1)\nconst b = ref(2)\n`, `<p-view :style="a">{{ b }}</p-view>`)
    expect(JSON.stringify(buildVaporSubscriptions(src, 'a.vue').table)).toBe(
      JSON.stringify(buildVaporSubscriptions(src, 'a.vue').table),
    )
  })
})

describe('V2 Step 6 · 分层判定（★L0/L1 混跑）', () => {
  it('★★同一组件内 L0 与 L1 共存：纯表达式升 L1，v-if 分支内降 L0', () => {
    const src = sfc(
      `const count = ref(0)\nconst ok = ref(true)\n`,
      `<p-view :style="count" />\n<p-text v-if="ok">{{ count }}</p-text>`,
    )
    const res = buildVaporSubscriptions(src, 'a.vue')
    const tiers = res.decisions.map((d) => d.tier)
    expect(tiers).toContain('L1') // :style="count"
    expect(tiers).toContain('L0') // v-if 内
    expect(res.table.stats.l1).toBeGreaterThan(0)
    expect(res.table.stats.l0).toBeGreaterThan(0)
    expect(res.table.stats.l1Rate).toBeGreaterThan(0)
    expect(res.table.stats.l1Rate).toBeLessThan(1)
  })

  it('★函数调用默认降 L0（C1 无法证明纯），@pure 注解可升级', () => {
    const src = sfc(`const ts = ref(0)\nfunction fmt(v: number) { return String(v) }\n`, `<p-view :title="fmt(ts)" />`)
    const l0 = buildVaporSubscriptions(src, 'a.vue')
    expect(l0.decisions[0].tier).toBe('L0')
    const l1 = buildVaporSubscriptions(src, 'a.vue', { pureSymbols: ['fmt'] })
    expect(l1.decisions[0].tier).toBe('L1')
    expect(l1.decisions[0].mark).toBe('⚠') // 人工担保
  })

  it('★动态组件 ⇒ 全文件降级（C3）', () => {
    const src = sfc(`const which = ref('a')\nconst count = ref(1)\n`, `<component :is="which" />\n<p-view :style="count" />`)
    const res = buildVaporSubscriptions(src, 'a.vue')
    // C3 是文件级事实：整个文件的槽位都应降 L0
    expect(res.decisions.every((d) => d.tier === 'L0')).toBe(true)
    expect(res.decisions[0].reason).toContain('C3')
  })

  it('★getCurrentInstance ⇒ 降 L0（C7，方案 §5.4）', () => {
    const src = sfc(`import { getCurrentInstance } from 'vue'\nconst inst = getCurrentInstance()\nconst count = ref(1)\n`, `<p-view :style="count" />`)
    const res = buildVaporSubscriptions(src, 'a.vue')
    expect(res.decisions[0].tier).toBe('L0')
    expect(res.decisions[0].reason).toContain('C7')
  })

  it('★强制降级通道：forceL0Slots 生效（方案 §5.6 反向注解）', () => {
    const src = sfc(`const count = ref(0)\n`, `<p-view :style="count" />`)
    const res = buildVaporSubscriptions(src, 'a.vue', { forceL0Slots: [0] })
    expect(res.decisions[0].tier).toBe('L0')
    expect(res.decisions[0].reason).toContain('人工指定')
  })

  it('★表达式解析失败 ⇒ 该槽位降 L0（不许假设安全）', () => {
    const src = sfc(`const count = ref(0)\n`, `<p-view :style="count +* 1" />`)
    const res = buildVaporSubscriptions(src, 'a.vue')
    expect(res.decisions[0].tier).toBe('L0')
  })

  it('★L1 覆盖率是统计出来的（§10 验收指标）', () => {
    const src = sfc(`const a = ref(1)\n`, `<p-view :style="a" />`)
    const res = buildVaporSubscriptions(src, 'a.vue')
    expect(res.table.stats.l1Rate).toBe(1)
    expect(res.table.stats).toMatchObject({ l1: 1, l0: 0 })
  })
})

describe('V2 · 辅助映射', () => {
  it('★propKey 归一化（与 component-ir 约定对齐）', () => {
    expect(normalizePropKey('style')).toBe('paint.style')
    expect(normalizePropKey('width')).toBe('layout.width')
    expect(normalizePropKey('modelValue')).toBe('text.content')
    expect(normalizePropKey('dataFoo')).toBe('attr.dataFoo')
  })

  it('★propKey → 槽位种类', () => {
    expect(slotKindOf('text.content')).toBe('text')
    expect(slotKindOf('text.color')).toBe('style')
    expect(slotKindOf('layout.width')).toBe('style')
    expect(slotKindOf('visible')).toBe('visibility')
    expect(slotKindOf('list.items')).toBe('list-data')
    expect(slotKindOf('attr.foo')).toBe('prop')
  })
})
