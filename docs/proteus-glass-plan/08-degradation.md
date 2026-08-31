# 08 降级策略

> 三级降级：设备级 → 版本级 → 性能级。**任何情况不崩溃、不白屏。**

## 设备级降级

低端/旧设备直接 L1 实色：

```ts
// packages/platform/src/glass/degrade.ts
export function resolveGlassLevel(platform: Platform, device: DeviceInfo): GlassLevel {
  if (device.tier === 'low') return 'solid'           // 低端机 → 实色
  if (!capability.support(platform, 'glass')) return 'solid'
  if (capability.support(platform, 'glass', 'l3') && device.tier === 'high')
    return 'l3'
  return 'l1'
}
```

## 版本级降级

| 平台 | L3 | L1 | solid |
|------|----|----|-------|
| iOS | 26+ | 13-25 | <13 |
| 鸿蒙 | NEXT | API 9-12 | <API 9 |
| Android | — | 31+ | <31 |
| Web | — | 支持 backdrop-filter | 不支持 |

## 性能级降级（运行时）

监控帧率，动态降级：

```ts
// 鸿蒙 / Android / Skyline
Choreographer / onFrame => {
  if (fps < 55 && currentLevel === 'l3') currentLevel = 'l1'
  if (fps < 45 && currentLevel === 'l1') currentLevel = 'solid'
}
```

降级过渡需平滑（blur 半径渐变），避免突兀跳变。

## fallback Prop

```vue
<pg-glass :fallback="'solid'"/>   <!-- 明确指定降级为实色 -->
<pg-glass :fallback="'flat'"/>    <!-- 完全无背景（仅边框） -->
```

默认 `solid`。

## 降级行为矩阵

| 场景 | 行为 |
|------|------|
| backdrop-filter 不支持 | 半透明实色背景 |
| 系统玻璃不可用 | blur + tint CSS 模拟 |
| 内存紧张 | 关闭噪点/高光层 |
| 帧率过低 | blur 半径递减 → solid |
| 无障碍减弱动效 | 关闭动态形变 + 透明 |

## 测试要求

- 每个 preset × 每个降级等级 → 快照测试
- 模拟低端机：`?glass=force-solid` URL 参数强制降级
- 无障碍：`prefers-reduced-transparency: reduce` DevTools 模拟验证

对齐 Test Framework plan（L1 mock + E2E）。
