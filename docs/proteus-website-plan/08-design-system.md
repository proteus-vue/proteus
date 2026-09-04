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

---

## 落地差距登记（决策 #386 · 风格对齐批次）

> 本节是 2026-09-04 官网实现（`website/`）与本设计系统规范的**逐项对照结论**：已对齐项、差距项与归属，避免「规范写了、落地没人认领」。

### ✅ 已对齐（#386 后）

| 规范要求 | 落地状态 |
|---|---|
| token 单一事实源 | `website/src/style.css` 补全：**状态色 ok/warn/rec、后端色 bk-*（6）、语法色 syn-*（6）、品牌柔色 brand-soft、玻璃 bg-glass、radius 语义化（chip6/sm7/md9/lg12/xl14/pill）、间距 scale sp-***——数值全部取自 `proteus-website-v3/design-tokens.json` |
| 语法高亮用 token 色 | docs 引擎 `docs-tok-*` → `--syn-*` 接线（keyword/string/comment/tag/number） |
| 布局必须 p-* 语义 | Home 三大卖点/数字区裸 div 网格 → `p-grid`；Playground 规则列表裸 div → `p-stack`（D-2 统计 19→21/57） |
| 状态层用色 | 对标矩阵 ✅→ok / 🟡→warn / 📋→dim（替代单色 brand2） |
| 圆角/间距禁裸 px | 页面级 radius 全部 token 化（唯一例外：nav active 下划线 2px 装饰微元素） |
| a11y 对比度 | 11–13px 小字不再使用 dim（#5c5c6a 对比度不足 AA）——footer/cmp-note/stat-source/pg-meta/pg-dim/qs-dim 提级 muted |
| Glass-light | nav blur 12px（原 14px 校准回规范值）+ `--glass-bg` token |

### ⚠️ 差距与归属（认领后再关闭）

| 差距 | 现状 | 归属 |
|---|---|---|
| **主题：双主题 vs Dark-first** | 08 原文要求「prefers-color-scheme + 手动切换 + 持久化」；但 v3 `llm-style-guide.md` 明确 **Dark-first、禁止浅色主体**，官网实现为 dark-only（#378 决策：深色专业形态）。两份规范冲突 | **裁定：当前阶段 Dark-first**（浅色主题与切换器列为后续批次待办，待产品决策后启用；届时需 no-flash 内联脚本 + Pinia 持久化 + `useColorScheme()`） |
| **缺失 p-​​组件**（08 组件清单 vs 框架实际 61 组件） | p-table / p-code-block / p-code-editor（Monaco）/ p-stats / p-search / p-hero / p-feature-card / p-cta / p-tabs / p-badge / p-callout / p-chart / p-progress / p-container / p-section / p-aside / p-accordion / p-link / p-space / p-icon 均不存在 | 组件族扩充批次（G-32/G-22 续批）立项；落地前官网对标表/代码块用语义化 HTML（table/pre/code）过渡 |
| p-* 覆盖率阈值 | D-2 现状 21/57 标签（布局原语已归 p-grid/p-stack/p-sidebar/p-split；table/pre 因缺原语保留语义化 HTML） | B5 定阈值（14-execution-batches B4 验收项） |
| Monaco / p-code-editor | textarea MVP（编译 <10ms，Monaco ~2MB 损害 LCP） | B5 按需评估（#376 诚实暂缓） |
| /reference（codegen）、/blog、/showcase、Cmd+K 搜索 | 未建 | B5（blog/search/i18n）/ B4 余量（codegen 待 types 集成）/ Showcase 待 Blueprint |
