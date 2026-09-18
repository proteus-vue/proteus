# M3 · L3 组件 / 集成测试

## 目标
验证组件渲染逻辑、Pinia store 联动、Router 守卫、Transform 插件，在**无真机**环境下跑通。

## 环境

| 端 | environment | 渲染层 |
|---|---|---|
| Web | `happy-dom` | `@vue/test-utils` mount |
| 小程序 | `node` + createMockContext | **不真实渲染**，只校验逻辑与生成 WXML |

## Web 组件用例

```ts
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import Counter from './Counter.vue'

it('点击 +1', () => {
  const wrapper = mount(Counter, {
    global: { plugins: [createTestingPinia()] },
  })
  wrapper.get('button').trigger('click')
  expect(wrapper.text()).toContain('1')
})
```

## 小程序组件：逻辑 + WXML 双断言

```ts
import { mountMpComponent } from '@proteus-vue/test-core'

it('p-button 渲染 + disabled 态', () => {
  const { instance, wxml } = mountMpComponent(`
    <template><button class="p-btn" :disabled="disabled">{{ label }}</button></template>
    <script setup lang="ts">
    import { ref } from 'vue'
    const disabled = ref(true)
    const label = '确认'
    </script>
  `)
  expect(instance.data).toHaveProperty('disabled', true) // 逻辑
  expect(wxml).toContain('button')                        // 结构（对齐 Component plan 映射表）
})
```

`mountMpComponent(sfc, options?)`（★实现形态：**同步**函数）内部：
1. Compiler 把 SFC → WXML + 逻辑层 JS（复用真实 transform）
2. 执行逻辑层（Page/Component 构造器捕获）→ 实例化
3. 返回 `{ instance, wxml, js, context, config }`——实例方法已摊平（组件 `methods` + 页面顶层函数绑定，微信组件方法必须在 `methods:{}`）；`setData` 合并进 `data`（真实语义）

## 统一挂载 API：同一份 SFC 双端挂载（决策 #204）

```ts
// ★必须 @vitest-environment happy-dom（esbuild TextEncoder instanceof 检查在 jsdom 跨 realm 崩）
import { mountComponent, stateOf, textOf } from '@proteus-vue/test-core'

const COUNTER = `<script setup lang="ts">
import { ref } from 'vue'
const count = ref(1)
const label = 'counter'
function increment() { count.value++ }
</script>
<template><view><text>{{ label }}: {{ count }}</text><button @click="increment">+1</button></view></template>`

it('同一份 SFC → web/mp 挂载 → 状态断言只写一份（06 铁律）', async () => {
  const web = (await mountComponent(COUNTER, { platform: 'web' })) as any
  const mp = (await mountComponent(COUNTER, { platform: 'mp' })) as any
  for (const host of [web, mp]) {
    expect(stateOf(host).count).toBe(1) // 统一状态读取
    ;(host.vm ? host.vm.increment : host.increment)()
    expect(stateOf(host).count).toBe(2)
  }
})
```

- `mountComponent(sfc, { platform: 'web' | 'mp', props?, global?, compileOptions? })`——统一入口；web = @vue/test-utils 真实渲染（`mountWebComponent`），mp = 逻辑层 + WXML 归一化 host（instance 摊平 + wxml 顶层暴露，深层断言仍用 `mountMpComponent`）
- `sfcToComponent(sfc)`——compileScript + compileTemplate 双段编译 → esbuild 剥离 TS（cjs）→ `__VUE__` 注入执行；★不启用 inlineTemplate（setup 返回绑定对象 → `vm.$.setupState` 可读状态）
- 断言 helper（stateOf/textOf）见 §06；★web 渲染更新在微任务队列——状态变更后文本断言先 `await host.vm.$nextTick()`

## Transform 插件测试（对齐 Compiler M2/M4）

```ts
it('v-if → wx:if', () => {
  const ir = parse('<view v-if="x"/>')
  const code = codegenMp(ir)
  expect(code).toContain('wx:if')
})
```

## 铁律
- L3 不跑真机，真机行为下沉到 L4 E2E
- 小程序用例只校验"逻辑 + WXML"，不校验视觉样式
- `createMockContext` 是唯一 wx 来源

---
