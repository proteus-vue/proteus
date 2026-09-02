# G-38 CompilerBackend SPI 规范与实现指南

> **状态**：草案 · 待评审（M1 启动）
> **依赖**：G-29（编译器可插拔）、G-30（端接入）、G-31（语义入口）、G-32（原语）、G-37（RenderBackend SPI）
> **铁律**：G-38.1 ~ G-38.6 + CMP029 ~ CMP034

---

## 1. 动机：编译器插拔的"插头"必须被定义

### 1.1 问题

G-29 确立了方向——**「编译器可插拔：Node 遇性能瓶颈可切 Rust / WASM」**。但迄今为止，没有任何文档回答：

> **如果一个团队想给 Proteus 写一个编译后端（Rust / Go / WASM / Bytecode AOT），他到底要实现哪些接口？签名是什么？生命周期是什么？增量编译怎么做？Conformance 怎么跑？**

现状：只有 `ProteusCompilerBackend` 这个接口名飘在架构图里，没有接口定义、没有契约、没有实现指南、没有 conformance 测试套件。

**这与 G-27「渲染可插拔」当初的处境完全同构**——而 G-37 已经把渲染的插头定义清楚了。按照方法论的统一性（原则 #0 五支柱 + 原则 #13「可插拔必须有可验证支撑」），编译器层必须给出同等规格的 SPI。

### 1.2 目标

一份工程师拿到 G-38，**3 天能写出合规的编译后端**：

```
Step 1  声明（id / version / capabilities）        → 0.5 天
Step 2  实现三大阶段（parse / transform / emit）    → 1 天
Step 3  实现增量会话（IncrementalSession）           → 0.5 天
Step 4  处理降级（FallbackBackend）                  → 0.5 天
Step 5  跑 Conformance + 性能基准                    → 0.5 天
```

### 1.3 与 G-37 的同形性（设计原则）

G-38 刻意与 G-37（RenderBackend SPI）保持**同一套设计语言**——写过一个就能写另一个：

| 维度 | RenderBackend (G-37) | CompilerBackend (G-38) |
|------|---------------------|------------------------|
| 输入 | `ComponentIRNode` | `SourceFile` |
| 输出 | 像素 | `CompiledArtifact` |
| 核心方法数 | 18 + 1 可选 | **16 + 3 可选** |
| 差分单位 | 节点 | **IR Instruction（更细）** |
| 特有机制 | 手势桥接 | **★ 增量编译 + 缓存** |
| Conformance | 42 项 (C-01~C-10) | **42 项 (C-01~C-10)** |
| 降级 | `StubBackend` | **`FallbackBackend`（可等价降级）** |

**对称不是巧合，是方法论五支柱在两层 SPI 上的同构投影。**

---

## 2. 核心接口：`ProteusCompilerBackend`

### 2.1 完整签名

```typescript
/**
 * Proteus 编译后端 SPI
 * 任何编译后端必须实现此接口才能接入 Proteus
 */
interface ProteusCompilerBackend {
  // === 身份 ===
  readonly id: string           // 'node' | 'rust' | 'go' | 'wasm' | 'bytecode'
  readonly version: string
  readonly capabilities: CompilerCapabilities

  // === 生命周期 ===
  initialize(ctx: CompilerContext): Promise<void>
  dispose(): void

  // === 三大阶段 ===
  parse(source: SourceFile, ctx: ParseContext): ProgramIR
  transform(ast: ProgramIR, ctx: TransformContext): IRModule
  emit(module: IRModule, ctx: EmitContext): CompiledArtifact

  // === 增量编译（编译独有） ===
  createIncrementalSession(cacheDir: string): IncrementalSession

  // === 诊断 / 缓存 / 哈希 ===
  reportDiagnostics(module: IRModule): Diagnostic[]
  getCacheKey(input: SourceFile): string
  getArtifactHash(artifact: CompiledArtifact): string
}
```

### 2.2 三个可插拔点（关键洞察）

**不是"整个编译器换掉"，而是每个阶段可独立换实现：**

| 阶段 | 接口 | 参考实现 |
|------|------|---------|
| 1. parse | `ProteusParser` | `@proteus-vue/parser-babel`（默认）/ `swc-parser` / 手写递归下降 |
| 2. transform | `ProteusTransformer` | Node（TS 插件）/ **Rust（性能）** / WASM（浏览器内） |
| 3. emit | `ProteusEmitter` | JS bundle / Bytecode / AOT / SourceMap |

