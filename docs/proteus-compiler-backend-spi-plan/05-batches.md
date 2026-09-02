# G-38 分批落地计划

> 与 M1 / M2 / M3 协同，依赖 G-32（原语库）、G-37（RenderBackend）稳定。

## B1 — SPI 定义 + Compiler IR schema（M1）

**目标**：冻结接口与 IR 契约。

| 交付物 | 责任 |
|--------|------|
| `ProteusCompilerBackend` 接口（TS 类型） | @proteus-vue/core |
| `ProgramIR` / `IRModule` schema（JSON Schema） | @proteus-vue/ir |
| `CompilerCapabilities` 定义 | @proteus-vue/core |
| `IncrementalSession` 接口 | @proteus-vue/core |

**DoD**：
- [ ] 接口在 `@proteus-vue/core` 导出
- [ ] IR schema 有 JSON Schema + TS 类型双份
- [ ] 与 G-37 `ComponentIRNode` 对接验证（下游可消费）
- [ ] 架构评审通过（原则 #13.5）

## B2 — Conformance 测试套件 + FallbackBackend（M1）

**目标**：可验证支撑就位（原则 #13）。

| 交付物 | 责任 |
|--------|------|
| `proteus conformance` CLI | @proteus-vue/cli |
| 42 项测试实现（C-01~C-10） | @proteus-vue/conformance |
| `TerminalCompilerBackend`（最简参考） | @proteus-vue/backend-terminal |
| `NodeCompilerBackend`（完整参考） | @proteus-vue/backend-node |
| `FallbackBackend` | @proteus-vue/core |

**DoD**：
- [ ] `TerminalCompilerBackend` 跑通 42/42（或仅 capability SKIP）
- [ ] `NodeCompilerBackend` 跑通 42/42
- [ ] Fallback：Rust 不可用 → Node 自动降级，日志可观测
- [ ] CI 集成：`proteus conformance` 失败 → PR 阻断

## B3 — Rust 后端（性能标杆，M2）

**目标**：兑现 G-29「Node 遇瓶颈切 Rust」。

| 交付物 | 责任 |
|--------|------|
| `proteus-compiler-rust`（napi-rs 绑定） | 独立 crate |
| SWC / tree-sitter parser 适配 | 同上 |
| 增量编译（rayon 并行） | 同上 |
| benchmark 套件 | @proteus-vue/bench |

**DoD**：
- [ ] 相对 Node 基线 ≥ 2x（C-08-02）
- [ ] 与 Node 产出语义等价（C-04-05, C-09-02）
- [ ] Conformance 42/42
- [ ] 真实项目（≥1000 文件）冷启动 < 5s

## B4 — WASM 后端（浏览器内，M2）

**目标**：支撑官网 Playground 浏览器内编译。

| 交付物 | 责任 |
|--------|------|
| `proteus-compiler-wasm`（wasm-pack） | 独立包 |
| 体积预算 < 2MB | 同上 |
| Playground 集成示例 | website-v3 |

**DoD**：
- [ ] 浏览器内可编译 SFC → IR（C-08-03）
- [ ] 与 Node 产出语义等价
- [ ] 首屏编译 < 500ms（小项目）

## B5 — Go / Bytecode AOT 后端（M3）

**目标**：覆盖独立 CLI 与首帧优化场景。

| 交付物 | 责任 |
|--------|------|
| `proteus-compiler-go`（自研 lexer/parser） | 独立二进制 |
| `proteus-compiler-bytecode`（AOT 预编译） | @proteus-vue/aot |

**DoD**：
- [ ] Go 后端单二进制分发，无 Node 依赖
- [ ] Bytecode 后端：emit 预编译产物，运行时直解释
- [ ] 两者均跑通 conformance（capability SKIP 允许）

---

## 跨 Plan 协同矩阵

| 依赖方 | 被依赖方 | 协同点 |
|--------|---------|--------|
| G-38 B1 | G-32 | Compiler IR 消费 128 原语定义 |
| G-38 B2 | G-37 | conformance 框架同形（42 项） |
| G-38 B3 | G-29 | Rust 后端兑现「可切 Rust」 |
| G-38 B4 | website-v3 | Playground 浏览器内编译 |
| G-38 emit | G-37 | IRModule → ComponentIRNode → RenderBackend |
| G-38 IR | G-31 | 语义入口 = IR 的输入源 |

---

## 路线图落点

```
M1  ── B1（SPI + IR schema）+ B2（conformance + Node 参考实现）
M2  ── B3（Rust 性能后端）+ B4（WASM 浏览器内）
M3  ── B5（Go + Bytecode AOT）
```

**关键路径**：B1 必须先于所有其他模块——因为 IR schema 稳定是所有后端实现的前提（与 G-32 B1、G-37 B1 同批，均在 M1）。

---

## Definition of Done（全局）

- [ ] 9 份文档齐全（本目录全部文件）
- [ ] SPI 接口在 `@proteus-vue/core` 导出且类型检查通过
- [ ] Conformance 42 项有参考实现跑通
- [ ] 至少 2 个真实后端（Node + Rust）合规
- [ ] FallbackBackend 在真实环境验证
- [ ] benchmark 基线入库，CI 门禁生效
- [ ] 与 G-37 同形性检查通过（verify.sh 步骤 7）
- [ ] 架构更新合并进规约（原则 #13.5/13.6/13.7）
