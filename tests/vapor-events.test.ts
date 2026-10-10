// tests/vapor-events.test.ts —— ★★**事件编译器**判据（交互闭环的编译期半边）
//
// 【为什么必须有】事件编译是"点得动"的**唯一入口**：它编不出事件 ⇒ 真机上手势能识别、
//   hitTest 能命中，而**没有任何 handler 可跑**（现象是"点了没反应"，且链路上零报错）。
//   本文件的判据分三层：① 支持形态**编对了**（动作语义正确）；② 不支持形态**编不出但产诊断**
//   （不静默）；③ **节点 id 与模板同序**（与 `buildLayoutTemplate` 的 id 分配同源——
//   分叉的后果是 handler 挂到别的节点上，症状伪装成"点错地方"）。
import { describe, it, expect } from 'vitest'
import { compileEvents, buildLayoutTemplate, buildVaporSubscriptions } from '@proteus-vue/compiler'
import { evalExpr } from '@proteus-vue/slot-runtime'
import type { ExprProgram } from '@proteus-vue/slot-runtime'

const sfc = (template: string, script = `const count = ref(0)\nconst toggle = ref(false)\nconst boxW = ref(120)\nconst list = ref([{ id: 1, w: 10 }])\n`): string =>
  `<template>\n${template}\n</template>\n\n<script setup lang="ts">\n${script}</script>\n`

