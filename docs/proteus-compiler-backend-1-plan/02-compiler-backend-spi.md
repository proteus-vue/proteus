# G-29 CompilerBackend SPI 规范

> 与 G-27 `ProteusRenderBackend`、G-28 `ProteusNativeBackend` 同构，共用 `BackendCapabilities` / 版本协商 / conformance test 模式。

## 1. 核心接口

```ts
interface ProteusCompilerBackend {
  readonly id: string                    // 'node' | 'rust' | 'wasm'
  readonly version: string
  readonly capabilities: CompilerCapabilities

  compile(sfc: SFCSource): CompilerIR
  parse(template: string): TemplateAST
  transform(ast: TemplateAST, options: TransformOptions): TransformedAST
  generate(ir: CompilerIR): CodegenResult

  hotUpdate(changes: FileChange[]): UpdatePayload
  generateSourceMap(): SourceMap
}
```

## 2. CompilerIR 契约

```ts
interface CompilerIR {
  version: 1
  layout?: LayoutConstraintIR     // → G-22 柔性布局
  semantic?: SemanticIR           // → G-24 语义原语
  render: RenderIR                // → G-27 nodeOps
  bindings: BindingIR             // → G-28 能力调用
}
```

## 3. CompilerCapabilities

```ts
interface CompilerCapabilities {
  incremental: boolean      // 支持 HMR 增量
  sourceMap: boolean
  treeShaking: boolean
  wasmRuntime: boolean      // 能否在浏览器跑
  plugins: boolean         // 是否支持 G-21 Plugin
  maxFileSize: number      // 单文件上限（bytes）
}
```

## 4. 版本协商

与 G-27 一致：`IR version` + `backend.minCompatVersion` → 不匹配则报错。

## 5. Conformance Test

每个 Backend 必须通过：

1. **IR Golden Test**：同一份 SFC → diff IR，完全一致
2. **HMR 一致性**：连续 hotUpdate，三端结果等价
3. **Source Map 正确**：映射回源行号
4. **Tree-shaking**：未用导出被消除

## 6. 错误码（CMP 前缀）

| 码 | 含义 |
|----|------|
| CMP001 | 业务依赖了 Backend 私有 API |
| CMP002 | IR 产出不符合契约 |
| CMP003 | HMR 语义在三端不一致 |
| CMP004 | 版本不兼容 |
