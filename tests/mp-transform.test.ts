// tests/mp-transform.test.ts
// P4 转换函数单测（文档 P6-2 提前落地）：直接调用三个纯转换函数，验证映射表
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  transformTemplateToWxml,
  transformScriptToPage,
  transformStyleToWxss,
  compileVueSfc,
  validateJs,
  validateWxml,
} from '../packages/compiler/src'
import { vlqEncode, vlqDecode } from '../packages/compiler/src/script'

const opts = { px2rpx: true, rpxRatio: 2 }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('v-show（v0.3 指令补全）', () => {
  it('v-show → hidden 属性（display:none 语义，元素始终渲染）', () => {
    const { wxml } = transformTemplateToWxml('<p v-show="show">a</p>', opts)
    expect(wxml).toContain('hidden="{{!show}}"')
    expect(wxml).toContain('class="proteus-p"')
  })

  it('v-show 不再警告（原为 limitation 规则，已升级 implemented）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    transformTemplateToWxml('<p v-show="show">a</p>', opts)
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('v-show'))
  })
})

describe('computed 读路径（v0.3）', () => {
  const SRC = 'const count = ref(0)\nconst double = computed(() => count.value * 2)\nfunction add() {\n  count.value++\n}\nfunction setN() {\n  count.value = 5\n}'

  it('data 不含 computed 字段（派生字段不进初始 data）', () => {
    const { js } = transformScriptToPage(SRC, opts)
    const dataLine = js.split('\n').find((l) => l.includes('count: 0'))
    expect(dataLine).toBeTruthy()
    expect(js).not.toContain('double: undefined')
  })

  it('onLoad 初始化：首次渲染前计算派生字段', () => {
    const { js } = transformScriptToPage(SRC, opts)
    expect(js).toContain('this.setData({ double: this.data.count * 2 })')
  })

  it('依赖写入 setData 合并重算：先更新 this.data 再 setData（派生读到新值）', () => {
    const { js } = transformScriptToPage(SRC, opts)
    // 自增（后置）：先 this.data.count 更新，setData 对象里 count + double
    expect(js).toContain('this.data.count = (this.data.count === undefined || this.data.count === null ? 0 : this.data.count) + 1; this.setData({ count: this.data.count, double: this.data.count * 2 })')
    // 赋值：同样先写 this.data
    expect(js).toContain('this.data.count = 5; this.setData({ count: this.data.count, double: this.data.count * 2 })')
  })

  it('无写入的 ref（只读）不产生 setData', () => {
    const { js } = transformScriptToPage('const a = ref(1)\nconst b = computed(() => a.value + 1)', opts)
    expect(js).toContain('this.setData({ b: this.data.a + 1 })')
    expect(js.split('setData').length).toBeGreaterThanOrEqual(2) // onLoad 初始化 + 无其他
  })

  it('依赖未在顶层 data 定义 → 编译期警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    transformScriptToPage('const double = computed(() => count.value * 2)', opts)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('依赖 count 未在顶层 data 中定义'))
  })

  it('块体 computed（computed(() => { return ... })）→ 编译期警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { js } = transformScriptToPage('const c = ref(1)\nconst d = computed(() => { return c.value + 1 })', opts)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('仅支持箭头简写'))
    expect(js).not.toContain('d:')
  })

  it('模板插值直接渲染派生字段（{{ double }} 无需额外转换）', () => {
    const result = compileVueSfc('<script setup lang="ts">const count = ref(0)\nconst double = computed(() => count.value * 2)</script>\n<template><p>{{ double }}</p></template>')
    expect(result.wxml).toContain('{{ double }}')
    expect(result.js).toContain('this.setData({ double: this.data.count * 2 })')
  })
})

describe('scoped CSS（v0.3）', () => {
  const SFC = '<template>\n  <div class="card">\n    <p class="title">hi</p>\n  </div>\n</template>\n<style scoped>\n.card { padding: 8px; }\n.card .title { color: red; }\n</style>'

  it('★类名后缀拼接：用户 class 与 scopeId 拼接为单一类（.card → .card-data-v-x，Skyline 单类选择器 ✓）', () => {
    const result = compileVueSfc(SFC, { filename: 'scoped-demo.vue' })
    expect(result.wxml).toContain('data-v-')
    expect(result.wxml).toContain('class="card-data-v-') // 用户类名 + '-' + scopeId（不再并列 scope class——复合选择器 Skyline 不匹配）
    expect(result.wxml).toContain('class="proteus-p-data-v-') // 语义基础类同样后缀
    expect(result.wxml).toContain('title-data-v-')
    // 单 class 属性不变量（WXML 重复 class 属性只保留其一）
    expect(result.wxml).not.toMatch(/class="[^"]*"\s+class=/)
    expect(result.wxss).toContain('.card-data-v-')
    expect(result.wxss).not.toContain('.card.data-v-') // 复合选择器方案已废弃（Skyline 不匹配）
    expect(result.wxss).not.toContain('.card[data-v-') // 属性选择器 Skyline 不支持
  })

  it('@keyframes 帧选择器（from/to/百分比）不追加 scope class（Skyline 非法语法）', () => {
    const result = compileVueSfc(
      '<template><div class="a">x</div></template>\n<style scoped>\n@keyframes pop { from { opacity: 0; } 50% { opacity: 0.5; } to { opacity: 1; } }\n.a { animation: pop 0.3s; }\n</style>',
      { filename: 'keyframes-demo.vue' },
    )
    expect(result.wxss).toContain('@keyframes pop {')
    expect(result.wxss).toContain('from { opacity: 0; }')
    expect(result.wxss).toContain('to { opacity: 1; }')
    expect(result.wxss).not.toContain('from.data-v-')
    expect(result.wxss).not.toContain('to.data-v-')
    expect(result.wxss).not.toContain('50%.data-v-')
    expect(result.wxss).toContain('.a-data-v-') // 类名后缀拼接（单类选择器）
  })

  it('伪元素/伪类选择器：类名后缀后接伪选择器（.a-data-v-x::after / .a-data-v-x:hover）', () => {
    const result = compileVueSfc(
      '<template><div class="a">x</div></template>\n<style scoped>\n.a::after { border: none; }\n.a:hover { opacity: 0.8; }\n</style>',
      { filename: 'pseudo-demo.vue' },
    )
    expect(result.wxss).toMatch(/\.a-data-v-[a-f0-9]+::after/)
    expect(result.wxss).not.toContain('::after.data-v-')
    expect(result.wxss).toMatch(/\.a-data-v-[a-f0-9]+:hover/)
    expect(result.wxss).not.toContain(':hover.data-v-')
  })

  it('注释 + 换行 + 伪元素（类名后缀不受注释影响）', () => {
    const result = compileVueSfc(
      '<template><div class="a">x</div></template>\n<style scoped>\n/* 说明：清除原生 ::after 边框线 */\n.a::after { border: none; }\n</style>',
      { filename: 'pseudo-comment.vue' },
    )
    expect(result.wxss).toMatch(/\.a-data-v-[a-f0-9]+::after/)
    expect(result.wxss).not.toContain('::after.data-v-')
  })

  it('逗号选择器列表逐条后缀（.a, .b → .a-data-v-x, .b-data-v-x，无泄漏）', () => {
    const result = compileVueSfc(
      '<template><div class="a">x</div><div class="b">y</div></template>\n<style scoped>\n.a, .b { color: red; }\n</style>',
      { filename: 'comma-demo.vue' },
    )
    expect(result.wxss).toMatch(/\.a-data-v-[a-f0-9]+, \.b-data-v-[a-f0-9]+/)
    expect(result.wxss).not.toContain('.a, .b.data-v-')
  })

  it('scopeId 稳定（同文件同属性名），且产物自校验通过', () => {
    const a = compileVueSfc(SFC, { filename: 'scoped-demo.vue' })
    const b = compileVueSfc(SFC, { filename: 'scoped-demo.vue' })
    const idA = a.wxml.match(/data-v-[a-f0-9]+/)?.[0]
    const idB = b.wxml.match(/data-v-[a-f0-9]+/)?.[0]
    expect(idA).toBeTruthy()
    expect(idA).toBe(idB)
  })

  it(':deep() 去包装（内容保留 + 后缀）', () => {
    const result = compileVueSfc('<template><div class="a">x</div></template>\n<style scoped>\n.a :deep(.b) { color: red; }\n</style>', { filename: 'deep-demo.vue' })
    expect(result.wxss).toMatch(/\.a-data-v-[a-f0-9]+ \.b-data-v-[a-f0-9]+/) // :deep 去包装 + 类名后缀
    expect(result.wxss).not.toContain(':deep')
  })

  it('★默认 scoped（2026-08 用户决策）：<style> 无标记按 scoped 处理（类名后缀）+ 编译期警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = compileVueSfc('<template><div class="a">x</div></template>\n<style>\n.a { color: red; }\n</style>', { filename: 'plain-demo.vue' })
    expect(result.wxml).toContain('class="a-data-v-') // 默认 scoped：用户 class + 后缀
    expect(result.wxss).toContain('.a-data-v-') // 选择器后缀
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('scoped 处理'))
  })

  it('<style global> 显式全局：不作用域化（无后缀无警告）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = compileVueSfc('<template><div class="a">x</div></template>\n<style global>\n.a { color: red; }\n</style>', { filename: 'global-demo.vue' })
    expect(result.wxml).not.toContain('data-v-')
    expect(result.wxss).toContain('.a { color: red; }')
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('默认 scoped'))
  })

  it('同文件 scoped + global 分组输出（global 在前可被 scoped 覆盖）', () => {
    const result = compileVueSfc(
      '<template><div class="a">x</div></template>\n<style global>\n.g { color: red; }\n</style>\n<style scoped>\n.a { color: blue; }\n</style>',
      { filename: 'mixed-demo.vue' },
    )
    expect(result.wxss).toContain('.g { color: red; }') // global 不后缀
    expect(result.wxss).toContain('.a-data-v-') // scoped 后缀
    expect(result.wxss.indexOf('.g')).toBeLessThan(result.wxss.indexOf('.a-data-v-')) // global 在前
  })
})

