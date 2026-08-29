// tests/vue-compat-advance.test.ts
// Vue 能力兼容进阶（docs/vue-compat-advance.md）：
//   Batch 1：作用域插槽编译期警告（反黑盒）
//   Batch 2：<transition> 装饰式进入动画
//   Batch 3：provide/inject 页面级注入桥（全局注册表）
import { describe, it, expect, beforeEach } from 'vitest'
import { compileVueSfc } from '../packages/compiler/src'
import { getTransformRule } from '../packages/compiler/src/transforms/registry'
import { registerProvide, readInject, clearProvides, provideCount, subscribeProvide, notifyProvide, nextPageId, destroyPage } from '../packages/runtime/src/provide-inject'

const compile = (src: string, name = 'vca.vue'): { warnings: string[]; wxml: string; js: string; wxss: string } => {
  const r = compileVueSfc(src, { filename: name })
  return { warnings: r.warnings, wxml: r.wxml, js: r.js, wxss: r.wxss }
}

const compileComponent = (src: string, name = 'components/box.vue'): { warnings: string[]; wxml: string; js: string; wxss: string } => {
  const r = compileVueSfc(src, { filename: name, isComponent: true })
  return { warnings: r.warnings, wxml: r.wxml, js: r.js, wxss: r.wxss }
}

