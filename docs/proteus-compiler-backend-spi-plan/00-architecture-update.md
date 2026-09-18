# G-38 架构增量

> 待合并进主规约（proteus-architecture/）。本文件是增量 diff，评审通过后并入。

## 1. 原则新增

### 原则 #13.5 — 编译器 IR 为中间表示

> **Compiler IR（IRModule）是编译层与下游（渲染、能力、端）之间的唯一契约。**
> 任何编译后端只消费 IR，不假设上游框架；下游（G-37 RenderBackend 等）只消费 IR，不假设编译器实现。

### 原则 #13.6 — 降级等价

> **编译后端降级（FallbackBackend）不得改变产物运行语义。** 允许性能差异，不允许行为差异。

### 原则 #13.7 — 确定性

> **合规编译后端必须支持确定性产出（deterministic emit）。** 相同输入 + 相同选项 → 字节级一致产物。

---

## 2. 全景图细化

### 编译层（G-29）— 细化

```
ProteusCompilerBackend (SPI, G-38)
├── NodeCompilerBackend        ✅ 参考实现（B2）
├── RustCompilerBackend        📋 B3（性能标杆）
├── WasmCompilerBackend        📋 B4（浏览器内）
├── GoCompilerBackend          📋 B5（独立 CLI）
├── BytecodeCompilerBackend    📋 B5（AOT）
└── FallbackBackend            📋 B2（自动降级）

Compiler IR (IRModule)
├── ComponentIRNode   → G-37 RenderBackend
├── CapabilityIRNode  → G-28 NativeBackend
└── Metadata           → G-30 Platform (Tier)
```

### 与渲染层（G-37）的对称结构

```
┌─────────────────────┬─────────────────────┐
│  G-38 编译器插拔      │  G-37 渲染插拔      │
│  CompilerBackend     │  RenderBackend      │
│  16+3 方法           │  18+1 方法          │
│  parse/transform/emit│  create/update/...  │
│  ★ 增量编译           │  手势桥接           │
│  FallbackBackend     │  StubBackend        │
│  42 conformance      │  42 conformance     │
└────────┬─────────────┴────────┬────────────┘
         ↓                      ↓
    Compiler IR            Component/Render IR
         └──────┬──────────────┘
                ↓
         G-31 语义入口（128 原语）
```

---

## 3. 铁律总表增量

| 编号 | 内容 | 来源 |
|------|------|------|
| G-38.1 | IR 不可知后端 | 本文件 |
| G-38.2 | 产物语义等价 | 本文件 |
| G-38.3 | 能力诚实声明 | 本文件 |
| G-38.4 | 降级可观测 | 本文件 |
| G-38.5 | 性能基准强制 | 本文件 |
| G-38.6 | 确定性产出 | 本文件 |
| CMP029 | 接口完整性 | 本文件 |
| CMP030 | 确定性 emit | 本文件 |
| CMP031 | 降级语义一致 | 本文件 |
| CMP032 | 缓存键可移植 | 本文件 |
| CMP033 | 诊断不抛异常 | 本文件 |
| CMP034 | 源码位置保留 | 本文件 |

---

## 4. 文档关系

```
PROTEUS-METHODOLOGY（原则 #0）
    ↓ 原则 #13（可插拔完整性）
    ↓ 原则 #13.5 / #13.6 / #13.7（编译器专项）
    ↓
G-38 CompilerBackend SPI（本目录）
    ↑ 复用 conformance 框架
G-37 RenderBackend SPI
    ↑ 兑现方向
G-29 编译器可插拔（方向）
    ↓ 落地产物
具体后端：node / rust / wasm / go / bytecode / fallback
    ↓
Compiler IR → G-37 → G-30 → 柔性框架六端
```

---

## 5. 风险与边界

| 风险 | 缓解 |
|------|------|
| IR schema 过早冻结限制演进 | 语义化版本 + 扩展字段（不得 breaking） |
| Rust/Node 产出字节不一致 | C-09 conformance + CMP030 强制 |
| WASM 体积过大 | B4 DoD：< 2MB 预算 |
| 增量缓存跨后端失效 | CMP032：缓存键算法标准化 |
| 后端生态碎片化 | Conformance 是唯一准入门槛 |

---

## 6. 路线落点

```
M1  B1（SPI + IR schema）+ B2（conformance + Node 参考实现）
M2  B3（Rust）+ B4（WASM）
M3  B5（Go + Bytecode AOT）
```

与 G-32（原语）、G-37（渲染）B1 同批进 M1——**IR schema 稳定是所有后端的前提**。

---

## 7. 版本记录

- **v0.1**（草案）：初始 SPI 定义，与 G-37 同形设计，原则 #13.5/13.6/13.7 建立。
- 依赖文档版本：G-27 v1.0、G-29 v1.0、G-30 v1.0、G-31 v1.0、G-32 v1.0、G-36 v1.0、G-37 v1.0。
