// tests/vapor-sfc-to-tree.test.ts
// ★★V4 收官判据：**全量 SFC → 端上节点树**（编译器两件产物协同，此前从未跑通）
//
// 【这条链此前断在哪（本仓实测）】V3/V4 的设备验证用**手写节点数组**
//   （`largeNodes` 里 id/parentId/style 一行行写死）；编译器只产出订阅表。
//   ⇒ 节点树从未由 SFC 生成过 ⇒ "Vapor 能替换 Vue 运行时"这件事**缺最后一环证据**。
//
// 【本文件的判据分三层】
//   ① **id 同源**：模板产物的节点 id == 订阅表的 nodeId 空间
//      （分叉的后果：指令写到别的节点上，症状伪装成几何错——本仓已踩过一次）
//   ② **实例化正确**：v-for 展开 N 行；首行用模板序 id、新增行顺序分配；父子链正确
//   ③ **注册表回填**：行内槽位 (listId,itemKey,itemSlotId) → **实际行节点 id**
//      ⇒ 行内更新发普通 SET_STYLE（而不是回退 LIST_UPDATE）
import { describe, it, expect } from 'vitest'
import { buildVaporSubscriptions, buildLayoutTemplate } from '@proteus-vue/compiler'
import { ListRegistry, OpCode, PropKeyTable, StringPool, SlotRuntime, VaporRuntime, decodeOps, instantiateTemplate } from '@proteus-vue/slot-runtime'
import { resolveDynamicClasses } from '@proteus-vue/slot-runtime'
import type { EvalContext } from '@proteus-vue/slot-runtime'
import type { LayoutTemplate, SubscriptionTable } from '@proteus-vue/slot-runtime'

const sfc = (script: string, template: string): string =>
  `<template>\n${template}\n</template>\n\n<script setup lang="ts">\n${script}\n</script>\n`

/** 一个「页面 + 标题 + 列表行」的真实形态 SFC（静态样式走字符串、动态走绑定） */
const LIST_SFC = sfc(
  `const list = ref([{ id: 1, w: 10, title: 'a' }])\nconst pad = ref(16)\n`,
  `<p-view style="flex-direction: column; padding-top: 60px; background-color: #101020">\n` +
    `  <p-text style="font-size: 24px; color: #ffffff">标题</p-text>\n` +
    `  <p-view v-for="item in list" :key="item.id" style="height: 56px; flex-shrink: 0; margin-bottom: 8px">\n` +
    `    <p-text :width="item.w" style="color: #fff">{{ item.title }}</p-text>\n` +
    `  </p-view>\n` +
    `</p-view>`,
)

