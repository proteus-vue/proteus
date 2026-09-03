# 分批执行（Execution Batches）

## 原则

对齐前面 16 份 plan 的分批规格：
- 每批 = 1 PR = LLM 单次 ≤ 3 文件 + overview
- 每批有明确**输入 / 输出 / 验收**
- 依赖下层先稳定，可并行则并行
- **防上下文撑爆**：执行某批只喂 `00-overview + 当前批文件 + 直接依赖文件`

## 依赖图

```
Compiler ──┐
Types ─────┤
Component ─┼──→ Website
Router ────┤
DevTools ──┘
Blueprint ─→（M4 起消费成果数据）
```

Website 内部依赖：
```
08 设计系统 ← 所有页面（dogfooding）
02 文档系统 ← 03/04/07
05 Playground ← 01/03/04/06
09 i18n ← 02/08
11 小程序 ← 02/05/08/09
12 SEO ← 08/09
13 测试 ← 全部
```

## 批次规划（B1-B8）

### B1 · 项目骨架 + 设计系统（地基）
**文件**：`00-overview` `08-design-system` `README`
**输入**：Component plan 的 `p-*` 组件定义
**输出**：`apps/website` + `packages/design-tokens` + p-* 基础组件
**验收**：
- [ ] `npm run dev` 能起一个用 p-* 的空页面
- [ ] 暗色切换无闪烁
- [ ] `proteus audit website` 无第三方 UI

### B2 · 文档系统 MVP
**文件**：`02-docs-system` `03-guide-tutorial` `04-api-reference`（仅渲染）
**输入**：16 份 plan 的 README 作初稿
**输出**：`packages/docs-loader` + `/docs/guide` 可浏览
**验收**：
- [ ] 10 篇指南页 SSG 渲染
- [ ] 侧边栏自动生成
- [ ] codegen 从 .d.ts 生成 1 个 API 页

> **✅ 引擎件落地（决策 #365）**：新包 **`@proteus-vue/docs`**（36 包，零依赖）——**Markdown → Docs IR（语义块 AST）→ HTML/Vue SFC**：块级解析（标题锚点 kebab+中文/代码围栏/列表一层嵌套/表格对齐/引用/分隔线）+ 行内（code/strong/em/link/image）+ YAML-lite frontmatter（块式/行内数组、布尔数字归一）+ **零依赖轻量高亮器**（js/ts/vue/json/bash/css/html；内容全转义防注入）+ TOC（平铺/嵌套 h2-h3 可配）+ 搜索索引（构建期条目 + 子串评分检索）+ **toSfc**（DocsCode v-pre 包裹 + {{}} 实体化 + p-page 语义根 + 恒 script setup）；**核心证据**：md → toSfc → **框架编译器 compileVueSfc 编译通过** → mountWebComponent 真实渲染（docs-* 语义类在 DOM）——「文档也是编译产物」（第九次泛化叙事）；vite md 虚拟模块接入待下一批。测试 tests/docs-engine.test.ts 17 用例；全量 1904/181 无回归。

### B3 · Playground 内核
**文件**：`05-playground` + `compiler-plan` WASM 集成
**输入**：Compiler IR + TraceBus
**输出**：浏览器内 `.vue → 三端产物`，Monaco + Worker
**验收**：
- [ ] 输入 `v-if` → 实时出 `wx:if`
- [ ] Trace 链路与 `--trace-transform` 一致
- [ ] 分享链接可复现

### B4 · 首页 + Showcase
**文件**：`01-home` `06-showcase-blueprint`
**输入**：Blueprint 验收数据（mock 起步）
**输出**：首页 Hero + 实时演示 + Showcase 矩阵/图表
**验收**：
- [ ] 首页 LCP < 2.5s（WASM 懒加载）
- [ ] Showcase 数字可追溯到脚本

### B5 · 博客 + 搜索 + i18n
**文件**：`07-blog-changelog` `09-search-i18n`
**输入**：changeset 流程 + i18n-plan
**输出**：博客列表/详情 + 搜索（Cmd+K）+ 中英文切换
**验收**：
- [ ] changeset → changelog 自动生成
- [ ] 搜索 1000 页 < 200ms
- [ ] 切换语言 URL 正确

### B6 · 埋点 + 小程序版
**文件**：`10-analytics-feedback` `11-mp-version`
**输入**：DevTools TraceBus + 小程序 Skyline 约束
**输出**：TraceBus 埋点 + website-mp 可浏览文档
**验收**：
- [ ] 事件全走 TraceBus
- [ ] 小程序 30 页内可浏览全部文档
- [ ] 分享卡片正确跳转

### B7 · 性能 + SEO
**文件**：`12-performance-seo`
**输入**：Build plan SSG + 缓存策略
**输出**：全站 SSG + CWV 达标 + sitemap
**验收**：
- [ ] Lighthouse ≥ 95
- [ ] CWV 真实数据全绿
- [ ] sitemap 收录全部页

### B8 · 测试 + 上线
**文件**：`13-testing-e2e` + 全量审计
**输入**：testing-plan 矩阵
**输出**：单元/组件/契约/E2E 全绿 + CI 门禁
**验收**：
- [ ] `proteus audit all` 零违规
- [ ] Playwright 关键路径全过
- [ ] 小程序真机 E2E 通过

## LLM Prompt 模板（每批复用）

```
你是 Proteus 框架开发专家。当前任务：执行 Website B{n}。

【上下文】
- 只读：00-overview.md + {当前批文件} + {直接依赖文件}
- 不读：其他批次文件（防上下文撑爆）

【输入】
{依赖层产物路径}

【输出】
{本批应产出的文件/模块清单}

【验收】
{可勾选的验收标准}

【约束】
- 全站用 p-* 组件，禁第三方 UI
- 内容即数据，MDC 扩展
- 产物可审计（对齐 --trace-transform）
```

## 进度追踪

| 批 | 状态 | 依赖 | PR |
|----|------|------|-----|
| B1 | ⬜ | - | - |
| B2 | ⬜ | B1 | - |
| B3 | ⬜ | Compiler | - |
| B4 | ⬜ | Blueprint | - |
| B5 | ⬜ | B2 + i18n-plan | - |
| B6 | ⬜ | B1 + DevTools | - |
| B7 | ⬜ | Build plan | - |
| B8 | ⬜ | 全部 | - |

## 与 16 份 plan 的执行顺序建议

```
Sprint 1: Compiler + Types + Build（地基）
Sprint 2: Blueprint（验证数据来源）
Sprint 3: Website B1-B3（骨架 + Playground）
Sprint 4: Website B4-B8（内容 + 双端 + 上线）
```

**Website 可边做边验证其他层**——写官网发现 Component/Router 不足时，回填对应 plan。

## 验收（整份文档完成）

- [ ] 首页实时 transform 演示可跑
- [ ] 150+ 文档页全量构建 < 60s
- [ ] Skyline 小程序版可浏览全部文档
- [ ] `proteus audit all`（docs/api/module/capability/website）零违规
- [ ] Lighthouse 四指标 ≥ 95
- [ ] llms.txt 被 LLM 工具正确抓取