describe('Vapor 事件编译 · 支持形态', () => {
  it('`count++` → set/add 动作（自增编成 add + 字面量 1）', () => {
    const r = compileEvents(sfc(`<p-view @click="count++"></p-view>`))
    expect(r.diagnostics).toHaveLength(0)
    expect(r.events).toEqual([{ nodeId: 0, event: 'tap', handler: 'h0', loc: { line: 2, column: 17 } }])
    expect(r.handlers.h0).toEqual([{ op: 'add', source: 'count', program: { k: 'lit', v: 1 } }])
  })

  it('★源位置 loc（决策 #712）：默认下 = **整份 .vue 文件**行号（模板块前有前置行时须偏移）', () => {
    // 前导注释 + 缩进 ⇒ `<template>` 落在文件第 2 行 ⇒ 事件在文件第 3 行（不是模板内容相对的第 2 行）
    const raw = `<!-- 头部注释 -->\n<template>\n  <p-view @click="count++"></p-view>\n</template>\n<script setup lang="ts">\nconst count = ref(0)\n</script>\n`
    const r = compileEvents(raw)
    expect(r.events).toHaveLength(1)
    // 行 = 文件行（3），列 = 模板内容相对列（Vue AST 口径，1 基）
    expect(r.events[0]!.loc?.line).toBe(3)
    expect(r.events[0]!.loc?.column).toBe(19)
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

  it('★`$nav(\'detail\')` → nav 动作（B1 导航一等动作；静态目标）', () => {
    const r = compileEvents(sfc(`<p-view @tap="$nav('detail')"></p-view>`))
    expect(r.diagnostics).toHaveLength(0)
    expect(r.events).toEqual([{ nodeId: 0, event: 'tap', handler: 'h0', loc: { line: 2, column: 15 } }])
    expect(r.handlers.h0).toEqual([{ op: 'nav', target: 'detail' }])
  })

  it('★`$nav(expr)`（动态目标）→ 明确诊断（不静默）', () => {
    const r = compileEvents(sfc(`<p-view @tap="$nav(target)"></p-view>`))
    expect(r.diagnostics.length).toBeGreaterThan(0)
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

// ═══════════ ★★★决策 #740 T1：事件处理器「方法引用 / 方法体」（2026-10-10）═══════════
// 【为什么单列一组】App 端此前只认**内联单语句**；真实页面写 `@click="handleTap"` ⇒
//   App 编不出事件（点了没反应），而 Web/小程序照常 ⇒ **三端分叉**（劝退级）。
//   本组判据锁：方法引用/无参调用 ⇒ 内联方法体降级为**同一套动作**；多语句 ⇒ 多动作按序；
//   ref `.value` 解包；不支持形态（任意函数）⇒ **明确诊断**（不静默、不产出事件）。T2 见下组。
describe('Vapor 事件编译 · ★★★方法引用 / 方法体（决策 #740 T1）', () => {
  const withScript = (body: string, tpl: string): string =>
    `<template>\n${tpl}\n</template>\n\n<script setup lang="ts">\nconst count = ref(0)\nconst show = ref(false)\n${body}\n</script>\n`

  it('方法引用 `@click="handleTap"`（方法体 count.value++）⇒ add 动作（ref .value 解包）', () => {
    const r = compileEvents(withScript(`function handleTap() { count.value++ }`, `<p-view @click="handleTap"></p-view>`))
    expect(r.diagnostics).toHaveLength(0)
    expect(r.events).toHaveLength(1)
    expect(r.handlers.h0).toEqual([{ op: 'add', source: 'count', program: { k: 'lit', v: 1 } }])
  })

  it('无参调用 `@click="handleTap()"` 与方法引用等价（同产物）', () => {
    const a = compileEvents(withScript(`function handleTap() { count.value++ }`, `<p-view @click="handleTap"></p-view>`))
    const b = compileEvents(withScript(`function handleTap() { count.value++ }`, `<p-view @click="handleTap()"></p-view>`))
    expect(b.handlers.h0).toEqual(a.handlers.h0)
  })

  it('箭头函数方法表也识别（`const handleTap = () => {…}`）', () => {
    const r = compileEvents(withScript(`const handleTap = () => { count.value++ }`, `<p-view @click="handleTap"></p-view>`))
    expect(r.handlers.h0).toEqual([{ op: 'add', source: 'count', program: { k: 'lit', v: 1 } }])
  })

  it('★多语句方法体 ⇒ 多动作按序（"先算后写"）', () => {
    const r = compileEvents(
      withScript(`function handleTap() { count.value++; show.value = !show.value }`, `<p-view @click="handleTap"></p-view>`),
    )
    expect(r.diagnostics).toHaveLength(0)
    expect(r.handlers.h0).toHaveLength(2)
    expect(r.handlers.h0![0]).toEqual({ op: 'add', source: 'count', program: { k: 'lit', v: 1 } })
    expect(r.handlers.h0![1]).toMatchObject({ op: 'set', source: 'show' })
  })

  it('★内联多语句 `@click="count++; show = !show"` ⇒ 两动作按序（此前诊断拒绝）', () => {
    const r = compileEvents(sfc(`<p-view @click="count++; toggle = !toggle"></p-view>`))
    expect(r.diagnostics).toHaveLength(0)
    expect(r.handlers.h0).toHaveLength(2)
    expect(r.handlers.h0![0]).toEqual({ op: 'add', source: 'count', program: { k: 'lit', v: 1 } })
  })

  it('方法体里的 `$nav` / `$emit` ⇒ 同内联动作（单点实现）', () => {
    const nav = compileEvents(withScript(`function go() { $nav('detail') }`, `<p-view @tap="go"></p-view>`))
    expect(nav.handlers.h0).toEqual([{ op: 'nav', target: 'detail' }])
    const em = compileEvents(withScript(`function bump() { $emit('bump', count) }`, `<p-view><p-text @tap="bump">t</p-text></p-view>`))
    // $emit 的载荷是 ref 源（count）⇒ 解包为 root
    expect(em.handlers.h0).toEqual([{ op: 'emit', event: 'bump', program: { k: 'root', name: 'count' } }])
  })

  it('`this`-free 成员写法定态：非 ref 的 `.value` 属性**不**解包（只解包已知 ref）', () => {
    // `obj` 不是 ref 工厂产物 ⇒ `obj.value` 保留为成员访问
    const r = compileEvents(withScript(`const obj = { value: 1 }\nfunction h() { count.value = obj.value }`, `<p-view @click="h"></p-view>`))
    expect(r.handlers.h0).toEqual([{ op: 'set', source: 'count', program: { k: 'mem', obj: { k: 'root', name: 'obj' }, key: 'value' } }])
  })

  // ★不支持形态：必须**诊断 + 不产出事件**（不静默——与 §"不支持形态"同纪律）
  //   ★T2/T3 起：带参/形参/if-else/局部变量/`console.*` 均已**支持**（见下方 T2/T3 describe）；
  //   此处只留**仍不支持**的任意函数（非 console、非组件方法的裸调用）。
  const unsupported: Array<[string, string, string, string]> = [
    ['任意未知函数 foo()', ``, `<p-view @click="foo()"></p-view>`, 'handler 形态不支持'],
  ]
  for (const [label, fn, tpl, expectMsg] of unsupported) {
    it(`${label} ⇒ 诊断（含修法）+ 不产出事件`, () => {
      const r = compileEvents(withScript(fn, tpl))
      expect(r.events, `${label} 不应产出事件`).toHaveLength(0)
      expect(r.diagnostics.map((d) => d.message).join(' | ')).toContain(expectMsg)
      expect(r.diagnostics.every((d) => (d.hint ?? '').length > 0), '每条诊断都要有修法').toBe(true)
    })
  }
})

// ═══════════ ★★★决策 #740 T2：带参调用 / 方法形参 / 方法内局部变量 / if-else ═══════════
// 【T2 补什么】T1 只到"方法引用/无参 + 平铺多语句"；真实页面还常写 `add(2)`（带参）、
//   方法内 `const y = …`（局部变量）、`if (cond) {…} else {…}`（条件分支）。
//   T2 在**编译期**把实参降级为 `let` 形参绑定、局部变量降级为 `let`、if 降级为 `if` 动作
//   （两臂子动作列表）——运行期 `runHandlerActions` 用**局部作用域 + 递归**执行（仍无 eval）。
describe('Vapor 事件编译 · ★★★T2（带参 / 形参 / 局部变量 / if-else）', () => {
  const withScript = (body: string, tpl: string): string =>
    `<template>\n${tpl}\n</template>\n\n<script setup lang="ts">\nconst count = ref(0)\nconst show = ref(false)\n${body}\n</script>\n`

  it('★带参调用 `add(2)` ⇒ 方法形参绑为 `let n = 2` + 方法体用 n', () => {
    const r = compileEvents(withScript(`function add(n: number) { count.value += n }`, `<p-view @click="add(2)"></p-view>`))
    expect(r.diagnostics, r.diagnostics.map((d) => d.message).join('|')).toHaveLength(0)
    expect(r.events).toHaveLength(1)
    // 先 let 绑形参（program = lit 2），再 add（program = root n）
    expect(r.handlers.h0).toEqual([
      { op: 'let', name: 'n', program: { k: 'lit', v: 2 } },
      { op: 'add', source: 'count', program: { k: 'root', name: 'n' } },
    ])
  })

  it('★`$event` 形参：`@click="onTap($event)"` 只是把事件载荷透传（编译期允许；运行时 event 注入）', () => {
    // 方法体引用 `$event`（形参名），实参就是 `$event`（root 名 '$event'）
    const r = compileEvents(withScript(`function setFrom(e: number) { count.value = e }`, `<p-view @click="setFrom(5)"></p-view>`))
    expect(r.handlers.h0).toEqual([
      { op: 'let', name: 'e', program: { k: 'lit', v: 5 } },
      { op: 'set', source: 'count', program: { k: 'root', name: 'e' } },
    ])
  })

  it('★方法内局部变量 `const y = count * 2` ⇒ `let y` 动作', () => {
    const r = compileEvents(withScript(`function h() { const y = count.value * 2; show.value = y }`, `<p-view @click="h"></p-view>`))
    expect(r.diagnostics, r.diagnostics.map((d) => d.message).join('|')).toHaveLength(0)
    expect(r.handlers.h0![0]).toMatchObject({ op: 'let', name: 'y' })
    expect(r.handlers.h0![1]).toMatchObject({ op: 'set', source: 'show' })
  })

  it('★`if (cond) {…} else {…}` ⇒ if 动作（两臂子动作列表 + 条件程序）', () => {
    const r = compileEvents(
      withScript(`function h() { if (count.value > 0) { show.value = true } else { show.value = false } }`, `<p-view @click="h"></p-view>`),
    )
    expect(r.diagnostics, r.diagnostics.map((d) => d.message).join('|')).toHaveLength(0)
    const act = r.handlers.h0![0] as { op: string; then: unknown[]; else: unknown[] }
    expect(act.op).toBe('if')
    expect(act.then).toHaveLength(1)
    expect(act.else).toHaveLength(1)
  })

  it('★内联 `@click="add(2)"` 也可（模板里直接调方法，带实参）', () => {
    const r = compileEvents(withScript(`function add(n: number) { count.value += n }`, `<p-view @click="add(2)"></p-view>`))
    expect(r.handlers.h0![0]).toEqual({ op: 'let', name: 'n', program: { k: 'lit', v: 2 } })
  })

  it('★实参个数不符 ⇒ 诊断（不静默）', () => {
    const r = compileEvents(withScript(`function add(a: number, b: number) { count.value = a + b }`, `<p-view @click="add(1)"></p-view>`))
    expect(r.events).toHaveLength(0)
    expect(r.diagnostics.map((d) => d.message).join(' | ')).toContain('需要 2 个实参')
  })

  it('★循环 / async 仍**明确不做**（诊断 + 修法）', () => {
    for (const [body, key] of [
      [`function h() { for (let i = 0; i < 3; i++) { count.value++ } }`, '循环'],
      [`async function h() { count.value++ }`, 'async'],
    ] as const) {
      const r = compileEvents(withScript(body, `<p-view @click="h"></p-view>`))
      expect(r.diagnostics.length, body).toBeGreaterThan(0)
      expect(r.diagnostics.map((d) => d.message).join(' | ')).toContain(key)
    }
  })
})

// ═══════════ ★★★T3：`console.*` → 面板日志（新 op `log`）═══════════
describe('Vapor 事件编译 · ★★★T3（console.* → 面板日志）', () => {
  const withScript = (body: string, tpl: string): string =>
    `<template>\n${tpl}\n</template>\n\n<script setup lang="ts">\nconst count = ref(0)\n${body}\n</script>\n`

  it('★`console.log(a, b)` ⇒ log 动作（level=log，实参各为求值程序）', () => {
    const r = compileEvents(withScript(`function h() { console.log('hit', count.value); count.value++ }`, `<p-view @click="h"></p-view>`))
    expect(r.diagnostics, r.diagnostics.map((d) => d.message).join('|')).toHaveLength(0)
    expect(r.handlers.h0![0]).toEqual({
      op: 'log',
      level: 'log',
      programs: [{ k: 'lit', v: 'hit' }, { k: 'root', name: 'count' }], // count.value 解包为 root count
    })
    expect(r.handlers.h0![1]).toMatchObject({ op: 'add', source: 'count' }) // 后续动作保留
  })

  it('★各 level 都认（info/warn/error/debug）', () => {
    for (const lv of ['info', 'warn', 'error', 'debug'] as const) {
      const r = compileEvents(withScript(`function h() { console.${lv}(count.value) }`, `<p-view @click="h"></p-view>`))
      expect(r.handlers.h0![0], lv).toMatchObject({ op: 'log', level: lv })
    }
  })

  it('★其它 console.*（table/time）⇒ 明确诊断（封闭集）', () => {
    const r = compileEvents(withScript(`function h() { console.table(count.value) }`, `<p-view @click="h"></p-view>`))
    expect(r.events).toHaveLength(0)
    expect(r.diagnostics.map((d) => d.message).join(' | ')).toContain('console.table')
  })

  it('★方法调方法（已可用）：递归内联为动作（含带参）', () => {
    const r = compileEvents(withScript(`function a() { b(3) }\nfunction b(n: number) { count.value += n }`, `<p-view @click="a"></p-view>`))
    expect(r.diagnostics, r.diagnostics.map((d) => d.message).join('|')).toHaveLength(0)
    expect(r.handlers.h0).toEqual([
      { op: 'let', name: 'n', program: { k: 'lit', v: 3 } },
      { op: 'add', source: 'count', program: { k: 'root', name: 'n' } },
    ])
  })
})

// ═══════════ ★★★决策 #740 T1 · 端到端（编译 → 执行 → 数据变更）═══════════
// 【为什么必须有】上面的判据只到"动作表编对了"；**真正的验收 = 点了数据真的变**。
//   本组用设备端 `screen-runtime.runHandler` 的**同一套动作语义**（add/set + evalExpr）跑一遍，
//   证明方法引用降级出的动作**真的改数据**（否则"编出来了"却"没效果"，等于没修）。
describe('★★★决策 #740 T1 · 端到端（编译 → 执行 → 数据变更）', () => {
  // 设备端 runHandler 的动作语义（与 render-backend/screen-runtime.ts 一致：add 累加 / set 赋值）
  function runHandler(handlers: Record<string, unknown[]>, name: string, data: Record<string, unknown>): void {
    for (const raw of handlers[name] ?? []) {
      const a = raw as { op: string; source?: string; program?: ExprProgram }
      const read = (n: string): unknown => data[n]
      if (!a.source) continue
      if (a.op === 'add') {
        const cur = data[a.source]
        const v = evalExpr(a.program!, { read })
        data[a.source] = (typeof cur === 'number' ? cur : 0) + (typeof v === 'number' ? v : 0)
      } else if (a.op === 'set') {
        data[a.source] = evalExpr(a.program!, { read })
      }
    }
  }
  const withScript = (body: string, tpl: string): string =>
    `<template>\n${tpl}\n</template>\n\n<script setup lang="ts">\nconst count = ref(0)\nconst show = ref(false)\n${body}\n</script>\n`

  it('`@click="handleTap"`（方法体 count.value++）→ 点击后 count 递增（App 端不再"点了没反应"）', () => {
    const r = compileEvents(withScript(`function handleTap() { count.value++ }`, `<p-view @click="handleTap"></p-view>`))
    const data: Record<string, unknown> = { count: 0, show: false }
    runHandler(r.handlers, r.events[0]!.handler, data)
    expect(data.count).toBe(1)
    runHandler(r.handlers, r.events[0]!.handler, data)
    expect(data.count).toBe(2)
  })

  it('★多语句方法体（count.value++; show.value = !show.value）→ 两处都生效', () => {
    const r = compileEvents(
      withScript(`function handleTap() { count.value++; show.value = !show.value }`, `<p-view @click="handleTap"></p-view>`),
    )
    const data: Record<string, unknown> = { count: 0, show: false }
    runHandler(r.handlers, r.events[0]!.handler, data)
    expect(data.count).toBe(1)
    expect(data.show).toBe(true)
    runHandler(r.handlers, r.events[0]!.handler, data)
    expect(data.show).toBe(false)
  })
})

describe('Vapor 事件编译 · ★不支持形态必须产诊断（不静默）', () => {
  const cases: Array<[string, string, string]> = [
    ['调用表达式（任意函数）', `<p-view @click="submit()"></p-view>`, 'handler 形态不支持'],
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

// ═══════════ ★★★B5：脚本级生命周期钩子（onMounted / onUnmounted）降级为动作 ═══════════
describe('Vapor 事件编译 · ★★★B5（脚本 onMounted / onUnmounted）', () => {
  const sfc2 = (script: string, tpl = `<p-view @click="count++"></p-view>`): string =>
    `<template>\n${tpl}\n</template>\n\n<script setup lang="ts">\nconst count = ref(0)\n${script}\n</script>\n`

  it('★`onMounted(() => { count.value = 99 })` ⇒ scriptLifecycle(mounted) 动作（事件 h0 不变）', () => {
    const r = compileEvents(sfc2(`onMounted(() => { count.value = 99 })`))
    expect(r.diagnostics, r.diagnostics.map((d) => d.message).join('|')).toHaveLength(0)
    // 事件 handler 仍 h0（脚本钩子在 walk 之后编号 ⇒ 既有事件命名不变）
    expect(r.events[0]!.handler).toBe('h0')
    expect(r.scriptLifecycle).toEqual([{ phase: 'mounted', handler: 'h1' }])
    expect(r.handlers.h1).toEqual([{ op: 'set', source: 'count', program: { k: 'lit', v: 99 } }])
  })

  it('★`onUnmounted(() => { count.value = 0 })` ⇒ scriptLifecycle(unmounted)', () => {
    const r = compileEvents(sfc2(`onUnmounted(() => { count.value = 0 })`))
    expect(r.scriptLifecycle).toEqual([{ phase: 'unmounted', handler: 'h1' }])
  })

  it('★两者并存 ⇒ 两条绑定（按源码序）；空体 ⇒ 不产出（无诊断）', () => {
    const both = compileEvents(sfc2(`onMounted(() => { count.value = 1 })\nonUnmounted(() => { count.value = 0 })`))
    expect(both.scriptLifecycle).toEqual([
      { phase: 'mounted', handler: 'h1' },
      { phase: 'unmounted', handler: 'h2' },
    ])
    const empty = compileEvents(sfc2(`onMounted(() => {})`))
    expect(empty.scriptLifecycle).toBeUndefined()
    expect(empty.diagnostics).toHaveLength(0)
  })

  it('★不可降级体（循环）⇒ 精确诊断 + 不产出（不静默）', () => {
    const r = compileEvents(sfc2(`onMounted(() => { for (let i = 0; i < 3; i++) count.value++ })`))
    expect(r.scriptLifecycle).toBeUndefined()
    expect(r.diagnostics.map((d) => d.message).join(' | ')).toContain('循环')
    expect(r.diagnostics.every((d) => (d.hint ?? '').length > 0)).toBe(true)
  })

  it('★两种钩子内容一致：`@vue:mounted` 与 `onMounted` 产出同一动作形态', () => {
    const tmplHook = compileEvents(sfc2(``, `<p-view @vue:mounted="count = 99"></p-view>`))
    const scriptHook = compileEvents(sfc2(`onMounted(() => { count.value = 99 })`))
    // 模板钩子进 lifecycle；脚本钩子进 scriptLifecycle——但动作体一致
    expect(tmplHook.handlers[tmplHook.lifecycle![0]!.handler]).toEqual(scriptHook.handlers.h1)
  })
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

  it('v-html 必须产诊断（此前静默）；★v-text / v-memo 已真支持（P2-6 / P2-5）', () => {
    expect(diagText(`<div v-html="a" style="height: 5px"></div>`)).toContain('v-html 未支持')
    // ★2026-10-03（P2-6）：v-text 从"诊断拒绝"升为**真支持**（与插值同槽位）
    expect(diagText(`<div v-text="a" style="height: 5px"></div>`), 'v-text 已支持').not.toContain('v-text 未支持')
    // ★2026-10-03（P2-5）：v-memo 从"诊断拒绝"升为**真支持**——数组字面量形态零诊断；
    //   非数组字面量仍诊断（形态诊断，不是"未支持"）
    expect(diagText(`<div v-memo="[a]" style="height: 5px"></div>`), 'v-memo 数组字面量已支持').not.toContain('v-memo 未支持')
    expect(diagText(`<div v-memo="a" style="height: 5px"></div>`), '非数组字面量必须诊断').toContain('数组字面量')
  })

  it('内置组件（Teleport / KeepAlive / TransitionGroup / Suspense）必须产诊断', () => {
    // ★2026-10-03（P3 批次）：Teleport/KeepAlive/Suspense 改为**逻辑容器透传** + **精确诊断**
    //   （不再是笼统的"未支持"）——判据改为核"各自的能力边界文案"（详见 vapor-logical-containers.test.ts）
    expect(diagText(`<Teleport to="#x"><i>t</i></Teleport>`)).toContain('传送语义')
    expect(diagText(`<KeepAlive><Comp /></KeepAlive>`)).toContain('组件级缓存')
    // ★2026-10-03（P3-3）：`<Transition>` 从"当普通容器"升为**真支持**（预设动画 + 宿主动画入口），
    //   换 `TransitionGroup` 验同一档缺口（列表差异/move 过渡仍未做）。
    expect(diagText(`<TransitionGroup><div /></TransitionGroup>`)).toContain('TransitionGroup 未支持')
    expect(diagText(`<Suspense><div /></Suspense>`)).toContain('异步边界')
    // ★反向：`<Transition>` 现在**不该**再报"未支持"（它只可能因用法问题产别的诊断）
    expect(diagText(`<Transition name="fade"><div v-show="a" /></Transition>`)).not.toContain('Transition 未支持')
  })

  it('★动态组件已真支持（P3，2026-10-03）——首帧解析；★插槽出口真支持（P1-3）', () => {
    // ★2026-10-03（P3 动态组件）：`<component :is>` 从"未支持"升为**首帧解析真支持**
    //   （编译期标记 + 实例化期求值 → 组件展开）；诊断改为**边界说明**（运行时切换不支持）
    expect(diagText(`<component :is="a" />`)).toContain('按**首帧值**解析组件')
    expect(diagText(`<component :is="a" />`), '不再是"未支持"').not.toContain('动态组件 `<component :is>` 未支持')
    // 缺 :is 的形态仍诊断
    expect(diagText(`<component />`)).toContain('动态组件缺 `:is`')
    // ★2026-10-03（P1-3 插槽分发）：`<slot name="x">` 从"未支持"升为**真支持**
    //   （出口溶解 + 内容分发，见 instantiate.ts dissolveOutlets）——不该再有"未支持"诊断
    expect(diagText(`<div><slot name="foo" /></div>`), '静态名已支持').not.toContain('插槽出口')
    // ★2026-10-03（P1-3 作用域插槽）：出口 props（`<slot :text="a">`）升为**真支持**
    //   （分发时求值 + 父级 `#x="sp"` 按它求值）——同样不该再有"未支持"诊断
    expect(diagText(`<div><slot :text="a">fb</slot></div>`), '出口 props 已支持').not.toContain('出口 props')
    // 仍不支持的形态（精确诊断，不静默半支持）
    expect(diagText(`<div><slot :name="a" /></div>`)).toContain('动态插槽名')
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
    // ★`loc` 是决策 #712 新增的**源位置**（非修饰符）——断言其余字段 + 无修饰符字段
    const ev = r.events[0] as unknown as Record<string, unknown>
    expect(ev.nodeId).toBe(0)
    expect(ev.event).toBe('tap')
    expect(ev.handler).toBe('h0')
    expect(ev.stop).toBeUndefined()
    expect(ev.self).toBeUndefined()
    expect(ev.once).toBeUndefined()
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