describe('V4 · ★全量 SFC → 模板产物', () => {
  it('★★① 模板静态样式解析为**引擎字段**（字符串样式此前完全没进过 IR）', () => {
    const res = buildLayoutTemplate(LIST_SFC, 'list.vue')
    expect(res.ok, `模板应可用；诊断：${res.diagnostics.map((d) => d.message).join(' | ')}`).toBe(true)
    const page = res.template.nodes.find((n) => n.id === 0)!
    expect(page.style.flexDirection).toBe('column')
    // ★边值形状与适配器 `foldEdges` **同约定**：只写出现过的边，缺省边由引擎按 0 处理
    //   （锁定这一点是因为两份产物的形状分叉过 ⇒ 首帧与补丁对不齐，且不报错）
    expect(page.style.padding).toEqual({ top: 60 })
    expect(page.style.backgroundColor).toBe('#101020')
    const title = res.template.nodes.find((n) => n.tag === 'p-text')!
    expect(title.style.fontSize).toBe(24)
    expect(title.style.color).toBe('#ffffff')
    expect(title.text, '静态文本应进占位（运行时不必求值）').toBe('标题')
  })

  it('★★② 节点 id 与订阅表**同源**（分叉 ⇒ 指令写错节点）', () => {
    const tpl = buildLayoutTemplate(LIST_SFC, 'list.vue').template
    const { table } = buildVaporSubscriptions(LIST_SFC, 'list.vue')
    const slotNodeIds = new Set(table.sources.flatMap((s) => s.slots).map((x) => x.nodeId))
    const tplIds = new Set(tpl.nodes.map((n) => n.id))
    // ★根节点必须是 **0**（单根模板；id 从 0 起是两件产物共同的起点约定）
    //   破坏性验证实测：只查"槽位 id ⊆ 模板 id"**抓不到**整体偏移（都落在范围内但指向别的节点）
    //   ⇒ 必须有能判"**指向对不对**"的断言，见下方 tag 检查。
    expect(tplIds.has(0), '模板必须有 id=0 的根（与订阅表同起点）').toBe(true)
    // ★每个槽位的 nodeId 必须命中模板里的某个节点
    for (const id of slotNodeIds) {
      expect(tplIds.has(id), `槽位 nodeId=${id} 不在模板节点集合里（两件产物 id 空间分叉）`).toBe(true)
    }
    // ★★语义判据：槽位的目标节点 **tag 必须匹配**（这才真正抓得住整体偏移）
    //   `:width="item.w"` 写在 p-text 上 ⇒ 它的 nodeId 必须指向一个 p-text，
    //   而不是"范围内任意一个 id"（偏移 +1 时会指向 p-view ⇒ 该断言必红）。
    const widthSlot = table.sources.flatMap((s) => s.slots).find((x) => x.kind === 'list-item' && x.propKey === 'layout.width')!
    const widthTarget = tpl.nodes.find((n) => n.id === widthSlot.nodeId)!
    expect(widthTarget, `槽位 nodeId=${widthSlot.nodeId} 应指向模板节点`).toBeTruthy()
    expect(widthTarget.tag, '`:width` 的目标应是 p-text（而非偏移后的容器）').toBe('p-text')
    // 模板里的 v-for 行根也必须命中（它是行内槽位的锚）
    const listMeta = tpl.lists[0]!
    expect(tplIds.has(listMeta.rowRootId)).toBe(true)
  })

  it('★③ v-for 行模板与订阅表的 listId 对齐（各自独立分配 ⇒ 必须同序）', () => {
    const tpl = buildLayoutTemplate(LIST_SFC, 'list.vue').template
    const { table } = buildVaporSubscriptions(LIST_SFC, 'list.vue')
    const slotListIds = [...new Set(table.sources.flatMap((s) => s.slots).filter((x) => x.kind === 'list-item').map((x) => x.listId!))]
    expect(tpl.lists.map((l) => l.listId)).toEqual(slotListIds)
    // 行子树包含行根 + 其内的文本节点（模板序连续）
    const meta = tpl.lists[0]!
    expect(meta.subtreeIds).toContain(meta.rowRootId)
    expect(meta.subtreeIds.length).toBeGreaterThanOrEqual(2)
  })

  it('★④ 不支持的模板形态 ⇒ **诊断而非静默**（混合文本）+ ★嵌套 v-for **已支持**（P2 批次）', () => {
    // ★★2026-10-03 能力提升（P2 批次）：嵌套 v-for 从"诊断拒绝"改为**真支持**——
    //   本用例随之改判：**零诊断 + 产物含 parentListId/outerScope 的嵌套结构**。
    const nested = sfc(
      `const l1 = ref([{ id: 1, l2: [{ id: 2, name: 'x' }] }])\n`,
      `<p-view v-for="a in l1" :key="a.id"><p-text v-for="b in a.l2" :key="b.id">{{ b.name }}</p-text></p-view>`,
    )
    const r1 = buildLayoutTemplate(nested, 'n.vue')
    expect(
      r1.diagnostics.some((d) => d.message.includes('嵌套 v-for')),
      '嵌套 v-for 已支持（P2）——不应再报"未支持"诊断',
    ).toBe(false)
    const inner = (r1.template.lists || []).find((l) => l.parentListId !== undefined)
    expect(inner, '内层列表必须带 parentListId（运行时按外层行递归实例化）').toBeDefined()
    expect(inner!.outerScope, '内层必须记录外层作用域名（嵌套求值 `a.l2` 的 `a`）').toBe('a')
    expect(inner!.sourceField, '内层行集从外层行字段下钻（a.l2 ⇒ l2）').toBe('l2')
    const outer = (r1.template.lists || []).find((l) => l.parentListId === undefined)
    expect(outer!.listId, '内层 parentListId 必须指到外层（同源分配）').toBe(inner!.parentListId)
    // ★★子树**不合并**（本仓实测的纠正）：若外层 subtreeIds 含内层节点，外层克隆会为它
    //   分配一个"占位实例"、内层递归再分配真实实例 ⇒ 重复 id / 假节点。
    //   内层节点的产出者**唯一**：内层自己的 cloneRow（经 parentListId 递归触发）。
    expect(outer!.subtreeIds, '外层子树只含行根自身（内层节点归内层列表）').toEqual([outer!.rowRootId])
    expect(inner!.subtreeIds).toContain(inner!.rowRootId)

    // 反向：★混合文本（P2-2 之前"必须上报"）——**2026-10-03 起已支持** ⇒ 判据改为：
    //   零诊断 + 产物带 textSegments 段表（静态段 + 表达式段）
    const mixed = sfc(`const n = ref(1)\n`, `<p-text style="color: #fff">前缀{{ n }}</p-text>`)
    const r2 = buildLayoutTemplate(mixed, 'm.vue')
    expect(
      r2.diagnostics.some((d) => d.message.includes('文本/插值')),
      '混合文本已支持（P2-2）——不应再报"未支持"诊断',
    ).toBe(false)
    const mixedNode = r2.template.nodes.find((n) => n.tag === 'p-text')!
    expect(mixedNode.textSegments, '混合文本必须产出段表（静态段 + 表达式段）').toBeDefined()
    expect(mixedNode.textSegments!.map((s) => ('text' in s ? s.text : `<expr:${s.src}>`)))
      .toEqual(['前缀', '<expr:n>'])
  })

  it('★⑤ 百分比宽高 → **比例字段**（widthRatio / heightRatio——单位模型在模板产物里的一环）', () => {
    // 【为什么必须有（2026-10-02 实测抓出的跨端形态差）】`width: 100%` 是"内容随屏宽、
    //   左右留白恒定"的标准写法；此前对百分比**直接丢弃 + 诊断**（"只支持 px/数字"）
    //   ⇒ 同一份 SFC：Web/MP 走 CSS 引擎正常流式，到 Vapor 链就静默变无宽度。
    //   本判据锁定：① 映射为 ratio（不是数值——百分比没有密度可乘）；
    //   ② 不再报"不是纯数值"诊断；③ 非宽高属性的百分比仍如实诊断（边界不扩大）。
    const pct = sfc(
      `const n = ref(1)\n`,
      `<p-view style="width: 100%; height: 50%; padding-top: 4px">\n` +
        `  <p-view style="width: 60.5%; height: 40px; margin-left: 5%"></p-view>\n` +
        `</p-view>`,
    )
    const r = buildLayoutTemplate(pct, 'pct.vue')
    const root = r.template.nodes.find((n) => n.id === 0)!
    expect(root.style.widthRatio, 'width: 100% → widthRatio: 1').toBe(1)
    expect(root.style.heightRatio, 'height: 50% → heightRatio: 0.5').toBe(0.5)
    const child = r.template.nodes.find((n) => n.id === 1)!
    expect(child.style.widthRatio, 'width: 60.5% → widthRatio: 0.605').toBeCloseTo(0.605, 5)
    expect(child.style.height, 'px 混用不受影响').toBe(40)
    // 宽高百分比不再触发"不是纯数值"诊断（逐条核对：只有宽高这两处受影响）
    const numDiags = r.diagnostics.filter((d) => d.message.includes('不是纯数值'))
    expect(
      numDiags.some((d) => /width: 100%|height: 50%|width: 60\.5%/.test(d.message)),
      `宽高百分比不应再诊断：${numDiags.map((d) => d.message).join(' | ')}`,
    ).toBe(false)
    // ★边界：margin 的百分比仍不支持（该形态各端语义复杂，本版不扩大）
    expect(
      r.diagnostics.some((d) => d.message.includes('margin-left: 5%')),
      'margin 百分比仍应如实诊断（能力边界不扩大）',
    ).toBe(true)
  })
})

