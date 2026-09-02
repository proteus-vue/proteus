# G-29 三端 Backend 实现

## 1. Node Backend（默认）

- 底层：`@vue/compiler-sfc` + Babel/esbuild
- 场景：开发期默认、插件生态最丰富
- 实现：直接复用 Vue 官方编译器，适配层薄

## 2. Rust Backend（生产构建）

- 底层：**SWC-ecosystem**（SWC / oxc / rolldown）
- 场景：生产构建、大项目、CI，10x 吞吐
- 关键：SWC 已支持 Vue SFC（社区 `swc-plugin-vue`），oxc 在做 Vue SFC 支持，rolldown（Vue/Vite 作者发起）即将成熟
- **不需要自己写 parser**，只写薄适配把 SWC/oxc 输出转成 CompilerIR

## 3. WASM Backend（浏览器内编译）

- 底层：Rust → WASM
- 场景：Playground、在线 Demo、浏览器内编译
- 关键：Compiler 本身可在浏览器跑，支撑官网 Playground 实时预览

## 4. 渐进迁移粒度

| 粒度 | 说明 |
|------|------|
| 文件级 | 某个文件用 Rust 编译，其他 Node |
| 包级 | 某个 pkg 用 Rust，其他 Node |
| 项目级 | 整项目切换 |

**随时 `--compiler node` 回退。**

## 5. 性能基准（M2 实测目标）

| Backend | 冷启动 | 500 页面构建 | HMR |
|---------|--------|-------------|-----|
| Node | 基线 | 基线 | 基线 |
| Rust | 更快 | **10x** | 亚秒级 |
| WASM | 浏览器内 | — | — |

> 具体数字 M2 实测后填入，此处为方向性目标。
