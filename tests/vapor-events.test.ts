// tests/vapor-events.test.ts —— ★★**事件编译器**判据（交互闭环的编译期半边）
//
// 【为什么必须有】事件编译是"点得动"的**唯一入口**：它编不出事件 ⇒ 真机上手势能识别、
//   hitTest 能命中，而**没有任何 handler 可跑**（现象是"点了没反应"，且链路上零报错）。
//   本文件的判据分三层：① 支持形态**编对了**（动作语义正确）；② 不支持形态**编不出但产诊断**
//   （不静默）；③ **节点 id 与模板同序**（与 `buildLayoutTemplate` 的 id 分配同源——
//   分叉的后果是 handler 挂到别的节点上，症状伪装成"点错地方"）。
import { describe, it, expect } from 'vitest'
import { compileEvents, buildLayoutTemplate, buildVaporSubscriptions } from '@proteus-vue/compiler'

const sfc = (template: string, script = `const count = ref(0)\nconst toggle = ref(false)\nconst boxW = ref(120)\nconst list = ref([{ id: 1, w: 10 }])\n`): string =>
  `<template>\n${template}\n</template>\n\n<script setup lang="ts">\n${script}</script>\n`

describe('Vapor 事件编译 · 支持形态', () => {
  it('`count++` → set/add 动作（自增编成 add + 字面量 1）', () => {
    const r = compileEvents(sfc(`<p-view @click="count++"></p-view>`))
    expect(r.diagnostics).toHaveLength(0)
    expect(r.events).toEqual([{ nodeId: 0, event: 'tap', handler: 'h0' }])
    expect(r.handlers.h0).toEqual([{ op: 'add', source: 'count', program: { k: 'lit', v: 1 } }])
  })

  it('`count--` / `++count` / `--count` 都归一为 add（含符号）', () => {
    expect(compileEvents(sfc(`<p-view @click="count--"></p-view>`)).handlers.h0![0]).toMatchObject({
      op: 'add',
      program: { k: 'lit', v: -1 },
    })
    expect(compileEvents(sfc(`<p-view @click="++count"></p-view>`)).handlers.h0![0]).toMatchObject({
      op: 'add',
      program: { k: 'lit', v: 1 },
    })
    expect(compileEvents(sfc(`<p-view @click="--count"></p-view>`)).handlers.h0![0]).toMatchObject({
      op: 'add',
      program: { k: 'lit', v: -1 },
    })
  })

  it('`boxW += 30` → add（右侧求值为 30）', () => {
    const r = compileEvents(sfc(`<p-view @click="boxW += 30"></p-view>`))
    expect(r.handlers.h0).toEqual([{ op: 'add', source: 'boxW', program: { k: 'lit', v: 30 } }])
  })

  it('`count = count * 2 + 1` → set + 表达式程序（含算术）', () => {
    const r = compileEvents(sfc(`<p-view @click="count = count * 2 + 1"></p-view>`))
    expect(r.diagnostics).toHaveLength(0)
    const act = r.handlers.h0![0]!
    expect(act.op).toBe('set')
    expect((act as { program: { k: string; op: string } }).program).toMatchObject({ k: 'bin', op: '+' })
  })

  it('`toggle = !toggle` → set + 一元非（布尔取反）', () => {
    const r = compileEvents(sfc(`<p-view @click="toggle = !toggle"></p-view>`))
    expect(r.handlers.h0).toEqual([
      { op: 'set', source: 'toggle', program: { k: 'un', op: '!', arg: { k: 'root', name: 'toggle' } } },
    ])
  })

  it('`@longpress` 映射为 longpress 语义（不是 tap）', () => {
    const r = compileEvents(sfc(`<p-view @longpress="count--"></p-view>`))
    expect(r.events[0]!.event).toBe('longpress')
  })

  it('多个事件 → 多条绑定 + 多个 handler（按出现序命名 h0/h1）', () => {
    const r = compileEvents(sfc(`<p-view @click="count++"></p-view><p-view @click="boxW += 30"></p-view>`))
    expect(r.events.map((e) => e.handler)).toEqual(['h0', 'h1'])
    expect(Object.keys(r.handlers)).toEqual(['h0', 'h1'])
  })
})