describe('★批次 30 · 动态 :class（对齐 Web · 削减胶水）', () => {
  const DYN_SFC = [
    '<template><view class="base" :class="{ on: open }"><text>x</text></view></template>',
    '<script setup>import { ref } from \'vue\'\nconst open = ref(true)</script>',
    '<style>\n.base { padding: 4px }\n.on { background-color: #ff0000; border-radius: 8px }\n</style>',
  ].join('\n')
  const data: Record<string, unknown> = { open: true }
  const read = (n: string): unknown => data[n]

  it('① 编译器投影：只投影**自匹配纯类**规则（.base / .on）', () => {
    const { table } = buildVaporSubscriptions(DYN_SFC, 'dyn.vue')
    expect(Array.isArray(table.classRules), '有动态 :class ⇒ 发射 classRules').toBe(true)
    const cls = (table.classRules ?? []).map((r) => r.classes.join('.'))
    expect(cls).toContain('base')
    expect(cls).toContain('on')
  })

  it('② 运行期解析：对象/数组/字符串三形态', () => {
    const rules = buildVaporSubscriptions(DYN_SFC, 'dyn.vue').table.classRules ?? []
    expect(resolveDynamicClasses({ on: true }, rules)).toEqual({ backgroundColor: '#ff0000', borderRadius: 8 })
    expect(resolveDynamicClasses({ on: false }, rules), '关掉 ⇒ 空').toEqual({})
    expect(resolveDynamicClasses(['on'], rules)).toEqual({ backgroundColor: '#ff0000', borderRadius: 8 })
    expect(resolveDynamicClasses('on', rules)).toEqual({ backgroundColor: '#ff0000', borderRadius: 8 })
  })

  it('③ 首帧回填：open=true ⇒ 节点带 on 类字段', () => {
    const tpl = buildLayoutTemplate(DYN_SFC, 'dyn.vue').template
    const { table } = buildVaporSubscriptions(DYN_SFC, 'dyn.vue')
    const inst = instantiateTemplate(tpl, { viewport: { width: 390, height: 844 }, read, table, registry: new ListRegistry() })
    const root = inst.nodes.find((n) => n.id === 0)!
    expect((root as { backgroundColor?: string }).backgroundColor, '动态类 on ⇒ 背景红（首帧）').toBe('#ff0000')
    expect((root as { borderRadius?: number }).borderRadius, '动态类 on ⇒ 圆角 8').toBe(8)
  })

  it('④ 运行期写：open 翻转 ⇒ 下发 / 清除字段（onPaintProp 记录）', () => {
    const { table } = buildVaporSubscriptions(DYN_SFC, 'dyn.vue')
    const rt = new SlotRuntime(new PropKeyTable(), new StringPool(), () => {})
    const log: Array<[number, string, unknown]> = []
    const vapor = new VaporRuntime(
      table, rt, VaporRuntime.buildEvaluators(table.evaluators), new ListRegistry(),
      undefined, 0, undefined, (id, key, val) => log.push([id, key, val]),
    )
    vapor.writeSlotsOfSource('open', { read })
    expect(log.some(([, k, v]) => k === 'paint.backgroundColor' && v === '#ff0000'), 'open=true ⇒ 下发背景红').toBe(true)
    log.length = 0
    data.open = false
    vapor.writeSlotsOfSource('open', { read })
    expect(log.some(([, k, v]) => k === 'paint.backgroundColor' && v === undefined), 'open=false ⇒ 清除背景').toBe(true)
  })

  it('⑥ ★B3a：动态 :class 的**数值布局字段**走内核 SET_STYLE（非 onPaintProp）', () => {
    const SFC = "<template><view :class=\"{ on: x }\">x</view></template>\n<script setup>const x=ref(1)</script>\n<style>.on{width:200px;padding-top:4px;flex-grow:1}</style>"
    const { table } = buildVaporSubscriptions(SFC, 'b3a.vue')
    const rt = new SlotRuntime(new PropKeyTable(), new StringPool(), () => {})
    const paintLog: Array<[number, string, unknown]> = []
    const vapor = new VaporRuntime(
      table, rt, VaporRuntime.buildEvaluators(table.evaluators), new ListRegistry(),
      undefined, 0, undefined, (id, key, val) => paintLog.push([id, key, val]),
    )
    const dataX = { x: true }
    vapor.writeSlotsOfSource('x', { read: (n: string) => (dataX as Record<string, unknown>)[n] } as never)
    // 内核指令（缓冲快照）里应有 layout.width / layout.paddingTop / layout.flexGrow（数值来自 plan 描述符）
    const snap = rt.buffer.snapshot() as Array<{ op: number; nodeId?: number; keyId?: number; value?: number }>
    const keyOf = (id: number | undefined) => (id === undefined ? undefined : rt.keys.keyOf(id))
    const styleOps = snap.filter((o) => o.op === 2 /* SET_STYLE */)
    const byKey = new Map(styleOps.map((o) => [keyOf(o.keyId), o.value]))
    expect(byKey.get('layout.width'), '数值布局字段 width ⇒ 内核 SET_STYLE(200)').toBe(200)
    expect(byKey.get('layout.paddingTop'), 'padding-top ⇒ SET_STYLE(4)').toBe(4)
    expect(byKey.get('layout.flexGrow'), 'flex-grow ⇒ SET_STYLE(1)').toBe(1)
    // ★反证：数值布局字段**不进** onPaintProp（此前误走绘制通道 ⇒ 端上不生效）
    expect(paintLog.some(([, k]) => k === 'paint.width' || k === 'paint.paddingTop'), '数值布局字段不得走绘制通道').toBe(false)
  })

  it('⑦ ★B3b/B3c：动态 :class 的**枚举布局字段**走内核 SET_STYLE（索引编码）', () => {
    const SFC = "<template><view :class=\"{ on: x }\">x</view></template>\n<script setup>const x=ref(1)</script>\n<style>.on{display:grid;flex-direction:row;align-items:center;justify-content:center;align-self:end}</style>"
    const { table } = buildVaporSubscriptions(SFC, 'b3b.vue')
    const rt = new SlotRuntime(new PropKeyTable(), new StringPool(), () => {})
    const vapor = new VaporRuntime(table, rt, VaporRuntime.buildEvaluators(table.evaluators), new ListRegistry())
    const dataX = { x: true }
    vapor.writeSlotsOfSource('x', { read: (n: string) => (dataX as Record<string, unknown>)[n] } as never)
    const snap = rt.buffer.snapshot() as unknown as Array<{ op: number; keyId?: number; value?: number }>
    const byKey = new Map(snap.filter((o) => o.op === 2).map((o) => [o.keyId === undefined ? undefined : rt.keys.keyOf(o.keyId), o.value]))
    // 索引编码：display grid=1 · flexDirection row=0 · alignItems center=7 · justifyContent center=4 · alignSelf end=4
    expect(byKey.get('layout.display'), 'display:grid ⇒ 索引 1').toBe(1)
    expect(byKey.get('layout.flexDirection'), 'flex-direction:row ⇒ 索引 0').toBe(0)
    expect(byKey.get('layout.alignItems'), 'align-items:center ⇒ 索引 7').toBe(7)
    expect(byKey.get('layout.justifyContent'), 'justify-content:center ⇒ 索引 4').toBe(4)
    expect(byKey.get('layout.alignSelf'), 'align-self:end ⇒ 索引 4').toBe(4)
  })

  it('⑧ ★B3d：动态 :class 的**字符串布局字段**（grid 模板）走内核 SET_STYLE_STR', () => {
    // 该 class 同时含数值（gap）与字符串（grid-template-columns）字段：
    //   · 数值字段进 CSE 计划（bitmap）；字符串字段不在计划里 ⇒ 运行期必须从**线性规则**补
    //   断言：两条通道都下发（SET_STYLE_STR 带字符串池引用、值可反查）。
    const SFC = "<template><view :class=\"{ on: x }\">x</view></template>\n<script setup>const x=ref(1)</script>\n<style>.on{grid-template-columns:1fr 200px;width:200px}</style>"
    const { table } = buildVaporSubscriptions(SFC, 'b3d.vue')
    const rt = new SlotRuntime(new PropKeyTable(), new StringPool(), () => {})
    const vapor = new VaporRuntime(table, rt, VaporRuntime.buildEvaluators(table.evaluators), new ListRegistry())
    const dataX = { x: true }
    vapor.writeSlotsOfSource('x', { read: (n: string) => (dataX as Record<string, unknown>)[n] } as never)
    const snap = rt.buffer.snapshot() as unknown as Array<{ op: number; keyId?: number; valueRef?: number; value?: number }>
    const keyOf = (id: number | undefined) => (id === undefined ? undefined : rt.keys.keyOf(id))
    // 数值通道：width 走 SET_STYLE（op=2，来自 CSE 计划）
    const byKey = new Map(snap.filter((o) => o.op === 2).map((o) => [keyOf(o.keyId), o.value]))
    expect(byKey.get('layout.width'), 'width 走数值 SET_STYLE(200)').toBe(200)
    // 字符串通道：grid-template-columns 走 SET_STYLE_STR（op=0x06），值可反查
    const strOps = snap.filter((o) => o.op === 6)
    expect(strOps.length, 'grid 模板字段必须下发 SET_STYLE_STR').toBeGreaterThan(0)
    const gridOp = strOps.find((o) => keyOf(o.keyId) === 'layout.gridTemplateColumns')!
    expect(gridOp, 'SET_STYLE_STR 键应为 layout.gridTemplateColumns').toBeTruthy()
    expect(rt.strings.valueOf(gridOp.valueRef!), '字符串池可反查 grid 模板值').toBe('1fr 200px')
  })

  it('⑤ 诚实边界：动态 :class 的**数值/枚举/字符串**布局字段已支持（B3a/B3b/B3d）；**白空格**等仍诊断', () => {
    const P = "<template><view :class=\"{ on: x }\">x</view></template>\n<script setup>const x=ref(1)</script>\n"
    const sfcPaint = P + '<style>.on{background-color:#f00}</style>'
    // ★B3a：数值布局字段（width/margin*/padding*/flex*…）走内核 SET_STYLE ⇒ 无诊断
    const sfcNum = P + '<style>.on{width:200px;padding-top:4px;flex-grow:1}</style>'
    // ★B3b：枚举布局字段（display/flexDirection/alignItems…）走内核 SET_STYLE 索引编码 ⇒ 无诊断
    const sfcEnum = P + '<style>.on{flex-direction:row;display:grid;align-items:center}</style>'
    // ★B3d：字符串布局字段（grid 模板 token 串）走内核 SET_STYLE_STR ⇒ 无诊断
    const sfcStr = P + '<style>.on{grid-template-columns:1fr 1fr;grid-auto-rows:80px}</style>'
    // 仍无二进制通道的布局字段（white-space 需内核文本建模）⇒ 仍诊断
    const sfcUnsup = P + '<style>.on{white-space:nowrap}</style>'
    const codesOf = (sfc: string, f: string) => buildVaporSubscriptions(sfc, f).diagnostics.map((d) => d.code)
    expect(codesOf(sfcPaint, 'p.vue'), '绘制字段 ⇒ 无诊断').not.toContain('VAPOR_DYNCLASS_LAYOUT_UNSUPPORTED')
    expect(codesOf(sfcNum, 'n.vue'), '数值布局字段已支持（B3a）⇒ 无诊断').not.toContain('VAPOR_DYNCLASS_LAYOUT_UNSUPPORTED')
    expect(codesOf(sfcEnum, 'e.vue'), '枚举布局字段已支持（B3b）⇒ 无诊断').not.toContain('VAPOR_DYNCLASS_LAYOUT_UNSUPPORTED')
    expect(codesOf(sfcStr, 's.vue'), 'grid 模板字段已支持（B3d）⇒ 无诊断').not.toContain('VAPOR_DYNCLASS_LAYOUT_UNSUPPORTED')
    expect(codesOf(sfcUnsup, 'w.vue'), 'white-space ⇒ 仍诊断').toContain('VAPOR_DYNCLASS_LAYOUT_UNSUPPORTED')
  })
})

