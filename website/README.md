# @proteus-vue/website — Proteus 官网

> **dogfooding：官网用 Proteus 自身构建。** 竞品官网自己不是用自家框架写的——他们的框架能力只能"描述"；Proteus 官网的能力是"正在渲染你眼前这个页面的东西"。

## 本批落地（Website B2 · 决策 #374）

- **文档系统 MVP**：10 篇指南（`guides/*.md`）由 `@proteus-vue/docs` 引擎在 vite 构建期编译（frontmatter/title/html/toc），运行时零解析——**文档也是编译产物**
- **侧边栏自动生成**：`src/guides.ts` 用 `import.meta.glob` 收集全部 md 模块，按 frontmatter.order 排序——**新增指南 = 放一个 md 文件，侧边栏零改动**
- **柔性框架优先（W-6/D-5）**：响应式全部走 `v-p-fluid` clamp 表达式 + 柔性网格（auto-fill/minmax），**全站零 @media 断点**（`verify-llm.cjs` C8 机器门禁）
- **桌面交互原语**（G-24）：`v-p-hover` 卡片悬停语义

## 运行

```bash
npm run dev:website     # 根目录（或 cd website && npm run dev）
npm run build:website   # vue-tsc 类型检查 + vite 构建
```

## 结构

```
website/
├── guides/*.md          # 10 篇指南（内容即数据——frontmatter: title/order）
├── src/
│   ├── guides.ts        # 侧边栏自动生成（glob + frontmatter 排序）
│   ├── pages/Home.vue   # Hero + 能力矩阵 + 快速开始
│   ├── pages/Guide.vue  # 侧边栏 + 文档渲染 + TOC + 上下篇
│   └── style.css        # design tokens（深色优先，v3 tokens 子集）——零 @media
└── vite.config.ts       # vue + docsMdPlugin（md → 组件）
```

## dogfooding 清单（诚实边界）

| 层 | 用了什么 | 状态 |
|----|---------|------|
| 文档 | @proteus-vue/docs（md → Docs IR → 渲染） | ✅ |
| 柔性布局 | v-p-fluid（G-22 clamp 流式）+ 柔性网格 | ✅ |
| 桌面原语 | v-p-hover（G-24） | ✅ |
| p-* 使用须知 | p-view 默认 flex-column（行向用 class 覆盖）；p-heading level 用 :level 数字绑定；页面样式一律 scoped（防组件 scoped 级联）；p-page 深色经 --p-page-bg 变量钩子 | ✅ |
| 路由 | vue-router（@proteus-vue/router 路由模型面向双端页面工程——差距已登记，B4 评估回填） | ⚠️ |
| SSG / SEO | 构建期渲染已具备，sitemap/SSG 输出随 B7 | ⬜ |
