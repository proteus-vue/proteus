# @proteus-vue/test-ir

> **G-44 B1（proteus-testing-framework-plan）** —— 验证语义层：测试代码不再绑定断言库 / 运行器 / 设备（第八次泛化）。
> 规格：`docs/proteus-test-framework-plan/`。

## 一句话

**测试用例先编译成可序列化的 Test IR（AssertionNode / ActOp / Profile3D），再由 TestBackend SPI 解释执行**——
同一份测试语义可在 Node / JS 载体 / AOT / 宿主 / 真机五种后端上跑，断言结果统一由 `ConformanceRunner` 汇总。

## 组成

| 层 | 内容 |
|---|---|
| Test IR | `AssertionNode` / `ActOp` / `Profile3D`——纯数据、可序列化、可跨进程传递 |
| 官方后端（5） | `NodeBackend` / `JSCarrierBackend` / `AOTBackend` / `HostBackend` / `DeviceBackend` |
| 解释器 | `evalAssertion`（断言求值）/ `applyAct`（动作执行）/ `getPath`（取值路径） |
| 汇总 | `ConformanceRunner`——多后端结果统一收敛成一份一致性报告 |
| 断点矩阵 | `generateBreakpointSuite` + `W_BREAK` / `H_BREAK` / `F_FORMS`（100 个 profile） |

## 用法

```ts
import { evalAssertion, applyAct, ConformanceRunner, officialBackends } from '@proteus-vue/test-ir'

// 直接解释一条断言（不依赖任何测试运行器）
const ok = evalAssertion({ kind: 'equals', path: 'title', expected: '默者' }, state)

// 多后端一致性：同一套 Test IR 在各后端跑一遍，汇总差异
const runner = new ConformanceRunner(officialBackends)
const report = await runner.run(suite)
```

## 设计意图

断言与执行的**分离**是本包存在的理由：断言是数据（Test IR），执行是后端能力（TestBackend SPI）。
于是「同一测试在 Node 上通过、在真机上不通过」可以被机器判据直接指出，而不用人肉比对两套测试代码。