describe('V4 · ★★SFC 产物 → 实例化成端上节点树', () => {
  const data = {
    list: [
      { id: 1, w: 10, title: 'a' },
      { id: 2, w: 20, title: 'b' },
      { id: 3, w: 30, title: 'c' },
    ],
    pad: 16,
  }
  const read = (n: string): unknown => (data as Record<string, unknown>)[n]

  function build(): { tpl: LayoutTemplate; table: SubscriptionTable } {
    const tpl = buildLayoutTemplate(LIST_SFC, 'list.vue').template
    const { table } = buildVaporSubscriptions(LIST_SFC, 'list.vue')
    return { tpl, table }
  }

  it('★★① 3 行数据 ⇒ 展开 3 行；首行复用模板 id、新增行顺序分配', () => {
    const { tpl, table } = build()
    const reg = new ListRegistry()
    const inst = instantiateTemplate(tpl, { viewport: { width: 390, height: 844 }, read, table, registry: reg })
    const meta = tpl.lists[0]!
    // 首行按模板序 id 出现（与订阅表同源 ⇒ 行内指令能命中）
    expect(inst.nodes.some((n) => n.id === meta.rowRootId), '首行必须复用模板 id').toBe(true)
    // 3 行 ⇒ 行根共 3 个（首行 + 2 个新分配）
    const rowRootIds = [meta.rowRootId, meta.rowRootId + meta.subtreeIds.length, meta.rowRootId + meta.subtreeIds.length * 2]
    for (const rid of rowRootIds) expect(inst.nodes.some((n) => n.id === rid), `行根 ${rid} 应存在`).toBe(true)
    expect(inst.stats.allocatedIds).toBeGreaterThan(0)
    // 新增行 id 必须**不与静态节点冲突**（> 模板最大 id）
    const maxTpl = Math.max(...tpl.nodes.map((n) => n.id))
    for (const n of inst.nodes) {
      if (!tpl.nodes.some((t) => t.id === n.id)) {
        expect(n.id).toBeGreaterThan(maxTpl)
      }
    }
  })

  it('★★② 行内槽位在注册表里解析到**实际行节点**（⇒ 发普通 SET_STYLE 而非 LIST_UPDATE）', () => {
    const { tpl, table } = build()
    const reg = new ListRegistry()
    instantiateTemplate(tpl, { viewport: { width: 390, height: 844 }, read, table, registry: reg })
    const itemSlot = table.sources.flatMap((s) => s.slots).find((x) => x.kind === 'list-item' && x.propKey === 'layout.width')!
    // 第 2 行（itemKey='2'）必须解析到一个**真实存在的节点**
    const node2 = reg.resolveNode(itemSlot.listId!, '2', itemSlot.itemSlotId!)
    expect(node2, '第 2 行的宽度槽位必须能解析到节点').toBeDefined()
    const all = instantiateTemplate(tpl, { viewport: { width: 390, height: 844 }, read, table })
    expect(all.nodes.some((n) => n.id === node2), '解析出的节点必须在实例树里').toBe(true)
    // ★不同行 ⇒ 不同节点（不串行）
    const node1 = reg.resolveNode(itemSlot.listId!, '1', itemSlot.itemSlotId!)!
    const node3 = reg.resolveNode(itemSlot.listId!, '3', itemSlot.itemSlotId!)!
    expect(new Set([node1, node2, node3]).size).toBe(3)
  })

  it('★★③ 展开的树**父子链完整**（每个 parentId 都能在树里找到，根为 null）', () => {
    const { tpl, table } = build()
    const inst = instantiateTemplate(tpl, { viewport: { width: 390, height: 844 }, read, table })
    const ids = new Set(inst.nodes.map((n) => n.id))
    for (const n of inst.nodes) {
      if (n.parentId !== null) {
        expect(ids.has(n.parentId), `节点 ${n.id} 的父 ${n.parentId} 不在树里`).toBe(true)
      }
    }
    const roots = inst.nodes.filter((n) => n.parentId === null)
    expect(roots.length).toBeGreaterThanOrEqual(1)
  })

  it('★★⑤ **初始值必须回填**（不回填 ⇒ 首帧文本为空、几何错，且无报错）', () => {
    // 【为什么必须锁定（本仓实测的真缺口）】插值文本的模板占位是**空串**
    //   （编译期不知道数据）。若实例化不回填、而调用方又丢弃首帧指令
    //   （"值已对"的常见假设），屏幕上**文本永远为空**——结构全对、零报错。
    //   ⇒ 判据：实例化产出的节点里，**行内文本槽位对应的节点 text 非空**、
    //     且 `:width` 对应的节点 style.width 已是数据值。
    const { tpl, table } = build()
    const inst = instantiateTemplate(tpl, { viewport: { width: 390, height: 844 }, read, table })
    const itemSlots = table.sources.flatMap((s) => s.slots).filter((x) => x.kind === 'list-item')
    const titleSlot = itemSlots.find((x) => x.propKey === 'text.content')!
    const widthSlot = itemSlots.find((x) => x.propKey === 'layout.width')!
    // 首行用模板 id ⇒ 直接查该 id 的节点
    const titleNode = inst.nodes.find((n) => n.id === titleSlot.nodeId)!
    expect(titleNode.text, '行内文本必须已回填（否则首帧空白）').toBe('a')
    const widthNode = inst.nodes.find((n) => n.id === widthSlot.nodeId)!
    // ★形态：样式**平铺在顶层**（核心 NodeDto 契约——放 `style` 子对象会被静默忽略）
    expect(widthNode.width, '行内样式必须已回填到**顶层**（否则核心看不到 ⇒ 布局按全 auto 算）').toBe(10)
    expect(widthNode.style, '★不得再产出 `style` 子对象（那是接口不匹配的形态）').toBeUndefined()
    // 第 2 行（新分配 id）也必须回填
    const rows = inst.nodes.filter((n) => n.text === 'b' || n.text === 'c')
    expect(rows.length, '第 2/3 行的文本也应回填').toBe(2)
    expect(inst.stats.valuesFilled).toBeGreaterThanOrEqual(6) // 3 行 × (width + title)
  })

  it('★★⑥ **id 唯一**（行内子节点不设 listId ⇒ 静态分支重复产出是实测踩到的缺陷）', () => {
    // 【为什么必须锁定（本仓实测：核心拒收）】模板里只有 **v-for 那个元素**带 listId，
    //   行内子节点没有 ⇒ 若实例化按 `listId === undefined` 分流，行内子节点会被
    //   **静态分支与行克隆各产出一次** ⇒ id 重复 ⇒ 核心输入图校验拒收（设备端实测报
    //   `proteus_layout_create 失败（节点数 13）`）。⇒ 判据：id 全局唯一 + 数量守恒。
    const { tpl, table } = build()
    const inst = instantiateTemplate(tpl, { viewport: { width: 390, height: 844 }, read, table })
    const ids = inst.nodes.map((n) => n.id)
    expect(new Set(ids).size, `id 必须唯一（重复：${ids.filter((x, i) => ids.indexOf(x) !== i)}）`).toBe(ids.length)
    // 数量守恒：静态节点 + 行数 × 行子树大小
    const rowSubtree = tpl.lists[0]!.subtreeIds.length
    const staticNodes = tpl.nodes.filter((n) => !tpl.lists[0]!.subtreeIds.includes(n.id)).length
    expect(inst.nodes.length).toBe(staticNodes + 3 * rowSubtree)
  })

  it('★④ 空列表 ⇒ 不展开行（不崩、不产生悬空节点）', () => {
    const { tpl, table } = build()
    const inst = instantiateTemplate(tpl, {
      viewport: { width: 390, height: 844 }, read: (n) => (n === 'list' ? [] : read(n)), table,
    })
    const meta = tpl.lists[0]!
    expect(inst.nodes.some((n) => n.id === meta.rowRootId)).toBe(false)
    // 静态部分仍在
    expect(inst.nodes.length).toBeGreaterThanOrEqual(2)
  })
})