describe(':class 数组语法（v0.3）', () => {
  it('数组 → 逐项拼接（字符串/对象/简单变量/三元）', () => {
    const { wxml } = transformTemplateToWxml('<p :class="[base, { active: on }, \'fixed\', cond ? \'a\' : \'b\']">x</p>', opts)
    expect(wxml).toContain("{{((base)?(base)+' ':'')+(on?'active ':'')+'fixed '+((cond ? 'a' : 'b')?(cond ? 'a' : 'b')+' ':'')}}")
  })

  it('数组项不支持形式 → 编译期警告并跳过该项', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { wxml } = transformTemplateToWxml('<p :class="[foo.bar(), ok]">x</p>', opts)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('数组项'))
    expect(wxml).toContain('ok')
  })
})

describe('watch（v0.3）', () => {
  const SRC = `const count = ref(0)
watch(count, (n, o) => {
  console.log(n, o)
})
function bump() {
  count.value++
}
function setN() {
  count.value = 5
}`

  it('生成 proteusWatchX 方法（回调体入 methods）', () => {
    const { js } = transformScriptToPage(SRC, opts)
    expect(js).toContain('proteusWatchCount(n, o) {')
    expect(js).toContain('console.log(n, o)')
  })

  it('依赖写入 setData 后自动调用：旧值在写入前保存 + 分号分隔', () => {
    const { js } = transformScriptToPage(SRC, opts)
    // 后置 ++（有 watch：先存旧值 → 先写 this.data → setData → 调用）
    expect(js).toContain('const oldCount = this.data.count; this.data.count = (this.data.count === undefined || this.data.count === null ? 0 : this.data.count) + 1; this.setData({ count: this.data.count }); this.proteusWatchCount(this.data.count, oldCount)')
    // 赋值
    expect(js).toContain('const oldCount = this.data.count; this.data.count = 5; this.setData({ count: this.data.count }); this.proteusWatchCount(this.data.count, oldCount)')
  })

  it('watch 与 computed 联动：写入时派生重算 + watch 调用同在', () => {
    const src = `const count = ref(0)\nconst double = computed(() => count.value * 2)\nwatch(count, (n) => {\n  log(n)\n})\nfunction setN() {\n  count.value = 5\n}`
    const { js } = transformScriptToPage(src, opts)
    expect(js).toContain('const oldCount = this.data.count; this.data.count = 5; this.setData({ count: this.data.count, double: this.data.count * 2 }); this.proteusWatchCount(this.data.count, oldCount)')
  })

  it('immediate: true → onLoad 初始化调用一次（oldVal = undefined）', () => {
    const src = `const count = ref(0)\nwatch(count, (n) => {\n  log(n)\n}, { immediate: true })`
    const { js } = transformScriptToPage(src, opts)
    expect(js).toContain('this.proteusWatchCount(this.data.count, undefined)')
  })

  it('watch 回调体内的 ref 读取被重写（this.data 形式）', () => {
    const src = `const count = ref(0)\nwatch(count, (n) => {\n  console.log(count.value)\n})`
    const { js } = transformScriptToPage(src, opts)
    expect(js).toContain('console.log(this.data.count)')
  })

  it('依赖未在顶层 data 定义 → 编译期警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    transformScriptToPage('watch(other, (n) => { log(n) })', opts)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('未在顶层 data 中定义'))
  })

  it('同一 ref 多个 watch → 警告（重名覆盖，MVP 每个 watch 源一个）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    transformScriptToPage('const c = ref(0)\nwatch(c, (n) => { a(n) })\nwatch(c, (n) => { b(n) })', opts)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('重名'))
  })

  it('rules.disabled 禁用 script/watch-to-methods → 不生成 watch 方法', () => {
    const { js } = transformScriptToPage('const c = ref(0)\nwatch(c, (n) => { a(n) })', opts, { rules: { disabled: ['script/watch-to-methods'] } })
    expect(js).not.toContain('proteusWatch')
  })

  it('数组源 watch([a, b]) → proteusWatchAAndB（多源回调数组，旧值逐个保存）', () => {
    const src = 'const a = ref(1)\nconst b = ref(2)\nwatch([a, b], (ns, os) => {\n  console.log(ns, os)\n})\nfunction setA() {\n  a.value = 5\n}'
    const { js } = transformScriptToPage(src, opts)
    expect(js).toContain('proteusWatchAAndB(ns, os) {')
    expect(js).toContain('const oldA = this.data.a, oldB = this.data.b; this.data.a = 5; this.setData({ a: this.data.a }); this.proteusWatchAAndB([this.data.a, this.data.b], [oldA, oldB])')
  })

  it('函数源 watch(() => expr) → 依赖从 getter 提取，回调收到求值结果', () => {
    const src = 'const a = ref(1)\nwatch(() => a.value * 2, (n) => {\n  log(n)\n})\nfunction setA() {\n  a.value = 5\n}'
    const { js } = transformScriptToPage(src, opts)
    expect(js).toContain('proteusWatchA(n) {')
    expect(js).toContain('this.proteusWatchA(this.data.a * 2, oldA)')
  })

  it('函数源依赖不在 data → 警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    transformScriptToPage('watch(() => other.value, (n) => { a(n) })', opts)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('未在顶层 data 中定义'))
  })

  it('computed 写路径：对象形式 get/set → proteusSetX 方法（setter 内 ref 写入照常重写）', () => {
    const src = 'const count = ref(0)\nconst double = computed({\n  get: () => count.value * 2,\n  set: (v) => { count.value = v / 2 },\n})\nfunction setD() {\n  double.value = 10\n}'
    const { js } = transformScriptToPage(src, opts)
    expect(js).toContain('proteusSetDouble(v) {')
    expect(js).toContain('this.data.count = v / 2; this.setData({ count: this.data.count, double: this.data.count * 2 })')
    expect(js).toContain('this.proteusSetDouble(10)')
  })

  it('computed 写路径：只读（无 setter）赋值 → 注释忽略（产物无副作用）', () => {
    const src = 'const count = ref(0)\nconst ro = computed(() => count.value + 1)\nfunction bad() {\n  ro.value = 5\n}'
    const { js } = transformScriptToPage(src, opts)
    expect(js).toContain('只读（无 setter），赋值已忽略')
    expect(js).not.toContain('ro.value = 5')
  })

  it('defineExpose：方法暴露 no-op（methods 天然可访问）', () => {
    const src = 'const props = defineProps({ label: String })\nfunction reset() {}\ndefineExpose({ reset })'
    const { js } = transformScriptToPage(src, opts, { isComponent: true })
    expect(js).toContain('reset() {')
    // no-op：不额外生成代码
    expect(js).not.toContain('defineExpose')
  })

  it('defineExpose 暴露 ref 值 → 警告（请用方法包装）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const src = 'const count = ref(0)\ndefineExpose({ count })'
    transformScriptToPage(src, opts, { isComponent: true })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ref 值'))
  })

  it('defineExpose 不污染 data（组件宏跳过提取）', () => {
    const src = 'const count = ref(0)\ndefineExpose({ count })\nfunction go() {}'
    const { js } = transformScriptToPage(src, opts, { isComponent: true })
    expect(js).toContain('count: 0')
    expect(js).not.toContain('count: undefined')
  })

  it('TS 泛型 defineProps<{...}> → properties（类型映射 + 可选标记）', () => {
    const src = 'const props = defineProps<{ label: string; count?: number; done: boolean }>()\nfunction log() {\n  console.log(props.label)\n}'
    const { js } = transformScriptToPage(src, opts, { isComponent: true })
    expect(js).toContain('label: { type: String, value: "" }')
    expect(js).toContain('count: { type: Number, value: 0 }')
    expect(js).toContain('done: { type: Boolean, value: false }')
    // props 访问重写（泛型形式 propsVar 提取）
    expect(js).toContain('console.log(this.data.label)')
  })

  it('TS 泛型 defineProps 数组/联合类型 → Array/String', () => {
    const src = 'const props = defineProps<{ tags: string[]; kind: \'a\' | \'b\' }>()'
    const { js } = transformScriptToPage(src, opts, { isComponent: true })
    expect(js).toContain('tags: { type: Array }')
    expect(js).toContain('kind: { type: String, value: "" }')
  })

  it('TS 泛型 defineProps 未知类型 → 警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    transformScriptToPage("const props = defineProps<{ x: CustomThing }>()", opts, { isComponent: true })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('无法映射'))
  })
})

