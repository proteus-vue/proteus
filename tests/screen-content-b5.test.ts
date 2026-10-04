// tests/screen-content-b5.test.ts —— ★★★App 三端对齐 · 阶段 1b（B5）：
//   **SFC 产物 → 屏内容**（LayoutTemplate → ScreenContent）——把"装置内联"换成"真实页面产物"（2026-10-04）
//
// 【这张测试锁什么】阶段 1a 的 `contentOf` 用**手写节点**证明链路；B5 让内容来自**编译器产物**：
//   `buildLayoutTemplate(SFC)`（真实 Vue 模板 → 布局模板）→ `screenContentFromLayoutTemplate`
//   → `ScreenContent`（宿主建树用）。本测试锁**转换正确性**（尤其"嵌套 style 展平到顶层"
//   ——内核 NodeDto 读顶层键，不展平会静默丢样式）。
//
// 【判据】
//   ① 真实 SFC → 模板 → 内容：节点数一致、id/parentId/text 搬对
//   ② ★**style 展平**：引擎字段出现在**节点顶层**（不是嵌套 `style` 子对象）
//   ③ 空文本不搬（`text:''` 不产生空 text 字段）；有文本则搬
//   ④ viewport 透传（可选）
//   ⑤ 结构类型：不依赖 compiler 包即可满足（本函数签名用结构类型）

import { describe, it, expect } from 'vitest'
import { buildLayoutTemplate } from '@proteus-vue/compiler'
import { screenContentFromLayoutTemplate } from '@proteus-vue/render-backend'

const SFC = `<template>
  <view class="screen" style="width: 100%; flex-direction: column; padding: 16">
    <view style="height: 56; background-color: #5B5BD6; justify-content: center">
      <text style="color: #FFFFFF; font-size: 20">工作台</text>
    </view>
    <view style="height: 120; background-color: #FFFFFF" />
  </view>
</template>
<script setup lang="ts">
const unused = 1
</script>`

describe('★阶段 1b（B5）· SFC 产物 → 屏内容', () => {
  const tpl = buildLayoutTemplate(SFC, 'pages/workbench.vue')
  const content = screenContentFromLayoutTemplate(tpl.template, { width: 390, height: 844 })

  it('① 真实 SFC → 模板 → 内容：节点数与 id/parentId 搬对', () => {
    expect(tpl.ok, '模板编译应 ok').toBe(true)
    expect(content.nodes.length, '节点数与模板一致').toBe(tpl.template.nodes.length)
    expect(content.nodes.length, '至少一个根 + 子节点').toBeGreaterThanOrEqual(3)
    // 根：parentId=null；子：parentId 指向父
    const roots = content.nodes.filter((n) => n.parentId === null)
    expect(roots.length, '恰一个根').toBe(1)
    expect(roots[0]!.id, '根 id 与模板同源').toBe(tpl.template.roots[0])
  })

  it('② ★style 展平：引擎字段在节点**顶层**（不是嵌套 style 子对象）', () => {
    // 找那个有背景色的节点（header）
    const header = content.nodes.find((n) => (n as { backgroundColor?: string }).backgroundColor)
    expect(header, '应有带 backgroundColor 的节点').toBeTruthy()
    // ★关键：backgroundColor 必须在**顶层**（内核 NodeDto 读顶层），且节点上不应残留嵌套 style 对象
    expect(typeof (header as { backgroundColor?: string }).backgroundColor, '背景色在顶层').toBe('string')
    expect((header as { style?: unknown }).style, '★不应残留嵌套 style 对象（否则内核读不到）').toBeUndefined()
    expect((header as { height?: number }).height, 'height 也应在顶层').toBe(56)
  })

  it('③ 文本：非空搬、空不搬（空文本不产生空字段）', () => {
    const withText = content.nodes.find((n) => (n as { text?: string }).text)
    expect(withText, '应有一个带文本的节点').toBeTruthy()
    expect((withText as { text?: string }).text, '文本内容搬对').toBe('工作台')
    // 无文本节点不应有 text 键
    const noText = content.nodes.find((n) => !(n as { text?: string }).text && (n as { backgroundColor?: string }).backgroundColor)
    expect(noText && 'text' in noText, '空文本节点不应有 text 键').toBe(false)
  })

  it('④ viewport 透传（可选）', () => {
    expect(content.viewport, 'viewport 透传').toEqual({ width: 390, height: 844 })
    const noVp = screenContentFromLayoutTemplate(tpl.template)
    expect(noVp.viewport, '不传 viewport ⇒ 无该字段').toBeUndefined()
  })

  it('⑤ 结构类型：手写模板对象也能转（不依赖 compiler 包）', () => {
    const c = screenContentFromLayoutTemplate({
      nodes: [
        { id: 1, parentId: null, style: { flexDirection: 'column' }, tag: 'view' },
        { id: 2, parentId: 1, style: { height: 40 }, text: 'hi' },
      ],
    })
    expect(c.nodes[0]).toMatchObject({ id: 1, parentId: null, flexDirection: 'column', semantic: 'view' })
    expect(c.nodes[1]).toMatchObject({ id: 2, parentId: 1, height: 40, text: 'hi' })
  })
})
