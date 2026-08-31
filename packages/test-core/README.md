# @proteus-vue/test-core

Proteus 测试核心（test-framework M3）——L1-L3 标准件。

## 能力

| API | 说明 |
|-----|------|
| `createMockContext(options?)` | **唯一 wx 来源**：wx 全局 mock（storage/router/ui 内存实现 + vi.fn 可断言）+ Page/Component/App 构造器捕获 + getApp/getCurrentPages + 内存存储。`afterEach` 调 `cleanup()` 恢复全局 |
| `mountMpComponent(sfc, options?)` | SFC → 真实编译（`compileVueSfc`）→ 执行逻辑层 JS → 返回 `{ instance, wxml, js, context, config }`——**逻辑 + WXML 双断言**（不真实渲染，真机行为下沉 L4） |

## 使用

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { createMockContext, mountMpComponent } from '@proteus-vue/test-core'

describe('p-button 逻辑 + WXML', () => {
  let ctx: ReturnType<typeof createMockContext>
  afterEach(() => ctx?.cleanup())

  it('渲染 + disabled 态', () => {
    const { instance, wxml, context } = mountMpComponent(`
      <template><button class="p-btn" :disabled="disabled">{{ label }}</button></template>
      <script setup>
      import { ref } from 'vue'
      const disabled = ref(true)
      const label = '确认'
      </script>
    `)
    expect(wxml).toContain('button') // 结构断言
    expect(instance.data).toHaveProperty('disabled', true) // 逻辑断言
    // wx 断言（唯一来源）
    context.wx.storage.setStorageSync('k', 1)
    expect(context.wx.storage.getStorageSync('k')).toBe(1)
  })
})
```

## 铁律（03-component-integration.md）

- 测试环境只 mock wx，禁止真实引用
- 小程序用例只校验"逻辑 + WXML"，不校验视觉样式
- `createMockContext` 是唯一 wx 来源
