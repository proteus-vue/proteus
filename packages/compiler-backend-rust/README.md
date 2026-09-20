# @proteus-vue/compiler-backend-rust

> **G-29 B2 RustBackend**（`docs/proteus-compiler-backend-1-plan/`）——编译器的 Rust 后端，与 Node / WASM 后端产出**语义等价**的 `CompilerIR`。

## 一句话

**真编译核心在 Rust 侧**（`Cargo.toml` + `src/`），npm 包只是 bin 工具壳：
`npx proteus-cc-rust compile <file.vue>` → stdout 输出 CompilerIR JSON，与 Node 后端逐字段可比。

## 内容

| 模块 | 说明 |
|------|------|
| `bin/cli.js` | npm bin 壳——定位 cargo 产物（release 优先，缺则 `cargo build --release`）并透传参数 |
| `src/main.rs` | CLI 入口：`compile <file.vue> [--pretty]` |
| `src/ir.rs` | `CompilerIR` 结构与序列化（与 `@proteus-vue/compiler-backend` 的契约同源） |
| `src/template.rs` | 模板解析 |
| `src/semantic.rs` | 语义链接（`p-*` 标签 → 语义映射，与 Node 后端同表） |

## 用法

```bash
# 经 npm bin（首次调用会自动 cargo build --release）
npx proteus-cc-rust compile src/pages/index.vue
npx proteus-cc-rust compile src/pages/index.vue --pretty
```

```ts
// 经 CLI 的 --compiler rust：框架会做 Node/Rust 双编译语义等价校验（不一致则 fail fast）
// proteus build --target web --compiler rust
```

## 约束

- **G-29.1 铁律**：Node / Rust / WASM 三端对同一份 SFC 必须产出同一份 `CompilerIR`——
  等价性由 `verifyDualCompilerEquivalence` 在每页编译前校验，不一致不产出。
- 本包**不进 npm 的是编译核心**：发布物含 `bin/` 与 package.json；Rust 源码随仓库分发，
  用户侧首次运行由 `cargo build --release` 产出二进制（故需本机有 Rust 工具链）。
