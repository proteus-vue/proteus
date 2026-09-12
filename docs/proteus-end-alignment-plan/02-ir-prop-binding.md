# 02 · 三层绑定规则（IR props ↔ 组件 props ↔ 原生属性）

## 1. 绑定链路

```
官方能力点 ──(覆盖度判定)──→ IR 语义约束 ──(props 声明)──→ 原生属性
   (22 个)                    (props: [...])            (模板绑定)
        │                          │                        │
        └── 标尺（完整性）          └── SSOT（一致性）        └── 实现（可端异）
```

## 2. 命名策略（★核心，决定"对齐"是不是"抄"）

对每个官方属性，三种处理：

| 情形 | 处理 | 例子 |
|---|---|---|
| **语义等价，多端通用** | 归一为框架名 | 官方 `value`（slider）/`checked`（switch）→ `modelValue` |
| **语义等价，官方名更通用** | 保留官方名（转 camelCase） | 官方 `placeholder`/`disabled`/`maxlength` → 同名 |
| **平台私有能力**（T3） | 保留原名 + **标 Tier private** | 官方 `open-type`/`session-from`/`app-parameter` |

**判定顺序**（不可颠倒）：

1. 先在 `primitives.ts` 的 `props` 里登记**语义约束**
2. 再在组件 `defineProps` 声明**开发者书写面**
3. 最后在模板绑到**原生元素**

> **禁止**：直接从第 3 步开始（见到官方属性就往模板加）——会绕过语义层，形成"端私有属性泄漏"。已验证此坑：`p-button` 只声明 2 个 props 时，Web 端 `proteus-button` 却实现了全套 → **两端能力不对称**。

## 3. 命名转换规则

| 场景 | 规则 | 例子 |
|---|---|---|
| 模板 → props | `:kebab-case` ↔ props `camelCase` | `:form-type` ↔ `formType` |
| props → IR 约束 | 同名（IR 用 camelCase） | `hoverStartTime` |
| 保留字冲突 | 加前缀或改写 | `type`（DOM 表单语义冲突）→ 见 §4 |
| 事件 | `@event` ↔ props `onEvent`；官方 `bind:x` → `@x` | `bind:getuserinfo` → `@getuserinfo` |

## 4. 已知冲突与解法

### 4.1 `type` 的 DOM 语义冲突

`<button :type>` 在 DOM 里是**表单提交类型**（`button|submit|reset`），但小程序 `type` 是**视觉样式**（`default|primary|warn`）：

```vue
<!-- vue-tsc 会报 TS2322（string 不匹配 button|submit|reset） -->
<button :type="type">
<!-- 解法：类型断言（运行时不校验，语义由小程序/Web 后端各自解释） -->
<button :type="(type as any)">
```

### 4.2 布尔属性三态

小程序空属性（`<button disabled>`）为真、Web `:disabled="false"` 为假 —— 须**显式真值判定**：
`v === true || v === '' || v === 'true'`（Web 端 `proteus-button` 已内化；★曾因此把全部按钮置灰）。

### 4.3 `defineEmits` 必须单行数组

框架 `extractSfcMacros` 用**单行正则**解析 `emits: [...]`：

```ts
// ❌ 多行 → 权威 emits 提取为空 → sfc-macros-conformance 测试红
const emit = defineEmits([
  'click', 'getuserinfo',
])
// ✅ 单行
const emit = defineEmits(['click', 'getuserinfo', 'contact'])
```

## 5. 落地模板（以 p-button 为例）

```vue
<script setup lang="ts">
const props = defineProps({
  // ── T1 核心（跨端语义） ──
  disabled: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  // ── T3 私有（小程序开放能力，标 private） ──
  openType: { type: String, default: '' },      // 微信开放能力
  sessionFrom: { type: String, default: '' },   // open-type=contact 配套
})
const emit = defineEmits(['click', 'getuserinfo', 'contact'])  // ★单行
</script>
<template>
  <button
    :open-type="openType"
    :session-from="sessionFrom"
    @getuserinfo="onOpenEvent('getuserinfo', $event)"
  ><slot /></button>
</template>
```

## 6. IR 登记（Layer 1）

对齐一个新属性时，**同步更新** `primitives.ts` 的 `props`：

```ts
{ id: 'U1', kind: 'ui', semantic: 'ui.button', tag: 'p-button',
  props: ['disabled', 'loading', 'size', 'type', 'plain', 'openType', 'hoverClass', 'hoverStartTime'],
  mpEquiv: '<button>' }
```

> IR `props` 是**语义约束集**（可读性/审计用），不要求与 `defineProps` 逐字一致（后者含实现细节如 `pid`/`throttle`）。
