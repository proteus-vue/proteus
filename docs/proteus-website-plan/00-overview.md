# Proteus Website — 总览

## 定位

Proteus 框架官网 = **门面 + 文档站 + Blueprint 成果展示 + 透明编译交互式演示**四合一。

技术栈：**用 Proteus 自身构建**（Web SPA + Skyline 小程序双端），实现真正的 dogfooding——写官网的过程就是在测 Proteus。

## 信息架构（页面清单）

```
/                    首页（Hero + 三大卖点 + 实时 transform 演示）
/docs                文档系统
  /guide             指南（入门 → 核心概念 → 进阶 → Blueprint）
  /reference         API 参考（自动 codegen）
  /tutorial          交互式教程（Playground 内嵌）
/playground          在线 Playground（.vue → 三端产物）
/showcase            Blueprint 成果（150 页验证 / 性能 / 审计）
/blog                博客 + 更新日志
/community           社区 + 反馈
```

## 设计原则（铁律）

1. **官网 = dogfooding**：全站用 `p-*` 组件，禁止引入 Element/Vant 等第三方 UI
2. **内容即数据**：文档/博客均为 Markdown，构建期解析为 JSON，运行时只渲染
3. **AI 可读**：每页配 `llms.txt` + `llms-full.txt`；API 有结构化 JSON 供 agent 消费
4. **双端同源**：Web + Skyline 共用 Markdown 内容，差异收敛在渲染后端
5. **透明可验证**：Playground 展示真实 Compiler IR + transform 链路，绝不伪造输出
6. **性能预算**：首页 LCP < 2s，文档页 TTI < 1.5s，Core Web Vitals 全绿

## 里程碑

| 阶段 | 交付 | 依赖 |
|------|------|------|
| M1 基础设施 | 项目骨架 + 设计系统 + MD 渲染 | Component / Router |
| M2 文档系统 | 侧边栏 + 搜索 + 版本切换 | Types（codegen）/ i18n |
| M3 交互核心 | Playground + 实时 transform | Compiler / DevTools |
| M4 内容运营 | 指南 + API 参考 + 博客 | Blueprint |
| M5 双端 + 优化 | Skyline 小程序版 + SSG/SEO | Build |

## 依赖关系

```
Compiler ──┐
Types ─────┤
Component ─┼──→ Website
Router ────┤
DevTools ──┘
Blueprint ─→（成果数据来源）
```

Website **依赖 Blueprint 产出验收数据**（M4 阶段），但 M1-M3 可与 Blueprint 并行推进（用 mock 数据）。

## 产物结构

```
apps/
  website/         Web 端（SPA + SSG）
  website-mp/      小程序端（Skyline）
packages/
  docs-loader/     Markdown → AST → JSON
  api-codegen/     从 .d.ts 生成 API 参考（复用 types-plan 03）
  playground-runtime/  浏览器内跑 Compiler（WASM）
  llms-gen/        生成 llms.txt
```

## 验收标准

- [ ] 首页实时 transform 演示可跑（写 .vue → 实时出 IR + .wxml）
- [ ] 150+ 文档页全量构建 < 60s
- [ ] `proteus audit docs` 检查死链/未翻译/缺失 API
- [ ] Skyline 小程序版可浏览全部文档
- [ ] `llms.txt` 被主流 LLM 工具正确抓取
- [ ] Lighthouse 性能/SEO/可访问性均 ≥ 95
