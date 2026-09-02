# Proteus CompilerBackend SPI（G-38）

> 编译器插拔的"插头"标准——任何编译后端实现此 SPI + 跑通 conformance，即合规接入 Proteus。
> ★编号避让：规划文档（zip 包内原稿 G-35）入库时 G-35 已被 app-config 占用，按规约编号避让纪律重编号为 **G-38**；原稿内部引用 G-34（RenderBackend SPI）同步重指向 **G-37**，原则 #11（可插拔可验证）→ **#13**。

## 为什么需要这份规范

G-29 确立了「编译器可插拔：Node 遇瓶颈可切 Rust / WASM」的方向，但从未定义：

- 编译后端要实现哪些接口？签名是什么？
- 生命周期、增量编译、降级怎么做？
- Conformance 怎么跑？

本规范补全它，**与 G-37（RenderBackend SPI）保持同形设计**——写过一个就能写另一个。

## 快速导航

| 文件 | 内容 |
|------|------|
| [01-compiler-backend-spi.md](./01-compiler-backend-spi.md) | ★ 主文档：接口、生命周期、IR、降级、conformance |
| [02-conformance-suite.md](./02-conformance-suite.md) | ★ 42 项测试（C-01~C-10） |
| [03-implementation-guide.md](./03-implementation-guide.md) | ★ 5 步实现 + Node/Rust/WASM 示例 |
| [04-incremental-compilation.md](./04-incremental-compilation.md) | ★ 增量编译协议（编译独有） |
| [05-batches.md](./05-batches.md) | B1-B5 + DoD + 跨 plan 协同 |
| [06-rules.md](./06-rules.md) | 铁律 G-38.1-6 + CMP029-034 |
| [00-architecture-update.md](./00-architecture-update.md) | 规约增量（原则 #13.5/13.6/13.7） |

## 核心接口（速览）

```typescript
interface ProteusCompilerBackend {
  readonly id: string
  readonly capabilities: CompilerCapabilities
  initialize(ctx): Promise<void>
  dispose(): void
  parse(source: SourceFile): ProgramIR
  transform(ast: ProgramIR): IRModule
  emit(module: IRModule): CompiledArtifact
  createIncrementalSession(cacheDir: string): IncrementalSession
  reportDiagnostics(module: IRModule): Diagnostic[]
  getCacheKey(input: SourceFile): string
  getArtifactHash(artifact: CompiledArtifact): string
}
```

## 已知后端

| Backend | 目标 | 状态 |
|---------|------|------|
| `node` | 默认（Babel/TS） | ✅ 参考实现 |
| `rust` | SWC-like 高性能 | 📋 B3 |
| `wasm` | 浏览器内 | 📋 B4 |
| `go` | 独立 CLI | 📋 B5 |
| `bytecode` | AOT 预编译 | 📋 B5 |
| `fallback` | 自动降级 | 📋 B2 |

## 与 G-37 的对称

```
源码 → [Compiler IR] → [Component/Render IR] → Backend → 像素
        ↑ G-38                    ↑ G-37
```

两层 SPI 通过 IR 解耦，均为 42 项 conformance + Fallback 机制。

## 打包与校验

```bash
# 打包（生成 CHECKSUM.md 后打包，MANIFEST 本身进包）
bash pack.sh

# 校验（单场景）
bash verify.sh

# 三场景独立校验
bash run-all-verify.sh
```

`verify.sh` 包含 10 步骤，含**步骤 7「同形性检查」**（G-38 vs G-37 接口/阶段/降级/conformance 对称）。

## 校验状态

- 内容文件：9 份（8 文档 + 本 README）
- MANIFEST 白名单：含全部文件 + 校验脚本
- SHA256：`bash pack.sh` 重新生成 CHECKSUM.md（入库后首次运行时生成）
- 单场景 verify：`bash verify.sh` → **VERIFY: PASS 11/11**（Node ≥18 跑 conformance-runner.js，PASS=69 FAIL=0）
- ★注意：`run-all-verify.sh` 场景 3（隔离目录仅有 zip）需先 `bash pack.sh` 生成 zip；仓库不跟踪 zip 产物（用户偏好，见 PROJECT_MEMORY #312）——日常以单场景 `verify.sh` 为准

详见 `verify.sh` 输出。
