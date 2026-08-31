# 跨端断言一致性

## 问题
同一份 SFC，两端 DOM 结构不同：
- Web: `<div class="btn">`
- 小程序: `<view class="btn">`

**如果断言写结构，一份用例无法两端复用。**

## 解决方案：断言只碰"逻辑 + 状态 + 语义"

```ts
// ✅ 好：跨端通用
expect(wrapper.vm.count).toBe(1)
expect(page.data.count).toBe(1)

// ❌ 坏：端专属
expect(wrapper.find('div.btn').exists()).toBe(true)   // 小程序是 view
```

## 分层断言策略

| 层级 | Web | 小程序 | 是否共用 |
|---|---|---|---|
| 状态（Pinia） | ✅ | ✅ | ✅ 完全共用 |
| 计算属性 | ✅ | ✅ | ✅ 完全共用 |
| 事件触发 | `@vue/test-utils` | automator | **封装统一 helper** |
| DOM 结构 | happy-dom | WXML AST | ❌ 各自断言 |
| 视觉 | Playwright 截图 | automator 截图 | ❌ 各自截图 |

## 统一事件 helper

```ts
// test-core/events.ts
export async function tap(el: WebEl | MpEl) {
  if ('trigger' in el) el.trigger('click')      // Web
  else await el.tap()                            // 小程序
}
```

## DOM 差异收敛点（对齐 Component plan `p-*`）

`p-*` 组件映射表是**唯一的端差异来源**，测试只校验映射结果：
- Web: `p-button` → `<button>`
- 小程序: `p-button` → `<button type="default">`

映射表本身有独立快照用例（§02），业务用例不再重复。

## 铁律
- 禁止跨端用例直接写 `div` / `view` 字面量
- DOM 断言一律下沉到 `p-*` 组件测试 + 编译快照
- 业务逻辑用例 100% 跨端复用

---
