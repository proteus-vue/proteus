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
it('p-button 渲染 + disabled 态', async () => {
  const { instance, wxml } = await mountMpComponent('./p-button.vue', {
    props: { disabled: true },
  })
  expect(instance.proxy!.disabled).toBe(true)   // 逻辑
  expect(wxml).toContain('view')                 // 结构（对齐 Component plan 映射表）
})
```

`mountMpComponent` 内部：
1. Compiler 把 SFC → WXML（复用真实 transform）
2. happy-dom 加载 WXML 对应的逻辑层 Page
3. 返回 `{ instance, wxml }`

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
