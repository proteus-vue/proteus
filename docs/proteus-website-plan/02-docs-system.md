# 文档系统（Docs System）

## 目标

承载 150+ 页技术文档（对应 16 份 plan + 指南 + API 参考），要求：
- 编写体验好（Markdown + MDC 扩展）
- 构建快（增量解析）
- 可搜索、可版本化、可多语言
- **AI 可读**（`llms.txt` 标准）

## 内容组织

```
content/
  docs/
    guide/
      01-introduction.md
      02-quick-start.md
      ...（对应 16 份 plan 的入门路径）
    reference/
      api/
      transforms/
      config/
    tutorial/
  blog/
  showcase/
  llms.txt            ← AI 抓取入口
  llms-full.txt       ← 完整版
```

## MDC 扩展（Markdown + Components）

允许在 Markdown 中嵌入 `p-*` 组件：

```md
# 快速开始

<p-steps>
  <p-step title="安装">npm i</p-step>
  <p-step title="运行">npm run dev</p-step>
</p-steps>

<proteus-playground preset="v-if" />
```

构建期把 `<p-*>` 转成组件调用（对齐 compiler-plan transform 插件系统）。

## Markdown → AST → JSON 管线

```
content/**.md
  → docs-loader/parse（frontmatter + AST）
  → 提取 headings / code-blocks / 组件调用
  → 生成 docs.json（路由 + 侧边栏 + 搜索索引 + llms）
  → 运行时渲染
```

**关键**：code-block 额外记录 `lang` + `meta`，Playground 可一键打开（"在 Playground 中运行"按钮）。

## 侧边栏 / 导航

- 由目录结构 + frontmatter `order` 自动生成（不手写配置）
- 支持分组：`guide / reference / tutorial`
- 当前页高亮 + 面包屑 + 上一篇/下一篇
- 移动端抽屉式

## 版本管理

- 每个 plan 有 `version` 字段（对齐 types-plan config schema）
- URL 含版本：`/docs/guide/v2/...`
- 切换器下拉，旧版本冻结为静态 HTML

## 搜索

- 构建期生成 `search-index.json`（标题 + 摘要 + 标题层级）
- 客户端 Fuse.js 模糊搜索（首屏不加载，用户聚焦搜索框时才拉）
- 支持按 plan 过滤

## llms.txt（AI 可读性）⭐

遵循 `llms.txt` 标准，让 AI agent 能完整理解框架：

```
# Proteus

> The self-evolving Vue framework for Web + WeChat Skyline

## Docs

- Guide: /docs/guide/llms-full.txt
- API Reference: /docs/reference/llms-full.txt
- Transforms: /docs/reference/transforms/llms-full.txt

## Optional

- Blog: /blog/llms-full.txt
- Showcase: /showcase/llms-full.txt
```

每个 `.md` 页面对应一份结构化 JSON（`headings / codeBlocks / componentUsage`），供 agent 精确引用。

## 构建期校验（`proteus audit docs`）

- 死链检测（内部链接可解析）
- 缺失 API（reference 里声明但未在代码实现）
- 未翻译段落（对齐 i18n-plan audit）
- 代码块语法校验（标记 ` ```vue` 的片段能否通过 Compiler 解析）

## 验收

- [ ] 150 页文档全量构建 < 60s（增量 < 5s）
- [ ] 搜索响应 < 100ms（首屏不加载索引）
- [ ] `llms.txt` 被 Cursor / Claude Code 正确抓取
- [ ] `proteus audit docs` 零违规

## 依赖

- `docs-loader/`（新建，复用 compiler-plan parser）
- `api-codegen/`（04，从 .d.ts 生成 reference）
- `i18n-plan`（09，多语言）
- `build-plan`（12，SSG 输出）
