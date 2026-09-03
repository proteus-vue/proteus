---
title: 原生能力
order: 5
---

# 原生能力即语义（G-28：99% 零原生代码）

## 业务调用语义，后端提供实现

传统跨端框架要求开发者自己封装原生插件：写 Swift/Kotlin 桥接 + 三端各一份 + 持续维护。Proteus 把渲染后端的 SPI 方法论泛化到**一切原生能力**：

```ts
const native = useNative()
const { text } = await native.scanQR()   // ← 完了，iOS/Android/鸿蒙全端可用
```

## 帕累托分层（99% 覆盖）

| 层 | 内容 | 覆盖 | 开发者写原生？ |
|----|------|------|---------------|
| L1 内置 | Top 30 能力（相机/定位/扫码/分享/通知/存储/蓝牙/NFC/生物识别…） | 80% | ❌ 零 |
| L2 官方 Backend | 平台 SDK 直映射（独立包按需安装） | +18% | ❌ 零 |
| L3 社区包 | 生态贡献，签名审计 | +1.9% | ⚠️ 社区写 |
| L4 自定义 | 仅长尾 | 0.1% | ✅ 兜底 |

## Capability Hook（已落地 50 个）

```ts
useCamera() / useLocation() / usePayment() / useBiometric()
useBluetooth() / useNFC() / useFileSystem() / useWebSocket()
// …50 个，双端真实实现；缺桥诚实降级（CapError，非抛同步异常）
```

## 权限声明自动化

Compiler 扫描 `app.config.ts` 的 `capabilities` → **自动生成** iOS `Info.plist` / Android `AndroidManifest.xml` / 鸿蒙 `module.json5` 权限声明——杜绝运行时才发现漏配权限。

```bash
proteus capabilities:manifest --platform ios
```

> G-28 NativeBackend SPI 为规划已入库（native-backend-1-plan），Capability Hook 50 个已落地（G-32 B3）。