describe('组件系统（v0.3：defineProps / defineEmits / slots）', () => {
  const COMP = `const props = defineProps({ initial: { type: Number, default: 0 }, label: String })\nconst emit = defineEmits(['change'])\nconst count = ref(0)\nfunction add() {\n  count.value++\n  emit('change', count.value)\n}`

  it('defineProps → Component properties（type + 默认值）', () => {
    const { js } = transformScriptToPage(COMP, opts, { isComponent: true })
    expect(js).toContain('Component({')
    expect(js).toContain('properties: {')
    expect(js).toContain('initial: { type: Number, value: 0 }')
    expect(js).toContain('label: { type: String, value: "" }')
  })

  it('defineProps/defineEmits 不作为 data 字段（组件宏跳过提取）', () => {
    const { js } = transformScriptToPage(COMP, opts, { isComponent: true })
    expect(js).not.toContain('props: undefined')
    expect(js).not.toContain('emit: undefined')
  })

  it('emit(...) → this.triggerEvent(...)', () => {
    const { js } = transformScriptToPage(COMP, opts, { isComponent: true })
    expect(js).toContain('this.triggerEvent(\'change\', this.data.count)')
    expect(js).not.toContain('emit(\'change')
  })

  it('组件模式不生成 onLoad（微信组件生命周期无 onLoad）；computed 初始化走 attached', () => {
    const src = 'const c = ref(0)\nconst d = computed(() => c.value * 2)'
    const { js } = transformScriptToPage(src, opts, { isComponent: true })
    expect(js).not.toContain('onLoad(')
    expect(js).toContain('attached() {')
    expect(js).toContain('this.setData({ d: this.data.c * 2 })')
  })

  it('页面模式仍生成默认 onLoad（组件不影响页面）', () => {
    const { js } = transformScriptToPage('const c = ref(0)', opts, { isComponent: false })
    expect(js).toContain('onLoad(options)')
  })

  it('方法参数 TS 标注被剥离（产物纯 JS）', () => {
    const src = 'function handle(e: { detail?: number }) {\n  const v = e.detail\n}'
    const { js } = transformScriptToPage(src, opts)
    expect(js).toContain('handle(e) {')
    expect(js).not.toContain('e: {')
  })

  it('props 访问重写：props.xxx → this.data.xxx', () => {
    const src = 'const props = defineProps({ label: String })\nfunction log() {\n  console.log(props.label)\n}'
    const { js } = transformScriptToPage(src, opts, { isComponent: true })
    expect(js).toContain('console.log(this.data.label)')
  })

  it('<slot> 标签原样透传', () => {
    const { wxml } = transformTemplateToWxml('<div><slot /></div>', opts)
    expect(wxml).toContain('<slot />')
  })

  it('父组件自定义事件（非 EVENT_MAP）→ bind: 冒号形式', () => {
    const { wxml } = transformTemplateToWxml('<counter @updated="onUpdated" />', opts)
    expect(wxml).toContain('bind:updated="onUpdated"')
    // EVENT_MAP 内事件保持 bindxxx 无冒号（兼容既有产物）
    const w = transformTemplateToWxml('<button @click="go">x</button>', opts)
    expect(w.wxml).toContain('bindtap="go"')
  })

  it('compileVueSfc 组件模式整包编译通过（含 properties）', () => {
    const result = compileVueSfc('<script setup lang="ts">const props = defineProps({ label: String })</script>\n<template><div>{{ label }}</div></template>', { isComponent: true, filename: 'components/x/index.vue' })
    expect(result.js).toContain('Component({')
    expect(result.js).toContain('label: { type: String, value: "" }')
  })

  it('CSS 预处理器（v0.3 尾）：lang=scss 经 preprocessStyle 钩子转 css 进 WXSS', () => {
    const src = '<template><div class="a">x</div></template>\n<style lang="scss">\n$c: red;\n.a { color: $c; }\n</style>'
    const preprocessStyle = vi.fn((_lang: string, content: string) => content.replace('$c: red;\n', '').replace('$c', 'red'))
    const result = compileVueSfc(src, { preprocessStyle })
    expect(preprocessStyle).toHaveBeenCalledWith('scss', expect.stringContaining('$c'))
    expect(result.wxss).toMatch(/\.a-data-v-[a-f0-9]+ \{ color: red; \}/) // 默认 scoped（2026-08）：选择器后缀
    expect(result.wxss).not.toContain('$c')
  })

  it('无 lang 的 style 不触发 preprocessStyle', () => {
    const src = '<template><div>x</div></template>\n<style>.a { color: red; }</style>'
    const preprocessStyle = vi.fn()
    compileVueSfc(src, { preprocessStyle })
    expect(preprocessStyle).not.toHaveBeenCalled()
  })
})

