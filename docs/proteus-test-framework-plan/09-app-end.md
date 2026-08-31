# App 端（占位）

> ⚠️ **本章为占位章节**。App 端（uni-app / 原生渲染）自动化方案**未定**，本节仅预留驱动接口，不实现。

## 背景
框架支持三端：Web / 小程序 / App（uni-app 编译到 iOS / Android + 原生渲染）。
App 端测试当前无官方统一方案，需评估：

| 方案 | 说明 | 状态 |
|---|---|---|
| Detox | React Native 主流，uni-app 适用性待验证 | 待调研 |
| Appium | 跨平台，重、慢 | 待调研 |
| 厂商云测 | 华为/小米等真机云测 | 待调研 |
| uni-app 官方 | 小程序自动化 SDK 为主，App 端有限 | 待调研 |

## 预留接口

App 端就是 **TestDriver 的第三实现**（决策 #205：一套能力接口多端自动化）：

```ts
// @proteus-vue/test-core/driver/app.ts（待实现，G-22 后接线）
import { createDriver } from '@proteus-vue/test-core/driver'

// 形态：createDriver({ platform: 'app', app: <Appium/Detox/云测句柄> })
// 复用能力接口：navigate · element(tap/input/longPress/text/value) · evaluate · screenshot · currentPage/systemInfo · waitFor
// 与 web/mp 的差异（原生渲染）：元素定位走原生选择器/坐标，longPress 有原生语义，截图走真机
```

设计目标：**App E2E 用例与 Web / 小程序共用同一份 TestDriver 描述**，仅驱动层替换（句柄装配）。

## TODO（启动 M8 时补齐）
- [ ] 选型评估：Detox / Appium / 云测
- [ ] `createAppDriver` 对接 TestDriver 接口（对齐 automator 风格能力域）
- [ ] 真机矩阵（iOS / Android / 厂商）
- [ ] CI 接入（Mac runner 同节点或独立）

---
