# API 设计：`useSafeArea()` 与 `<p-safe>`

> 统一 JS 运行时 API + 组件语义，五端行为一致

---

## 1. `useSafeArea()`

返回**响应式**安全区对象，系统区域变化时自动更新：

```typescript
import { useSafeArea } from '@proteus-vue/platform'

const safe = useSafeArea()
// safe.value = { top, bottom, left, right, island }

// 模板绑定
<p-view :style="{ paddingTop: safe.top + 'px' }">

// 灵动岛展开/收起时 safe.top 自动变化，触发 patch
```

### 1.1 响应式更新源

| 端 | 监听方式 |
|---|---|
| iOS | `viewSafeAreaInsetsDidChange` → JSI 回调 |
| Android | `WindowInsetsListener` → JNI 回调 |
| 鸿蒙 | `window.on('avoidAreaChange')` → 回调 |
| Web | `ResizeObserver` + CSS env |
| Skyline | `onResize` + `safeArea` |

### 1.2 `onChange`

```typescript
const disposer = safe.onChange((next) => {
  console.log('灵动岛展开/收起', next)
})
// 返回销毁函数，避免泄漏（对齐 Memory plan 的 disposer 模式）
```

---

## 2. `<p-safe>` 组件

```vue
<!-- 顶部避让 -->
<p-safe area="top">
  <pg-glass preset="navigationBar" />
</p-safe>

<!-- 底部避让 -->
<p-safe area="bottom">
  <p-view class="tab-bar">...</p-view>
</p-safe>

<!-- 横屏左右 -->
<p-safe area="horizontal">
  <p-view class="landscape">...</p-view>
</p-safe>

<!-- 全部避让 -->
<p-safe area="all">
  <p-view class="fullscreen-content">...</p-view>
</p-safe>
```

### Props

| Prop | 类型 | 默认 | 说明 |
|------|------|------|------|
| `area` | `'top'\|'bottom'\|'left'\|'right'\|'horizontal'\|'all'` | `'top'` | 避让方向 |
| `mode` | `'constraint'\|'extend'\|'ignore'` | `'constraint'` | 约束/扩展/忽略 |

---

## 3. `<p-safe-island>` 组件

灵动岛专属（iOS only）：

```vue
<!-- 避让灵动岛 -->
<p-safe-island>
  <p-view class="status-content">...</p-view>
</p-safe-island>

<!-- 玻璃融合 -->
<p-safe-island mode="glass-blend">
  <pg-glass preset="navigationBar" />
</p-safe-island>
```

| Prop | 类型 | 默认 | 说明 |
|------|------|------|------|
| `mode` | `'avoid'\|'glass-blend'` | `'avoid'` | 避让 / 玻璃融合 |

**其他端：`p-safe-island` 降级为 `p-safe-top`，`glass-blend` 降级为普通避让。**

---

## 4. CSS 语义单位

```css
.nav-bar {
  padding-top: p-safe-top;
  padding-bottom: p-safe-bottom;
  padding-left: p-safe-left;
  padding-right: p-safe-right;
}

.island-zone {
  height: p-safe-island;  /* iOS: 灵动岛高度, 其他: 0 */
}
```

Compiler 构建期映射到各端（见 `05-compiler-integration.md`）。

---

## 5. 与 Platform 判别联合的协作

遵循 Platform plan 的 `assertPlatform`：

```typescript
import { assertPlatform } from '@proteus-vue/platform'

// 仅在 iOS 使用灵动岛专属能力
if (assertPlatform('ios')) {
  // 可直接用 p-safe-island-glass
}
```

**但推荐优先用 `p-safe-*` 语义，让 Compiler 自动分支，避免运行时平台判断。**

---

## 6. 组合示例

```vue
<template>
  <p-safe area="top" mode="extend">
    <p-safe-island mode="glass-blend">
      <pg-glass preset="navigationBar">
        <p-text class="title">{{ title }}</p-text>
      </pg-glass>
    </p-safe-island>
  </p-safe>

  <p-view class="content">
    <!-- 页面内容 -->
  </p-view>

  <p-safe area="bottom">
    <p-view class="action-bar">
      <p-button>确认</p-button>
    </p-view>
  </p-safe>
</template>

<style>
.title { padding-left: p-safe-left; padding-right: p-safe-right; }
</style>
```

**完整导航栏方案：玻璃 + 灵动岛融合 + 安全区避让，五端一致。**

---

## 7. 反例

❌ `safe.top.value + 'px'` 硬编码数值逻辑（应用 `p-safe-top` CSS）  
❌ 直接读 `window.safeAreaInsets`（JSI 旁路，违反 Memory plan 约束）  
❌ `onChange` 后不销毁监听器（内存泄漏，违反 disposer 模式）  
✅ 用 `useSafeArea()` 响应式 + `<p-safe>` 组件 + 及时 disposer
