# 09 Compiler IR 集成

## 1. IR 扩展（对齐 Compiler plan）

Compiler 产出平台无关的 IR，App 后端新增 **Native 指令序列**：

```ts
type IRNode = {
  kind: 'element' | 'text' | 'component'
  type: string           // p-view / p-glass ...
  props: Record<string, IRProp>
  children: IRNode[]
  // App 后端扩展
  nativeInstructions?: NativeInstruction[]
}

type NativeInstruction =
  | { op: 'createView'; viewId: number; type: string }
  | { op: 'updateProp'; viewId: number; key: string; value: IRProp }
  | { op: 'appendChild'; parentId: number; childId: number }
  | { op: 'removeView'; viewId: number }
  | { op: 'invokeCapability'; name: string; params: unknown }
```

## 2. 代码生成

Compiler 为每个平台生成不同产物：

```
IR ─┬─→ Web：render 函数（DOM）
     ├─→ Skyline：.wxml + pages.json
     └─→ App：Native 指令序列（本方案）
            ↓
        @proteus-vue/app-renderer 消费
```

## 3. --trace-app（对齐 --trace-transform）

```bash
proteus build --platform app --trace-app
```

输出（对齐 DevTools TraceBus）：

```json
{
  "phase": "render",
  "component": "App",
  "instructions": [
    { "op": "createView", "viewId": 1, "type": "UIView" },
    { "op": "updateProp", "viewId": 1, "key": "backgroundColor", "value": "#fff" }
  ],
  "durationMs": 0.3,
  "thread": "ui"
}
```

## 4. 与 --trace-transform 的关系

```
--trace-transform  →  SFC → IR 的转换链路（Compiler 层）
--trace-app        →  IR → Native 指令的执行链路（Renderer 层）
--trace-glass      →  Glass 能力选择（Glass 层）
```

三者统一进 DevTools TraceBus，可端到端回放一次渲染。

## 5. 产物快照（对齐 Blueprint）

`dist/app/**/*.{js,json}` 全部进 git，diff = 回归。

```
dist/app/
  ├─ native-instructions.json   # IR 指令序列
  ├─ bridge-bundle.js           # JSI Host Object
  └─ manifest.json
```

## 6. 编译期校验

- 组件名必须在 `componentMap` 中（04）
- 属性必须在 Native SDK 类型中（08）
- 能力调用必须走 `invokeCapability`
- 违反 → 编译报错 + `--trace-app` 定位

详见 `proteus-compiler-plan`。
