# G-29 跨 plan 协同与分批

## 1. 跨体系协同

```
G-29 编译 → 产出 LayoutConstraint IR / Semantic IR / Render IR
                ↓
G-21 Compiler Plugin → 拦截并注入 IR
G-27 nodeOps → 消费 Render IR
G-28 JSI → 消费能力调用
G-23 AI Agent → 操作 Compiler IR（生成/优化/修复）
G-26 开发效率 → Rust 10x 吞吐 + WASM Playground
```

## 2. 与 G-27/G-28 同构

| 层 | SPI | 后端 |
|----|-----|------|
| G-29 编译 | `ProteusCompilerBackend` | Node/Rust/WASM |
| G-27 UI | `ProteusRenderBackend` | VueDom/Native/Flutter/Skia |
| G-28 能力 | `ProteusNativeBackend` | iOS/Android/Harmony/Mock |

共用：`BackendCapabilities` / conformance test / 版本协商。

## 3. 分批落地

| 批次 | 内容 | 依赖 |
|------|------|------|
| B1 | CompilerIR 契约 + NodeBackend 产出合规 IR | ✅ `@proteus-vue/compiler-backend`：spi（CompilerIR render/semantic/bindings + CompilerCapabilities）/ conformance（CMP002 契约 + CMP004 版本 + ★G-31.1 语义链接——与 G-27 runBackendConformance 同构）/ node（真实模板编译 @vue/compiler-sfc+dom → C-IR 语义树，toComponentIR 衔接；v-model/v-on/capability 绑定收集） |
| B2 | RustBackend 对接 SWC-ecosystem → 同一 IR | B1 | ✅ `packages/compiler-backend-rust`（cargo crate，@proteus-vue/compiler-backend-rust 占位包）：proteus-cc-rust CLI——轻量模板扫描器（Vue SFC template 提取→元素树）→ 语义链接（p-* → semantic 常量表）→ CompilerIR JSON（与 NodeBackend 同契约 version:1/render+C-IR 树/bindings）；**G-29.1 语义等价（Node/Rust Golden）**：DEFAULT_CONFORMANCE_SFC 双端产出 render 树 semantic 序列 + C-IR 树语义序列一致；**后记（决策 #332/#333）真实文件级门禁 + 插拔消费点**：修复扫描器四类真实缺口（外层 template 深度提取（槽模板不再截断）/ 引号感知标签结束（属性值含 `source="<b>…</b>"`）/ semantic 表与 TAG_SEMANTIC_MAP 严格同步（补 p-view·删超集 3 项）/ v-if/v-else 顶层兄弟 Node 单根语义对齐（discard_depth 丢弃第二根））→ `tests/compiler-backend-examples.test.ts` 对 examples/pages + subpackages + src/components 全部 81 个真实 .vue 双端编译跑通 + 语义等价；`dual-check.ts` + `config.compiler.backend: 'node'\|'rust'` + `proteus build --compiler rust` + vite 构建内双编译校验（阶段 A：产物仍 Node 引擎，Rust 等价校验源；产物级 codegen 待 B3/B4）；决策 #330/#332/#333 |
| B3 | WASM Backend（Playground） | B1 |
| B4 | HMR 三端一致 + Source Map + Tree-shaking | B2, B3 |

**B1 最快出原型**：纯逻辑、零依赖、可单测（diff IR）。

## 4. 单测用例

1. IR 语义等价：同一 SFC 两 Backend diff IR → 一致
2. HMR 一致性：连续 hotUpdate 三端等价
3. Source Map：映射回源行号正确
4. Tree-shaking：未用导出消除

## 5. 路线图落点

- **M1**：B1（与 G-27 B1 nodeOps 同期，都是"定义 SPI shape"）
- **M2**：B2、B3
- **M3**：B4 + 生态完整
