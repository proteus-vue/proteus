# G-38 编译后端实现指南

> 目标：从一个空目录到「Proteus Compatible」的 5 步完整教程。

## Step 1：声明身份与能力（0.5 天）

```typescript
// my-backend.ts
import { ProteusCompilerBackend, CompilerCapabilities } from '@proteus-vue/core'

export class MyBackend implements ProteusCompilerBackend {
  readonly id = 'rust'  // 唯一标识
  readonly version = '0.1.0'
  readonly capabilities: CompilerCapabilities = {
    incremental: true,
    aot: false,
    sourceMap: true,
    minify: true,
    treeShake: true,
    targetPlatforms: ['web', 'ios', 'android'],
    supportedLanguages: ['sfc', 'tsx'],
    backend: 'native',
    deterministic: true   // ★ G-38.6
  }

  async initialize(ctx) { /* ... */ }
  dispose() { /* ... */ }
  // ...
}
```

**要点**：`capabilities` 必须如实声明（G-38.3）。不支持的设为 `false`，conformance 会自动 SKIP 对应项——虚报反而会在 C-01/C-05 暴露。

## Step 2：实现 parse（源码 → ProgramIR）

```typescript
parse(source: SourceFile, ctx: ParseContext): ProgramIR {
  // 方案 A：复用 babel（最快）
  const ast = babel.parse(source.content, { filename: source.path })
  return this.toProgramIR(ast)

  // 方案 B：自研递归下降（Go / Rust 后端常见）
  // const tokenizer = new Tokenizer(source.content)
  // return this.parseProgram(tokenizer)
}
```

**要点**：
- 必须保留源码位置信息（C-03-04，用于 sourcemap）
- 语法错误 → 返回 `Diagnostic[]`，**不抛异常**（C-03-03）

## Step 3：实现 transform（ProgramIR → IRModule）

```typescript
transform(ast: ProgramIR, ctx: TransformContext): IRModule {
  const components: ComponentIRNode[] = []
  const capabilities: CapabilityIRNode[] = []

  for (const node of ast.nodes) {
    if (node.kind === 'element') {
      // ★ 关键：基于 semantic 分发，禁止标签名（G-38.1 同 G-37.1）
      components.push(this.toComponentIR(node))
    } else if (node.kind === 'capability-call') {
      capabilities.push(this.toCapabilityIR(node))
    }
  }

  return { id: ctx.moduleId, imports: ast.imports, components, capabilities, metadata: {} }
}
```

**原语映射示例**（C-04-01/02）：

```typescript
toComponentIR(node): ComponentIRNode {
  const map = {
    'p-grid': 'layout.grid',
    'p-stack': 'layout.stack',
    'p-scroll': 'layout.scroll',
    'p-text': 'ui.text',
    'p-button': 'ui.button',
  }
  return {
    semantic: map[node.tag] ?? `unknown.${node.tag}`,
    props: node.attributes,
    children: node.children.map(c => this.toComponentIR(c))
  }
}
```

## Step 4：实现 emit（IRModule → CompiledArtifact）

```typescript
emit(module: IRModule, ctx: EmitContext): CompiledArtifact {
  const code = this.generate(module, {
    minify: this.capabilities.minify,
    sourceMap: this.capabilities.sourceMap
  })
  return {
    code,
    map: ctx.sourceMap,
    hash: this.getArtifactHash({ code })
  }
}
```

**确定性**（C-09）：`minify` / `sourceMap` 外的非确定性因素（如 Date、随机 ID）必须剔除，保证两次 emit 字节级一致。

## Step 5：实现增量会话 + 跑 Conformance

```typescript
createIncrementalSession(cacheDir: string): IncrementalSession {
  return new IncrementalSessionImpl(cacheDir, this)
}

// 跑测试
// $ proteus conformance --backend ./dist/my-backend.js
// ✅ 42/42 passed
```

---

## 完整示例：Terminal 后端（最简，用于 conformance 自检）