这正是 G-29 的真实含义：**transform 阶段从 Node 换成 Rust，parse 与 emit 可保持不变——增量替换，不是整体重写。**

### 2.3 能力声明

```typescript
interface CompilerCapabilities {
  incremental: boolean       // 支持增量编译
  aot: boolean              // 支持 AOT 预编译
  sourceMap: boolean        // 生成 SourceMap
  minify: boolean          // 压缩
  treeShake: boolean       // 摇树
  targetPlatforms: ('web' | 'ios' | 'android' | 'harmony' | 'flutter')[]
  supportedLanguages: ('sfc' | 'tsx' | 'jsx' | 'vue')[]
  backend: 'native' | 'wasm' | 'js'
  deterministic: boolean    // ★ 确定性产出（G-38.6）
}
```

---

## 3. 生命周期

```
┌──────────┐    ┌──────────────┐    ┌─────────┐    ┌──────────┐    ┌────────┐
│ initialize │───▶│ parse循环   │───▶│ transform│───▶│ emit     │───▶│ dispose │
└──────────┘    │ (可多次)     │    └─────────┘    └──────────┘    └────────┘
                └──────────────┘
                     ↑ 增量会话复用
```

| 阶段 | 时机 | 责任 |
|------|------|------|
| `initialize` | 进程启动 | 加载原生库 / 初始化 WASM / 建立缓存目录 |
| `parse` | 每个源文件 | 源码 → ProgramIR（语法树） |
| `transform` | 每次完整构建 / 增量更新 | ProgramIR → IRModule（语义 IR） |
| `emit` | transform 后 | IRModule → CompiledArtifact（bundle / bytecode） |
| `dispose` | 进程退出 / 热替换 | 释放资源、刷盘缓存 |

---

## 4. 中间表示：Compiler IR 标准

### 4.1 IR 层级

```
SourceFile
    ↓ parse
ProgramIR (语法树，前端无关)
    ↓ transform
IRModule (语义 IR，含 ComponentIR / RenderIR / CapabilityIR)
    ↓ emit
CompiledArtifact (bundle / bytecode / AOT)
```

### 4.2 IRModule 结构

```typescript
interface IRModule {
  readonly id: string
  readonly imports: ImportNode[]
  readonly components: ComponentIRNode[]   // → 交给 G-37 RenderBackend
  readonly capabilities: CapabilityIRNode[] // → 交给 G-28 NativeBackend
  readonly metadata: ModuleMetadata
}
```

**关键**：Compiler IR 的输出**直接对接下游 SPI**——`ComponentIRNode` 正是 G-37 `createNode(ir)` 的输入。两层 SPI 通过 IR 解耦。

### 4.3 语义等价契约（G-38.2）

> **同一份 IRModule，经任何合规后端 emit 出的产物，运行行为必须一致。**

```
irModule ──emit──▶ artifact-node    ┐
                              ──run──▶ 相同输出 ✅
irModule ──emit──▶ artifact-rust   ┘
```

---

## 5. 增量编译（编译后端独有）

### 5.1 `IncrementalSession`

```typescript
interface IncrementalSession {
  readonly id: string
  invalidate(file: string): void
  recompute(): IRModuleDiff
  getDependencies(file: string): string[]
  commit(): void
  rollback(): void
}
```

### 5.2 工作流程

```
首次构建：全量 parse + transform + emit，建立依赖图 + 签名缓存
修改 F：invalidate(F) → 仅重算 F 及其反向依赖 → 增量 emit
会话结束：commit() 持久化 / rollback() 丢弃
```

### 5.3 缓存键

```
cacheKey = hash(source) + hash(backendVersion) + hash(transformOptions)
```

命中缓存 → 跳过 parse + transform，直接复用 IR。

---

## 6. 降级：`FallbackBackend`

```typescript
const backend = selectCompilerBackend({
  preferred: 'rust',
  fallback: 'node'
})
// Rust 可用 → Rust；不可用（环境/许可）→ 自动降级 Node
```

**与渲染的关键区别**：渲染少了能力只能缺（车机没摄像头）；但编译**换后端不影响产物语义**——Rust 与 Node 编译出的 bundle **必须字节级一致**（deterministic emit，G-38.6 / CMP030）。

---

## 7. Conformance（42 项，C-01 ~ C-10）