describe('V4 · ★★嵌套 v-for 递归实例化（P2 批次，2026-10-03）', () => {
  // 【这一组防什么（三处实测缺陷的回归锁）】
  //   ① 外层列表**行内无绑定**时（只有内层 v-for）⇒ 订阅表里只有 list-data 槽位
  //      ⇒ 首版 `rowsOfList` 找不到 spec 直接返回 [] ⇒ **外层行整行不展开**（实测只剩内层 i）。
  //   ② 内层行根的父在**外层行实例**上（模板 id 属于外层子树，内层 idMap 翻译不到）
  //      ⇒ 不传 parentOverrideId 时，第 2 行起内层节点全挂到第一行（实测"都挤在第一个 li"）。
  //   ③ 两层都从主循环展开 ⇒ 内层按"全局扁平行集"扩一次、父行克隆又扩一次 ⇒ 重复 + 撞 id。
  const NESTED_SFC = sfc(
    `const gs = ref([{ id: 1, t: 'G1', items: [{ id: 10, n: 'a' }, { id: 11, n: 'b' }] }, { id: 2, t: 'G2', items: [{ id: 20, n: 'c' }] }])\n`,
    `<ul>\n` +
      `  <li v-for="g in gs" :key="g.id">\n` +
      `    <span>{{ g.t }}</span>\n` +
      `    <i v-for="x in g.items" :key="x.id">{{ x.n }}</i>\n` +
      `  </li>\n` +
      `</ul>`,
  )
  const data = {
    gs: [
      { id: 1, t: 'G1', items: [{ id: 10, n: 'a' }, { id: 11, n: 'b' }] },
      { id: 2, t: 'G2', items: [{ id: 20, n: 'c' }] },
    ],
  }
  const read = (n: string): unknown => (data as Record<string, unknown>)[n]

  function build() {
    const tpl = buildLayoutTemplate(NESTED_SFC, 'nested.vue').template
    const { table } = buildVaporSubscriptions(NESTED_SFC, 'nested.vue')
    return { tpl, table }
  }

  it('★★① 三层结构齐备：ul → 2×li → (span + i×n)；内层 i 挂**自己那一行的 li**', () => {
    const { tpl, table } = build()
    const inst = instantiateTemplate(tpl, { viewport: { width: 390, height: 844 }, read, table })
    const tagOf = (n: { id: number }): string => {
      const node = tpl.nodes.find((t) => t.id === n.id)
      return node?.tag ?? ''
    }
    const byId = new Map(inst.nodes.map((n) => [n.id, n]))
    // 全部节点（tag 从模板查——实例节点带 tag 透传，此处双路核对）
    const tags = inst.nodes.map((n) => (n as { tag?: string }).tag)
    expect(tags.filter((t) => t === 'li').length, '2 个外层行根').toBe(2)
    expect(tags.filter((t) => t === 'i').length, '3 个内层行（2+1）').toBe(3)
    expect(tags.filter((t) => t === 'span').length, '每行一个 span').toBe(2)
    // ★层级：每个 i 的父必须是 li（不是别的 i / 不是 ul）
    for (const n of inst.nodes) {
      if ((n as { tag?: string }).tag === 'i') {
        const parent = byId.get(n.parentId!)
        expect((parent as { tag?: string } | undefined)?.tag, `i(${n.id}) 的父必须是 li`).toBe('li')
      }
    }
    // ★文本回填：a/b/c 三条 + G1/G2
    const texts = inst.nodes.map((n) => (n as { text?: string }).text).filter(Boolean)
    expect(texts).toEqual(expect.arrayContaining(['G1', 'a', 'b', 'G2', 'c']))
    // id 唯一 + 父子完整
    const ids = inst.nodes.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
    const idSet = new Set(ids)
    for (const n of inst.nodes) if (n.parentId !== null) expect(idSet.has(n.parentId)).toBe(true)
    void tagOf
  })

  it('★★② 无行内绑定的外层列表也能展开（list-data 兜底——实测缺陷①的回归锁）', () => {
    // 外层 li 只有 :key + 内层 v-for ⇒ 无 list-item 槽位 ⇒ 必须靠 list-data 槽位取行集
    const sfcNoBind = sfc(
      `const gs = ref([{ id: 1, items: [{ id: 10, n: 'a' }] }, { id: 2, items: [{ id: 20, n: 'c' }] }])\n`,
      `<ul><li v-for="g in gs" :key="g.id"><i v-for="x in g.items" :key="x.id">{{ x.n }}</i></li></ul>`,
    )
    const tpl = buildLayoutTemplate(sfcNoBind, 'nb.vue').template
    const { table } = buildVaporSubscriptions(sfcNoBind, 'nb.vue')
    // 前提：外层确实没有 list-item 槽位（否则这条用例没有测到兜底路径）
    const outerListId = tpl.lists.find((l) => l.parentListId === undefined)!.listId
    const hasOuterItem = table.sources.flatMap((s) => s.slots).some((x) => x.kind === 'list-item' && x.listId === outerListId)
    expect(hasOuterItem, '前提：外层无 list-item 槽位').toBe(false)
    const inst = instantiateTemplate(tpl, { viewport: { width: 390, height: 844 }, read, table })
    const tags = inst.nodes.map((n) => (n as { tag?: string }).tag)
    expect(tags.filter((t) => t === 'li').length, '外层 2 行必须展开').toBe(2)
    // 共享数据里内层是 2+1 = 3 行（a,b 在第 1 行；c 在第 2 行）
    expect(tags.filter((t) => t === 'i').length, '内层行数 = 数据里的 items 总数').toBe(3)
  })

  it('★★③ 内层行挂到**自己那一行**的 li（parentOverrideId——实测缺陷②的回归锁）', () => {
    const { tpl, table } = build()
    const inst = instantiateTemplate(tpl, { viewport: { width: 390, height: 844 }, read, table })
    const byId = new Map(inst.nodes.map((n) => [n.id, n as Record<string, unknown>]))
    const lis = inst.nodes.filter((n) => (n as { tag?: string }).tag === 'li')
    // 每个 li 下必须有且只有属于它的 i（第 1 行 2 个、第 2 行 1 个）
    const innerCounts = lis.map((li) => inst.nodes.filter((n) => n.parentId === li.id && (n as { tag?: string }).tag === 'i').length)
    expect(innerCounts.sort(), '各行内层数应为 [1, 2]（不是全挤在第一行）').toEqual([1, 2])
    // 内层文本与所属行匹配：li#1 → a,b；li#2 → c
    const textUnder = (liId: number): string[] =>
      inst.nodes.filter((n) => n.parentId === liId).map((n) => String((n as { text?: string }).text ?? ''))
    const rowTexts = lis.map((li) => textUnder(li.id))
    expect(rowTexts.some((t) => t.includes('a') && t.includes('b'))).toBe(true)
    expect(rowTexts.some((t) => t.includes('c'))).toBe(true)
    void byId
  })

  it('★★④ 三层嵌套 2×2×2 ⇒ 15 节点、id 唯一、层级正确（任意层递归）', () => {
    const sfc3 = sfc(
      `const as_ = ref([])\n`,
      `<ul><li v-for="a in as_" :key="a.id"><div v-for="b in a.l2" :key="b.id"><i v-for="c in b.l3" :key="c.id">{{ c.n }}</i></div></li></ul>`,
    )
    // 构造 2×2×2 数据
    const as_: unknown[] = []
    let id = 1
    for (let i = 0; i < 2; i++) {
      const r: Record<string, unknown> = { id: id++, l2: [] }
      for (let j = 0; j < 2; j++) {
        const r2: Record<string, unknown> = { id: id++, l3: [] }
        for (let k = 0; k < 2; k++) (r2.l3 as unknown[]).push({ id: id++, n: `t${i}${j}${k}` })
        ;(r.l2 as unknown[]).push(r2)
      }
      as_.push(r)
    }
    const tpl = buildLayoutTemplate(sfc3, 'l3.vue').template
    const { table } = buildVaporSubscriptions(sfc3, 'l3.vue')
    const inst = instantiateTemplate(tpl, {
      viewport: { width: 390, height: 844 }, read: (n) => (n === 'as_' ? as_ : undefined), table,
    })
    // 1 ul + 2 li + 4 div + 8 i = 15
    expect(inst.nodes.length).toBe(15)
    const ids = inst.nodes.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
    // 层级：div 的父是 li、i 的父是 div
    const byId = new Map(inst.nodes.map((n) => [n.id, n as Record<string, unknown>]))
    for (const n of inst.nodes) {
      const tag = (n as { tag?: string }).tag
      const pt = n.parentId === null ? '' : String((byId.get(n.parentId) as Record<string, unknown> | undefined)?.tag)
      if (tag === 'div') expect(pt).toBe('li')
      if (tag === 'i') expect(pt).toBe('div')
    }
    // 8 条文本全部回填（层级 × 路径都正确才可能全对）
    const texts = inst.nodes.map((n) => (n as { text?: string }).text).filter(Boolean).sort()
    expect(texts).toEqual(['t000', 't001', 't010', 't011', 't100', 't101', 't110', 't111'])
  })
})

