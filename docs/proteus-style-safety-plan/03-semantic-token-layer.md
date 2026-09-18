# 语义层设计：只允许安全子集

> 配套：`01-style-runtime-safety.md` · `architecture-principle.md`（原则 #10）

---

## 核心判断

> **内联 style / 动态 `:style` 的本质问题 = 开发者绕过"统一语义层"，把 CSS 属性名直塞各端——而各端原生 API 的参数模型根本不是 CSS。**

因此解法不是"校验 CSS 是否合法"，而是 **禁止 `:style` 直通 CSS，只允许 `p-* `语义 token + 已映射（白名单）属性**。

---

## 1. 属性白名单（ALLOWED_STYLE_PROPS）

```typescript
// runtime/style-safety/whitelist.ts
export const ALLOWED_STYLE_PROPS = {
  // ── ✅ 直映射：五端原生都有对应，值经类型守卫后放行 ──
  width: 'Length', height: 'Length',
  minWidth: 'Length', maxWidth: 'Length',
  minHeight: 'Length', maxHeight: 'Length',
  padding: 'Length', paddingTop: 'Length', paddingRight: 'Length',
  paddingBottom: 'Length', paddingLeft: 'Length',
  margin: 'Length', marginTop: 'Length', marginRight: 'Length',
  marginBottom: 'Length', marginLeft: 'Length',
  color: 'Color', backgroundColor: 'Color', borderColor: 'Color',
  opacity: 'Opacity', borderRadius: 'Length',
  borderWidth: 'Length', borderTopWidth: 'Length',
  transform: 'Transform', transformOrigin: 'TransformOrigin',
  zIndex: 'Integer',
  flex: 'FlexNumber', flexGrow: 'FlexNumber', flexShrink: 'FlexNumber',
  alignSelf: 'FlexAlign', justifyContent: 'FlexJustify', alignItems: 'FlexAlign',
  // ── 🔶 语义组件：必须用 p-* 封装，禁止裸写 ──
  backdropFilter: 'SEMANTIC_ONLY',  // → <p-glass>
  filter: 'SEMANTIC_ONLY',          // → <p-filter>
  // ── ❌ 禁止（CSS 矩阵 ❌ 级）──
  display: 'FORBIDDEN',   // inline/float 禁用，用 p-flex/p-stack
  float: 'FORBIDDEN',
  clear: 'FORBIDDEN',
  verticalAlign: 'FORBIDDEN',
} as const

export type AllowedStyleProp = keyof typeof ALLOWED_STYLE_PROPS
```

### 级别语义

| 标记 | 含义 | 运行时行为 |
|------|------|-----------|
| `Length` / `Color` 等类型名 | ✅ 直映射 | 走类型守卫 → 放行 |
| `SEMANTIC_ONLY` | 🔶 语义组件 | 编译报错，提示改用 `<p-*>` |
| `FORBIDDEN` | ❌ 禁止 | 编译报错（CSS001） |

---

## 2. `:style` 写法约束

```vue
<!-- ❌ 禁止：CSS 属性直通（绕过语义层） -->
<div :style="{ 'backdrop-filter': 'blur(10px)' }" />
<div :style="{ display: 'inline-flex' }" />
<div :style="{ float: 'left' }" />

<!-- ✅ 允许：语义组件 -->
<p-glass :blur="10" />
<p-flex direction="row" justify="center" />

<!-- ✅ 允许：白名单属性（✅ 直映射） -->
<div :style="{ opacity: 0.5, width: dynamicWidth }" />

<!-- ✅ 允许：p-* token / Theme token -->
<div :style="{ color: theme.colors.primary }" />
<div :class="[isActive && 'card-active']" />
```

**核心约束只有一个：动态 `:style` 只允许白名单属性 + `p-*` 语义组件 + Theme token。**

---

## 3. 为什么 `:class` 完全不受影响

```vue
<!-- ✅ 零运行时开销、零安全风险 -->
<div :class="{ active: isActive, 'text-lg': isLarge }" />
```

原因：
- `<style>` 块在**编译期被完全控制**（静态 CSS），已通过 CSS 四级矩阵校验
- `:class` 只是**切换已校验的类名**，不引入任何新样式值
- → **无需运行时参与**

> 框架鼓励用 `:class` + 语义类，而非 `:style` + 裸属性。

---

## 4. 推荐写法层级（递进）

| 层级 | 写法 | 安全性 | 性能 | 适用 |
|------|------|--------|------|------|
| 1（最优） | `<style>` + `:class` | 编译期 100% | 0 运行时 | 静态样式 |
| 2 | `<p-*>` 语义组件 | 编译期 100% | 0 运行时 | 布局/玻璃/特效 |
| 3 | `:style` + 白名单属性 | 编译期 + 运行时 | O(n) | 动态数值 |
| 4（兜底） | Theme token / CSS 变量 | 编译期展开 | GPU 联动 | 主题/字号 |

**层级越靠前，越安全、越高效。** 框架通过 `--strict-style` 引导开发者向前靠。

---

## 5. 自动修复（Compiler 尽力而为）

```vue
<!-- 修复前 -->
<div :style="{ display: 'inline-flex', 'backdrop-filter': 'blur(10px)' }" />

<!-- --strict-style --fix 修复后 -->
<p-flex display="inline-flex">
  <p-glass :blur="10">
    ...
  </p-glass>
</p-flex>
```

**规则：**
- `display: flex/inline-flex` → `<p-flex>`
- `display: grid` → `<p-grid>`
- `backdrop-filter` → `<p-glass>`
- `filter` → `<p-filter>`

无法自动修复的（如复杂动态值）→ 报错 + 手动引导。

---

## 6. 与 CSS 四级矩阵的联动

```
CSS 兼容矩阵（proteus-css-compat）
    ├─ ✅ 直映射 → 进入白名单（本方案）
    ├─ 🔶 语义组件 → SEMANTIC_ONLY（本方案）
    ├─ ⚠️ 编译期重写 → Compiler 处理后进入白名单
    └─ ❌ 禁止 → FORBIDDEN（本方案）
```

**本方案 = CSS 矩阵的"运行时执行层"**：矩阵定义什么合法，本方案保证非法值永远到不了原生。

---

## 7. 反例（明确禁止）

- ❌ 允许任意 CSS 属性直通 `:style`（绕过语义层）
- ❌ 用 `v-html` + `<style>` 注入（CSP + 安全层拦截）
- ❌ 运行时动态 `display: inline-flex`（必须用 `<p-flex>`）
- ❌ 把 `:style` 当 `:class` 用（频繁切换类名应走 `:class`）
- ❌ 用 `!important` 覆盖（框架禁用，编译报错）

---

## 8. 边界情况

| 情况 | 处理 |
|------|------|
| 第三方组件库传入 style | 进入同一 Validator，统一校验 |
| 动画 `transition` 中动态值 | 走 Worklet + 类型守卫，不放大桥 |
| 服务端渲染（SSR） | 编译期校验优先，运行时降级为 warn |
| 用户主题切换 | Theme token 编译期展开为 CSS 变量，GPU 联动，不走 JSI |

---

## 9. 开发者心智负担

**极小**——因为：
1. `<style>` 块写法与 Web 几乎一致（仅剔除 ❌ 级属性）
2. `:class` 完全不受影响
3. `:style` 只需记住"**只用白名单属性 + p-组件**"
4. `--strict-style` 即时报错 + 自动修复

> **本质上把"原生 API 的强类型约束"提前到开发者熟悉的 Vue 模板层，而非在运行时崩溃后才发现。**
