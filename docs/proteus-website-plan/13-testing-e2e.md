# 测试与 E2E（Testing）

## 目标

官网本身作为**测试最佳实践示范**（dogfooding testing-plan），保证 150+ 页内容 + Playground + 小程序版长期可维护。

## 测试金字塔（对齐 testing-plan）

```
L1 单元 (70%)   → 组件 / 工具函数 / codegen
L2 组件 (20%)   → p-* 交互 / Playground Worker
L3 契约 (5%)    → docs 跨层契约
L4 E2E  (5%)    → 关键用户路径（真实浏览器 + 真机）
```

## L1 单元测试

- Vitest + @vue/test-utils
- 覆盖：
  - `docs-loader`（Markdown → AST 正确性）
  - `api-codegen`（.d.ts → reference JSON）
  - `p-*` 组件 props / 事件
  - `TraceBus`（devtools-plan）事件流
  - 搜索索引生成

## L2 组件测试

- Playground：模拟输入 → 检查输出 IR/codegen
- p-code-block：复制 / "在 Playground 运行"
- p-search：键盘导航 / 过滤

## L3 契约测试（核心）⭐

对齐 `blueprint` 跨层契约（C1-C10），官网版：

- **文档 ↔ 代码同步**：每篇 API 参考页声明的签名 ↔ 实际 `.d.ts`（`proteus audit api`）
- **示例可运行**：所有文档代码块能过 Compiler（`proteus audit docs`）
- **死链检测**：内部链接可解析（含 Playground preset 存在性）
- **llms.txt 完整**：每页可被结构化导出
- **双端内容一致**：Web `content/` = 小程序 `content/`（哈希比对）

## L4 E2E

### Web 端（Playwright）
关键路径：
1. 首页加载 → 实时演示可交互
2. 文档搜索 → 跳转结果页
3. Playground 改代码 → 输出更新 → 分享链接可复现
4. 切换主题 / 语言 → 无闪烁 + URL 正确
5. Showcase 图表渲染

### 小程序端（miniprogram-ci + 真机）
- 首页渲染
- 文档页切换
- 分享卡片 → 重新进入
- **CI 真机矩阵**（对齐 testing-plan B4）：微信开发者工具 + 真机采样

### 降级
- 真机 E2E 在 CI 受限 → 本地/专用 runner 跑，CI 跑模拟器 + 关键路径

## 可访问性测试

- `@axe-core/playwright` 扫描
- 键盘导航断言
- 对齐 `08-design-system.md` + `12-performance-seo.md` a11y 要求

## 快照测试

- 关键页面 HTML 快照（SSG 输出）
- Playground 输出快照（对齐 IR/codegen）
- 更新需 `vitest -u` + 人工 review（防幻觉）

## CI 矩阵（对齐 build-plan）

```
lint → typecheck → unit → component → contract → e2e-web → e2e-mp → a11y → deploy
```

- 文档契约测试**阻断发布**（内容错误 = 阻塞）
- E2E 失败允许重试（flaky 容忍，对齐 testing-plan）

## 本地开发体验

- `vitest --watch` 改文档即时校验
- 链接检查器 CLI：`proteus audit docs --watch`
- 错误定位到 `.md` 行号（对齐 compiler-plan source map）

## 验收

- [ ] 150+ 页构建期零死链
- [ ] 所有 API 文档签名与代码一致
- [ ] Playground 输出快照覆盖核心 preset
- [ ] E2E 关键路径在 Chrome + Safari + 微信开发者工具通过
- [ ] a11y 扫描零严重问题

## 依赖

- `testing-plan`（测试金字塔 + E2E 降级 + CI 矩阵）
- `02-docs-system.md`（audit docs）
- `04-api-reference.md`（audit api）
- `05-playground.md`（快照）
- `11-mp-version.md`（小程序 E2E）
- `08/12`（a11y）
