# Proteus Website — 框架官网实现规划

> 落地执行文档 · 配套 16 份 plan · AI 可读 · 产物可审计

## 这份文档解决什么

官网是整套框架的**门面 + 文档站 + 验证成果展示窗口**。缺它，Blueprint 的验收结果没地方呈现，"透明编译 / AI-native"理念也说不清。

**核心价值**：用 Proteus 自身构建官网 = **最好的 dogfooding**（吃自己的狗粮），同时把"一份内容双端（Web + Skyline）"的承诺实体化。

## 防止上下文撑爆（必读）

1. 每份 `.md` 是一个独立上下文单元，**LLM 单次只吃 ≤ 3 份 + overview**
2. 执行按 `14-execution-batches.md` 分批，每批 = 1 PR
3. 跨文档引用只写文件路径 + 关键接口签名，**不重复粘贴内容**
4. `website/` 目录结构与 `proteus-blueprint` 的 monorepo 对齐：`apps/website` + `apps/website-mp`

## 与 16 份 plan 的关系

| 层 | plan | Website 如何用 |
|----|------|---------------|
| Compiler | compiler-plan | Playground 跑 IR + transform（05） |
| Types | types-plan | API 参考 codegen（04） |
| Component | component-plan | 全站用 `p-*`（08） |
| Pinia | pinia-plan | 阅读进度/主题/搜索历史（03） |
| Router | router-plan | 文档路由 + `chunk` 懒加载（03） |
| DevTools | devtools-plan | TraceBus 可视化（05/10） |
| Blueprint | blueprint | 成果展示（06） |
| i18n | i18n-plan | 多语言（09） |
| Build | build-plan | SSG/SSR + CI（12） |

## 文档清单

```
00-overview.md
01-home.md
02-docs-system.md
03-guide-tutorial.md
04-api-reference.md
05-playground.md
06-showcase-blueprint.md
07-blog-changelog.md
08-design-system.md
09-search-i18n.md
10-analytics-feedback.md
11-mp-version.md
12-performance-seo.md
13-testing-e2e.md
14-execution-batches.md
```

## 设计原则（铁律）

1. **官网 = dogfooding**：能用 `p-*` 就用 `p-*`，不引入第三方 UI 库
2. **内容即数据**：所有文档/博客为 Markdown，构建期解析，运行时只渲染
3. **AI 可读**：每页配 `llms.txt`，API 有结构化 JSON
4. **双端同源**：Web + Skyline 共用 Markdown 内容，差异在渲染后端
5. **透明可验证**：Playground 展示真实 transform 链路，不伪造输出