describe('sourcemap（v0.3：方法级 JS 源码映射）', () => {
  it('vlqEncode/vlqDecode 往返一致', () => {
    for (const v of [0, 1, -1, 5, -5, 15, -16, 31, 63, 1000, -1000]) {
      expect(vlqDecode(vlqEncode(v))[0]).toBe(v)
    }
  })

  it('compileVueSfc 生成 sourcemap，方法体行映射到源码行', () => {
    const src = '<script setup lang="ts">\nconst count = ref(0)\nfunction add() {\n  count.value++\n}\n</script>\n<template><div>x</div></template>'
    const result = compileVueSfc(src, { filename: 'pages/sm.vue' })
    expect(result.sourcemap).toBeTruthy()
    const map = JSON.parse(result.sourcemap!)
    expect(map.version).toBe(3)
    expect(map.sources).toContain('pages/sm.vue')
    expect(map.sourcesContent[0]).toContain('const count = ref(0)')
    // 解码 mappings：sourceLine 是 delta，累加后应命中源码第 4 行（count.value++，0-based 3）
    const rows = map.mappings.split(';')
    let acc = 0
    const hit = rows.some((r: string) => {
      if (!r) return false
      const d = vlqDecode(r)
      acc += d[2] ?? 0
      return acc === 3
    })
    expect(hit).toBe(true)
  })
})

describe('虚拟列表（v0.4）', () => {
  it('scroll-view + @scroll → bindscroll（EVENT_MAP 新增 scroll）', () => {
    const { wxml } = transformTemplateToWxml('<scroll-view scroll-y @scroll="onScroll" />', opts)
    expect(wxml).toContain('bindscroll="onScroll"')
  })

  it('事件修饰符 .self → proteusSelfXxx 包装（target 判断）', () => {
    const result = compileVueSfc('<script setup lang="ts">function handleTap() {}</script>\n<template><button @click.self="handleTap">s</button></template>', { filename: 'pages/self.vue' })
    expect(result.wxml).toContain('bindtap="proteusSelfHandleTap"')
    expect(result.js).toContain('proteusSelfHandleTap(e) {')
    expect(result.js).toContain('if (e.target === e.currentTarget) {')
    expect(result.js).toContain('this.handleTap(e)')
  })

  it('事件修饰符 .once → proteusOnceXxx 包装（data 标记）', () => {
    const result = compileVueSfc('<script setup lang="ts">function go() {}</script>\n<template><button @click.once="go">o</button></template>', { filename: 'pages/once.vue' })
    expect(result.wxml).toContain('bindtap="proteusOnceGo"')
    expect(result.js).toContain('proteusOnceGo(e) {')
    expect(result.js).toContain('if (!this.data.__onceGo) {')
    expect(result.js).toContain('this.data.__onceGo = true')
  })

  it('键位修饰符 @keyup.enter → 编译期警告（input 用 @confirm）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    transformTemplateToWxml('<input @keyup.enter="go" />', opts)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('无对等键盘事件'))
  })

  it('.self 与 .stop 组合 → catch 优先（不包装）', () => {
    const { wxml } = transformTemplateToWxml('<a @click.stop.self="stopFn">s</a>', opts)
    expect(wxml).toContain('catchtap="stopFn"')
    expect(wxml).not.toContain('proteusSelf')
  })

  it('PListView 组件编译：properties（函数默认值忽略）+ 切片逻辑 + scroll-view 渲染 + observers', () => {
    const src = fs.readFileSync(path.resolve('src/components/p-list-view/index.vue'), 'utf-8')
    const r = compileVueSfc(src, { isComponent: true, filename: 'proteus/p-list-view/index.vue' })
    // properties：函数默认值（() => []）忽略，仅 type
    expect(r.js).toContain('items: { type: Array }')
    // 切片逻辑：props 重写 + slice（方法体内改写为 this.data）
    expect(r.js).toContain('this.data.items.slice')
    // items 变化响应：props 源 watch → observers
    expect(r.js).toContain('observers: {')
    // onReady 首屏计算
    expect(r.js).toContain('onReady()')
    expect(r.js).toContain('calc()')
    // 模板：scroll-view + bindscroll + 单一可视区 v-for（真机修复：无 wx:else 双 if）
    expect(r.wxml).toContain('<scroll-view')
    expect(r.wxml).toContain('bindscroll="onScroll"')
    expect(r.wxml).toContain('wx:for="{{visible}}"')
    expect(r.wxml).not.toContain('wx:else')
    expect(r.wxml).toContain('wx:key="i"')
    // 产物自校验通过（无坏产物）
    expect(r.js).not.toContain('undefined undefined')
  })

  it('VirtualList 兼容别名：转发 p-list-view（原 API 表面不变）', () => {
    const src = fs.readFileSync(path.resolve('src/components/virtual-list/index.vue'), 'utf-8')
    const r = compileVueSfc(src, { isComponent: true, filename: 'proteus/virtual-list/index.vue' })
    expect(r.wxml).toContain('<p-list-view')
    expect(r.wxml).toContain('items="{{items}}"')
    expect(r.js).toContain('items: { type: Array }')
  })
})

