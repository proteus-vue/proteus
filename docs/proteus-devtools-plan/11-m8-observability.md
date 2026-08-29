# M8 — 可观测性

> 把 DevTools 的 trace 能力与全局 Observability Layer（Pinia/Router/API 共用 traceId）打通，并支持生产环境远程上报与 CI 复现。

## M8.1 统一 traceId 协议

- traceId 生成规则：`${source}-${timestamp}-${random}`（对齐 API 层 `traceId` header）
- 跨层传播：Lifecycle 启动 → Router 导航 → API 请求 → Pinia action 共享同一 traceId
- Span 关系：`parentSpanId` 构建调用树，跨源也成立（同源 parentSpanId 即可）

## M8.2 导出 / 导入

```ts
devtools.exportSession()  // → SessionBundle
devtools.importSession(bundle)
```

`SessionBundle` 包含：时间轴 span + 状态快照 + 路由记录 + 错误信息 + 设备信息，可完整复现一次 bug。

## M8.3 远程上报（灰度）

- 仅内部 / 灰度用户开启：`config.devtools.remote = { endpoint, sampleRate }`
- 上报内容脱敏（铁律 #4），仅 error 事件 + 最小上下文（不传完整 state）
- 传输：Web `navigator.sendBeacon`，小程序 `wx.request`，App 原生上报

## M8.4 CI 复现

- 测试失败自动导出 `SessionBundle`，上传到 CI artifact
- `proteus test --replay=<bundle>` 在新环境重放，定位 flaky 测试
- 对齐 Testing plan 的"失败录制"

## M8.5 监控面板

- 聚合指标：P50/P95 启动耗时、错误率、capability 不支持率
- 按平台 / 基础库版本 / 渠道拆分
- 告警：错误率 > 阈值 → 触发 issue

## 依赖

- Types（trace 事件类型）
- CLI（`proteus audit devtools-budget`）
- 各运行时层的 trace 接入（M2）

## 验收

- 一次会话导出 → 另一环境导入，时间轴 + 快照 + 路由完全还原
- 远程上报包体 < 5KB/次（error only），不含敏感字段
- CI replay 能稳定复现构造的 flaky 场景
