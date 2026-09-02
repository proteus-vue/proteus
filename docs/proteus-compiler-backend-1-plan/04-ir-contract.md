# G-29 IR 产出契约

## 1. CompilerIR Schema

```ts
interface CompilerIR {
  version: 1
  layout?: LayoutConstraintIR
  semantic?: SemanticIR
  render: RenderIR
  bindings: BindingIR
}
```

## 2. 语义等价

Node / Rust / WASM 三端 Backend 对同一份 SFC **必须产出语义等价的 CompilerIR**。

- 字段顺序允许不同（规范化后比较）
- 数值精度允许误差范围
- 副作用顺序必须一致

## 3. IR Golden Test

```
fixtures/
  button.sfc        → button.ir.golden.json
  grid.sfc          → grid.ir.golden.json
  ...

每个 Backend 跑全部 fixture → diff 产出 IR vs golden → 一致则通过
```

## 4. Source Map

每个 Backend 必须产出合法 Source Map，映射回 SFC 源行号。

## 5. Tree-shaking

未使用的导出必须在 generate 阶段消除，三端行为一致。

## 6. 与 G-27/G-28 的 IR 衔接

```
CompilerIR.render  →  G-27 VNode / nodeOps
CompilerIR.bindings → G-28 能力调用 JSI
CompilerIR.layout   → G-22 柔性布局约束
CompilerIR.semantic → G-24 语义原语
```

IR 是四层 Backend 之间的"通用语言"。