> 不产出真实 bundle，而是把 IR 渲染为 ASCII 树——用于 CI 自检后端逻辑正确性。

```typescript
export class TerminalCompilerBackend implements ProteusCompilerBackend {
  readonly id = 'terminal'
  readonly capabilities = { /* ... minimal ... */ deterministic: true }

  parse(source: SourceFile): ProgramIR {
    // 极简：把每个 <p-x> 当作节点
    return { nodes: this.scan(source.content) }
  }
  transform(ast: ProgramIR): IRModule {
    return { components: ast.nodes.map(n => ({
      semantic: n.tag.replace(/^p-/, 'layout.'),
      props: {}, children: []
    })) }
  }
  emit(module: IRModule): CompiledArtifact {
    // ASCII 渲染
    const tree = module.components.map(c => `├─ ${c.semantic}`).join('\n')
    return { code: tree, map: null, hash: hash(tree) }
  }
  createIncrementalSession() { return new NoopSession() }
  // ...
}
```

---

## 各后端实现要点

### Node 后端（参考实现，B2）

- parse：`@babel/parser`
- transform：babel-traverse + 自定义插件
- emit：babel-generator + 自研 bundle 组装
- 增量：`chokidar` 文件监听 + 依赖图

### Rust 后端（性能标杆，B3）

- 绑定：`napi-rs` 或 `wasm-bindgen`
- parse：`swc` / `tree-sitter` 绑定
- transform：Rust 原生 IR 转换（并行化优势）
- **关键**：与 Node 后端产出语义等价（C-04-05, C-09-02）

### WASM 后端（浏览器内，B4）

- 编译目标：`wasm-pack` 输出 wasm
- 用途：在线 Playground（无需服务器编译）
- 限制：`backend: 'wasm'`，AOT 通常不支持

### Go 后端（独立 CLI，B5）

- 完全自研：lexer / parser / transformer
- 优势：单二进制分发，无 Node 依赖
- 用途：CI 环境、跨平台工具链

### Bytecode AOT（B5）

- emit 产出预编译字节码
- 运行时直接解释，跳过 parse + transform → **首帧优化**
- capabilities：aot: true

---

## 性能调优技巧

1. **缓存 parse 结果**：`getCacheKey = hash(source) + hash(version)`
2. **并行 transform**：IR 节点独立，可 worker pool（Rust 优势最大）
3. **增量粒度**：精确到函数 / 表达式，而非文件
4. **treeShake 早做**：transform 阶段标记副作用，emit 阶段删除
5. **SourceMap 懒生成**：仅 dev 模式

---

## FallbackBackend 实现

```typescript
export function selectCompilerBackend(opts: {
  preferred: 'rust' | 'wasm' | 'go',
  fallback: 'node'
}): ProteusCompilerBackend {
  try {
    const backend = loadBackend(opts.preferred)
    if (backend.isAvailable()) {
      backend.onFallback = (reason) => log.warn(`preferred unavailable: ${reason}`)
      return backend
    }
  } catch (e) {
    log.warn(`preferred backend failed: ${e.message}`)
  }
  return new NodeCompilerBackend()  // 降级（C-07）
}
```

**降级必须可观测**（G-38.4）：日志 + 指标（`compiler_fallback_total{from="rust",to="node"}`）。

---

## 自检清单

- [ ] `id` / `version` / `capabilities` 齐全
- [ ] 16 方法全部实现（可选方法可 no-op 但不得崩溃）
- [ ] parse 保留位置信息
- [ ] transform 基于 `semantic` 分发（无标签名硬编码）
- [ ] emit 产物可运行 + sourcemap 有效
- [ ] `getArtifactHash` 稳定
- [ ] 增量会话：invalidate / recompute / commit / rollback
- [ ] FallbackBackend：Rust → Node 自动降级
- [ ] `proteus conformance` → 42/42（或仅 warning）
- [ ] benchmark 相对 Node 基线有提升
