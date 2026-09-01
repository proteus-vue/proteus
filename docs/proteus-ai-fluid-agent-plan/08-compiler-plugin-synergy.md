# 与 Compiler Plugin (G-21) 协同

## 核心关系

> **Agent 工具 = Compiler Plugin。** Agent 不另起一套解析，而是复用 G-21 的 `definePlugin()` 注册，读取/写入同一份 `LayoutConstraint` IR。

## 复用钩子

| Agent 工具 | 使用的钩子 | 说明 |
|-----------|-----------|------|
| scanHardcodedWidth | `buildIR` | 遍历 IR 节点收集硬编码尺寸 |
| suggestFluidProp | （纯函数） | 基于 IR + breakpoints 推导 |
| applyFluidRefactor | `transform` | 改写 IR → 生成 `p-*` SFC |
| verifyViaCompilerPlugin | `post` | 校验产物过 FLD + Style Safety |

## IR 契约

```ts
interface LayoutConstraint {
  nodeId: string
  prop: "width" | "height" | "flex" | ...
  value: number | string
  source: { file: string; line: number }
  // Agent 据此生成建议
}
```

Compiler 在 `buildIR` 阶段产出 `LayoutConstraint` 列表，Agent 读取后填充 `replacement`。

## dogfooding

G-21 原则"核心能力 = 官方插件"在本方案落地：Agent 是第一个消费 Plugin API 的内部插件，倒逼 IR 接口稳定、可扩展。

## 校验闭环

```
Agent apply → transform IR → post 钩子
  → FLD001-006 (G-22)
  → Style Safety (G-16)
  → --strict-css
  → 全绿 → commit
```

未通过的产物在 `post` 阶段被拒绝，Agent 自我修正或交人工（G-23.2）。
