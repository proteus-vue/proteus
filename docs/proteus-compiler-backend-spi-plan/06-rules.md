# G-38 严格规则

> 铁律 + 补充规则。编号已避让 G-37（CMP023-028）。

## 铁律（G-38.1 ~ G-38.6）

### G-38.1 — IR 不可知后端

**编译后端不得假设任何前端框架。**

后端只消费 `SourceFile → ProgramIR → IRModule` 契约。不得硬编码 Vue / React / Svelte 特定逻辑（除对应 parser 适配层）。

```typescript
// ❌ 禁止
if (source.framework === 'vue') { /* 特殊路径 */ }

// ✅ 正确：基于 IR 语义字段
if (node.semantic === 'layout.grid') { /* ... */ }
```

### G-38.2 — 产物语义等价

**同一份 IRModule，经任何合规后端 emit 出的产物，运行行为必须一致。**

```
irModule ──emit(node)──▶ bundleA    ┐
                              ──run──▶ 相同输出 ✅
irModule ──emit(rust)──▶ bundleB   ┘
```

违反示例：Node 后端默认 `strict: false`，Rust 后端默认 `strict: true` → 运行时行为分歧。

### G-38.3 — 能力诚实声明

**`capabilities` 不得虚报。**

不支持的能力设为 `false`，conformance 会自动 SKIP 对应项。虚报会在 C-01/C-05 暴露。

### G-38.4 — 降级可观测

**Fallback（Rust → Node）必须产生日志 / 指标。**

```typescript
log.warn('compiler.fallback', { from: 'rust', to: 'node', reason: 'load_failed' })
metrics.inc('compiler_fallback_total', { from: 'rust', to: 'node' })
```

### G-38.5 — 性能基准强制

**每个编译后端必须提供 benchmark，CI 门禁。**

目标：Rust 后端相对 Node 基线 ≥ 2x（C-08）。无 benchmark → conformance C-08-01 失败。

### G-38.6 — 确定性产出

**`deterministic: true` 的后端必须保证字节级一致产出。**

```
emit(ir, opts) === emit(ir, opts)   // 任意两次调用
```

非确定性来源（必须剔除）：`Date.now()`、自增 ID、`Math.random()`、对象遍历顺序（须排序后序列化）。

---

## 补充规则（CMP029 ~ CMP034）

### CMP029 — 接口完整性

必须完整实现 `ProteusCompilerBackend` 接口（16 方法）。可选方法可 no-op，但不得缺失导致调用方抛 `TypeError`。

### CMP030 — 确定性 emit

`capabilities.deterministic = true` 时，`getArtifactHash` 必须对相同输入稳定。这是 C-09 的强制版本。

### CMP031 — 降级语义一致

FallbackBackend 降级前后，emit 产物**运行行为等价**（G-38.2 的降级特例）。允许性能差异，**不允许行为差异**。

### CMP032 — 缓存键可移植

`getCacheKey` 算法**跨后端一致**（同源 hash）。Node 建立的缓存，Rust 后端应能复用，否则视为不合规。

### CMP033 — 诊断不抛异常

parse / transform 中的用户代码错误，**必须**以 `Diagnostic[]` 返回，**不得**抛出未捕获异常（C-03-03、C-04-06）。

### CMP034 — 源码位置保留

parse 阶段必须保留每个节点的源码位置（file / line / column），用于 sourcemap 与错误定位（C-03-04）。

---

## 与既有编号的避让记录

| 模块 | 铁律编号范围 |
|------|-------------|
| G-30 | G-30.x / NAT00x / CMP00x |
| G-31 | G-31.x / CMP005-008 |
| G-32 | G-32.x / CMP009-012 |
| G-36 | G-36.x / CMP017-022 |
| G-37 | G-37.x / CMP023-028 |
| **G-38** | **G-38.1-6 / CMP029-034** ← 本文件 |

verify.sh 步骤 6「编号冲突检测」已确认**零冲突**。

---

## 源自原则 #13 的编译器专项标尺

| 原则 | 内容 | G-38 兑现点 |
|------|------|-------------|
| #13 可插拔完整性 | 可插拔层必须有可验证支撑 | Conformance 42 项 |
| #13.5 编译器 IR 为中间表示 | IR 是唯一契约 | IRModule 标准 |
| #13.6 降级等价 | Fallback 不改变语义 | G-38.4 + CMP031 |
| #13.7 确定性 | 可复现构建 | G-38.6 + CMP030 |

原则 #13 已在 G-37（渲染）首次兑现，G-38 是其**第二次兑现**——证明它不是一次性规则，而是跨层通用的完整性标尺。
