# 指南与教程（Guide & Tutorial）

## 目标

把 16 份 plan 的复杂度，**压缩成一条清晰的学习路径**——从"5 分钟跑起来"到"理解透明编译哲学"。

## 学习路径设计

```
入门（30 分钟）
  ├─ 1. 为什么需要 Proteus（透明编译 vs 黑盒）
  ├─ 2. 快速开始（create-proteus）
  └─ 3. 第一个页面（.vue → Skyline）
核心概念（2 小时）
  ├─ 4. SFC 与 <route>（router-plan）
  ├─ 5. 状态管理（pinia-plan）
  ├─ 6. API 层（api-plan）
  ├─ 7. 内置组件（component-plan）
  └─ 8. 平台能力（platform-plan）
进阶（按需）
  ├─ 9. 模块化（module-plan）
  ├─ 10. 生命周期（lifecycle-plan）
  ├─ 11. 自定义 transform（compiler-plan）
  ├─ 12. AI 协作（transforms/ 可读写）
  └─ 13. 超级应用加固（M7/M8 各 plan）
实战
  └─ 14. 从零构建 Blueprint（proteus-music）
```

## 写作规范

每条指南遵循 **Diátaxis** 框架：
- **教程**：手把手（学会做某事）
- **指南**：概念解释（理解原理）
- **参考**：API 清单（查某个东西）
- **解释**：决策背后的原因（透明编译为什么这样设计）

## 交互式教程（Tutorial = Playground 内嵌）

关键步骤嵌入可运行的 Playground：

```md
## 4. 试试 v-if

下面这个例子可以直接改，右边实时出 .wxml：

<proteus-playground preset="v-if" :height="300" />
```

- 教程页默认渲染 `<proteus-playground>`（见 `05-playground.md`）
- 用户改动 → 生成分享链接（URL hash 含代码，可复现 bug）

## 内容来源（dogfooding）

- 16 份 plan 的 `README.md` + `00-overview.md` = **官方指南的初稿**
- 每个 plan 的 `execution-batches.md` = **迁移/实战教程**
- Blueprint = **完整实战教程**

**即：写文档的过程 = 整理 plan 的过程**，内容不重复造轮子。

## 版本化与稳定性标记

- 每页 frontmatter：`since: 2.0` `stability: stable | experimental | deprecated`
- 不稳定 API 页面顶部警告条（用 `p-callout`）
- 破坏性变更 → 自动生成迁移指南（见 `07-blog-changelog.md`）

## 状态持久化（用 Pinia dogfooding）

- 阅读进度（每页 scroll + 完成勾选）→ Pinia store `docsProgress`
- 持久化策略：eager（核心指南）+ lazy（进阶）
- 主题偏好、代码块主题、`playground` 历史均走 Pinia（对齐 pinia-plan M7 分片）

## 路由与懒加载（用 Router dogfooding）

- `/docs/guide/[...slug]` 动态路由
- 每个二级章节为独立 chunk（`chunk: 'docs-guide'`）
- 对齐 router-plan M7.1：`preloadRule` 预加载相邻章节

## 验收

- [ ] 新用户按路径走完入门 < 30 分钟
- [ ] 每个核心概念页都有"试试看"交互
- [ ] 教程代码块 100% 可通过 Compiler 校验（构建期跑 `proteus audit docs`）
- [ ] 阅读进度跨设备同步（Pinia + 云端，可选）

## 依赖

- `02-docs-system.md`（MDC 渲染 + 侧边栏）
- `05-playground.md`（内嵌运行）
- `pinia-plan` / `router-plan`（dogfooding）
- `i18n-plan`（多语言指南）
