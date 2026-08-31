# 02 `--strict-css` Lint 规则

> Compiler 构建期校验，确保业务样式落在「兼容矩阵」允许范围内。
> 开关：`proteus compile --strict-css`（默认开；关则降级为警告 + 自动修复建议）

## 一、报错码

| 码 | 规则 | 级别(strict) | 降级(非 strict) |
|----|------|--------------|----------------|
| `CSS001` | 使用 `float` | error | warn + 建议删 |
| `CSS002` | 使用 `display: inline/inline-block`（非文本内嵌套） | error | warn |
| `CSS003` | 通用选择器 `*` | error | warn |
| `CSS004` | 属性选择器 `[attr]` | error | warn |
| `CSS005` | 元素选择器（`div{}` / `span{}`） | error | warn |
| `CSS006` | 深层后代组合（超过 2 级 `.a .b .c`） | error | warn |
| `CSS007` | 依赖层叠上下文的 `z-index`（跨父级 stacking） | error | warn |
| `CSS008` | 使用 `calc()` / `vh` / `vw` 等需运行期求值单位 | error | ⚠️ 自动重写 |
| `CSS009` | 裸 `backdrop-filter`（未走 `<p-glass>`） | error | 🔶 自动转 p-glass |
| `CSS010` | `:nth-child` 复杂表达式（非 `:first/:last`） | warn | warn |
| `CSS011` | `box-shadow` 含 rgba 多色/大扩散（需 ARGB 重写） | warn | ⚠️ 自动转 ARGB |
| `CSS012` | `@media` 非 DarkMode / 非断点预设 | warn | warn |

## 二、校验时机

```
SFC 解析
  ↓
<style> 提取
  ↓
AST 遍历（postcss / css-tree）
  ↓
  ① 选择器校验（CSS003-007）
  ② 属性校验（CSS001-002, 008-012）
  ③ 语义封装建议（CSS009）
  ↓
Reporter 输出（对接 --trace-transform / TraceBus）
```

**接入点**：Compiler plan 的 transform 管线，与 `--trace-transform` 同通道输出，
DevTools 可视化标红。

## 三、自动修复（fixable）

标注 `⚠️ 自动重写` 的项可由 `proteus compile --fix` 改写：

| 输入 | 重写为 |
|------|--------|
| `width: calc(100% - 20px)` | `width: 100%` + IR 约束 `margin-right:20px`（或按端映射） |
| `height: 100vh` | `p-h-safe`（语义指令 → 各端 safe area） |
| `color: rgba(0,0,0,0.5)` | 鸿蒙端 `ARGB` 十六进制（构建期转换，运行期不下发 rgba） |
| `backdrop-filter: blur(20px)` | `<p-glass blur="20">`（需改模板，仅提示） |

## 四、配置示例

```ts
// proteus.config.ts
export default {
  compiler: {
    strictCss: true,       // 默认开
    css: {
      allowSelectors: ['class', 'component-scope'],
      allowUnits: ['px', '%', 'rem'],   // 禁用 vh/vw/calc
      mediaWhitelist: ['dark', 'sm', 'md', 'lg'],  // 断点预设
      autoFix: true,
    },
  },
}
```

## 五、白名单（逃生口）

极少场景需原生特写，允许 `/* proteus-css-ignore */` 注释跳过校验，
**但仅限 `platform/app` 目录下的 JSI 增强模块**，业务 SFC 不得使用：

```css
/* proteus-css-ignore */
.ios-only { /* iOS 专属，需平台分支 */ }
```

DevTools 会统计 ignore 使用量，**CI 门禁：ignore 数量必须为 0 或经 PR 审批**。
