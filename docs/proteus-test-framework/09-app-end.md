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

```ts
// test-runner/drivers/app-driver.ts（待实现）
export interface AppDriver {
  launch(): Promise<void>
  tap(selector: string): Promise<void>
  screenshot(): Promise<Buffer>
  // ...对齐 automator 的最小 API 表面
}
```

设计目标：**让 App E2E 用例与 Web / 小程序尽量共用同一份描述**（BDD / 步骤化），仅驱动层替换。

## TODO（启动 M8 时补齐）
- [ ] 选型评估：Detox / Appium / 云测
- [ ] App Driver 对接 automator 风格 API
- [ ] 真机矩阵（iOS / Android / 厂商）
- [ ] CI 接入（Mac runner 同节点或独立）

---
