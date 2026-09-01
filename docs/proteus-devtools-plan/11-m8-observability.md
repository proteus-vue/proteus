# M8 — 可观测性

> 把 DevTools 的 trace 能力与全局 Observability Layer（Pinia/Router/API 共用 traceId）打通，并支持生产环境远程上报与 CI 复现。

## M8.1 统一 traceId 协议

- traceId 生成规则：`${source}-${timestamp}-${random}`（对齐 API 层 `traceId` header）
- 跨层传播：Lifecycle 启动 → Router 导航 → API 请求 → Pinia action 共享同一 traceId
- Span 关系：`parentSpanId` 构建调用树，跨源也成立（同源 parentSpanId 即可）

## M8.2 导出 / 导入

```ts
devtools.exportSession()  // → SessionBundle（Blob 下载 proteus-session.json）
devtools.importSession(bundle)
```

`SessionBundle` = **可重放事件日志**（TraceEvent[]：时间轴 + 路由 + 根因 + store + 组件聚合的唯一真相源）+ 设备信息 + store 快照——导入 = 清空聚合 → 重放事件全视图重建 → `onApplyState` 恢复最新状态。✅ 已落地（panel `exportSession()/importSession()` + state 工具栏按钮 + `session-io.ts` 纯逻辑）。

## M8.3 远程上报（灰度）⬜ 延后（收尾说明见文末）

- 仅内部 / 灰度用户开启：`config.devtools.remote = { endpoint, sampleRate }`
- 上报内容脱敏（铁律 #4），仅 error 事件 + 最小上下文（不传完整 state）
- 传输：Web `navigator.sendBeacon`，小程序 `wx.request`，App 原生上报

## M8.4 CI 复现 ⬜ 延后（随 test-framework-plan 推进）

- 测试失败自动导出 `SessionBundle`，上传到 CI artifact
- `proteus test --replay=<bundle>` 在新环境重放，定位 flaky 测试
- 对齐 Testing plan 的"失败录制"

## M8.5 监控面板 ⬜ 延后（中台消费端，M14 覆盖）

- 聚合指标：P50/P95 启动耗时、错误率、capability 不支持率
- 按平台 / 基础库版本 / 渠道拆分
- 告警：错误率 > 阈值 → 触发 issue

## ★收尾说明（M11 核心闭环）

M8.2（SessionBundle 导出/导入）已落地；**M8.3 / M8.4 / M8.5 明确延后不做**：

| 项 | 延后理由 |
|----|---------|
| M8.3 远程上报 | 本包定位**浏览器端开发工具（生产零端点零开销）**——生产遥测与定位冲突；需要生产采集请用中台上行（M14 SessionBundle）+ 自有后端 |
| M8.4 CI 复现 | 与 test-framework-plan（失败录制/重放）交集——待其推进时以 `proteus test --replay=<bundle>` 接入（session 格式已就绪，`parseSession` 可复用） |
| M8.5 监控面板 | 聚合/告警本质是**中台消费端**——由 M14 的 SessionBundle 中台上行后在中台实现 |

## 依赖

- Types（trace 事件类型）✅
- CLI（`proteus audit devtools-budget`）✅（M10 已接入）
- 各运行时层的 trace 接入（M2）✅

## 验收

- 一次会话导出 → 另一环境导入，时间轴 + 快照 + 路由完全还原 ✅（M8.2 落地，devtools-panel.test 会话用例）
- 远程上报包体 < 5KB/次（error only），不含敏感字段 ⬜（延后）
- CI replay 能稳定复现构造的 flaky 场景 ⬜（延后，随 test-framework-plan）
