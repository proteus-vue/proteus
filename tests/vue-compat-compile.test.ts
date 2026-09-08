// tests/vue-compat-compile.test.ts
// ★2026-09-08 立项（proteus-compiler-vue-align-plan）P0 Step 3：编译器接线——<script setup> 的 vue 命名导入查「Vue 全集基准线」，
//   aligned 静默翻译 / partial·unsupported+degrade 编译期警告 / unsupported 无降级 抛 CompilerError（反黑盒 fail-closed）。
import { describe, it, expect } from 'vitest'
import { compileVueSfc, CompilerError } from '../packages/compiler/src/index'

const opts = { px2rpx: true, rpxRatio: 2 }

function makeSfc(imports: string, setup: string, template = '<template><view>{{x}}</view></template>') {
  return `<script setup lang="ts">\n${imports}\n${setup}\n</script>\n${template}`
}

describe('编译器接线：vue 命名导入 × Vue 全集基准线', () => {
  it('aligned API（ref/computed/onMounted 等）→ 正常编译（无 CompilerError）', () => {
    const src = makeSfc(
      "import { ref, computed, watch } from 'vue'",
      "const x = ref(0)\nconst y = computed(() => x.value + 1)\nwatch(x, () => {})",
    )
    const r = compileVueSfc(src, { filename: 'pages/probe.vue', ...opts })
    expect(r.js).toContain('x: 0') // ref → data
    expect(r.js).toMatch(/proteusWatchX/) // watch → proteusWatchX 方法
    // computed 未在模板引用为死代码（Vue 惰性）——不生成 proteusCalcY，属正常；aligned 不产生 Vue API 警告
    expect(r.warnings.filter((w) => w.includes('Vue API'))).toEqual([])
  })

  it('unsupported 无降级（getCurrentInstance）→ 抛 CompilerError（反黑盒 fail-closed）', () => {
    const src = makeSfc(
      "import { getCurrentInstance } from 'vue'",
      "const inst = getCurrentInstance()",
    )
    expect(() => compileVueSfc(src, { filename: 'pages/probe.vue', ...opts })).toThrow(CompilerError)
    // 报错信息含 API 名 + 替代建议
    try {
      compileVueSfc(src, { filename: 'pages/probe.vue', ...opts })
      expect.unreachable()
    } catch (e) {
      expect((e as Error).message).toContain('getCurrentInstance')
      expect((e as Error).message).toContain('单独立项框架语义 API')
    }
  })

  it('unsupported 无降级（h / createApp / useSlots）→ 抛 CompilerError', () => {
    for (const api of ['h', 'createApp', 'useSlots']) {
      const src = makeSfc(`import { ${api} } from 'vue'`, 'const x = 1')
      expect(() => compileVueSfc(src, { filename: `p-${api}.vue`, ...opts }), `${api} 应抛 CompilerError`).toThrow(CompilerError)
    }
  })

  it('partial（onErrorCaptured / onBeforeUnmount）→ 编译期警告（不抛错，带 note）', () => {
    // onErrorCaptured 在矩阵为 partial（degrade）→ warning
    const src = makeSfc(
      "import { onErrorCaptured } from 'vue'",
      "onErrorCaptured(() => { return false })",
    )
    const r = compileVueSfc(src, { filename: 'pages/probe.vue', ...opts })
    expect(r.warnings.some((w) => w.includes('onErrorCaptured') && w.includes('Vue API'))).toBe(true)
  })

  it('partial 生命周期钩子：警告 + 干净剥离（产物不裸泄漏 onXxx 调用进 onLoad——防 ReferenceError）', () => {
    // ★2026-09-08：onBeforeUnmount/onErrorCaptured 等未映射钩子不仅应警告，且不得被当顶层副作用裸注入 onLoad
    //   （产物 onBeforeUnmount(...) 无 import → 运行时 ReferenceError，getCurrentInstance 同类）。
    const src = makeSfc(
      "import { onMounted, onBeforeUnmount, onErrorCaptured } from 'vue'",
      "onMounted(() => { console.log('M') })\nonBeforeUnmount(() => { clear() })\nonErrorCaptured(() => { return false })",
    )
    const r = compileVueSfc(src, { filename: 'pages/probe.vue', ...opts })
    // 生命周期映射：onMounted → onReady 生效
    expect(r.js).toMatch(/onReady\(\)/)
    // 未映射钩子（partial）→ 警告
    expect(r.warnings.some((w) => w.includes('onBeforeUnmount') && w.includes('未映射'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('onErrorCaptured'))).toBe(true)
    // ★不裸泄漏：产物无裸 onBeforeUnmount(/onErrorCaptured(/onMounted( 调用（防 ReferenceError）
    expect(r.js).not.toMatch(/(?:^|\s)onBeforeUnmount\s*\(/)
    expect(r.js).not.toMatch(/(?:^|\s)onErrorCaptured\s*\(/)
    expect(r.js).not.toMatch(/(?:^|\s)onMounted\s*\(/)
  })

  it('partial（defineComponent）→ 警告 + 【剥离为 no-op】（产物无裸 defineComponent 调用，防 ReferenceError）', () => {
    // ★2026-09-08 P1：defineComponent 在 <script setup> 为冗余包装（SFC 已自动组件化）——编译器识别并剥离。
    //   此前被当顶层副作用裸注入 onLoad → 产物 defineComponent(...) 无 import → not defined（getCurrentInstance 同类）。
    const src = makeSfc(
      "import { defineComponent } from 'vue'",
      "defineComponent({ name: 'X' })\nconst App = defineComponent({ name: 'Y' })",
    )
    const r = compileVueSfc(src, { filename: 'pages/probe.vue', ...opts })
    // 警告（partial·degrade → warning）
    expect(r.warnings.some((w) => w.includes('defineComponent') && w.includes('Vue API'))).toBe(true)
    // ★不裸泄漏：产物无裸 defineComponent( 调用
    expect(r.js).not.toMatch(/(?<![.\w])defineComponent\s*\(/)
    // 也不落 data（const App 不成为 data 字段）
    expect(r.js).not.toMatch(/App\s*:/)
  })

  it('defineModel（compileScript 权威源）：prop 注册 + m.value 读写 + 模板改名（对齐 glass-easel）', () => {
    // ★2026-09-08 P1（地基）：defineModel 经 @vue/compiler-sfc 权威展开（_useModel），不手写——
    //   const m = defineModel<string>() → prop modelValue + m.value 读→this.data.modelValue / 写→triggerEvent('update-modelValue', v)
    const src = `<script setup lang="ts">
import { defineModel } from 'vue'
const m = defineModel<string>()
function set(v: string) { m.value = v }
function read() { return m.value }
</script>
<template><view>{{ m }}</view></template>`
    const r = compileVueSfc(src, { filename: 'src/components/p-probe/index.vue', ...opts, isComponent: true })
    // prop 注册（properties.modelValue）
    expect(r.js).toMatch(/modelValue:\s*\{\s*type: String/)
    // 模板改名：{{ m }} → {{ modelValue }}
    expect(r.wxml).toMatch(/\{\{\s*modelValue\s*\}\}/)
    expect(r.wxml).not.toMatch(/\{\{\s*m\s*\}\}/)
    // 写：m.value = v → this.triggerEvent('update-modelValue', v)
    expect(r.js).toMatch(/triggerEvent\('update-modelValue',\s*v\)/)
    // 读：return m.value → return this.data.modelValue
    expect(r.js).toMatch(/return this\.data\.modelValue/)
    // 不落 data（m 不进 data）
    expect(r.js).not.toMatch(/data:\s*\{[\s\S]*?m:\s*undefined/)
  })

  it('现有 aligned 生态（provide/inject）正常不收 Vue API 警告', () => {
    const src = makeSfc(
      "import { provide } from 'vue'",
      "provide('k', 1)",
    )
    const r = compileVueSfc(src, { filename: 'pages/probe.vue', ...opts })
    expect(r.warnings.filter((w) => w.includes('Vue API'))).toEqual([])
  })
})
