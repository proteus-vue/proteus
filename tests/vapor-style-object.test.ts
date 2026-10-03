// tests/vapor-style-object.test.ts —— ★★★`:style` 对象字面量逐键展开判据（2026-10-03）
//
// 【这一批修的是什么（本仓实测的静默失效）】`<p-text :style="{ width: w, color: c }">` 此前
//   产出**两条都叫 `paint.style` 的槽位**（同键、各带一个成员的求值器）——而内核 `SET_STYLE`
//   只认**字段级键**（`layout.width` / 内核登记的 17 个），`paint.style` 整键被归 paint-only 后
//   **忽略** ⇒ 宽度与颜色**都不生效**；更糟的是模板侧诊断声称"由订阅表以 SET_STYLE 逐键下发"
//   （**假承诺**——它并没有逐键）。
//
// 【这一批交出什么】静态键在编译期展开：
//   · 布局数值键 ⇒ `layout.<field>`（内核真改几何）；
//   · 绘制键 ⇒ `paint.<field>`（**值由桥转给宿主**——内核 f32 通道装不下颜色字符串；
//     见 slot-runtime 的 onPaintProp 注释）；
//   · **全字面量对象** ⇒ 折进静态 style（零槽位——与 `style="…"` 等价，比建槽位更省）。
//
// 【判据打在三处】① 逐键展开（键名 + 值表达式各自独立）；② 常量折叠 + 零槽位；
//   ③ 诊断如实（变量形态/计算键/展开/嵌套/不支持键——五类各有精确文案，不再假承诺）。

import { describe, it, expect } from 'vitest'
import { buildLayoutTemplate, buildVaporSubscriptions } from '@proteus-vue/compiler'
import { mapStyleObjectKey, parseStyleObject, stripUnitConcat } from '../packages/compiler/src/vapor/style-object'

const sfc = (tpl: string, script = 'const w = ref(100)\nconst c = ref("#fff")\n'): string =>
  `<template>\n${tpl}\n</template>\n\n<script setup lang="ts">\n${script}\n</script>\n`

describe('★:style 对象 · 逐键展开（核心修复）', () => {
  it('`{ width: w, color: c }` ⇒ **两条独立槽位**：layout.width（内核）+ paint.color（宿主通道）', () => {
    const src = sfc(`<p-view :style="{ width: w, color: c }" style="height: 10px"></p-view>`)
    const sub = buildVaporSubscriptions(src, 's.vue').table
    const keys = sub.sources.flatMap((x) => x.slots.map((sl) => `${sl.nodeId}:${sl.propKey}`)).sort()
    expect(keys).toEqual(['0:layout.width', '0:paint.color'])
    // ★回归锁：**不得**再有 `paint.style` 整键（那是内核不认的形态）
    expect(keys.some((k) => k.endsWith('paint.style'))).toBe(false)
    // 两个成员的值表达式各自独立（w 与 c 分别是两个源）
    const names = sub.sources.map((x) => x.sourceName).sort()
    expect(names).toEqual(['c', 'w'])
  })

  it('kebab 键与单位拼接都归一（`font-size: 12` / `:style="{width: w + \'px\'}"`）', () => {
    const sub = buildVaporSubscriptions(sfc(`<p-view :style="{ 'font-size': w }"></p-view>`), 's.vue').table
    expect(sub.sources.flatMap((x) => x.slots.map((sl) => sl.propKey))).toEqual(['paint.fontSize'])
    expect(stripUnitConcat("w + 'px'"), '单位后缀被剥掉（内核要 f32）').toBe('w')
  })

  it('★行内（v-for 内）：仍走 list-item 槽位但**键正确**', () => {
    const src = sfc(`<p-view><p-text v-for="it in list" :key="it.id" :style="{ width: it.w }">x</p-text></p-view>`,
      'const list = ref([{ id: 1, w: 10 }])\n')
    const sub = buildVaporSubscriptions(src, 's.vue').table
    const itemSlots = sub.sources.flatMap((x) => x.slots).filter((sl) => sl.kind === 'list-item')
    expect(itemSlots.map((sl) => sl.propKey)).toEqual(['layout.width'])
  })
})

describe('★:style 对象 · 常量折叠（零槽位）', () => {
  it('全字面量对象 ⇒ 折进**静态 style**（无槽位——与 style="…" 等价）', () => {
    const t = buildLayoutTemplate(sfc(`<p-view :style="{ width: 100, color: '#fff' }" style="height: 10px"></p-view>`), 's.vue')
    expect(t.template.nodes[0]!.style).toMatchObject({ width: 100, color: '#fff', height: 10 })
    const sub = buildVaporSubscriptions(sfc(`<p-view :style="{ width: 100, color: '#fff' }"></p-view>`), 's.vue').table
    expect(sub.sources, '零槽位').toHaveLength(0)
    expect(sub.constantSlots ?? [], '也不进常量槽位（静态样式已给值）').toHaveLength(0)
  })

  it('★混合（部分字面量 + 部分表达式）⇒ 表达式成员展开；字面量成员由**展开的槽位**覆盖', () => {
    const sub = buildVaporSubscriptions(sfc(`<p-view :style="{ width: w, color: '#f00' }"></p-view>`), 's.vue').table
    const keys = sub.sources.flatMap((x) => x.slots.map((sl) => sl.propKey))
    // 表达式成员（width）展开为**源驱动槽位**；字面量成员（color）展开为**常量槽位**
    expect(keys).toContain('layout.width')
    const consts = (sub.constantSlots ?? []).map((sl) => sl.propKey)
    expect(consts).toContain('paint.color')
  })
})