describe('transformTemplateToWxml（template → wxml）', () => {
  it('标准标签映射：div→view / span,p,h1→text / img→image', () => {
    const { wxml } = transformTemplateToWxml('<div><span>hi</span><p>p</p><h1>t</h1><img :src="url" /></div>', opts)
    // 多 text + image（纵向容器）→ 不触发 auto-flex-row（保守规则）
    expect(wxml).toContain('<view>')
    expect(wxml).toContain('<text>hi</text>')
    expect(wxml).toContain('<text class="proteus-p">p</text>')
    expect(wxml).toContain('<text class="proteus-h1">t</text>')
    expect(wxml).toContain('<image src="{{url}}" />')
  })

  it('语义标签自动附加基础类，与静态 class / :class 共存', () => {
    const { wxml } = transformTemplateToWxml(
      '<h1 class="title">a</h1><p :class="{ active: on }">b</p><h2>c</h2><div class="plain">d</div>',
      opts,
    )
    expect(wxml).toContain('<text class="proteus-h1 title">a</text>')
    expect(wxml).toContain('<text class="proteus-p {{(on?\'active \':\'\')}}">b</text>')
    expect(wxml).toContain('<text class="proteus-h2">c</text>')
    // 非语义标签（div）不附加基础类
    expect(wxml).toContain('<view class="plain">d</view>')
  })

  it('v-if / v-else → wx:if / wx:else', () => {
    const { wxml } = transformTemplateToWxml('<p v-if="show">a</p><p v-else>b</p>', opts)
    expect(wxml).toContain('wx:if="{{show}}"')
    expect(wxml).toContain('wx:else')
  })

  it('v-for → wx:for / wx:for-item / wx:for-index（:key 映射 wx:key）', () => {
    const { wxml } = transformTemplateToWxml('<div v-for="(item, idx) in list" :key="idx">{{ item }}</div>', opts)
    expect(wxml).toContain('wx:for="{{list}}"')
    expect(wxml).toContain('wx:for-item="item"')
    expect(wxml).toContain('wx:for-index="idx"')
    expect(wxml).toContain('wx:key="idx"')
  })

  it('事件映射：@click→bindtap / @click.stop→catchtap / @input→bindinput', () => {
    const { wxml } = transformTemplateToWxml(
      '<button @click="handleTap">go</button><a @click.stop="stopFn">s</a><input @input="onInput" />',
      opts,
    )
    expect(wxml).toContain('bindtap="handleTap"')
    expect(wxml).toContain('catchtap="stopFn"')
    expect(wxml).toContain('bindinput="onInput"')
  })

  it('v-model → value + bindinput，并收集绑定名', () => {
    const { wxml, vModelBindings } = transformTemplateToWxml('<input v-model="text" />', opts)
    expect(wxml).toContain('value="{{text}}"')
    expect(wxml).toContain('bindinput="proteusOnTextInput"')
    expect(vModelBindings).toEqual(['text'])
  })

  it('v-html → rich-text（不附加基础类）', () => {
    const { wxml } = transformTemplateToWxml('<div v-html="html"></div>', opts)
    expect(wxml).toContain('<rich-text nodes="{{html}}" />')
  })

  it(':class 对象语法 → 三元拼接', () => {
    const { wxml } = transformTemplateToWxml('<div :class="{ active: isActive }">x</div>', opts)
    expect(wxml).toContain("isActive?'active '")
  })

  it(':src / :style 绑定 → {{ }}', () => {
    const { wxml } = transformTemplateToWxml('<div :style="{ color: c }">x</div><img :src="img" />', opts)
    expect(wxml).toContain('style="color:{{c}}"')
    expect(wxml).toContain('src="{{img}}"')
  })

  it('导航链接：<a href> → view bindtap proteusNavigateTo + data-url（并标记 usesNavigate）', () => {
    const { wxml, usesNavigate } = transformTemplateToWxml('<a href="/pages/user/profile">go</a>', opts)
    expect(wxml).toContain('bindtap="proteusNavigateTo"')
    expect(wxml).toContain('data-url="/pages/user/profile"')
    expect(wxml).toContain('<view')
    expect(wxml).toContain('class="proteus-a"')
    expect(usesNavigate).toBe(true)
  })

  it('<router-link to> 与 route-type → data-url / data-route-type；对象形式 :to 告警', () => {
    const { wxml } = transformTemplateToWxml(
      `<router-link to="/pages/x" route-type="halfScreen">x</router-link>`,
      opts,
    )
    expect(wxml).toContain('data-url="/pages/x"')
    expect(wxml).toContain('data-route-type="halfScreen"')
    expect(wxml).toContain('bindtap="proteusNavigateTo"')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    transformTemplateToWxml(`<router-link :to="{ name: 'x' }">x</router-link>`, opts)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('对象形式暂不支持'))
  })

  it('<a @click> 仍按事件映射（不作为导航链接）', () => {
    const { wxml, usesNavigate } = transformTemplateToWxml('<a href="/x" @click="fn">go</a>', opts)
    expect(wxml).toContain('bindtap="fn"')
    expect(usesNavigate).toBe(false)
  })

  it('文本插值保留为 {{ }}', () => {
    const { wxml } = transformTemplateToWxml('<p>{{ msg }}</p>', opts)
    expect(wxml).toContain('{{ msg }}')
  })
})

describe('transformScriptToPage（script → Page 构造器）', () => {
  it('ref/reactive/字面量 const → data', () => {
    const { js } = transformScriptToPage(
      "import { ref } from 'vue'\nconst title = ref('Proteus')\nconst count = ref(0)\nconst imgUrl = '/logo.png'",
      opts,
    )
    expect(js).toContain('Page({')
    expect(js).toContain('title: "Proteus"')
    expect(js).toContain('count: 0')
    expect(js).toContain('imgUrl: "/logo.png"')
  })

  it('顶层函数 → methods（对象方法简写）', () => {
    const { js } = transformScriptToPage('function greet(name) { return "hi " + name }', opts)
    expect(js).toContain('greet(name) {')
    expect(js).toContain('"hi " + name')
    // 对象字面量中必须是方法简写，不能是裸 function 声明
    expect(js).not.toContain('  function greet')
  })

  it('生命周期映射：onMounted→onReady / onUnmounted→onUnload', () => {
    const { js } = transformScriptToPage(
      "onMounted(() => {\n  console.log('ready')\n})\nonUnmounted(() => {\n  console.log('bye')\n})",
      opts,
    )
    expect(js).toContain('onReady() {')
    expect(js).toContain("console.log('ready')")
    expect(js).toContain('onUnload() {')
  })

  it('方法内 ref 写入重写为 setData（++/--/赋值/读取，不用 ?? 运算符）', () => {
    const { js } = transformScriptToPage(
      [
        'const count = ref(0)',
        'const title = ref("x")',
        'function inc() { count.value++ }',
        'function dec() { count.value-- }',
        'function setTitle() { title.value = "y" }',
        'function read() { return count.value }',
      ].join('\n'),
      opts,
    )
    expect(js).toContain('this.setData({ count: (this.data.count === undefined || this.data.count === null ? 0 : this.data.count) + 1 })')
    expect(js).toContain('this.setData({ count: (this.data.count === undefined || this.data.count === null ? 0 : this.data.count) - 1 })')
    expect(js).toContain('this.setData({ title: "y" })')
    expect(js).toContain('return this.data.count')
    // 不残留裸的 .value 与 ?? 运算符（真机预览 SyntaxError: Unexpected token ?）
    expect(js).not.toMatch(/\bcount\.value\b/)
    expect(js).not.toMatch(/\btitle\.value\b/)
    expect(js).not.toContain('??')
  })

  it('生命周期体内 ref 写入同样重写', () => {
    const { js } = transformScriptToPage('const n = ref(0)\nonMounted(() => {\n  n.value = 5\n})', opts)
    expect(js).toContain('this.setData({ n: 5 })')
  })

  it('多行 RHS ref 赋值（箭头函数体）→ 完整 setData（B5 修复：旧捕获 [^;\\n]+ 截断多行）', () => {
    const src = [
      'const timer = ref(0)',
      'const emit = defineEmits(["close"])',
      'function go() {',
      '  timer.value = setTimeout(() => {',
      "    emit('close')",
      '  }, 100)',
      '}',
    ].join('\n')
    const { js } = transformScriptToPage(src, opts, { isComponent: true })
    expect(js).toContain("this.setData({ timer: setTimeout(() => {")
    expect(js).toContain("this.triggerEvent('close')")
    expect(js).toContain('}, 100) })')
    // 不残留裸 .value 与孤立的 {}（旧产物：setTimeout(() => { }) 后悬挂 triggerEvent）
    expect(js).not.toMatch(/\btimer\.value\b/)
    expect(js).not.toContain('setTimeout(() => { })')
  })

  it('v-model handler 注入：proteusOnXxxInput(e) { this.setData(...) }', () => {
    const { js } = transformScriptToPage('', opts, { vModelBindings: ['text'] })
    expect(js).toContain('proteusOnTextInput(e) { this.setData({ text: e.detail.value }) }')
  })

  it('usesNavigate → 自动注入 proteusNavigateTo handler（方法名避开 __ 前缀）', () => {
    const { js } = transformScriptToPage('', opts, { usesNavigate: true })
    expect(js).toContain('proteusNavigateTo(e) {')
    expect(js).not.toContain('__navigateTo')
    expect(js).toContain('wx.navigateTo(nav)')
    expect(js).toContain('ds.routeType')
  })

  it('导航 url 保留前导 /（微信 navigateTo 相对路径会解析成 pages/pages/... 报错）', () => {
    const { js } = transformScriptToPage('', opts, { usesNavigate: true })
    expect(js).toContain('const url = String(ds.url || "")')
    expect(js).not.toContain('replace(/^[/]/')
  })

  it('生成代码避免数组解构/对象展开（微信 ES5 转译 babel helper 问题）', () => {
    const { js } = transformScriptToPage('', opts, { usesNavigate: true, vModelBindings: ['text'] })
    // onLoad 用索引循环，不用 for (const [k, v] of ...)
    expect(js).toContain('const keys = Object.keys(options || {})')
    expect(js).not.toContain('for (const [k, v]')
    // 导航不用对象展开
    expect(js).not.toContain('...opts')
    expect(js).not.toContain('...(')
  })

  it('全链路调试日志：debug=true 注入 [proteus][环节] 日志，默认构建零日志', () => {
    const dbg = transformScriptToPage('', opts, { usesNavigate: true, debug: true, file: 'pages/index' })
    expect(dbg.js).toContain("[proteus][page] onLoad pages/index")
    expect(dbg.js).toContain("[proteus][page] onReady pages/index")
    expect(dbg.js).toContain("[proteus][nav] tap")
    expect(dbg.js).toContain("[proteus][nav] navigateTo success")
    expect(dbg.js).toContain("[proteus][nav] navigateTo fail")
    const plain = transformScriptToPage('', opts, { usesNavigate: true, file: 'pages/index' })
    expect(plain.js).not.toContain('[proteus]')
  })

  it('多行对象数组 ref → data 完整提取（字符串内括号不干扰，★showcase 修复）', () => {
    const { js } = transformScriptToPage(
      [
        "import { ref } from 'vue'",
        'const cards = ref([',
        "  { title: '缓出/缓入曲线', desc: '进入 easeOutCubic / 退出 easeInCubic' },",
        "  { title: '遮罩 barrierColor', desc: 'rgba(0,0,0,0.8) + 点击关闭' },",
        '])',
      ].join('\n'),
      opts,
    )
    expect(js).toContain('cards: [{"title":"缓出/缓入曲线","desc":"进入 easeOutCubic / 退出 easeInCubic"},{"title":"遮罩 barrierColor","desc":"rgba(0,0,0,0.8) + 点击关闭"}]')
    expect(js).not.toContain('cards: undefined')
  })

  it('多行普通数组 / 带分号初始值同样支持', () => {
    const { js } = transformScriptToPage(
      [
        'const tags = [',
        "  'a',",
        "  'b',",
        ']',
        "const title = ref('x');",
      ].join('\n'),
      opts,
    )
    expect(js).toContain('tags: ["a","b"]')
    expect(js).toContain('title: "x"')
  })

  it('函数体/生命周期体内的局部 const 不提取为 data', () => {
    const { js } = transformScriptToPage(
      [
        'const top = ref(1)',
        'function foo() {',
        '  const hidden = 2',
        '  return hidden',
        '}',
        "onMounted(() => {",
        '  const inner = ref(3)',
        '  inner.value = 5',
        '})',
      ].join('\n'),
      opts,
    )
    expect(js).toContain('top: 1')
    expect(js).not.toContain('hidden:')
    expect(js).not.toContain('inner:')
  })

  it('多行方法体内 const 不误伤（缩进判断）', () => {
    const { js } = transformScriptToPage(
      [
        'const a = 1',
        'function handler() {',
        '  const b = [',
        '    1,',
        '    2,',
        '  ]',
        '  return b',
        '}',
      ].join('\n'),
      opts,
    )
    expect(js).toContain('a: 1')
    expect(js).not.toContain('b:')
  })

  it('组件（isComponent）→ Component 构造器', () => {
    const { js } = transformScriptToPage('const name = ref("x")', opts, { isComponent: true })
    expect(js).toContain('Component({')
    expect(js).not.toContain('Page({')
  })
})

