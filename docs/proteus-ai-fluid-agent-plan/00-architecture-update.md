# Architecture Update — G-23 AI Agent 柔性布局接入

> 合并进 `proteus-architecture` 规约的变更清单。本文件为 G-23 的规约合并入口。

## 新增执行位 G-23（P1）

| 字段 | 值 |
|------|-----|
| 执行位 | G-23 |
| 名称 | AI Agent 柔性布局接入 |
| 优先级 | P1 |
| 依赖 | G-21（Compiler Plugin，提供 IR 访问与校验）、G-22（Fluid Layout，提供约束语义）、G-19（DevTools，提供 Inspector 入口）、G-16（Style Safety，产物合规闸门） |
| 阶段 | M3–M4 |

## 原则 #12（新增）

> **框架显式化的约束，AI 可安全自动生成；未显式化的部分，AI 不得臆测。**

推论：
1. Agent 只操作 `p-*` 语义与原生映射已定义的属性；
2. Agent 产物必须经由 Compiler Plugin 校验（FLD001-006 + `--strict-css`）；
3. Agent 不得直接正则改写业务字符串，必须在 LayoutConstraint IR 上操作。

## 铁律

- **G-23.1**：Agent 所有写操作须落在 Git 分支 / 临时副本，禁止直写主工作树。
- **G-23.2**：Agent 产物未通过 FLD + Style Safety 校验，不得 apply。
- **G-23.3**：破坏性重构（跨文件重命名、删除死代码）须经人工审批。

## 严格规则（新增 AI 系列）

| 规则 | 级别 | 说明 |
|------|------|------|
| AI001 | error | Agent 产物须通过 `--strict-css` + FLD001-006 |
| AI002 | error | Agent 不得绕过 DesignSystem token |
| AI003 | warning | 每次操作记录 `ai-audit.json` |
| AI004 | error | 破坏性写操作须经人工审批 |
| AI005 | warning | 建议须附带依据（FLD/CSS 规则编号） |

## 与既有体系的关系

```
G-22 柔性布局（FLD 约束）  ← 被 Agent 消费
G-21 Compiler Plugin IR   ← Agent 操作对象 + 校验入口
G-19 DevTools Inspector    ← Agent 读取运行时布局信息
G-16 Style Safety         ← Agent 产物合规闸门
```
