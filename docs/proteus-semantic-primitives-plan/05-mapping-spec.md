# 映射规范与编译期机制（Mapping Spec）

> 定义 `p-*` 语义 → 五端原生实现的统一映射流程（G-21 Compiler Plugin 实现）。

## 映射三要素

每个语义原语在 IR 中由三部分描述：
```
1. CapabilityKey   — 能力标识（如 "notify" / "permission.photo"）
2. PropsSchema     — 属性类型（Zod，编译期校验）
3. PlatformImpl    — 各端实现映射
```

## Compiler Plugin 流程

```
SFC <template>
   ↓ parse（G-21）
   ↓ buildIR：识别 p-* → SemanticNode
   ↓ transform：校验 PropsSchema + 权限前置
   ↓ codegen：按 platform 分发 PlatformImpl
   ↓ emit：生成各端原生调用 + 权限声明
```

## 平台实现映射字典（节选）

```ts
// Compiler Plugin 注册示例
registerPrimitive('p-notify', {
  capability: 'notify',
  props: NotifyPropsSchema,  // Zod
  impl: {
    ios: 'UNUserNotificationCenter → addRequest',
    android: 'NotificationManager → notify',
    harmony: 'notificationManager → publish',
    web: 'Notification API',
    skyline: 'wx.requestSubscribeMessage',  // 小程序适配
  },
})
```

## 权限清单自动生成

```
p-permission="photo" 出现 →
  iOS:     NSCameraUsageDescription
  Android: android.permission.CAMERA
  Harmony: ohos.permission.CAMERA
```
Compiler 扫描 IR → 输出 `permissions.generated.json` → 各端构建脚本消费。

## 降级策略

无系统原生能力时（如 Web 端 `p-badge`）：
```
L1 精确映射 → 有则映射
L2 近似实现 → 用 Notification API 模拟
L3 优雅降级 → no-op + dev warning
L4 编译期报错 → 明确不支持（仅特定端）
```

**对齐 Style Safety (G-16) 与 Glass (G-07)：宁可降级也不崩溃。**

## 可观测性

每个原语调用经 TraceBus（G-19 DevTools）上报：
- 实际映射的平台实现
- 降级发生情况
- 权限被拒统计

→ **DevTools 可视化"我的 p-* 在各端到底调了什么原生 API"。**