describe('compileVueSfc（整包编译入口）', () => {
  it('SFC → wxml/js/wxss 一次产出', () => {
    const sfc = [
      '<route>{ "meta": { "title": "x" } }</route>',
      '<script setup lang="ts">',
      "import { ref } from 'vue'",
      "const title = ref('hi')",
      '</script>',
      '<template>',
      '<div class="a"><h1>{{ title }}</h1><img :src="url" /></div>',
      '</template>',
      '<style>.a { padding: 16px; }</style>',
    ].join('\n')
    const { wxml, js, wxss, warnings } = compileVueSfc(sfc, { filename: 'pages/test/index' })
    expect(wxml).toContain('a-data-v-') // 默认 scoped（2026-08）——auto-flex-row 前缀共存
    expect(wxml).toContain('<image src="{{url}}" />')
    expect(js).toContain('Page({')
    expect(js).toContain('title: "hi"')
    expect(js).toContain('// pages/test/index（Proteus mp-transform 编译产物）')
    expect(wxss).toContain('32rpx')
    expect(Array.isArray(warnings)).toBe(true)
  })

  it('isComponent → Component 构造器', () => {
    const sfc = '<script setup lang="ts">const n = ref(1)</script><template><div>{{ n }}</div></template>'
    const { js } = compileVueSfc(sfc, { isComponent: true })
    expect(js).toContain('Component({')
  })

  it('★async 方法：async 修饰保留（方法体 await 合法，platform-plan B1 修复）', () => {
    const sfc = '<script setup lang="ts">async function loadData() { const r = await fetchData() }</script><template><view>x</view></template>'
    const { js } = compileVueSfc(sfc)
    expect(js).toContain('async loadData() {')
    expect(js).toContain('await fetchData()')
  })

  it('★方法体 TS 类型断言剥离（as unknown/泛型，platform-plan B1 修复）', () => {
    const sfc = '<script setup lang="ts">function f() { const x = get() as unknown as Capability<Foo>; return x }</script><template><view>x</view></template>'
    const { js } = compileVueSfc(sfc)
    expect(js).toContain('const x = get()')
    expect(js).not.toContain('as unknown')
    expect(js).not.toContain('Capability<Foo>')
  })
})