describe('Batch 1：作用域插槽警告（反黑盒）', () => {
  it('<slot :item="x"> → 警告（MP 父侧拿不到子数据）', () => {
    const r = compile('<template><slot :item="item" /></template><script setup>const item = ref("x")</script>')
    expect(r.warnings.some((w) => w.includes('作用域插槽'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('props 传子'))).toBe(true)
  })

  it('普通插槽不受影响（无绑定属性 → 零警告）', () => {
    const r = compile('<template><slot /><slot name="title" /></template>')
    expect(r.warnings).toHaveLength(0)
  })

  it('规则 slot/scoped-slot 已登记', () => {
    const rule = getTransformRule('slot/scoped-slot')
    expect(rule).toBeDefined()
    expect(rule!.why).toContain('#117')
  })
})

describe('Batch 2：<transition> 装饰式动画（运行时等价，进入动画）', () => {
  it('子元素注入动画 class + 裸 ref v-if 改写 __tv0 + 不再警告', () => {
    const r = compile('<template><transition name="fade"><view v-if="on">X</view></transition></template><script setup>const on = ref(true)</script>')
    expect(r.warnings.some((w) => w.includes('<transition>'))).toBe(false) // 不再 no-peer 警告
    expect(r.wxml).toContain('class="proteus-transition-fade')
    expect(r.wxml).toContain('wx:if="{{__tv0}}"') // ★Batch 5：裸 ref v-if → 离开动画状态机（显示由 __tv0 控制）
    expect(r.wxml).not.toContain('<transition') // 装饰式：过渡标签不输出
  })

  it('wxss 注入进入动画 keyframes', () => {
    const r = compile('<template><transition name="slide-up"><view v-if="on">X</view></transition></template><script setup>const on = ref(true)</script>')
    expect(r.wxss).toContain('proteus-transition-slide-up')
    expect(r.wxss).toContain('@keyframes proteus-slide-up-in')
  })

  it('transition-group/teleport 保留警告', () => {
    const r = compile('<template><transition-group name="fade"><view v-for="i in l" :key="i">{{ i }}</view></transition-group></template><script setup>const l = ref([1,2])</script>')
    expect(r.warnings.some((w) => w.includes('<transition-group>'))).toBe(true)
  })

  it('规则 transition/component 与 transition/animation-wxss 已登记', () => {
    expect(getTransformRule('transition/component')).toBeDefined()
    expect(getTransformRule('transition/animation-wxss')).toBeDefined()
  })
})

describe('Batch 3：provide/inject 页面级注入桥（全局注册表）', () => {
  beforeEach(() => clearProvides())

  it('页面 provide → onLoad 注入页面命名空间注册（ref.value 重写为 this.data）', () => {
    const r = compile('<script setup>\nconst user = ref({ name: "a" })\nprovide("user", user.value)\n</script>')
    // ★Batch 6：页面级隔离——__seq 生成 pageId + 页面命名空间（不再顶层直接存值）
    expect(r.js).toContain('this.__proteusPageId = \'p\' + __reg.__seq')
    expect(r.js).toContain('const provides = (__reg[this.__proteusPageId] || (__reg[this.__proteusPageId] = {}))')
    expect(r.js).toContain('provides["user"] = this.data.user')
  })

  it('页面 inject → onLoad setData 填充（无跨模块误导警告）', () => {
    const r = compile('<script setup>\nconst theme = inject("theme")\n</script>')
    expect(r.js).toContain('this.setData({ theme: provides["theme"] })')
    expect(r.warnings).toHaveLength(0) // 不再提示“跨模块引用将 undefined”（Batch 3 合法用法）
  })

  it('inject 默认值：未注册时取默认（ES5 三元，非 ??）', () => {
    const r = compile('<script setup>\nconst theme = inject("theme", "light")\n</script>')
    expect(r.js).toContain('this.setData({ theme: (provides["theme"] === undefined ? "light" : provides["theme"]) })')
  })

  it('组件模式：provide 注册放 created，inject 读取放 attached（先于子组件注入）', () => {
    const r = compileComponent('<script setup>\nprovide("cfg", cfg)\nconst cfg = ref(1)\nconst x = inject("x")\n</script>')
    expect(r.js).toContain('created() {')
    expect(r.js).toContain('provides["cfg"] = this.data.cfg')
    expect(r.js).toContain('attached() {')
    expect(r.js).toContain('this.setData({ x: provides["x"] })')
    expect(r.js).not.toContain('onLoad(options)')
  })

  it('运行时桥与编译产物共享同一注册表（非小程序环境回退 globalThis）', () => {
    expect(provideCount()).toBe(0)
    registerProvide('key', 42)
    expect(readInject('key')).toBe(42)
    expect(readInject('missing')).toBeUndefined()
    expect(provideCount()).toBe(1)
    clearProvides()
    expect(provideCount()).toBe(0)
  })

  it('规则 script/provide-inject 已登记', () => {
    const rule = getTransformRule('script/provide-inject')
    expect(rule).toBeDefined()
    expect(rule!.why).toContain('#117')
  })
})

describe('Batch 4：provide/inject 响应式联动（裸 ref 订阅/通知）', () => {
  beforeEach(() => clearProvides())

  it('页面提供裸 ref → __subs 初始化 + ref 写入点注入 proteusSyncProvide（值同步 + 通知）', () => {
    const r = compile('<script setup>\nconst user = ref({ name: "a" })\nprovide("user", user)\nfunction change() { user.value = { name: "b" } }\n</script>')
    // 注册 + 订阅集合初始化
    expect(r.js).toContain('provides["user"] = this.data.user')
    expect(r.js).toContain('if (!provides.__subs) provides.__subs = {}; if (!provides.__subs["user"]) provides.__subs["user"] = []')
    // ref 写入点联动（setData 后同步注册表 + 通知）
    expect(r.js).toContain('this.proteusSyncProvide("user", "user")')
    expect(r.js).toContain('proteusSyncProvide(key, ref) {')
  })

  it('provide .value / 字面量 → 静态快照零联动（Vue 语义回归）', () => {
    const r = compile('<script setup>\nconst user = ref({ name: "a" })\nprovide("user", user.value)\nprovide("ver", 1)\n</script>')
    expect(r.js).not.toContain('__subs')
    expect(r.js).not.toContain('proteusSyncProvide')
  })

  it('页面 inject → 订阅 __subs[key]（值变化 setData 刷新）+ onUnload 取消', () => {
    const r = compile('<script setup>\nconst x = inject("x")\n</script>')
    expect(r.js).toContain('const __self = this')
    expect(r.js).toContain('if (provides.__subs && provides.__subs["x"]) {')
    expect(r.js).toContain('fn: function () { __self.setData({ x: provides["x"] }) }')
    expect(r.js).toContain('proteusUnsubscribeProvide() {')
    expect(r.js).toContain('onUnload() {')
  })

  it('组件 inject → attached 订阅 + detached 取消（防全局注册表回调泄漏）', () => {
    const r = compileComponent('<script setup>\nconst x = inject("x")\n</script>')
    expect(r.js).toContain('detached() {')
    expect(r.js).toContain('this.proteusUnsubscribeProvide()')
    expect(r.js).not.toContain('onUnload(options)')
  })

  it('运行时桥：subscribeProvide 订阅 + notifyProvide 通知 + 取消幂等', () => {
    clearProvides()
    registerProvide('n', 1)
    const seen: number[] = []
    const cancel = subscribeProvide('n', () => seen.push(readInject('n') as number))
    notifyProvide('n')
    expect(seen).toEqual([1])
    registerProvide('n', 2)
    notifyProvide('n')
    expect(seen).toEqual([1, 2])
    cancel()
    cancel() // 幂等
    notifyProvide('n')
    expect(seen).toEqual([1, 2])
    clearProvides()
  })
})

describe('Batch 5：<transition> 离开动画（延迟移除状态机）', () => {
  it('裸 ref v-if → wxml 显示改 __tv0 + class 插值 __tl0（离开动画 class 切换）', () => {
    const r = compile('<template><transition name="fade"><view v-if="on">X</view></transition></template><script setup>const on = ref(true)</script>')
    expect(r.wxml).toContain('wx:if="{{__tv0}}"')
    expect(r.wxml).toContain("{{__tl0 ? 'proteus-transition-fade-leave' : ''}}")
    // 非状态机回归：不再直接绑定 on
    expect(r.wxml).not.toContain('wx:if="{{on}}"')
  })

  it('js：data 注入 __tv0（初始 = ref 初始值）/__tl0 + toggle 方法 + ref 写入点注入', () => {
    const r = compile('<template><transition name="slide-up"><view v-if="on">X</view></transition></template><script setup>const on = ref(false)\nfunction show() { on.value = true }\nfunction hide() { on.value = false }</script>')
    expect(r.js).toContain('__tv0: false')
    expect(r.js).toContain('__tl0: false')
    expect(r.js).toContain('proteusTransitionToggle0() {')
    expect(r.js).toContain('setTimeout(() => {')
    expect(r.js).toContain('}, 320)') // slide-up 动画时长对齐 keyframes
    expect(r.js).toContain('this.proteusTransitionToggle0()') // 写入点注入（show/hide 方法体）
  })

  it('复杂 v-if 表达式 → 保持 Batch 2 现状（无状态机）', () => {
    const r = compile('<template><transition name="fade"><view v-if="count > 0">X</view></transition></template><script setup>const count = ref(1)</script>')
    expect(r.wxml).toContain('wx:if="{{count > 0}}"')
    expect(r.wxml).not.toContain('__tv0')
    expect(r.js).not.toContain('proteusTransitionToggle')
  })

  it('wxss 注入离开动画 keyframes（fade-out/slide-up-out/scale-out）', () => {
    const r = compile('<template><transition name="scale"><view v-if="on">X</view></transition></template><script setup>const on = ref(true)</script>')
    expect(r.wxss).toContain('.proteus-transition-scale-leave')
    expect(r.wxss).toContain('@keyframes proteus-scale-out')
    expect(r.wxss).toContain('forwards')
  })
})

describe('Batch 6：provide/inject 页面级隔离（pageId 命名空间）', () => {
  beforeEach(() => clearProvides())

  it('页面 onLoad：__seq 生成 pageId + 命名空间解析 + onUnload 清理', () => {
    const r = compile('<script setup>\nprovide("k", v)\nconst v = ref(1)\n</script>')
    expect(r.js).toContain('__reg.__seq = (__reg.__seq || 0) + 1')
    expect(r.js).toContain('const provides = (__reg[this.__proteusPageId] || (__reg[this.__proteusPageId] = {}))')
    // onUnload：删除当前页命名空间（防泄漏）
    expect(r.js).toContain('if (__reg && this.__proteusPageId) delete __reg[this.__proteusPageId]')
    expect(r.js).toContain('onUnload() {')
  })

  it('组件 created/attached：从 getCurrentPages 栈顶解析所属页面 id（回退 global）', () => {
    const r = compileComponent('<script setup>\nprovide("cfg", cfg)\nconst cfg = ref(1)\nconst x = inject("x")\n</script>')
    expect(r.js).toContain('const __pid = __pages.length ? __pages[__pages.length - 1].__proteusPageId : \'\'')
    expect(r.js).toContain("this.__proteusPageId = __pid || 'global'")
    // created 与 attached 都落同一命名空间（provides = 当前页注册表）
    expect(r.js).toContain('const provides = (__reg[this.__proteusPageId] || (__reg[this.__proteusPageId] = {}))')
    expect(r.js).toContain('provides["cfg"] = this.data.cfg')
    expect(r.js).toContain('this.setData({ x: provides["x"] })')
  })

  it('运行时桥：nextPageId 递增 + pageId 隔离（A 提供 B 读不到）+ destroyPage 清理', () => {
    clearProvides()
    expect(nextPageId()).toBe('p1')
    expect(nextPageId()).toBe('p2')
    registerProvide('user', 'alice', 'p1')
    registerProvide('user', 'bob', 'p2')
    expect(readInject('user', 'p1')).toBe('alice')
    expect(readInject('user', 'p2')).toBe('bob')
    expect(readInject('user', 'p3')).toBeUndefined() // 其他页面读不到（隔离）
    destroyPage('p1')
    expect(readInject('user', 'p1')).toBeUndefined() // 页面销毁清理
    expect(readInject('user', 'p2')).toBe('bob')
    expect(provideCount()).toBe(1)
    clearProvides()
    expect(provideCount()).toBe(0)
  })

  it('规则 script/provide-inject 说明书含页面级隔离语义', () => {
    const rule = getTransformRule('script/provide-inject')
    expect(rule!.description).toContain('页面级隔离')
  })
})