describe('★★P2-2 混合文本（2026-10-03）：`a{{x}}b` 编译期切分 → 段求值 → 首帧与更新都对', () => {
  // 【这一批补的是什么（能力清单 P2-2）】此前"文本 + 插值混合"被诊断拒绝；而"前缀{{x}}后缀"
  //   是模板里的常见写法。自绘树里文本是**元素属性**（没有独立文本节点）⇒ 正解是**段数组**
  //   （静态段 + 表达式段），运行时求值拼接——与"组合表达式"同一套求值语义。
  //
  // 【本组判据打在三处（各自对应一个会静默出错的环节）】
  //   ① 切分：段序/段型正确（错 ⇒ 文本顺序错，看起来"像对的"）；
  //   ② 首帧回填：实例化后 `text` 已是完整拼接（错 ⇒ 首帧空白或半截，零报错）；
  //   ③ **更新**：改数据 ⇒ 一条指令 ⇒ Rust 内核文本真的变（错 ⇒ 首帧对、之后不更新）。
  it('① 切分：静态段 + 表达式段按子节点序（`a{{x}}b` ⇒ 3 段）', () => {
    const src = sfc(`const x = ref(1)\n`, `<p-text style="color: #fff">a{{ x }}b</p-text>`)
    const r = buildLayoutTemplate(src, 'mix.vue')
    expect(r.diagnostics, '混合文本不应有诊断').toHaveLength(0)
    const node = r.template.nodes.find((n) => n.tag === 'p-text')!
    expect(node.textSegments!.map((s) => ('text' in s ? s.text : `<expr:${s.src}>`))).toEqual(['a', '<expr:x>', 'b'])
    expect(node.text, '段表节点 text 置空串占位（既有"插值初值为空串"形态）').toBe('')
  })

  it('★反向：纯静态 / 单插值**不得**产出段表（既有产物逐字节不变）', () => {
    const staticOnly = buildLayoutTemplate(sfc(`const x = ref(1)\n`, `<p-text>标题</p-text>`), 's.vue')
    expect(staticOnly.template.nodes[0]!.textSegments).toBeUndefined()
    expect(staticOnly.template.nodes[0]!.text).toBe('标题')
    const single = buildLayoutTemplate(sfc(`const x = ref(1)\n`, `<p-text>{{ x }}</p-text>`), 'i.vue')
    expect(single.template.nodes[0]!.textSegments, '单插值走既有 text.content 槽位（不合成）').toBeUndefined()
    // ★★2026-10-03（混排批次）：**元素 + 文本混排已真支持**——文本合成 `p-text` 叶
    //   （与元素兄弟按文档序；见 text-runs.ts）。旧的"混合内容"诊断已移除。
    const mixedEl = buildLayoutTemplate(
      sfc(`const x = ref(1)\n`, `<p-view><p-text>x</p-text>尾{{ x }}</p-view>`),
      'e.vue',
    )
    expect(mixedEl.diagnostics.some((d) => d.message.includes('混合内容')), '混排不再被拒绝').toBe(false)
    // 合成叶：父(p-view) / p-text(x) / 合成叶(尾{{x}}) —— 文本按文档序成为兄弟
    expect(mixedEl.template.nodes.map((n) => n.tag)).toEqual(['p-view', 'p-text', 'p-text'])
    const synth = mixedEl.template.nodes[2]!
    expect(synth.id).toBe(2)
    expect(synth.textSegments!.map((s) => ('text' in s ? s.text : `<expr:${s.src}>`))).toEqual(['尾', '<expr:x>'])
  })

  it('② 订阅表：多个插值合成**一条**槽位（否则两条 SET_TEXT 后者覆盖前者）', () => {
    // 【本仓实测的形态】`{{a}}-{{b}}` 若不合成 ⇒ 两个独立 `text.content` 槽位指向**同一节点**
    //   ⇒ 运行时发两条 SET_TEXT，屏幕上只剩最后一个（静默错内容）。
    const src = sfc(
      `const a = ref(1)\nconst b = ref(2)\n`,
      `<p-text style="color: #fff">{{ a }}-{{ b }}</p-text>`,
    )
    const { table } = buildVaporSubscriptions(src, 'mix2.vue')
    const textSlots = table.sources.flatMap((s) => s.slots).filter((x) => x.propKey === 'text.content')
    // ★同一槽位被多个源驱动 ⇒ 会出现在多条源记录里（多源依赖的既有形态，见 build.ts 的 slotsBySource）；
    //   判据是**唯一 slotId 只有一个**——不合成时是两个不同 slotId ⇒ 运行时后者覆盖前者
    const uniqueSlots = [...new Set(textSlots.map((x) => x.slotId))]
    expect(uniqueSlots, '两个插值 ⇒ 合成后只应有一条文本槽位').toHaveLength(1)
    // 合成槽位的求值器必须是"程序"形态（拼接受支持）且被实例化
    const ev = table.evaluators.find((e) => e.evaluatorId === textSlots[0]!.evaluatorId)!
    expect(ev.form, '合成后的求值器应是程序（支持的拼接表达式）').toBe('program')
  })

  it('③ 首帧回填：实例化后 text 是**完整拼接**（不是单字段/单个源值）', () => {
    const src = sfc(
      `const a = ref(7)\nconst b = ref('zz')\n`,
      `<p-text style="color: #fff">a{{ a }}b{{ b }}</p-text>`,
    )
    const tpl = buildLayoutTemplate(src, 'fill.vue').template
    const { table } = buildVaporSubscriptions(src, 'fill.vue')
    const inst = instantiateTemplate(tpl, {
      viewport: { width: 390, height: 844 }, read: (n) => ({ a: 7, b: 'zz' } as Record<string, unknown>)[n], table,
    })
    const node = inst.nodes.find((n) => (n as { tag?: string }).tag === 'p-text')!
    expect((node as { text?: string }).text, '首帧必须是完整拼接').toBe('a7bzz')
  })

  it('★行内混合文本：段求值走 v-for 行作用域（`{{item.n}}!` 不能读到 undefined）', () => {
    const src = sfc(
      `const list = ref([{ id: 1, n: 'x' }, { id: 2, n: 'y' }])\n`,
      `<ul><li v-for="item in list" :key="item.id"><span>{{ item.n }}!</span></li></ul>`,
    )
    const tpl = buildLayoutTemplate(src, 'rowmix.vue').template
    const { table } = buildVaporSubscriptions(src, 'rowmix.vue')
    const inst = instantiateTemplate(tpl, {
      viewport: { width: 390, height: 844 },
      read: (n) => ({ list: [{ id: 1, n: 'x' }, { id: 2, n: 'y' }] } as Record<string, unknown>)[n],
      table,
    })
    const texts = inst.nodes.map((n) => (n as { text?: string }).text).filter(Boolean).sort()
    expect(texts, '两行的文本都要完整（行作用域绑定对）').toEqual(['x!', 'y!'])
  })

  it('★诊断边界：混合文本里的插值**编不出**（如调用）⇒ 诊断而非静默当字面量', () => {
    const src = sfc(`const n = ref(1)\n`, `<p-text style="color: #fff">a{{ fmt(n) }}b</p-text>`)
    const r = buildLayoutTemplate(src, 'bad.vue')
    expect(
      r.diagnostics.some((d) => d.message.includes('无法编译为可求值程序')),
      `编不出的插值必须诊断：${r.diagnostics.map((d) => d.message).join(' | ')}`,
    ).toBe(true)
    // ★不静默：编不出的那段**不进段表**（否则会被当成字面量文本 ⇒ 屏幕上出现 "fmt(n)" 字样）
    const node = r.template.nodes.find((n) => n.tag === 'p-text')!
    const hasFmtLiteral = (node.textSegments ?? []).some((s) => 'text' in s && s.text.includes('fmt'))
    expect(hasFmtLiteral, '表达式源码不得被当成字面量文本段').toBe(false)
  })
})

