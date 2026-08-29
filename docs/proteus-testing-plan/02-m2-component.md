# M2 — 组件测试 (L2)

> 占比 20%，测 SFC 渲染 + Route IR + Transform 规则

## 1. 技术选型

- `@vue/test-utils`（mount / shallowMount）
- `happy-dom` / `jsdom` 环境
- 小程序：glass-easel 测试适配器（模拟 WXML 节点树）

## 2. SFC 组件测试

```vue
<!-- MyButton.vue -->
<template>
  <button class="p-button" :disabled="loading" @click="onClick">
    <slot />
  </button>
</template>
```

```ts
import { mount } from '@vue/test-utils'
import MyButton from './MyButton.vue'

it('emits click', async () => {
  const wrapper = mount(MyButton)
  await wrapper.trigger('click')
  expect(wrapper.emitted('click')).toBeTruthy()
})

it('disabled when loading', () => {
  const wrapper = mount(MyButton, { props: { loading: true } })
  expect(wrapper.classes()).toContain('is-loading')
})
```

## 3. Route IR 测试（Router M2）

验证 `<route>` 块解析产物：

```ts
import { parseRouteBlock } from '@proteus/compiler'

it('parses nested route meta', () => {
  const ir = parseRouteBlock(`
    <route>
      { "path": "/detail/:id", "meta": { "auth": true } }
    </route>
  `)
  expect(ir.path).toBe('/detail/:id')
  expect(ir.meta.auth).toBe(true)
})
```

## 4. Transform 规则测试（Compiler M4）

每个 transform 一份测试，输入 IR → 期望产物：

```ts
import { transformVIf } from '@proteus/compiler/transforms/v-if'

it('v-if → wx:if', () => {
  const input = { type: 'Element', tag: 'view', directives: [{ name: 'if', exp: 'show' }] }
  const output = transformVIf(input)
  expect(output.tag).toBe('view')
  expect(output.attrs['wx:if']).toBe('{{show}}')
})
```

**这是"透明编译"的核心验证** —— 每条规则都有可复现的输入/输出。

## 5. Worklet 测试（Component M5）

mock `"worklet";` 函数，验证其在 UI 线程标记：

```ts
it('marks worklet function', () => {
  const fn = createWorklet(() => {})
  expect(fn.__worklet).toBe(true)
  expect(fn.__location).toMatch(/ui-thread/)
})
```

## 6. 验收

- [ ] 每个基础组件（p-view/p-button/...）有渲染测试
- [ ] 每个 transform 规则有快照
- [ ] Route IR 覆盖所有 meta 字段
- [ ] Worklet mock 不依赖真实 Skyline
