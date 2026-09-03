---
title: AI 原生开发
order: 8
---

# AI 原生开发（G-21/23/36）

## 为什么 AI 需要 IR

竞品缺的不是 AI 模型，而是**显式约束 + 可编程 IR**。没有 IR，AI 只能对源码做文本替换——写了什么全靠猜，错了没人拦。Proteus 的 AI 产出的是**符合 IR 契约的标准代码**，每一步都有编译期校验兜底。

## 规则注册表：编译器的 AI 说明书

编译引擎内置规则注册表：69 条转换规则，每条自带 AI 说明书（what / why / when / example / verify / 决策号）。

```bash
proteus explain pages/index.vue    # 决策 trace：该文件触发的全部转换规则 + 行号
proteus explain p-grid             # 单条规则的 AI 说明书
```

分派层 `executeRule()`：AI 覆盖规则实现即获得新能力，无需改框架代码。

## Agent 基建（G-36）

| 组件 | 能力 |
|------|------|
| MCP Server | 11 工具 + 5 Resources + CMP021 鉴权——LLM 按需查询规则/IR/trace |
| Agent Kit SDK | IRBuilder（不绑 LLM）+ generateCode 规则引擎 + withProteusRules |
| 自修复循环 | generateWithRetry：生成 → 校验 → 诊断（五类）→ 修复（≤3 次上限） |
| migrate Skill | `proteus migrate mp`：wx.* API 扫描 + 映射日志 + 覆盖率 |

## 三层护栏

1. **L1 IR Schema**：产物结构校验
2. **L2 风格**：语义命名 / 平台 API 禁用
3. **L3 conformance**：六端语义一致性快照

**信任分级**：generate 自动合并 / migrate 提 PR / refactor 需审批——AI 的自由度与风险成正比。
