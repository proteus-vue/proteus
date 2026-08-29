// tests/vue-compat.test.ts
// Vue 能力兼容（docs/vue-compat-plan Batch A：反黑盒）——
// 平台无对等能力 + import 剥离 → 编译期显式警告（不再静默失败）
import { describe, it, expect } from 'vitest'
import { compileVueSfc } from '../packages/compiler/src'
import { listTransformRules, getTransformRule } from '../packages/compiler/src/transforms/registry'

const compile = (src: string, name = 'vc.vue'): { warnings: string[]; wxml: string; js: string } => {
  const r = compileVueSfc(src, { filename: name })
  return { warnings: r.warnings, wxml: r.wxml, js: r.js }
}

describe('Batch A：平台无对等能力显式警告（反黑盒）', () => {
  it('动态组件 <component :is> → 警告（无效标签不再静默）', () => {
    const r = compile('<template><component :is="which" /></template><script setup>const which = ref("a")</script>')
    expect(r.warnings.some((w) => w.includes('<component :is>'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('条件渲染'))).toBe(true)
  })

  it('自定义指令 v-focus → 警告（剥离且不执行）', () => {
    const r = compile('<template><input v-focus /></template><script setup>const vFocus = { mounted: () => {} }</script>')
    expect(r.warnings.some((w) => w.includes('自定义指令 v-focus'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('无对等'))).toBe(true)
    expect(r.wxml).not.toContain('v-focus') // 已剥离
  })

  it('模板 ref → 警告（无对等绑定）', () => {
    const r = compile('<template><input ref="el" /></template><script setup>const inputEl = ref(null)</script>')
    expect(r.warnings.some((w) => w.includes('模板 ref="el"'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('selectComponent'))).toBe(true)
  })

  it('Transition 已支持（不再警告），Teleport 等无对等组件 → 警告', () => {
    const tr = compile('<template><transition name="fade"><view v-if="on">X</view></transition></template><script setup>const on = ref(true)</script>')
    expect(tr.warnings.some((w) => w.includes('<transition>'))).toBe(false) // vue-compat-advance Batch 2 已支持
    const r = compile('<template><teleport to="body"><view>x</view></teleport></template>')
    expect(r.warnings.some((w) => w.includes('<teleport>'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('routeType'))).toBe(true)
  })

  it('import 剥离 → 警告（无法解析的跨模块引用）+ 函数调用运行时初始化', () => {
    const src = '<template><view>{{ v }}</view></template>\n<script setup>\nimport { useV } from "./util"\nconst v = useV()\n</script>'
    const r = compile(src)
    expect(r.warnings.some((w) => w.includes('import') && w.includes('undefined'))).toBe(true)
    // ★module-plan B0：函数调用初始化不再降级 data undefined——运行时初始化实例属性（onLoad 注入）
    expect(r.js).toContain('this.v = useV()')
    expect(r.js).not.toContain('v: undefined')
  })

  it('内置指令不受影响（v-if/v-for/v-show 零新增警告）', () => {
    const r = compile('<template><p v-if="a">A</p><p v-show="b">B</p><li v-for="i in list" :key="i">{{ i }}</li></template><script setup>const a = ref(true); const b = ref(false); const list = ref([1,2])</script>')
    expect(r.warnings.some((w) => w.includes('自定义指令'))).toBe(false)
    expect(r.warnings).toHaveLength(0)
  })

  it('规则注册表登记 5 条新规则（防漂移）', () => {
    for (const id of ['directive/custom', 'template/is-component', 'template/template-ref', 'template/no-peer', 'script/module-import']) {
      const rule = getTransformRule(id)
      expect(rule, `规则 ${id} 应已登记`).toBeDefined()
      expect(rule!.title).toBeTruthy()
      expect(rule!.why).toContain('#116')
    }
    // 总规则数增长
    expect(listTransformRules().length).toBeGreaterThanOrEqual(61)
  })
})

describe('Batch B：事件内联表达式 → 包装方法（vue-compat）', () => {
  it('@click="count++" → proteusInlineIncCount（setData 更新）', () => {
    const r = compile('<template><button @click="count++">C</button></template><script setup>const count = ref(0)</script>')
    expect(r.warnings).toHaveLength(0) // 不再警告（已支持）
    expect(r.wxml).toContain('bindtap="proteusInlineIncCount"')
    expect(r.js).toContain('proteusInlineIncCount(e)')
    expect(r.js).toContain('this.setData({ count: this.data.count + 1 })')
  })

  it('@click="count--" 与 --count 前/后自减', () => {
    const r = compile('<template><button @click="count--">D</button></template><script setup>const count = ref(0)</script>')
    expect(r.wxml).toContain('bindtap="proteusInlineDecCount"')
    expect(r.js).toContain('this.data.count - 1')
  })

  it('@click="fn(1)" 简单方法调用 → 包装方法', () => {
    const r = compile('<template><button @click="fn(1)">F</button></template><script setup>const x = ref(0); function fn(n) { x.value = n }</script>')
    expect(r.wxml).toContain('bindtap="proteusInlineFn1"')
    expect(r.js).toContain('this.fn(1)')
  })

  it('复杂表达式（store.xxx 链式）仍警告原样', () => {
    const r = compile('<template><button @click="store.toggle()">T</button></template><script setup>const store = { toggle: () => {} }</script>')
    expect(r.warnings.some((w) => w.includes('不是简单方法引用'))).toBe(true)
    expect(r.wxml).toContain('store.toggle()') // 原样
  })

  it('规则 event/inline-expression 已登记且可禁用', () => {
    expect(getTransformRule('event/inline-expression')).toBeDefined()
    const r = compile('<template><button @click="count++">C</button></template><script setup>const count = ref(0)</script>', 'vc-dis.vue')
    // 默认启用：无警告
    expect(r.warnings).toHaveLength(0)
  })
})

describe('Batch C：收尾补全（vue-compat）', () => {
  it(':class 数组对象简写 [a, { on }] → 支持（{ on } → on?"on "）', () => {
    const r = compile('<template><div :class="[a, { on }]">X</div></template><script setup>const a = ref("x"); const on = ref(true)</script>')
    expect(r.warnings).toHaveLength(0) // 不再警告
    expect(r.wxml).toContain('(on?\'on \':\'\')')
  })

  it('函数调用初始化警告 actionable（运行时初始化 + 模块 import 提示）', () => {
    const r = compile('<template><view>{{ store }}</view></template>\n<script setup>\nconst store = useStore()\n</script>')
    const w = r.warnings.find((x) => x.includes('const store'))
    expect(w).toBeDefined()
    // ★module-plan B0：函数调用 → 运行时初始化（实例属性），警告提示模块 import 而非旧“跨模块引用”
    expect(w).toContain('函数调用')
    expect(w).toContain('运行时初始化')
    expect(r.js).toContain('this.store = useStore()')
  })
})
