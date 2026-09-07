# 10 Compiler 集成

> 对齐 Compiler plan（IR + 多 backend + `--trace-transform`）

## IR 扩展

```ts
// packages/compiler/src/ir/nodes.ts
export interface GlassNode extends ElementNode {
  type: 'glass'
  props: GlassProps
  children: IRNode[]
}

export interface ElementNode {
  // ... 既有字段
}
```

`pg-glass` 在 parse 阶段识别为 `GlassNode`，区别于普通 `ElementNode`。

## 编译流程

```
SFC parse → IR 构建
  ├─ 识别 <pg-glass> → GlassNode
  ├─ 校验 props（对齐 types-plan Registry）
  └─ 注入平台能力查询
       ↓
IR transform（平台分发）
  ├─ Web:     生成 <div class="pg-glass"> + scoped CSS
  ├─ Skyline: 生成 <view class="pg-glass"> + scoped CSS + worklet
  ├─ iOS:     生成原生组件树（UIGlassEffect / UIVisualEffectView）
  ├─ 鸿蒙:     生成 ArkTS（backdropBlur / fractal）
  └─ Android: 生成 Kotlin（RenderEffect）
       ↓
产物快照（对齐 Build plan）
```

## `--trace-glass`

新增 trace 子链路，输出 props → 端 → 映射实现：

```
[glass] <pg-glass preset="navigationBar" intensity="regular">
  → platform: ios
  → capability: glass.l3 (iOS 26+)
  → impl: UIGlassEffect(.regular) + bottom border
  → degrade: UIVisualEffectView (≤iOS 25)
```

`--trace-transform` 总链路中嵌入 `--trace-glass` 节点。

## 产物快照

`dist/mp/**/glass-manifest.json` 进 git：

```json
{
  "nodes": [
    { "id": "g1", "preset": "navigationBar", "platform": "ios", "impl": "UIGlassEffect" }
  ]
}
```

diff = 玻璃映射回归检测。

## props 校验

对齐 types-plan `defineGlassProps`：

```ts
// packages/glass/src/props.ts
export const glassPropsSchema = z.object({
  preset: z.enum(['navigationBar', 'modal', 'card', 'tabBar', 'floating', 'sidebar', 'custom']),
  intensity: z.union([z.number(), z.enum(['thin','regular','thick','ultra'])])，
  // ...
})
```

编译期校验，错误即报错（对齐 "编译期 > 运行时" 铁律）。

## 对齐跨层契约

`GlassNode` / `GlassProps` / `GlassLevel` 纳入 `contracts.ts`，
禁止各 backend 各自定义。