describe('transformStyleToWxss（style → wxss）', () => {
  it('px → rpx（含小数）', () => {
    const css = transformStyleToWxss('.a { padding: 48px 1.5px; }', opts)
    expect(css).toContain('96rpx')
    expect(css).toContain('3rpx')
    expect(css).not.toContain('48px')
  })

  it('标签选择器映射：语义标签 → 基础类（.links a → .links .proteus-a / h1 → .proteus-h1），div → view', () => {
    const css = transformStyleToWxss('.links a { color: #1a7af8; }\nh1 { font-size: 32px; }\np { margin: 0; }\ndiv > p { padding: 4px; }', opts)
    expect(css).toContain('.links .proteus-a { color: #1a7af8; }')
    expect(css).toContain('.proteus-h1 { font-size: 64rpx; }')
    expect(css).toContain('.proteus-p { margin: 0; }')
    expect(css).toContain('view > .proteus-p { padding: 8rpx; }')
    expect(css).not.toContain('.links a')
    expect(css).not.toContain('.links view')
  })

  it('多对一映射不撞选择器：.card h3 与 .card p 独立（★showcase 卡片 h3 被染灰回归）', () => {
    const css = transformStyleToWxss(
      '.card h3 { margin: 0 0 4px; font-size: 16px; }\n.card p { margin: 0; color: #666; font-size: 13px; }',
      opts,
    )
    expect(css).toContain('.card .proteus-h3 { margin: 0 0 8rpx; font-size: 32rpx; }')
    expect(css).toContain('.card .proteus-p { margin: 0; color: #666; font-size: 26rpx; }')
    // 两条规则不再合并为同选择器（否则后写 .card p 的 color:#666 会污染 h3）
    expect(css).not.toContain('.card text {')
  })

  it('div 与 a 同映射 view 也隔离：.x div → .x view、.x a → .x .proteus-a', () => {
    const css = transformStyleToWxss('.x div { color: blue; }\n.x a { color: red; }', opts)
    expect(css).toContain('.x view { color: blue; }')
    expect(css).toContain('.x .proteus-a { color: red; }')
  })

  it('注入 Web UA 语义基础样式（对齐 HTML 标准附录 D：font-size 固定 rpx + margin 单边 em）', () => {
    const css = transformStyleToWxss('', opts)
    expect(css).toContain('.proteus-h1 { display: block; font-size: 64rpx; font-weight: 700; margin: 0 0 0.67em; }')
    expect(css).toContain('.proteus-h2 { display: block; font-size: 48rpx; font-weight: 700; margin: 0 0 0.83em; }')
    expect(css).toContain('.proteus-p { display: block; margin: 0 0 1em; }')
    expect(css).toContain('.proteus-a { color: #1a7af8; text-decoration: underline; }')
    // margin 用 em（相对自身字号，与 Web UA 同比例），不经过 px2rpx；rpx 字号不被二次转换
    expect(css).not.toContain('margin: 24rpx 0')
    expect(css).not.toContain('font-size: 128rpx')
    // 基础类自身不被标签选择器重写误伤
    expect(css).not.toContain('.proteus-h1 { display: block; font-size: 128rpx')
  })

  it('伪类/伪函数：a:hover → .proteus-a:hover、:not(h1) → :not(.proteus-h1)、a.link → .proteus-a.link', () => {
    const css = transformStyleToWxss('a:hover { opacity: 0.5; }\n:not(h1) { color: gray; }\na.link { display: block; }', opts)
    expect(css).toContain('.proteus-a:hover { opacity: 0.5; }')
    expect(css).toContain(':not(.proteus-h1) { color: gray; }')
    expect(css).toContain('.proteus-a.link { display: block; }')
  })

  it('属性选择器保留：input[type="text"] → input[type="text"]（input→input 不变，属性内容不误伤）', () => {
    const css = transformStyleToWxss('input[type="text"] { border: 1px solid; }', opts)
    expect(css).toContain('input[type="text"] { border: 2rpx solid; }')
    expect(css).not.toContain('view[type="text"]')
  })

  it('类名/ID/长标识符不误伤：.a / #input / .tag-a / .data-input / .my-class 保持原样', () => {
    const css = transformStyleToWxss(
      '.a { color: red; }\n#input { color: blue; }\n.tag-a { color: green; }\n.data-input { color: black; }\n.my-class { color: white; }',
      opts,
    )
    expect(css).toContain('.a { color: red; }')
    expect(css).toContain('#input { color: blue; }')
    expect(css).toContain('.tag-a { color: green; }')
    expect(css).toContain('.data-input { color: black; }')
    expect(css).toContain('.my-class { color: white; }')
  })

  it('声明块内容不重写：content: "a" 的引号内容保留', () => {
    const css = transformStyleToWxss('view::before { content: "a"; }', opts)
    expect(css).toContain('view::before { content: "a"; }')
  })

  it('@media / @keyframes 骨架不被破坏', () => {
    const css = transformStyleToWxss(
      '@media (min-width: 600px) { h1 { color: red; } }\n@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }',
      opts,
    )
    expect(css).toContain('@media (min-width: 1200rpx) { .proteus-h1 { color: red; } }')
    expect(css).toContain('@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }')
  })

  it('float 触发编译期警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    transformStyleToWxss('.a { float: left; }', opts)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('float'))
  })
})

describe('产物自校验（反编译黑盒）', () => {
  it('validateJs：非法 JS 被检出', () => {
    expect(validateJs('Page({ data: {').ok).toBe(false)
    expect(validateJs('Page({ data: { a: 1 } })').ok).toBe(true)
  })

  it('validateWxml：标签不配对被检出', () => {
    expect(validateWxml('<view><text>a</view>').ok).toBe(false)
    expect(validateWxml('<view><text>a</text></view>').ok).toBe(true)
    // 行号注释（含标签文本）不应干扰校验
    expect(validateWxml('<!-- @3 div --><view />').ok).toBe(true)
  })

  it('compileVueSfc：合法输入不抛错（校验钩子生效）', () => {
    const sfc = '<script setup>const x = ref(1)</script><template><div>{{ x }}</div></template>'
    expect(() => compileVueSfc(sfc, { filename: 'pages/ok' })).not.toThrow()
  })

  it('annotateLines：产物注入源码行号注释（dev 调试）', () => {
    const sfc = ['<template>', '<div class="a">', '<h1>t</h1>', '</div>', '</template>'].join('\n')
    const { wxml } = compileVueSfc(sfc, { filename: 'pages/line', annotateLines: true })
    expect(wxml).toContain('<!-- @2 div -->')
    expect(wxml).toContain('<!-- @3 h1 -->')
    // 默认关闭：不影响正式产物
    const normal = compileVueSfc(sfc, { filename: 'pages/line' })
    expect(normal.wxml).not.toContain('<!-- @')
  })
})

