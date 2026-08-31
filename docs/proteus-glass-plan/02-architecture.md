# 02 架构与统一 API 设计

## 分层模型

```
L3 系统级   : iOS UIGlassEffect + 鸿蒙 fractal     → App 原生端 + 高版本
L2 高级质感  : noise / 高光边 / 动态形变           → 尽力达，低端降级
L1 基础玻璃  : blur + tint + radius + border       → 三端必达 ✅
```

**承诺**：L1 三端都能稳定实现，统一 API；L3 只有 App 原生端解锁。

## 统一入口：`<pg-glass>`

```vue
<pg-glass
  preset="navigationBar"
  intensity="regular"
  :tint="{ color: 'rgba(255,255,255,0.15)', style: 'light' }"
  :radius="16"
  :border="true"
  :noise="0.05"
>
  <slot/>
</pg-glass>
```

同一个 `regular` preset，各端自动映射：

| 端 | L1 映射 | L2/L3 提升 |
|----|--------|-----------|
| iOS | `UIVisualEffectView(.regular)` | iOS 26+ → `UIGlassEffect(.regular)` |
| 鸿蒙 | `blur(20)` | NEXT → fractal 材质 |
| Android | `RenderEffect` blur(20) | — |
| Web | `backdrop-filter: blur(20px)` | CSS noise + 高光边 |
| Skyline | `backdrop-filter: blur(20px)` | worklet 动态形变 |

**业务层零感知平台差异。**

## Props 规范

```ts
interface GlassProps {
  preset?: 'navigationBar' | 'modal' | 'card' | 'tabBar' | 'floating' | 'custom'
  intensity?: 'none' | 'thin' | 'regular' | 'thick' | 'ultra' | number
  tint?: { color: string; style?: 'light' | 'dark' | 'vibrant' }
  radius?: number
  border?: boolean | { width: number; color: string }
  noise?: number          // 0-1，噪点强度（L2）
  interactive?: boolean   // 是否响应滚动/手势形变（L2）
  fallback?: 'solid' | 'flat'   // 降级策略
}
```

## 内部组件拆分（对齐 Component plan `p-*`）

- `pg-glass`         — 根容器（条件编译分派）
- `pg-glass-noise`   — 噪点层（L2）
- `pg-glass-highlight` — 高光边（L2）
- `pg-glass-shape`   — 动态形变层（L2，仅原生/Skyline worklet）

## 映射决议流程

```
props → Platform.detect() → CapabilityRegistry.lookup('glass')
      → 选最高可达层级（L3? L2? L1?）
      → 渲染对应实现
      → 降级监听（性能/内存）→ 必要时降 L1/solid
```

## 铁律

1. L1 必达：blur + tint + radius + border 所有端一致
2. 单入口：业务只写 `<pg-glass>`，禁止平台分支散落页面
3. 降级不崩溃：能力不足时降级为实色，禁止白屏/黑块
4. 无障碍优先：`prefers-reduced-transparency` 自动关闭玻璃
5. 系统级仅在原生端：L3 只对 iOS/鸿蒙/Android

## Compiler 集成点

- IR 新增 `GlassNode`（继承 `ElementNode`）
- `--trace-glass`：输出 props → 端 → 映射实现的完整链路
- 产物快照含 `pg-glass` 各端映射结果

详见 `10-compiler-integration.md`。
