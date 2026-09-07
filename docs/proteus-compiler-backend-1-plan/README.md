# Proteus G-29 编译器后端可插拔架构

> 目标：编译器可插拔，Node 遇瓶颈一键切 Rust / WASM，业务零感知

## 文档清单

| 文件 | 内容 |
|------|------|
| 01-compiler-backend-architecture.md | ★ 主文档：动机/四层全景/对比 Rust 重写/规则/分批 |
| 02-compiler-backend-spi.md | SPI 接口 + CompilerIR + conformance test |
| 03-backend-implementations.md | Node/Rust(SWC-ecosystem)/WASM 三端 |
| 04-ir-contract.md | IR 产出契约 + IR Golden Test |
| 05-migration.md | 渐进迁移（文件/包/项目级）+ 回退 |
| 06-integration-batches.md | 跨 plan 协同 + B1-B4 |
| architecture-update.md | 规约增量：#10 泛化 + G-29 铁律 + CMP 规则 |

## 核心一句话

> 原则 #10 终极形态：编译、逻辑、UI、能力——四个维度全部可插拔。

## 校验

```bash
bash verify.sh
```
