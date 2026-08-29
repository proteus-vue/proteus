# M8 — 设备面板与 Skyline 能力

## 目标

展示运行环境信息，尤其是 Skyline / glass-easel 能力探测结果，辅助"为什么这个能力在当前端不可用"。

## 信息分类

### 环境
- platform：`web` / `mp-wechat` / `app-ios` / `app-android`
- userAgent / 微信版本 / 基础库版本
- 屏幕：dpr / 宽高 / 安全区

### Skyline 能力（核心）
对接 Platform capability registry，展示每个能力状态：

```ts
interface CapabilityInfo {
  name: string
  supported: boolean
  level?: 'full' | 'partial'
  fallback?: string
  detectedAt: number
}
```

面板用 ✅ / ⚠️ / ❌ 三态 + "为什么不支持"（版本 / 配置 / 平台缺失）。

### 资源用量（M7）
- JS 堆内存（`performance.memory`，Chrome）/ 小程序 `wx.getPerformance`
- 存储占用（Storage adapter 已用 / 配额）
- 包体 / 分包已加载大小（Compiler chunk 信息）

## UI

- **概览卡片**：平台 + 基础库 + Skyline 状态（开/关）+ 内存条
- **能力表格**：按域分组（navigation / media / payment / ui ...）
- **资源曲线**：内存随时间变化（录制期间）

## 真机连接

- Web：默认 `localhost:7092` WebSocket
- 小程序：通过 CLI `proteus dev --inspect` 起桥接，复用 `wx.getSystemInfo` 等
- App：Native 侧通过 JSI 上报

## 依赖

依赖 Platform plan 的 `CapabilityRegistry.detect()` 与 Compiler chunk manifest。

## 验收

- Skyline 环境下列出 `routeType`/`appBar`/`worklet` 等能力及状态
- 内存曲线在录制期间持续更新，数值与 `performance.memory` 一致（误差 < 5%）
- 能力表格与运行时 `isSupported()` 返回值一一对应
