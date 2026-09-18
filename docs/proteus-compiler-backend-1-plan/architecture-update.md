# Architecture Update: G-29 编译器后端可插拔

> 增量变更，合并进 `proteus-architecture` 规约。

## 1. 原则 #10 泛化

**原则 #10（统一语义 + 后端实现）** 现覆盖四层：

| 层 | SPI |
|----|-----|
| 编译（G-29） | `ProteusCompilerBackend` |
| UI（G-27） | `ProteusRenderBackend` |
| 能力（G-28） | `ProteusNativeBackend` |
| 逻辑 | JSI（统一通信层，不可插拔） |

## 2. 铁律

- **G-29.1**：三端 Compiler Backend 对同一 SFC 必须产出语义等价的 CompilerIR（IR Golden Test 强制）
- **G-29.2**：新 Compiler Backend 必须通过 conformance test
- **G-29.3**：HMR 语义在三端 Backend 上必须一致

## 3. 严格规则（CMP）

- **CMP001**：业务代码禁止直接依赖某 Compiler Backend 的私有 API
- **CMP002**：IR 产出必须符合契约 schema
- **CMP003**：HMR 语义三端一致
- **CMP004**：版本不兼容必须显式报错

## 4. 四层全景图

```
G-29 编译层 ★
G-23 AI 层
G-27 UI 层
G-28 能力层
```

四层全部 SPI，共用 BackendCapabilities / conformance test / 版本协商。

## 5. 路线图落点

- M1：B1（CompilerIR 契约 + NodeBackend）
- M2：B2（Rust）、B3（WASM）
- M3：B4（HMR/SourceMap/Tree-shaking）

## 6. 风险边界

- 编译器切换不改变运行时行为（只改变产出 IR 的实现）
- 业务代码不感知 Backend 差异（CMP001 保障）