describe('★★P2-5（2026-10-03）：v-once 冻结 / v-memo 组门 —— 编译产物 + 运行时语义', () => {
  const sfc2 = (script: string, template: string): string =>
    `<template>\n${template}\n</template>\n\n<script setup lang="ts">\n${script}\n</script>\n`
  const SCRIPT = `const a = ref(1)\nconst b = ref(2)\nconst c = ref(3)\n`

  it('① 编译：v-once 槽位带 once 标记；v-memo 槽位带 memoId + 组依赖表', () => {
    const onceSrc = sfc2(SCRIPT, `<p-text v-once>{{ a }}</p-text>`)
    const r1 = buildVaporSubscriptions(onceSrc, 'o.vue')
    const onceSlot = r1.table.sources.flatMap((s) => s.slots)[0]!
    expect(onceSlot.once, 'v-once 绑定必须带 once 标记').toBe(true)
    expect(r1.diagnostics, 'v-once 不应有诊断').toHaveLength(0)

    const memoSrc = sfc2(SCRIPT, `<p-text v-memo="[a, b]">{{ c }}</p-text>`)
    const r2 = buildVaporSubscriptions(memoSrc, 'm.vue')
    const memoSlot = r2.table.sources.flatMap((s) => s.slots)[0]!
    expect(memoSlot.memoId, 'v-memo 绑定必须带 memoId').toBe(0)
    expect(r2.table.memoGroups, 'memo 组表必须产出').toBeDefined()
    expect(r2.table.memoGroups![0]!.depsSrc, '依赖按书写序').toEqual(['a', 'b'])
    // ★关键：memo 依赖的根也必须在订阅图里（否则"依赖变了"不触发求值 ⇒ 静默漏更新）
    const srcNames = r2.table.sources.map((s) => s.sourceName)
    expect(srcNames, 'memo 依赖的源必须在订阅图（漏挂 ⇒ 依赖变化不触发）').toEqual(expect.arrayContaining(['a', 'b']))
  })

  it('★反向：无 v-once/v-memo 时**不产出**新字段（既有产物逐字节不变）', () => {
    const plain = sfc2(SCRIPT, `<p-text>{{ a }}</p-text>`)
    const r = buildVaporSubscriptions(plain, 'p.vue')
    expect(r.table.memoGroups, '无 v-memo ⇒ 不产出 memoGroups').toBeUndefined()
    expect(r.table.sources.flatMap((s) => s.slots).every((x) => x.once === undefined && x.memoId === undefined)).toBe(true)
  })

  it('★诊断边界：v-memo 非数组字面量 / 行内 v-once ⇒ 诊断（不静默）', () => {
    const bad = sfc2(SCRIPT, `<p-text v-memo="a">{{ c }}</p-text>`)
    const r1 = buildVaporSubscriptions(bad, 'b.vue')
    expect(r1.diagnostics.some((d) => d.code === 'VAPOR_MEMO_SHAPE'), '非数组 v-memo 必须诊断').toBe(true)
    expect(r1.table.memoGroups, '建不出依赖表 ⇒ 不产出组（照常更新，仅少优化）').toBeUndefined()

    const inList = sfc2(
      `const list = ref([{ id: 1, n: 'x' }])\n`,
      `<ul><li v-for="it in list" :key="it.id"><span v-once>{{ it.n }}</span></li></ul>`,
    )
    const r2 = buildVaporSubscriptions(inList, 'l.vue')
    expect(r2.diagnostics.some((d) => d.code === 'VAPOR_ONCE_IN_LIST'), '行内 v-once 必须诊断').toBe(true)
  })

  it('★★② 运行时：v-once 首帧后**永久冻结**（源变化不再写）', () => {
    const src = sfc2(SCRIPT, `<p-text v-once>{{ a }}</p-text>`)
    const { table } = buildVaporSubscriptions(src, 'o.vue')
    const data: Record<string, unknown> = { a: 1 }
    const keys = new PropKeyTable(); const strings = new StringPool()
    const captured: Uint8Array[] = []
    const rt = new SlotRuntime(keys, strings, (bx) => captured.push(bx))
    const ctx: EvalContext = { read: (n) => data[n] }
    const vapor = new VaporRuntime(table, rt, VaporRuntime.buildEvaluators(table.evaluators))
    const triggers = new Map<string, () => void>()
    vapor.load(ctx, (n, cb) => triggers.set(n, cb))
    vapor.relink(ctx); rt.flush()
    // 首帧已写（冻结前的唯一一次写）
    expect(captured.length, '首帧应有写入').toBe(1)
    captured.length = 0
    // 改源 → 触发 → relink：**不得**再写
    data.a = 999
    for (const [, cb] of triggers) cb()
    vapor.relink(ctx)
    rt.flush()
    expect(captured.length, '★v-once：源变化后不得再写（冻结）').toBe(0)
  })

  it('★★③ 运行时：v-memo 组门——依赖净则跳过、依赖脏则放行', () => {
    const src = sfc2(SCRIPT, `<p-text v-memo="[a]">{{ c }}</p-text>`)
    const { table } = buildVaporSubscriptions(src, 'm.vue')
    const data: Record<string, unknown> = { a: 1, c: 10 }
    const keys = new PropKeyTable(); const strings = new StringPool()
    const captured: Uint8Array[] = []
    const rt = new SlotRuntime(keys, strings, (bx) => captured.push(bx))
    const ctx: EvalContext = { read: (n) => data[n] }
    const vapor = new VaporRuntime(table, rt, VaporRuntime.buildEvaluators(table.evaluators))
    const triggers = new Map<string, () => void>()
    vapor.load(ctx, (n, cb) => triggers.set(n, cb))
    vapor.relink(ctx); rt.flush()
    captured.length = 0
    // ① 只改 c（memo 依赖 a 未变）⇒ **跳过**（stale c 与官方 withMemo 一致）
    data.c = 20
    for (const [, cb] of triggers) cb()
    vapor.relink(ctx); rt.flush()
    expect(captured.length, '★依赖净 ⇒ 必须跳过（组门生效）').toBe(0)
    // ② 改 a（依赖脏）⇒ 放行（同帧把新 c 写下去）
    data.a = 5
    for (const [, cb] of triggers) cb()
    vapor.relink(ctx); rt.flush()
    expect(captured.length, '★依赖脏 ⇒ 必须放行').toBe(1)
    const d = decodeOps(captured[0]!)
    const setText = d.ops.find((o) => o.op === OpCode.SET_TEXT) as { textRef: number } | undefined
    expect(d.strings.valueOf(setText!.textRef), '放行时写出的是**最新**值（20）').toBe('20')
  })

  it('★帧语义：同帧内先写依赖槽位、后写被门控槽位 ⇒ 两个都写出（组=子树整体更新）', () => {
    // 元素同时渲染依赖与内容：v-memo="[a]" 且 {{ a }} + {{ c }}
    const src = sfc2(SCRIPT, `<p-view v-memo="[a]"><p-text>{{ a }}</p-text><p-text>{{ c }}</p-text></p-view>`)
    const { table } = buildVaporSubscriptions(src, 'f.vue')
    const data: Record<string, unknown> = { a: 1, c: 10 }
    const keys = new PropKeyTable(); const strings = new StringPool()
    const captured: Uint8Array[] = []
    const rt = new SlotRuntime(keys, strings, (bx) => captured.push(bx))
    const ctx: EvalContext = { read: (n) => data[n] }
    const vapor = new VaporRuntime(table, rt, VaporRuntime.buildEvaluators(table.evaluators))
    const triggers = new Map<string, () => void>()
    vapor.load(ctx, (n, cb) => triggers.set(n, cb))
    vapor.relink(ctx); rt.flush()
    captured.length = 0
    // 同帧改 a + c（依赖脏）：**两个槽位都要写**（不能因"第一个已判定"而漏掉第二个）
    data.a = 7; data.c = 70
    for (const [, cb] of triggers) cb()
    vapor.relink(ctx); rt.flush()
    const texts: string[] = []
    for (const bx of captured) {
      const d = decodeOps(bx)
      for (const o of d.ops) if (o.op === OpCode.SET_TEXT) texts.push(String(d.strings.valueOf((o as { textRef: number }).textRef)))
    }
    expect(texts.sort(), '同帧依赖脏 ⇒ 组内**两个**槽位都要写').toEqual(['7', '70'])
  })
})
