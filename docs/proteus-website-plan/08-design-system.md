# 设计系统（Design System）

## 目标

官网**全部用 `p-*` 组件构建**（dogfooding Component plan），同时沉淀出一套可复用的设计语言。

这是"用 Proteus 构建 Proteus 官网"的最直接证明。

## 组件清单（官网用到的 `p-*`）

### 基础
- `p-text` `p-heading` `p-link` `p-image` `p-icon`
- `p-divider` `p-space` `p-grid`

### 布局
- `p-container` `p-section` `p-stack` `p-aside` `p-split`

### 交互
- `p-button` `p-tabs` `p-accordion` `p-dialog` `p-drawer`
- `p-tooltip` `p-dropdown` `p-search`

### 反馈
- `p-callout`（tip/warning/danger，指南页大量用）
- `p-badge` `p-toast` `p-skeleton` `p-progress`

### 代码（Playground 相关）
- `p-code-block`（语法高亮 + 复制 + "在 Playground 运行"）
- `p-code-editor`（Monaco 封装）
- `p-tabs` + `p-tree`（Trace 可视化）

### 数据
- `p-table`（Showcase 验证矩阵）
- `p-chart`（柱状/折线，canvas 轻量自研）
- `p-stats`（数字背书）

### 业务
- `p-hero` `p-feature-card` `p-cta` `p-pricing`（如需要）

## 主题

- CSS 变量（`--color-primary` `--space-4` `--radius-md`）
- 暗色模式：`prefers-color-scheme` + 手动切换（持久化到 Pinia）
- 主题切换无闪烁（内联脚本抢在渲染前设置）
- 对齐 component-plan 的 `p-theme-provider`

## 可访问性（a11y）

- WCAG 2.1 AA 目标
- 所有交互组件支持键盘导航
- 颜色对比度达标
- 语义化 HTML（`nav` `main` `aside` `article`）
- `aria-*` 属性完整

## 设计令牌（Design Tokens）

```
design-tokens/
  color.json
  spacing.json
  typography.json
  radius.json
  shadow.json
```
构建期生成 CSS 变量 + TS 类型（对齐 types-plan codegen）。

## Dogfooding 审计

CI 检查（`proteus audit website`）：
- 是否引入了第三方 UI 库（element / vant / antd）
- 是否直接写了 `div`（应改 `p-text` 或语义标签）
- 是否硬编码颜色（应用 token）

**唯一例外**：Playground 的 Monaco 编辑器（已封装在 `p-code-editor` 内）。

## Storybook（可选）

- 每个 `p-*` 组件有 stories（交互文档）
- 路径：`/docs/reference/components/*`
- 支持暗色/主题切换预览

## 验收

- [ ] 全站 0 个第三方 UI 组件（除 Monaco 封装）
- [ ] Lighthouse a11y ≥ 95
- [ ] 暗色切换无闪烁 + 跨页保持
- [ ] 所有 `p-*` 有文档页（自动从 props 生成）

## 依赖

- `component-plan`（p-* 组件实现）
- `pinia-plan`（主题/阅读进度持久化）
- `i18n-plan`（RTL + 多语言主题）
- `12-performance-seo.md`（a11y 影响 SEO）