详见 `conformance-suite.md`。核心分组：

| 编号 | 类别 | 项数 | 要点 |
|------|------|------|------|
| C-01 | 接口完整性 | 6 | 16 方法全部实现 |
| C-02 | 生命周期 | 5 | initialize/dispose 配对 |
| C-03 | parse 正确性 | 5 | SFC/TSX/Vue 解析 |
| C-04 | transform 语义 | 6 | IR 等价、原语映射 |
| C-05 | emit 产物 | 5 | bundle / sourcemap / hash |
| C-06 | 增量编译 | 5 | 依赖追踪、缓存命中 |
| C-07 | 降级与 Fallback | 3 | Rust→Node 自动降级 |
| C-08 | 性能基准 | 3 | vs Node 基线 |
| C-09 | 确定性 | 2 | 字节级一致 |
| C-10 | 可观测性 | 2 | 诊断、指标 |

**0 失败才配说「Proteus Compatible」。**

---

## 8. 已知后端清单

| Backend | 目标 | 定位 | 状态 |
|---------|------|------|------|
| `node` | 默认（Babel/TS） | 兼容生态 | ✅ 参考实现 |
| `rust` | SWC-like 高性能 | **性能标杆** | 📋 B3 |
| `wasm` | 浏览器内编译 | 在线 Playground | 📋 B4 |
| `go` | 独立工具链 | 跨平台 CLI | 📋 B5 |
| `bytecode` | AOT 预编译 | 首帧优化 | 📋 B5 |
| `fallback` | 自动降级 | 鲁棒性 | 📋 B2 |

---

## 9. 与既有体系协同

```
G-29 方向（"编译器可插拔"）
  ↓ 具体化 ← ★ G-38（本文件）
  ↓ 实现
具体 Backend：node / rust / wasm / go / bytecode / fallback
  ↓ 产出
Compiler IR (IRModule)
  ↓
G-31 语义入口（128 原语）→ G-37 RenderBackend → 像素
                              ↓
                         G-30 任意端（Tier 1-4）
                              ↓
                        柔性框架六端展示 ← G-36 AI Agent 生成代码
```

**完整闭环**：源码 → CompilerBackend → IR → RenderBackend → 六端原生呈现。两层 SPI 通过 IR 契约解耦。

---

## 10. 铁律速查

| 编号 | 内容 |
|------|------|
| G-38.1 | IR 不可知后端：后端不得假设前端框架 |
| G-38.2 | 产物语义等价：同一 IR → 任何后端 = 相同运行行为 |
| G-38.3 | 能力诚实声明：capabilities 不得虚报 |
| G-38.4 | 降级可观测：Fallback 必须日志 / 指标 |
| G-38.5 | 性能基准强制：必须提供 benchmark，CI 门禁 |
| G-38.6 | 确定性产出：deterministic emit（Rust = Node 字节级一致） |

详见 `rules.md`（含 CMP029 ~ CMP034）。

---

## 11. 分批落地

详见 `batches.md`：

```
B1  SPI 定义 + Compiler IR schema + 类型             → M1
B2  Conformance 测试套件 + FallbackBackend           → M1
B3  Node 参考实现 + Rust 后端（性能标杆）             → M2
B4  WASM 后端（浏览器内 Playground）                  → M2
B5  Go / Bytecode AOT 后端                           → M3
```

---

## 12. 参考实现示意

```typescript
// @proteus-vue/compiler-backend-node（默认，Babel/TS 驱动）
export class NodeCompilerBackend implements ProteusCompilerBackend {
  readonly id = 'node'
  readonly capabilities = {
    incremental: true, aot: false, sourceMap: true,
    minify: true, treeShake: true,
    targetPlatforms: ['web'],
    supportedLanguages: ['sfc', 'tsx', 'jsx', 'vue'],
    backend: 'js', deterministic: true
  }

  async initialize(ctx: CompilerContext) { /* 加载 babel */ }
  parse(source: SourceFile): ProgramIR { /* @babel/parser */ }
  transform(ast: ProgramIR): IRModule { /* babel-traverse + 自定义插件 */ }
  emit(module: IRModule): CompiledArtifact { /* 生成 bundle + sourcemap */ }
  createIncrementalSession(cacheDir: string): IncrementalSession { /* 文件监听 + 依赖图 */ }
  dispose() { /* 清理 */ }
}
```

完整实现指南见 `implementation-guide.md`。
