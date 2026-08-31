# 11 降级策略与 Bridge 兜底

## 1. 三层降级

```
L3 系统级（JSI + Native Glass）   ← 首选，高版本
         ↓ 不满足
L2 高级质感（Shader/噪声模拟）      ← 中端
         ↓ 不满足
L1 基础玻璃（backdrop-filter）      ← 必达，低端
```

## 2. JSI 不可用时的降级

极低版本或特殊环境 JSI 不可用时，降级为 **JSON Bridge**（对齐 React Native 旧架构）：

```ts
// 统一接口
interface NativeBridge {
  createView(type: string): number
  updateProp(viewId: number, key: string, value: unknown): void
  // ...
}

// 实现选择
const bridge: NativeBridge =
  jsiAvailable() ? new JSIBridge() : new JSONBridge()
```

| 维度 | JSI Bridge | JSON Bridge |
|------|-----------|-------------|
| 通信 | 同步直调 | 异步序列化 |
| 延迟 | < 1ms | 5-20ms |
| 适用 | 主流设备 | 极低版本兜底 |
| 手势 | Worklet | 受限 |

业务层**无感知**，接口一致。

## 3. 系统版本降级

| 能力 | 要求 | 不满足时 |
|------|------|---------|
| iOS Glass L3 | iOS 26+ | `UIVisualEffectView` |
| 鸿蒙 fractal | NEXT | `blur()` |
| Android RenderEffect | API 31+ | `backdrop-filter` CSS |
| JSI | 全版本 | JSON Bridge |

## 4. 能力探测

```ts
// Compiler 注入，运行时读取
const capability = {
  glass: { level: 3, available: true },
  jsi: true,
  platform: 'app',
  os: { ios: '26.0' }
}
```

组件按能力自适应：

```vue
<pg-glass :level="capability.glass.level" />
```

## 5. 明确不做（边界）

- ❌ 国内 ROM（小米/OPPO/vivo）私有玻璃 API → 系统特权，不稳定
- ❌ 跨版本像素级一致 → 只保证语义一致
- ❌ 为每个低端机单独优化 → 只保证 L1 必达

详见 `13-migration-boundary.md`。