describe('Vapor 事件编译 · ★不支持形态必须产诊断（不静默）', () => {
  const cases: Array<[string, string, string]> = [
    ['调用表达式', `<p-view @click="submit()"></p-view>`, 'handler 形态不支持'],
    ['多语句', `<p-view @click="count++; toggle = !toggle"></p-view>`, '多条语句'],
    ['未支持事件', `<p-view @input="count++"></p-view>`, '事件未支持'],
    ['空 handler', `<p-view @click=""></p-view>`, 'handler 为空'],
  ]
  for (const [label, template, expectMsg] of cases) {
    it(`${label} ⇒ 诊断（含修法）+ 不产出事件`, () => {
      const r = compileEvents(sfc(template))
      expect(r.events, `${label} 不应产出事件`).toHaveLength(0)
      expect(r.diagnostics.length, `${label} 必须产诊断`).toBeGreaterThan(0)
      const msg = r.diagnostics.map((d) => d.message).join(' | ')
      expect(msg).toContain(expectMsg)
      // ★诊断必须带修法（本仓纪律：报错要能照着改）
      expect(r.diagnostics.every((d) => (d.hint ?? '').length > 0), '每条诊断都要有修法').toBe(true)
    })
  }
})

describe('Vapor 事件编译 · ★节点 id 与模板**同序**（分叉 ⇒ handler 挂错节点）', () => {
  it('嵌套结构下 id 对齐（`<p-view><p-view @click>` ⇒ 内层 id=1）', () => {
    const template = `<p-view><p-view @click="count++"></p-view></p-view>`
    const ev = compileEvents(sfc(template))
    const tpl = buildLayoutTemplate(sfc(template), 'align.vue').template
    // 事件编译给出的 nodeId 必须是模板里的**同一个元素**
    const target = tpl.nodes.find((n) => n.id === ev.events[0]!.nodeId)!
    expect(target, '事件 nodeId 必须命中模板节点').toBeTruthy()
    // ★语义判据：内层是第二个元素（id=1），而它才是带 @click 的那个
    expect(ev.events[0]!.nodeId).toBe(1)
    expect(tpl.nodes).toHaveLength(2)
  })

  it('自闭合标签也计入元素序（与 template.ts 的 nextElementIndex++ 同纪律）', () => {
    const template = `<p-view /><p-view @click="count++" />`
    const ev = compileEvents(sfc(template))
    expect(ev.events[0]!.nodeId).toBe(1)
  })
})

