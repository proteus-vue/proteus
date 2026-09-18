# @proteus-vue/glass

> **G-07 液态玻璃（Liquid Glass）横切能力** —— 用统一声明式 API，在各端映射到该端所能达到的最强玻璃实现。
> 规格：`docs/proteus-glass-plan/`（02 架构 / 03 能力矩阵 / 07 Web·Skyline / 08 降级 / 09 预设 / 11 审计）。

## 一句话

**`<pg-glass>` 是业务唯一写入口；本包是它的纯逻辑内核（preset 表 + props 归一 + 三级降级决策 + 能力矩阵），零依赖。**

不存在「一套代码五端像素级相同」——框架承诺 **L1 基础玻璃（blur + tint + radius + border）全端必达**，L2 质感尽力提升，L3 系统材质仅原生端（iOS 26+ / 鸿蒙 NEXT）解锁。

## 分层

| 层级 | 内容 | 端 |
|------|------|----|
| L3 系统级 | iOS `UIGlassEffect` / 鸿蒙 fractal | App 原生 + 高版本 |
| L2 高级质感 | noise / 高光边 / 动态形变 | Web·Skyline 可（CSS） |
| L1 基础玻璃 | blur + tint + radius + border | **三端必达 ✅** |

## 用法

```vue
<pg-glass preset="navigationBar">…</pg-glass>
<pg-glass preset="card" :noise="0.03">…</pg-glass>
<pg-glass preset="custom" :radius="32" :intensity="1.2" fallback="flat">…</pg-glass>
```

纯逻辑内核（测试 / 工具 / 其他端 Backend 直接消费）：

```ts
import { resolveGlass, resolveGlassLevel, glassStyleFor, glassClassList } from '@proteus-vue/glass'

const resolved = resolveGlass({ preset: 'card', radius: 20 })
const level = resolveGlassLevel({ platform: 'web', backdropFilter: true }) // 'l2'
const style = glassStyleFor(resolved, level) // { backdropFilter: 'blur(10px)', background: 'rgba(255,255,255,0.08)', … }
```

## 导出

- `GLASS_PRESETS` / `GLASS_PRESET_NAMES` / `GLASS_INTENSITY_SCALE` — 七内置预设 + 强度缩放（唯一事实源）
- `defineGlassPreset` / `getGlassPreset` / `hasGlassPreset` — 预设扩展（业务品牌玻璃）
- `resolveGlass(props)` — props → `ResolvedGlass`（preset 为底 + 显式覆盖）
- `resolveGlassLevel(env)` — 三级降级决策 → `'l3' | 'l2' | 'l1' | 'solid' | 'flat'`
- `glassStyleFor` / `glassClassList` / `showsDecoration` — 渲染层产物（`:style` / class）
- `GLASS_CAPABILITY` / `glassCeilingFor` / `GLASS_DEGRADE_CHAIN` — 平台能力矩阵 + 降级链

## 降级（不崩溃、不白屏）

`resolveGlassLevel` 顺序：强制/无障碍(`prefers-reduced-transparency`)/无 `backdrop-filter` → **solid**；低端设备 → **l1**；原生 + 系统材质 → **l3**；其余 → **l2**。能力不足一律降级实色，绝不渲染黑块。

## 铁律（GLS001-006）

1. 单入口：业务只写 `<pg-glass>`，禁止裸 `backdrop-filter`（GLS001，CI error）
2. L1 必达：blur + tint + radius + border 全端一致
3. 降级不崩溃：能力不足 → 实色，禁止白屏/黑块
4. 无障碍优先：`prefers-reduced-transparency` 自动关闭玻璃
5. 系统级仅原生端：L3 只对 iOS/鸿蒙/Android
6. 嵌套 ≤ 2 层、单页玻璃节点 ≤ 10（性能预算，审计 warn/error）

## 诚实边界

- L2/L3 视觉一致性依赖各端系统能力，不保证像素级相同（系统材质差异不可消除）
- 国内 ROM 私有玻璃特效不可达（系统特权）
- L3 需真机验证（本包只做能力声明与降级决策）
