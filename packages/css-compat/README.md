# @proteus-vue/css-compat

Proteus CSS 跨端兼容（G-21 css-compat B1）——`--strict-css` 校验 + 编译期重写 + css-compat-report。

> 纯逻辑零运行时依赖（postcss 仅构建期工具）。`style-safety`（G-31）将消费本包白名单作为 Style Validator 的 ALLOWED_STYLE_PROPS。

## 能力（B1：CSS 校验 + 重写原型）

| 模块 | API | 说明 |
|------|-----|------|
| 校验 | `lintStyleCss(css, opts?)` | CSS001-012 规则（02-strict-css-lint.md 全量） |
| 重写 | `rewriteStyleCss(css)` | calc 数值折叠 / vh→% / rgba→#RRGGBBAA（03） |
| 报告 | `buildCssCompatReport(css, opts?)` | 03 §三 报告结构 + 违规/语义组件/禁止项统计 |
| SFC | `extractStyleBlocks(source)` | 提取 `<style>` 块（多块/scoped/lang） |
| CLI | `proteus css:check [dir\|file] [--no-strict] [--fix] [--report <path>]` | 扫描 .vue/.css 校验 |

## 报错码（CSS001-012）

float / display:inline / `*` / `[attr]` / 元素选择器 / 深层后代 / z-index / calc·vh·vw / backdrop-filter / :nth-child / box-shadow rgba / @media——严格模式 error 阻断，`--no-strict` 降级 warn（02 表「降级」列）。

## 使用

```ts
import { lintStyleCss, buildCssCompatReport } from '@proteus-vue/css-compat'

const violations = lintStyleCss('.a { float: left; }') // [{ code: 'CSS001', ... }]
const report = buildCssCompatReport('.page { height: 100vh; }')
// report.rewritten.vh === 1（编译期重写计数）
```

## 状态

- [x] B1：CSS001-012 校验 + calc/vh/rgba 重写 + 报告 + SFC 提取 + CLI css:check
- [ ] B2：Style IR → 五端 Renderer 映射（05）
- [ ] B3：预算门禁 + DevTools 面板（10）
