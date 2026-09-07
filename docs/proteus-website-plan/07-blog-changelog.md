# 博客与更新日志（Blog & Changelog）

## 目标

承载**版本发布、迁移指南、深度技术文章、社区动态**。changelog 从 changeset 自动生成，博客手工写。

## 内容组织

```
content/
  blog/
    2026-01-15-introducing-proteus-2-0.md
    2026-02-01-transparent-compilation.md
  changelog/
    2.0.0.md   ← 自动生成
    2.1.0.md
```

## Changelog（自动）

- 来源：changeset（`CHANGESET.md` 提交）→ CI 生成 `changelog/*.md`
- 格式：[Conventional Changelog](https://conventionalcommits.org/)
- 每条标注：`feat` / `fix` / `breaking` + 影响范围（哪个 plan）
- 破坏性变更 → **自动生成迁移指南**（对齐 build-plan changeset）

## 博客（手工）

- Markdown + MDC（可嵌入 Playground / 代码块 / 图表）
- frontmatter：`title` `date` `author` `tags` `cover`
- 支持系列文章（多 part）

## 写作规范

- 技术深度优先（透明编译的哲学、某个 transform 的实现细节）
- 每篇配可运行示例（Playground preset 或链接）
- 标注"对齐 plan"：`> 对应 pinia-plan M7`

## RSS / Atom

- 自动生成 `/rss.xml` + `/atom.xml`
- 供社区工具订阅

## 页面功能

- 列表（卡片 + 分页 + 标签过滤）
- 详情（MDC 渲染 + 上一篇/下一篇 + 评论区，可选 Giscus）
- 搜索（并入 `09-search-i18n.md`）

## SEO

- 每篇独立 `og:image` + `description`
- 结构化数据（Article schema）
- sitemap 包含博客页

## 版本归档

- 旧版本博客冻结（对应文档版本）
- URL：`/blog/v2/...`

## 验收

- [ ] 发版后 changelog 10 分钟内自动上线（CI）
- [ ] 每篇博客都有 Playground 示例或代码仓库链接
- [ ] RSS 被订阅工具正确解析
- [ ] 破坏性变更 100% 有迁移指南

## 依赖

- `02-docs-system.md`（MDC 渲染 + 侧边栏）
- `build-plan`（changeset + CI）
- `09-search-i18n.md`（搜索 + 多语言）
- `10-analytics-feedback.md`（阅读量统计）
