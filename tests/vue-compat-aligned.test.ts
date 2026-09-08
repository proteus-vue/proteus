// tests/vue-compat-aligned.test.ts
// ★2026-09-08 Step 2（proteus-compiler-vue-align-plan）P0 验收「3. 机器门禁：aligned 全部有黄金断言」——
//   对确认的真对齐核心能力：最小 fixture → 断言编译产物为「正确翻译」（非裸标识符/非剥离不执行的假对齐）。
//   防止"标了 aligned 但回归没锁定"。状态变更（如把某能力降级）需同步本断言。
import { describe, it, expect } from 'vitest'
import { compileVueSfc } from '../packages/compiler/src/index'

const opts = { px2rpx: true, rpxRatio: 2 }

function compile(script: string, template: string, filename = 'pages/probe.vue') {
  return compileVueSfc(`<script setup lang="ts">\n${script}\n</script>\n<template>${template}</template>`, { filename, ...opts })
}

describe('aligned 核心黄金断言（标 aligned = 产物是正确翻译）', () => {
  it('ref → data 字段（responsivity 内联编译）', () => {
    const r = compile("import { ref } from 'vue'\nconst x = ref(0)", '<view>{{ x }}</view>')
    expect((r as any).js).toMatch(/x:\s*0/)
    expect((r as any).js).not.toMatch(/ref\s*\(/)
  })

  it('computed（模板引用）→ onLoad 内联派生 setData', () => {
    const r = compile(
      "import { ref, computed } from 'vue'\nconst x = ref(2)\nconst y = computed(() => x.value * 3)",
      '<view>{{ y }}</view>',
    )
    expect((r as any).js).toMatch(/setData\(\{\s*y:\s*this\.data\.x\s*\*\s*3\s*\}\)/)
    expect((r as any).js).not.toMatch(/computed\s*\(/)
  })

  it('watch → proteusWatchX 方法（observers 接线）', () => {
    const r = compile(
      "import { ref, watch } from 'vue'\nconst x = ref(0)\nwatch(x, () => {})",
      '<view>{{ x }}</view>',
    )
    expect((r as any).js).toMatch(/proteusWatchX/)
    expect((r as any).js).not.toMatch(/watch\s*\(/)
  })

  it('onMounted → onReady（产物不再裸泄漏 onMounted 调用）', () => {
    const r = compile(
      "import { onMounted } from 'vue'\nonMounted(() => { console.log('HI') })",
      '<view>x</view>',
    )
    expect((r as any).js).toMatch(/onReady\(\)/)
    expect((r as any).js).not.toMatch(/(?:^|\s)onMounted\s*\(/)
  })

  it('v-if → wx:if / v-for → wx:for / v-model → value+bindinput', () => {
    const r = compile(
      "import { ref } from 'vue'\nconst name = ref('')\nconst list = ref([1,2,3])",
      '<view><input v-model="name" /><view v-for="(it,i) in list" :key="i" v-if="it > 1">{{ it }}</view></view>',
    )
    const wxml = (r as any).wxml
    expect(wxml).toMatch(/wx:for="\{\{list\}\}"/)
    expect(wxml).toMatch(/wx:if="\{\{it > 1\}\}"/)
    expect(wxml).toMatch(/value="\{\{name\}\}" bindinput="proteusOnNameInput"/)
    expect((r as any).js).toMatch(/proteusOnNameInput\(e\)/)
  })

  it('v-html → rich-text nodes', () => {
    const r = compile("const html = '<b>x</b>'", '<view v-html="html"></view>')
    expect((r as any).wxml).toMatch(/<rich-text nodes="\{\{html\}\}" \/>/)
  })

  it(':class（数组+对象）→ class 绑定', () => {
    const r = compile('const cls = ["a", { b: true }]', '<view :class="cls">x</view>')
    expect((r as any).wxml).toMatch(/class="\{\{cls\}\}"/)
  })

  it(':style（对象）→ style 绑定', () => {
    const r = compile('const st = { color: "red" }', '<view :style="st">x</view>')
    expect((r as any).wxml).toMatch(/style="\{\{st\}\}"/)
  })

  it('<transition> → 进出场状态机（__tv/__tl + proteusTransitionToggle）', () => {
    const r = compile(
      "import { ref } from 'vue'\nconst on = ref(true)",
      '<transition name="fade"><view v-if="on">x</view></transition>',
    )
    expect((r as any).js).toMatch(/__tv0/)
    expect((r as any).js).toMatch(/proteusTransitionToggle0/)
  })

  it('nextTick：cb 形态 → wx.nextTick(cb)；await/无参 → new Promise(r=>wx.nextTick(r))', () => {
    const r = compile(
      "import { nextTick } from 'vue'\nasync function go() { nextTick(() => {}); await nextTick() }",
      '<view>x</view>',
    )
    expect((r as any).js).toMatch(/wx\.nextTick\(\(\) => \{\}\)/)
    expect((r as any).js).toMatch(/await new Promise\(r => wx\.nextTick\(r\)\)/)
    // 无「裸 nextTick(」（非 wx. 前缀 = 未翻译残留——注意 wx.nextTick( 内 nextTick( 前有 .）
    expect((r as any).js).not.toMatch(/(?<![.\w])nextTick\s*\(/)
  })

  it('version：const v = version → data.v 内联版本号字符串（非 undefined）', () => {
    const r = compile("import { version } from 'vue'\nconst v = version", '<view>{{ v }}</view>')
    // VUE_PUBLIC_CONSTS 内联：data.v = '3.5.42'（与 @vue/runtime-core@3.5.42 对齐基线一致）
    expect((r as any).js).toMatch(/v:\s*['"]3\.5\.42['"]/)
    expect((r as any).js).not.toMatch(/v:\s*undefined/)
  })

  it('unref/toValue：编译期内联为 ref 值（const out = unref(x) → data.out = data.x；方法体 → this.data.x）', () => {
    // 顶层 const
    const r1 = compile("import { unref, ref } from 'vue'\nconst x = ref(1)\nconst out = unref(x)", '<view>{{ out }}</view>')
    expect((r1 as any).js).toMatch(/out:\s*1/)
    expect((r1 as any).js).not.toMatch(/unref\s*\(/)
    // toValue 同理
    const r2 = compile("import { toValue, ref } from 'vue'\nconst x = ref(1)\nconst out = toValue(x)", '<view>{{ out }}</view>')
    expect((r2 as any).js).toMatch(/out:\s*1/)
    expect((r2 as any).js).not.toMatch(/toValue\s*\(/)
    // 方法体
    const r3 = compile("import { unref, ref } from 'vue'\nconst x = ref(1)\nfunction f(){ return unref(x) }", '<view>x</view>')
    expect((r3 as any).js).toMatch(/return this\.data\.x/)
  })

  it('withDefaults：宏剥离 + 默认值合并到 properties（组件模式），不裸调用/不落 data', () => {
    const r = compileVueSfc(
      `<script setup lang="ts">
import { withDefaults } from 'vue'
const p = withDefaults(defineProps<{ a: number; b?: string }>(), { b: 'hi' })
</script>
<template><view>{{ a }}{{ b }}</view></template>`,
      { filename: 'src/components/p-probe/index.vue', ...opts, isComponent: true },
    )
    // 宏剥离：无裸 withDefaults 调用、无 const p 落 data
    expect((r as any).js).not.toMatch(/(?<![.\w])withDefaults\s*\(/)
    // 属性默认值合并：b → 'hi'（withDefaults 第二参默认对象，properties.value 形态）
    expect((r as any).js).toMatch(/b:\s*\{\s*type: String, value: ['"]hi['"]/)
  })

  it('defineProps（对象形态）→ 宏剥离，模板可直接消费 props', () => {
    const r = compile(
      "import { ref } from 'vue'\nconst props = defineProps({ initial: Number })",
      '<view>{{ initial }}</view>',
    )
    expect((r as any).js).not.toMatch(/defineProps\s*\(/)
  })

  it('aligned 产物不收「Vue API」警告（非标记为受限）', () => {
    const r = compile(
      "import { ref, computed, watch, onMounted } from 'vue'\nconst x = ref(0)\nconst y = computed(() => x.value + 1)\nwatch(x, () => {})\nonMounted(() => {})",
      '<view>{{ y }}</view>',
    )
    expect(r.warnings.filter((w) => w.includes('Vue API'))).toEqual([])
  })
})