describe('组件 class 透传（component/root-class，2026-08 真机实测）', () => {
  it('页面模式：组件标签 class → root-class 属性（scope class + 用户 class + :class 绑定合并）', () => {
    const { wxml } = compileVueSfc(
      '<script setup>const on = ref(true)</script>\n<template><p-view class="box" :class="{ on: on }">x</p-view></template>\n<style scoped>.box { padding: 8px; }</style>',
      { filename: 'pages/use-pview.vue' },
    )
    // 组件标签 class 后缀拼接后透传（root-class="box-data-v-x {{...}}"）
    expect(wxml).toMatch(/root-class="box-data-v-[a-f0-9]+ /)
    expect(wxml).toContain('{{(on?\'on-data-v-')
    // 组件标签不再输出独立 class 属性（避免 host 节点样式双重应用）
    expect(wxml).not.toMatch(/<p-view[^>]*\sclass="/)
    // scoped 后缀特征（类名拼接 -data-v-）
    expect(wxml).toContain('-data-v-')
  })

  it('组件模式：根节点 class 追加 {{rootClass}} + js 注入 rootClass property', () => {
    const { wxml, js } = compileVueSfc(
      '<template><view class="p-view"><slot /></view></template>\n<style scoped>.p-view { display: flex; }</style>',
      { filename: 'proteus/p-view/index', isComponent: true },
    )
    // 组件根节点：组件自身类名后缀 + {{rootClass}}（rootClass 由页面 root-class 传入，已后缀）
    expect(wxml).toMatch(/<view[^>]*class="p-view-data-v-[a-f0-9]+ \{\{rootClass\}\}"/)
    expect(js).toContain('rootClass: { type: String, value: "" }')
    // 非组件模式（页面）不注入 rootClass property
    const page = compileVueSfc('<template><view class="a">x</view></template>', { filename: 'pages/x.vue' })
    expect(page.js).not.toContain('rootClass')
  })

  it('组件根节点本身是组件标签（virtual-list 根 p-list-view）：root-class 透传自身 {{rootClass}}', () => {
    const { wxml } = compileVueSfc(
      '<template><p-list-view :items="items" /></template>\n<script setup>const items = ref([])</script>',
      { filename: 'proteus/virtual-list/index', isComponent: true },
    )
    expect(wxml).toContain('root-class="{{rootClass}}"')
  })

  it('rules.disabled 禁用 component/root-class → 回退普通 class 属性', () => {
    const { wxml } = compileVueSfc(
      '<template><p-view class="box">x</p-view></template>',
      { filename: 'pages/x.vue', rules: { disabled: ['component/root-class'] } },
    )
    expect(wxml).toContain('class="box"')
    expect(wxml).not.toContain('root-class')
  })
})

describe('页面滚动 API 桥接（page/scroll-bridge，15-page-scroll-container 批次2）', () => {
  it('onPageScroll + onReachBottom → 自动包装 scroll-view 绑定事件 + 桥接方法（载荷归一）', () => {
    const { wxml, js } = compileVueSfc(
      '<script setup>function onPageScroll(e) { console.log(e.scrollTop) }\nfunction onReachBottom() { console.log("bottom") }</script>\n<template><view class="a">x</view></template>',
      { filename: 'pages/scroll-demo.vue' },
    )
    expect(wxml).toContain('bindscroll="proteusPageScroll"')
    expect(wxml).toContain('bindscrolltolower="proteusReachBottom"')
    // 载荷归一：scroll-view e.detail.scrollTop → onPageScroll { scrollTop }
    expect(js).toContain('this.onPageScroll({ scrollTop: e.detail.scrollTop, scrollLeft: e.detail.scrollLeft })')
    expect(js).toContain('proteusReachBottom() { if (typeof this.onReachBottom === "function") this.onReachBottom() },')
  })

  it('onPullDownRefresh → refresher 绑定', () => {
    const { wxml } = compileVueSfc(
      '<script setup>function onPullDownRefresh() {}</script>\n<template><view class="a">x</view></template>',
      { filename: 'pages/pull.vue' },
    )
    expect(wxml).toContain('refresher-enabled="{{true}}"')
    expect(wxml).toContain('bindrefresherrefresh="proteusPullDownRefresh"')
  })

  it('无滚动钩子 → 不生成桥接', () => {
    const { wxml, js } = compileVueSfc('<template><view class="a">x</view></template>', { filename: 'pages/plain-scroll.vue' })
    expect(wxml).toContain('class="proteus-page-scroll"') // 仍自动包装
    expect(wxml).not.toContain('bindscroll=')
    expect(js).not.toContain('proteusPageScroll')
  })

  it('手动 scroll-view 根 + 声明滚动钩子 → 歧义警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    compileVueSfc('<script setup>function onPageScroll(e) {}</script>\n<template><scroll-view scroll-y><view>a</view></scroll-view></template>', {
      filename: 'pages/manual-scroll.vue',
    })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('歧义'))
  })

  it('组件模式不生成滚动桥接', () => {
    const { wxml, js } = compileVueSfc('<script setup>function onPageScroll(e) {}</script>\n<template><view>a</view></template>', {
      filename: 'components/x/index.vue',
      isComponent: true,
    })
    expect(wxml).not.toContain('proteus-page-scroll')
    expect(js).not.toContain('proteusPageScroll')
  })

  it('wx.pageScrollTo 桥接：调用改写为 this.proteusPageScrollTo + scroll-view scroll-top 绑定（批次3）', () => {
    const { wxml, js } = compileVueSfc(
      '<script setup>function goTop() { wx.pageScrollTo({ scrollTop: 0 }) }</script>\n<template><view class="a">x</view></template>',
      { filename: 'pages/pagescrollto.vue' },
    )
    expect(wxml).toContain('scroll-top="{{__proteusPageScrollTop}}"')
    expect(wxml).toContain('scroll-with-animation')
    expect(js).toContain('this.proteusPageScrollTo({ scrollTop: 0 })')
    expect(js).toContain('proteusPageScrollTo(opts) { this.setData({ __proteusPageScrollTop: opts.scrollTop }) }')
    expect(js).toContain('__proteusPageScrollTop: 0')
  })

  it('onPullDownRefresh refresher 受控结束（refresher-triggered 绑定 + 置 false 收回，批次3）', () => {
    const { wxml, js } = compileVueSfc('<script setup>function onPullDownRefresh() {}</script>\n<template><view class="a">x</view></template>', {
      filename: 'pages/pull2.vue',
    })
    expect(wxml).toContain('refresher-triggered="{{__proteusRefreshing}}"')
    expect(js).toContain('this.setData({ __proteusRefreshing: false })')
    expect(js).toContain('__proteusRefreshing: false')
  })

  it('行内场景自动 flex row（layout/auto-flex-row）：text + switch 同容器 → proteus-flex-row 类 + BASE 规则', () => {
    const { wxml, wxss } = compileVueSfc('<template><view class="row"><switch /><text>开关</text></view></template>', {
      filename: 'pages/flexrow.vue',
    })
    // 无 scoped：类无后缀（BASE .proteus-flex-row 规则匹配）
    expect(wxml).toContain('class="proteus-flex-row row"')
    expect(wxss).toContain('.proteus-flex-row { display: flex; flex-direction: row; align-items: center; }')
    // scoped 场景：类 + 规则同步后缀
    const scoped = compileVueSfc('<template><view class="row"><switch /><text>开关</text></view></template>\n<style scoped>.row { margin: 4px 0; }</style>', {
      filename: 'pages/flexrow2.vue',
    })
    expect(scoped.wxml).toContain('class="proteus-flex-row-data-v-')
    expect(scoped.wxss).toMatch(/\.proteus-flex-row-data-v-[a-f0-9]+ \{ display: flex; flex-direction: row; align-items: center; \}/)
  })

  it('纯文本容器（无行内控件）不自动 flex row', () => {
    const { wxml } = compileVueSfc('<template><view class="p"><text>一段文字</text></view></template>', { filename: 'pages/noflex.vue' })
    expect(wxml).not.toContain('proteus-flex-row')
  })

  it('rules.disabled 关闭 layout/auto-flex-row', () => {
    const { wxml } = compileVueSfc('<template><view><switch /><text>开关</text></view></template>', {
      filename: 'pages/flexoff.vue',
      rules: { disabled: ['layout/auto-flex-row'] },
    })
    expect(wxml).not.toContain('proteus-flex-row')
  })

  it('progress 降级（component/progress-degrade）：Skyline 不支持原生 progress → 自定义 view 结构 + 属性映射', () => {
    const { wxml, wxss } = compileVueSfc('<template><progress :percent="70" show-info stroke-width="6" active-color="#07c160" /></template>', {
      filename: 'pages/prog.vue',
    })
    expect(wxml).toContain('class="proteus-progress"')
    expect(wxml).toContain('class="proteus-progress-track" style="height:6px"') // 静态 stroke-width 直出
    expect(wxml).toContain('width:{{70}}%;background-color:#07c160') // 绑定 percent 插值 + 静态 active-color
    expect(wxml).toContain('class="proteus-progress-info">{{70}}%')
    expect(wxss).toContain('.proteus-progress-track')
  })

  it('progress 降级：show-info 缺失不输出 info；绑定 percent/color 插值', () => {
    const { wxml } = compileVueSfc('<script setup>const pct = ref(30)</script><template><progress :percent="pct" :active-color="c"></progress></template>', {
      filename: 'pages/prog2.vue',
    })
    expect(wxml).not.toContain('proteus-progress-info')
    expect(wxml).toContain('width:{{pct}}%')
    expect(wxml).toContain('background-color:{{c}}')
  })

  it('rules.disabled 关闭 component/progress-degrade → 原样输出', () => {
    const { wxml } = compileVueSfc('<template><progress percent="10" /></template>', {
      filename: 'pages/prog3.vue',
      rules: { disabled: ['component/progress-degrade'] },
    })
    expect(wxml).toContain('<progress')
    expect(wxml).not.toContain('proteus-progress')
  })
})