describe('★:style 对象 · 诊断如实（不假承诺）', () => {
  const codes = (tpl: string, script?: string): string[] =>
    buildLayoutTemplate(sfc(tpl, script), 's.vue').diagnostics.map((d) => d.code)

  it('变量形态 ⇒ VAPOR_STYLE_DYNAMIC_OBJECT（说明"键名编译期不可知" + 给替代路径）', () => {
    const t = buildLayoutTemplate(sfc(`<p-view :style="s"></p-view>`, 'const s = ref({})\n'), 's.vue')
    const d = t.diagnostics.find((x) => x.code === 'VAPOR_STYLE_DYNAMIC_OBJECT')!
    expect(d.message).toContain('键名编译期不可知')
    expect(d.hint).toContain('对象字面量')
  })

  it('计算键 / 展开 / 嵌套对象 ⇒ 各自诊断', () => {
    expect(codes(`<p-view :style="{ [w]: 1 }"></p-view>`)).toContain('VAPOR_STYLE_OBJECT_UNSUPPORTED')
    expect(codes(`<p-view :style="{ ...base }"></p-view>`, 'const base = ref({})\n')).toContain('VAPOR_STYLE_OBJECT_UNSUPPORTED')
    expect(codes(`<p-view :style="{ margin: { top: 1 } }"></p-view>`)).toContain('VAPOR_STYLE_OBJECT_UNSUPPORTED')
  })

  it('不支持的键（字符串类布局值 / 未知字段）⇒ VAPOR_STYLE_KEY_UNSUPPORTED（列出受支持键）', () => {
    const t = buildLayoutTemplate(sfc(`<p-view :style="{ flexDirection: w }"></p-view>`), 's.vue')
    const d = t.diagnostics.find((x) => x.code === 'VAPOR_STYLE_KEY_UNSUPPORTED')!
    expect(d.message).toContain('flexDirection')
    expect(d.hint).toContain('backgroundColor')   // 列出可用键
  })

  it('★回归锁：**不再**出现旧的笼统"逐键下发"假承诺文案', () => {
    const t = buildLayoutTemplate(sfc(`<p-view :style="s"></p-view>`, 'const s = ref({})\n'), 's.vue')
    expect(t.diagnostics.some((x) => x.message.includes('由订阅表以 SET_STYLE 逐键下发'))).toBe(false)
  })

  it('★反向：既有的单键拼接形态（`\'width:\' + w + \'px\'`）**零诊断**且照常工作', () => {
    const t = buildLayoutTemplate(sfc(`<p-view :style="'width:' + w + 'px'"></p-view>`), 's.vue')
    expect(t.diagnostics, '拼接形态此前被误报为 warn——现在零诊断').toHaveLength(0)
    const sub = buildVaporSubscriptions(sfc(`<p-view :style="'width:' + w + 'px'"></p-view>`), 's.vue').table
    expect(sub.sources.flatMap((x) => x.slots.map((sl) => sl.propKey))).toEqual(['layout.width'])
  })
})

describe('★:style 对象 · 解析器单元（style-object）', () => {
  it('parseStyleObject：静态键可析出、值源码正确切片', () => {
    const r = parseStyleObject("{ width: w, color: c }")!
    expect(r.entries.map((e) => `${e.key}=${e.valueSrc}`)).toEqual(['width=w', 'color=c'])
    expect(r.problems).toHaveLength(0)
  })

  it('mapStyleObjectKey：布局/绘制两类映射 + 未知键为 null（唯一映射表）', () => {
    expect(mapStyleObjectKey('width')).toBe('layout.width')
    expect(mapStyleObjectKey('min-width')).toBe('layout.minWidth')
    expect(mapStyleObjectKey('backgroundColor')).toBe('paint.backgroundColor')
    expect(mapStyleObjectKey('border-radius')).toBe('paint.borderRadius')
    expect(mapStyleObjectKey('flexDirection'), '字符串类布局值不可动态').toBeNull()
    expect(mapStyleObjectKey('nonsense')).toBeNull()
  })

  it('★反向：非对象字面量 ⇒ parseStyleObject 返 null（调用方走既有路径）', () => {
    expect(parseStyleObject('s')).toBeNull()
    expect(parseStyleObject("'width:' + w")).toBeNull()
  })
})
