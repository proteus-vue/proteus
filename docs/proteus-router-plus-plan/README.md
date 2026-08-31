# Proteus Router —— 声明式路由 + 原生导航映射

> 第 33 份 plan · 执行位 **G-17** · P0

## 定位

让 `router.push()` 在五端（Web / Skyline / iOS / Android / 鸿蒙）映射到**各自最优的原生导航实现**，业务代码零平台分支。

## 核心哲学（原则 #11）

> **路由配置即页面组件（单一事实源）。框架定义统一的转场/栈/手势语义，各端映射到各自最优的原生导航实现。**

## 文档清单

| 文件 | 内容 |
|------|------|
| `01-router.md` | ★ 主文档：问题/语义层/五端映射/手势/玻璃/API/对标 |
| `02-navigation-mapping.md` | 五端导航 API 映射细则 |
| `03-transition-transactions.md` | 转场事务（类比 PageTeardownTransaction） |
| `04-deep-link.md` | Deep Link / Universal Link |
| `05-strict-router.md` | `--strict-router` 规则 + 迁移 |
| `06-benchmark-budgets.md` | 性能预算 + 真机验收矩阵 |
| `07-batches.md` | M1-M4 分批 + Prompt 模板 |
| `architecture-update.md` | G-17 + 原则 #11 + 全景图 |

## 差异化

**唯一同时做到"声明式 + 单一事实源 + 原生转场 + 安全区/玻璃自动集成"的路由方案。**

## 关联

- App Renderer（页面栈）、Safe Area（转场避让）、Glass（导航栏玻璃）、Style Safety、Memory
- Architecture 原则 #10 / #11
