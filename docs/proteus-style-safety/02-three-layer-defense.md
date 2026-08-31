# 三层防线设计细节

> 配套：`01-style-runtime-safety.md` · `05-compile-time-derivation.md` · `06-runtime-validator.md`

---

## 总览

```
① 编译期静态校验（SFC <style> + :style AST）
        ↓ 静态可达值
② 编译期代码生成（_validated() 内联 + 常量折叠）
        ↓ 动态不可达值
③ 运行时 Validator（最后闸门，O(n) 属性数）
        ↓ 只放行合法值
④ 五端原生闸门（JSI 调用前最后一道类型收窄）
        ↓
原生 API（绝无非法参数）
```

**设计目标：让 ③ 的调用频率趋近于零。** ① 覆盖越全，运行时开销越小。

---

## 第一层：编译期静态校验

### 输入

- SFC `<style>` 块（完全静态，100% 可覆盖）
- `<template>` 中 `:style` 绑定的表达式 AST

### 处理流程

```typescript
// Compiler / transforms / style-safety.ts
export function styleSafetyTransform(sfc: SFC): TransformResult {
  // 1. 校验 <style> 块（对照 CSS 四级矩阵）
  for (const rule of sfc.styles) {
    for (const decl of rule.declarations) {
      const level = CSS_COMPAT_MATRIX[decl.property]
      switch (level) {
        case '✅': continue
        case '🔶': requireSemanticComponent(decl) // → <p-glass> 等
        case '⚠️': rewriteAtCompileTime(decl)      // calc → 约束
        case '❌': error('CSS001', `${decl.property} 禁止在运行时直通`)
      }
    }
  }

  // 2. 分析 :style 表达式 AST
  for (const bind of sfc.styleBindings) {
    const reachable = deriveReachableValues(bind.expression)
    // 见 05-compile-time-derivation.md
    if (reachable.isFullyStatic) {
      // 静态可达 → 第二层：生成校验后代码
      bind.replaceWith(generateValidatedCall(reachable.values))
    } else {
      // 动态不可达 → 保留为运行时 Validator 调用
      bind.replaceWith(`_runtimeValidate(${bind.expression})`)
    }
  }
}
```

### 关键：`<style>` 块 100% 编译期覆盖

Vue SFC 的 `<style>` 是**静态 CSS**，Compiler 能穷举每一条声明 → **无需运行时参与**。

```css
/* ✅ 编译期完全校验，产物中直接内联合法值 */
.card { width: 100px; opacity: 0.8; }
```

---

## 第二层：编译期 `:style` 代码生成

详见 `05-compile-time-derivation.md`。

要点：
- AST 静态分析推导"可达值集"
- 静态可达 → 生成 `_validated(prop, value)` 内联调用（值已硬编码，Validator 只做查表）
- 常量折叠、死分支消除

```vue
<!-- 源码 -->
<div :style="{ width: isLarge ? '100px' : '50px', opacity: 0.5 }" />
```

```javascript
// 编译产物
_patchStyle(el, {
  width: _validated('width', isLarge ? '100px' : '50px'), // 值集={100px,50px} 均合法
  opacity: 0.5  // 编译期确认合法，直接内联
})
```

---

## 第三层：运行时 Validator

详见 `06-runtime-validator.md`。

**只在"编译期无法推导的动态值"上触发**，例如：

```vue
<!-- API 返回值，编译期不可知 → 运行时校验 -->
<div :style="{ width: apiData.width + 'px' }" />
```

职责：
1. 属性名白名单检查
2. 值类型守卫（Length / Color / Opacity）
3. 逐平台类型收窄
4. 降级 + warn / 上报

**性能：O(n) where n = style 属性数，在 JS 线程执行，验证完才调 JSI → 不放大桥调用。**

---

## 第四层：五端原生闸门（纵深防御）

详见 `07-five-end-native-gates.md`。

即使前三层全漏（理论上不可能），**原生端 JSI binding 再做一次参数校验**：

| 端 | 闸门 |
|----|------|
| iOS | `CGFloat` 范围检查 + `UIEdgeInsets` 合法性 |
| Android | `TypedValue` 非 NaN + `LayoutParams` 合法性 |
| 鸿蒙 | `Length` 范围 + `Constraint` 合法性 |
| Web | CSSOM 宽容（天然安全） |
| Skyline | 有限数 + 布局参数校验 |

> **纵深防御：四层任一生效即安全。** 第四层是"最后堡垒"，正常情况下永远不会被触发（触发即 bug，DevTools 报警）。

---

## 优先级与退化

| 场景 | 生效层 | 运行时开销 |
|------|-------|-----------|
| `<style>` 静态样式 | ① | 0（编译期） |
| `:style` 静态可达值 | ② | ≈0（内联校验） |
| `:style` 动态值 | ③ | O(n) 属性数 |
| 极端兜底 | ④ | 原生校验（极低频） |

**目标分布：① 60% + ② 25% + ③ 15% + ④ <1%。**