describe('Vapor 事件编译 · 确定性（同一源码两次编译逐字节一致）', () => {
  it('handler 命名与动作表稳定（可对账）', () => {
    const template = `<p-view @click="count++"></p-view><p-view @click="toggle = !toggle"></p-view>`
    const a = compileEvents(sfc(template))
    const b = compileEvents(sfc(template))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe('★P0 静默风险可见化（2026-10-03 · Vapor 能力清单批次）', () => {
  // 【为什么单列一组】能力清单调研抓出「静默风险 12 项」——即"既无实现也无诊断"：
  //   产物里什么都不发生，而开发者以为生效（**页面看起来对、功能是空的**）。
  //   本批不实现能力，只让"未支持"在编译期**可见**。判据 = 必须产诊断（且带修法提示）。
  const wrap = (tpl: string): string =>
    `<script setup lang="ts">\nimport { ref } from 'vue'\nconst a = ref(1)\nconst items = ref([{ id: 1 }])\n</script>\n<template>${tpl}</template>`

  const diagText = (tpl: string): string =>
    buildLayoutTemplate(wrap(tpl), 'p.vue').diagnostics.map((d) => String(d.message)).join(' | ')

  it('v-html / v-text 必须产诊断（此前静默）；★v-memo 已真支持（P2-5）', () => {
    expect(diagText(`<div v-html="a" style="height: 5px"></div>`)).toContain('v-html 未支持')
    expect(diagText(`<div v-text="a" style="height: 5px"></div>`)).toContain('v-text 未支持')
    // ★2026-10-03（P2-5）：v-memo 从"诊断拒绝"升为**真支持**——数组字面量形态零诊断；
    //   非数组字面量仍诊断（形态诊断，不是"未支持"）
    expect(diagText(`<div v-memo="[a]" style="height: 5px"></div>`), 'v-memo 数组字面量已支持').not.toContain('v-memo 未支持')
    expect(diagText(`<div v-memo="a" style="height: 5px"></div>`), '非数组字面量必须诊断').toContain('数组字面量')
  })

  it('内置组件（Teleport / KeepAlive / Transition / Suspense）必须产诊断', () => {
    expect(diagText(`<Teleport to="#x"><i>t</i></Teleport>`)).toContain('Teleport 未支持')
    expect(diagText(`<KeepAlive><Comp /></KeepAlive>`)).toContain('KeepAlive 未支持')
    expect(diagText(`<Transition><div /></Transition>`)).toContain('Transition 未支持')
    expect(diagText(`<Suspense><div /></Suspense>`)).toContain('Suspense 未支持')
  })

  it('动态组件与插槽出口必须产诊断', () => {
    expect(diagText(`<component :is="a" />`)).toContain('动态组件')
    expect(diagText(`<div><slot name="foo" /></div>`)).toContain('插槽出口')
  })

  it('动态属性 :[k] / 动态事件 @[e] 必须产诊断（arg.isStatic===false 判据）', () => {
    expect(diagText(`<div :[a]="a" style="height: 5px"></div>`)).toContain('动态属性名')
    // 事件侧由 compileEvents 覆盖（正则解析器看不到方括号形态）
    const ev = compileEvents(wrap(`<div @[a]="a = 1">x</div>`))
    expect(ev.diagnostics.map((d) => String(d.message)).join(' | ')).toContain('动态事件名未支持')
  })

  it('自定义指令必须产诊断（内置白名单之外）', () => {
    expect(diagText(`<div v-focus style="height: 5px"></div>`)).toContain('自定义指令')
  })

  it('★反向：已支持的形态**不得**误报（防"诊断噪声淹没真问题"）', () => {
    // v-if / v-for / v-show / v-model / 事件 / 绘制声明 —— 这些都是已实现能力
    expect(diagText(`<div v-if="a" style="height: 5px">x</div>`)).not.toContain('未支持')
    expect(diagText(`<li v-for="it in items" :key="it.id" :width="a"></li>`)).not.toContain('未支持')
    expect(diagText(`<div v-show="a" style="height: 5px">x</div>`)).not.toContain('未支持')
    expect(diagText(`<input v-model="a" style="height: 5px" />`)).not.toContain('未支持')
    expect(diagText(`<div @click="a = 1" style="height: 5px">x</div>`)).not.toContain('未支持')
    expect(diagText(`<div glow='{"color":"#fff","radius":5,"alpha":0.5}' style="height: 5px"></div>`)).not.toContain('未支持')
  })
})

describe('★P1 组件系统第一批（2026-10-03 · 组件边界标记 + props 通道）', () => {
  // 【设计依据】方案 §7.3 强制规则第 1 条：「组件边界强制 L0」——
  //   props 跨组件传递走标准路径（CALL_COMPONENT_UPDATE），不穿透。
  //   本批交付：① 编译期**标记组件边界**（节点 component 字段）
  //             ② props 走 `component.<name>` propKey ⇒ `component-prop` 槽位
  //                ⇒ 运行时发 CALL_COMPONENT_UPDATE（opcode/编解码已存在）。
  //   ★诚实边界：组件**内部渲染** / 生命周期 / 插槽分发 = 后续批次（本批只做边界与通道）。
  const COMP_SFC = `
<script setup lang="ts">
import { ref } from 'vue'
const a = ref(1)
</script>
<template>
  <p-view style="height: 100px">
    <MyComp :prop1="a" style="height: 20px" />
    <div style="height: 10px">plain</div>
  </p-view>
</template>`

  it('① 组件标签被标记为组件边界（node.component）', () => {
    const t = buildLayoutTemplate(COMP_SFC, 'c.vue').template
    const comp = t.nodes.find((n) => n.tag === 'MyComp') as { component?: string } | undefined
    expect(comp?.component).toBe('MyComp')
    // 反向：普通元素**不得**被标记（kebab-case 是原生标签）
    const plain = t.nodes.find((n) => n.tag === 'div') as { component?: string } | undefined
    expect(plain?.component).toBeUndefined()
  })

  it('② 组件 props 走 component-prop 槽位（→ CALL_COMPONENT_UPDATE 通道）', () => {
    const r = buildVaporSubscriptions(COMP_SFC, 'c.vue')
    const slots = (r.table.sources || []).flatMap((s) => s.slots)
    const compSlot = slots.find((s) => s.kind === 'component-prop')
    expect(compSlot).toBeDefined()
    expect(compSlot!.propKey).toBe('component.prop1')
    // 反向：普通元素的 attr 绑定仍走 prop（不被误标组件）
    const propSlots = slots.filter((s) => s.kind === 'prop')
    expect(propSlots.every((s) => !String(s.propKey).startsWith('component.'))).toBe(true)
  })

  it('③ 组件的 style 声明仍进 layout（宿主位尺寸，与组件边界并存）', () => {
    const t = buildLayoutTemplate(COMP_SFC, 'c.vue').template
    const comp = t.nodes.find((n) => n.tag === 'MyComp')!
    expect((comp.style as Record<string, unknown>).height).toBe(20)
  })
})

describe('★★P2-3 事件修饰符（2026-10-03）：.stop/.self/.once 真语义 + 其余如实诊断', () => {
  // 【设计依据】能力清单 P2-3：修饰符语义在**运行时共享派发器**
  //   （`@proteus-vue/slot-runtime` 的 `dispatchGesture`）里实现——本组判编译期产物面
  //   （置位正确 / 误报为零），运行时语义由 `tests/slot-runtime-dispatch.test.ts` 判。
  it('`.stop` / `.self` / `.once` 置位（且不产诊断）', () => {
    const r = compileEvents(sfc(`<p-view @click.stop="count++"></p-view>`))
    expect(r.diagnostics).toHaveLength(0)
    expect(r.events[0]).toMatchObject({ nodeId: 0, event: 'tap', stop: true })
    expect(r.events[0]!.self, '未写的修饰符不得置位').toBeUndefined()

    const r2 = compileEvents(sfc(`<p-view @click.self="count++" @click.once="boxW += 1"></p-view>`))
    expect(r2.events[0]).toMatchObject({ self: true })
    expect(r2.events[1]).toMatchObject({ once: true })
  })

  it('链式修饰符（`.stop.once`）逐个识别（旧实现的尾缀正则只认最后一个）', () => {
    const r = compileEvents(sfc(`<p-view @click.stop.once="count++"></p-view>`))
    expect(r.events).toHaveLength(1)
    expect(r.events[0]).toMatchObject({ stop: true, once: true })
    // ★旧实现（`MODIFIER_RE` 只看末尾）会把 `click.stop` 整串当事件名的一部分 ⇒
    //   落到"事件未支持"诊断（误导修法）。本判据锁「多修饰符时不产生任何诊断」。
    expect(r.diagnostics, `链式修饰符不应有诊断：${r.diagnostics.map((d) => d.message).join(' | ')}`).toHaveLength(0)
  })

  it('反向：裸事件**不得**带任何修饰符字段（既有模板产物逐字节不变）', () => {
    const r = compileEvents(sfc(`<p-view @click="count++"></p-view>`))
    expect(r.events[0]).toEqual({ nodeId: 0, event: 'tap', handler: 'h0' })
  })

  it('`.prevent`/`.passive`/`.capture`/按键修饰符 ⇒ 诊断但仍执行 handler（不静默丢弃）', () => {
    for (const [mod, key] of [['prevent', '无对应语义'], ['passive', '无对应语义'], ['capture', '没有对应语义'], ['enter', '按键修饰符']] as const) {
      const r = compileEvents(sfc(`<p-view @click.${mod}="count++"></p-view>`))
      expect(r.events, `.${mod} 应仍产出绑定（handler 照常执行）`).toHaveLength(1)
      expect(r.diagnostics.length, `.${mod} 必须产诊断`).toBeGreaterThan(0)
      expect(r.diagnostics.map((d) => d.message).join(' | ')).toContain(key)
      // ★诊断对象是**修饰符**而不是事件名（否则修法会误导）
      expect(r.events[0]!.event, '事件语义不受修饰符影响').toBe('tap')
    }
  })

  it('未知修饰符 ⇒ 诊断（列出支持的三个），handler 仍执行', () => {
    const r = compileEvents(sfc(`<p-view @click.nonsense="count++"></p-view>`))
    expect(r.events).toHaveLength(1)
    expect(r.diagnostics.map((d) => d.message).join(' | ')).toContain('未知修饰符')
  })
})
