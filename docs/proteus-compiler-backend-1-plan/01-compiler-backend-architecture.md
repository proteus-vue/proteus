# Proteus G-29：编译器后端可插拔架构

> 状态：Draft v1 | 依赖：G-21（Compiler Plugin）、G-23（AI Agent）、G-27（渲染后端）、G-28（原生能力后端）
> 目标：编译器从"固定 Node 工具链"升级为"可插拔后端"，Node 遇瓶颈时一键切 Rust / WASM，业务零感知

---

## 1. 为什么编译器需要可插拔

### 1.1 Node 工具链的真实瓶颈

| 场景 | Node 的痛点 |
|------|------------|
| 超大型项目（500+ 页面） | TS 类型检查 + AST 遍历 → 内存膨胀、OOM |
| HMR 热更新 | 单线程，大文件 rebuild 卡顿 |
| CI/CD 构建 | Node 启动 + require 树慢 |
| 浏览器内编译（Playground） | Node 无法跑在浏览器 |
| 多语言生态 | 只能 JS/TS |

### 1.2 传统"Rust 重写"的代价

- 重写 = 全部重写，要么全切要么不切
- 旧插件全部废弃
- 失败 = 灾难，无回退

### 1.3 Proteus 的路线：编译器 SPI

> **不是"Node 不好所以要换"，而是"不同场景需要不同编译器实现"。**

就像不同页面需要不同渲染 Backend（G-27），不同构建场景需要不同编译器 Backend。

---

## 2. 核心设计：`ProteusCompilerBackend` SPI

### 2.1 与 G-27/G-28 同构

```
G-27 渲染：  VNode → nodeOps → Backend A/B/C
G-28 能力：  API call → JSI → Backend A/B/C
G-29 编译：  SFC 源码 → IR → Compiler A/B/C
```

三者共用同一套方法论：**语义契约 + 后端实现 + conformance test**。

### 2.2 接口定义

```ts
interface ProteusCompilerBackend {
  compile(sfc: SFCSource): CompilerIR
  parse(template: string): TemplateAST
  transform(ast: TemplateAST, options: TransformOptions): TransformedAST
  generate(ir: CompilerIR): CodegenResult
  hotUpdate(changes: FileChange[]): UpdatePayload
  generateSourceMap(): SourceMap
}
```

### 2.3 统一 IR 产出契约

**CompilerIR 是编译器 Backend 的"接口契约"——与 G-27 的 VNode IR 同一思路：**

```
SFC 源码
    ↓
CompilerBackend A (Node/TS)  →  IR  →  Codegen  →  运行时代码
CompilerBackend B (Rust)     →  IR  →  Codegen  →  运行时代码
CompilerBackend C (WASM)     →  IR  →  Codegen  →  运行时代码
```

同一份 IR → 同一份输出，**业务代码完全不知道编译器用 Node 还是 Rust**。

---

## 3. 四层 Backend 全景（原则 #10 终极兑现）

```
┌──────────────────────────────────────────────┐
│ G-29 编译层   SFC → IR → Codegen             │
│ Node / Rust(SWC-ecosystem) / WASM             │
├──────────────────────────────────────────────┤
│ 逻辑层       JS ↔ Native (JSI)               │
│ Hermes / JSC / V8                            │
├──────────────────────────────────────────────┤
│ G-27 UI 层   VNode → nodeOps → 渲染          │
│ VueDom / Native / Flutter / Skia             │
├──────────────────────────────────────────────┤
│ G-28 能力层   原生能力调用                     │
│ iOS / Android / Harmony / Mock               │
└──────────────────────────────────────────────┘
    ↓
原则 #10：一切皆语义 + 后端实现
```

---

## 4. 三个官方后端

| Backend | 底层引擎 | 适用场景 |
|---------|----------|----------|
| **Node** | `@vue/compiler-sfc` + esbuild | 开发期默认、插件生态最丰富 |
| **Rust** | SWC / oxc（Vue SFC 已支持）+ rolldown | 生产构建、大项目、CI、10x 吞吐 |
| **WASM** | Rust → WASM | Playground、浏览器内编译、在线 Demo |

**不需要自己写 parser**——复用 SWC/oxc/rolldown 生态，只写一层薄适配把输出转成 Compiler IR。

---

## 5. 切换方式

```ts
// proteus.config.ts
export default defineConfig({
  compiler: {
    backend: 'rust'  // 'node' | 'rust' | 'wasm'
  }
})

// CLI
// proteus build --compiler rust
// proteus dev --compiler wasm
```

业务零感知，一个 flag 切换。

---

## 6. 对比：编译器 SPI vs Rust 重写

| | 传统 Rust 重写 | **G-29 Compiler SPI** |
|--|---------------|----------------------|
| 切换成本 | 全部重写 | **一个 flag** |
| 迁移粒度 | 要么全切要么不切 | **文件级 / 包级** |
| 生态兼容 | 旧插件全废 | **Node Backend 继续支持旧插件** |
| 回退 | 失败 = 灾难 | **随时 `--compiler node`** |
| AI 介入 | 无 IR 可操作 | **IR = Agent 操作对象** |

---

## 7. 严格规则

- **G-29.1**：Node/Rust/WASM 三端 Backend 对同一份 SFC 必须产出语义等价的 Compiler IR（IR Golden Test 强制）
- **G-29.2**：新 Compiler Backend 必须通过 IR 产出契约 conformance test
- **G-29.3**：HMR 语义在三端 Backend 上必须一致
- **CMP001**：业务代码禁止直接依赖某 Compiler Backend 的私有 API

---

## 8. 分批落地

| 批次 | 内容 |
|------|------|
| B1 | CompilerIR 契约 + NodeBackend 产出合规 IR（✅ `@proteus-vue/compiler-backend` 已落地：真实模板编译 → C-IR 语义树 + conformance 门禁） |
| B2 | RustBackend 对接 SWC-ecosystem → 同一 IR |
| B3 | WASM Backend（Playground 用） |
| B4 | HMR 三端一致 + Source Map + Tree-shaking |

B1 验证方式：同一份 SFC 跑两个 Backend，diff IR → 完全一致即通过。

---

## 9. 跨体系协同

```
G-29 编译 → 产出 LayoutConstraint IR / Semantic IR / Render IR
                ↓
G-21 Compiler Plugin → 拦截并注入 IR
G-27 nodeOps → 消费 Render IR
G-28 JSI → 消费能力调用
G-23 AI Agent → 操作 Compiler IR（生成/优化/修复）
G-26 开发效率 → Rust 10x 吞吐 + WASM Playground
```

---

## 10. 收益总结

1. **性能**：大项目构建 10x 吞吐（Rust）、HMR 亚秒级
2. **灵活性**：开发期用 Node（生态），生产用 Rust（性能），浏览器用 WASM
3. **渐进迁移**：文件级/包级粒度，可回退
4. **AI 友好**：Compiler IR 是 Agent 的操作对象
5. **生态延续**：Node Backend 继续支持旧插件

> **原则 #10 终极形态：编译、逻辑、UI、能力——四个维度全部可插拔。**
