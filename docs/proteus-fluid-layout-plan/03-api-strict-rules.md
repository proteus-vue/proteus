# API 设计与严格规则

## 1. 模板指令 API

### `p-fluid` — 流式尺寸
```vue
<h1 p-fluid="font-size(20, 32)">标题</h1>
<div p-fluid="padding(16, 24)">内容</div>
<section p-fluid="gap(12,20) margin(16,32)">...</section>
```

### `p-grid` — 自适应网格
```vue
<p-grid :min-col-width="160" :gap="12">
  <p-card v-for="item in items" />
</p-grid>
```

### `p-stack` — 弹性栈
```vue
<p-stack direction="row" :wrap="true" :gap="8">
  <p-tag v-for="tag in tags" />
</p-stack>
```

### `p-fit` — 内在尺寸
```vue
<p-fit :max-ratio="0.8">
  <span>动态文本</span>
</p-fit>
```

## 2. 配置 API（app.config，对接 G-20）

```typescript
export default defineAppConfig({
  layout: {
    designWidth: 375,
    breakpoints: { sm: 320, md: 768, lg: 1024, xl: 1440 },
    // 可选：自定义流体算法
    fluid: { strategy: 'clamp' | 'container-query' },
  },
})
```

## 3. Composition API

```typescript
import { useBreakpoint, useColumns } from '@proteus-vue/runtime'

// 响应式当前断点
const bp = useBreakpoint()  // Ref<'sm' | 'md' | 'lg' | 'xl'>

// 响应式列数（对接 p-grid）
const cols = useColumns(160, 12)  // Ref<number>
```

## 4. 严格规则（FLD 系列）

| 规则 | 级别 | 说明 | 自动修复 |
|------|------|------|---------|
| **FLD001** | error | 禁止手写 `@media (min-width: Xpx)` | 提示改用 `p-fluid` |
| **FLD002** | error | 禁止硬编码像素断点值 | 提示用 `app.config.layout.breakpoints` |
| **FLD003** | warning | `p-fluid` 必须提供 min/max 区间 | 自动推导（设计稿基准） |
| **FLD004** | error | `p-grid` 必须声明 `min-col-width` | 无 |
| **FLD005** | warning | 避免固定 `width: 320px` 等死尺寸 | 提示改用 `p-fluid` |
| **FLD006** | error | 禁止 `Dimensions.get().width` 手动计算 | 提示用 `useBreakpoint` |

## 5. 与 Style Safety (G-16) 的协同

柔性布局生成的样式自动经过 Style Validator：

```
p-fluid → clamp() → Validator → JSI → 原生
p-grid  → grid-template → Validator → JSI → 原生
```

**违反 FLD 规则 → 编译期报错（对齐 --strict-css / --strict-style）。**
