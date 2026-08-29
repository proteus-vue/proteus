// tests/explain.test.ts
// 阶段二：决策 trace 测试
// 1. 防漂移：所有 trace 事件的 ruleId 都能在 transforms 注册表解析（改规则 ID 而漏改实现侧 trace 会当场失败）
// 2. 一份典型 SFC 触发预期的规则集合（标签/指令/事件/script/style 各阶段）
// 3. formatTransformTrace 渲染正确
import { describe, it, expect } from 'vitest'
import { explainTransform, formatTransformTrace, getTransformRule } from '../packages/compiler/src'

const SFC = `<route>
{ "meta": { "title": "首页" } }
</route>
<script setup lang="ts">
import { ref } from 'vue'

const count = ref(0)
const show = ref(true)

function handleTap() {
  count.value++
}
</script>

<template>
  <div class="home">
    <h1>{{ count }}</h1>
    <p v-if="show">hi</p>
    <button @click="handleTap">tap</button>
    <a href="/pages/user/index">用户</a>
  </div>
</template>

<style>
.home { padding: 48px; }
div .item { margin: 8px; }
</style>
`

describe('explainTransform（决策 trace）', () => {
  it('所有 trace 事件的 ruleId 都能在注册表解析（防漂移）', () => {
    const result = explainTransform(SFC, { filename: 'demo.vue' })
    expect(result.events.length).toBeGreaterThan(10)
    for (const ev of result.events) {
      expect(getTransformRule(ev.ruleId), `trace 事件 ${ev.ruleId} 未在注册表登记`).toBeTruthy()
    }
  })

  it('典型 SFC 触发预期规则（template 阶段）', () => {
    const result = explainTransform(SFC)
    const ids = result.events.map((e) => e.ruleId)
    // 标签映射 + 语义基础类
    expect(ids).toContain('tag/div-to-view')
    expect(ids).toContain('tag/heading-to-text') // h1
    expect(ids).toContain('tag/para-to-text') // p
    expect(ids).toContain('tag/link-to-view') // a
    expect(ids).toContain('tag/passthrough') // button
    expect(ids).toContain('semantic/base-class')
    // 指令 / 事件 / 导航
    expect(ids).toContain('directive/v-if')
    expect(ids).toContain('event/click-to-tap')
    expect(ids).toContain('nav/navigate-link')
    expect(ids).toContain('node/interpolation')
  })

  it('典型 SFC 触发预期规则（script 阶段）', () => {
    const result = explainTransform(SFC)
    const ids = result.events.map((e) => e.ruleId)
    expect(ids).toContain('script/const-to-data')
    expect(ids).toContain('script/function-to-methods')
    expect(ids).toContain('script/ref-incdec')
    expect(ids).toContain('script/onload-params') // 无显式 onLoad
    expect(ids).toContain('script/component-mode') // Page()
    expect(ids).toContain('script/es5-safe')
  })

  it('典型 SFC 触发预期规则（style 阶段）', () => {
    const result = explainTransform(SFC)
    const ids = result.events.map((e) => e.ruleId)
    expect(ids).toContain('style/semantic-base-wxss')
    expect(ids).toContain('style/px-to-rpx')
    expect(ids).toContain('style/selector-tag') // div .item
  })

  it('template 事件携带源码行号', () => {
    const result = explainTransform(SFC)
    const tplEvents = result.events.filter((e) => e.phase === 'template' && e.ruleId !== 'annotation/line-note')
    expect(tplEvents.length).toBeGreaterThan(5)
    for (const ev of tplEvents) {
      expect(ev.line, `${ev.ruleId} 缺少行号`).toBeTypeOf('number')
    }
  })

  it('v-model 链路：directive/v-model + script/vmodel-handler 成对出现', () => {
    const sfc = `<script setup lang="ts">
const name = ref('')
</script>
<template>
  <input v-model="name" />
</template>`
    const result = explainTransform(sfc)
    const ids = result.events.map((e) => e.ruleId)
    expect(ids).toContain('directive/v-model')
    expect(ids).toContain('script/vmodel-handler')
  })

  it('组件模式：isComponent → script/component-mode 输出 Component()', () => {
    const sfc = `<script setup lang="ts">
const x = ref(1)
</script>
<template>
  <div>{{ x }}</div>
</template>`
    const page = explainTransform(sfc, { isComponent: false })
    const comp = explainTransform(sfc, { isComponent: true })
    const pageMode = page.events.find((e) => e.ruleId === 'script/component-mode')
    const compMode = comp.events.find((e) => e.ruleId === 'script/component-mode')
    expect(pageMode?.after).toContain('Page(')
    expect(compMode?.after).toContain('Component(')
  })

  it('formatTransformTrace 渲染按阶段分组的可读文本', () => {
    const result = explainTransform(SFC, { filename: 'demo.vue' })
    const text = formatTransformTrace(result)
    expect(text).toContain('# explainTransform demo.vue')
    expect(text).toContain('### template 阶段')
    expect(text).toContain('### script 阶段')
    expect(text).toContain('### style 阶段')
    expect(text).toContain('tag/div-to-view')
    expect(text).toContain('→')
  })
})
