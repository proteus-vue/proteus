# Guardrails（护栏）

> Agent 不是"自由发挥"，是"在约束系统里求解"。三层拦截，失败自修复。

## 1. 三层拦截

```
生成代码
   ↓
[L1 结构] Component IR JSON Schema    → 节点类型/属性合法
   ↓
[L2 风格] verify-llm.js (C1-C7)      → token/命名/不可变源码/结构
   ↓
[L3 语义] conformance (六端一致)      → 各 Backend 渲染等价
   ↓
交付
```

任一层失败 → 进入自修复循环。

## 2. L1：IR Schema 校验

```json
{
  "type": "object",
  "required": ["kind", "nodes"],
  "properties": {
    "kind": { "type": "string", "pattern": "^[a-z]+(-[a-z0-9]+)*$" },
    "nodes": {
      "type": "array",
      "items": {
        "oneOf": [
          { "$ref": "#/definitions/layoutNode" },
          { "$ref": "#/definitions/uiNode" },
          { "$ref": "#/definitions/capabilityNode" }
        ]
      }
    }
  }
}
```

**拒绝**：未知原语类型、非法属性、缺失必填字段。

## 3. L2：风格校验（复用 verify-llm.js）

| 编号 | 规则 | 来源 |
|------|------|------|
| C1 | 无裸色值（走 var） | CMP017 |
| C2 | 交互 Demo 不改源码 | G-36 不变式 |
| C3 | 后端名用其后端色 | W-2 |
| C5 | 禁 `wx.*` 作首选 API | G-36.3 |
| C7 | 结构完整 | 基础 |

## 4. L3：语义 conformance

跑六端（ios/android/harmony/web/car/tv/watch）渲染，对比：
- 节点树结构一致
- 布局约束等价（cols / nav / 降级）
- 能力调用映射正确

**不一致 → 标记差异节点 → 回到 IR 修复。**

## 5. 自修复循环

```ts
async function generateWithRetry(intent: string, max = 3) {
  let attempt = 0
  let lastErrors: Error[]
  while (attempt < max) {
    const { code, ir } = await construct(intent)
    const report = await guardrails.validate(ir, code)
    if (report.ok) return { code, ir }
    // 诊断错误 → 修正 IR
    lastErrors = report.errors
    intent = enrichIntent(intent, diagnose(report.errors))
    attempt++
  }
  return { code: null, ir: null, status: 'need-human-review', errors: lastErrors }
}
```

**G-36.6：上限 3 次，超限转人工。**

## 6. 错误分类（diagnose）

| 类别 | 修复策略 |
|------|---------|
| schema | 修正节点类型/属性 |
| token | 替换为语义变量（design-token-fix） |
| naming | 重命名为 p- 前缀原语 |
| capability | 插入 `@conditional` 降级 |
| conformance | 调整 IR 布局约束 |
