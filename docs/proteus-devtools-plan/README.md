# Proteus DevTools

> 把"透明编译 + 产物可审计"变成开发者能直接用的调试界面。

## 是什么

一个运行时 + 一个面板：
- **`@proteus-vue/devtools-runtime`**：TraceBus，接收六层 trace 事件
- **`@proteus-vue/devtools-panel`**：时间轴 / 快照 / 火焰图 / 根因（浏览器扩展 or 独立窗口）

## 快速接入

```ts
// main.ts（Web 端一键接入）
import { installProteusDevtools } from '@proteus-vue/devtools'
import { getProteusTraceBus } from '@proteus-vue/devtools-runtime'

const traceBus = getProteusTraceBus()
if (import.meta.env.DEV || __PROTEUS_DEBUG__) traceBus.setEnabled(true)
installProteusDevtools(app, { pinia, remote: true }) // ◈ 面板 + Vue DevTools + 远程桥
```

面板连接（独立窗口/远程）：`createDevtoolsWsSource('ws://host/proteus-panel')` + `createDevtoolsPanel(root, { source })`；或 dev 模式直接开 `http://localhost:5173/proteus-devtools`。

## 文档结构

```
00-overview.md        架构 + 铁律 + 里程碑
01-m1-trace-bus.md    TraceBus + 事件协议
02-m2-6-sources.md    六源接入
03-m3-timeline.md     时间轴 + 泳道
04-m4-state-snapshot.md 状态快照 / 时间旅行
05-m5-route-backtrack.md 路由回溯
06-m6-perf-flamegraph.md 性能火焰图
07-m7-error-rootcause.md 异常根因
08-m8-device-panel.md   设备面板 + Skyline
09-m9-plugin-extension.md 插件扩展
10-m7-super-app.md     超级应用加固
11-m8-observability.md  可观测性
12-testing-migration.md  测试 + 迁移
13-execution-batches.md  分批策略
14-landing-evaluation.md 落地评估
15-open-api.md          后端开放 API（DevtoolsSource + WS 协议）✅
16-record-replay.md     M14 操作录屏回放（已排期）
```

## 防撑爆规则（沿用全局）

- 单份 `.md` ≤ 500 行；单函数 ≤ 80 行；单批 ≤ 3 文件
- LLM 单次只喂 `00-overview + 当前模块 + 直接依赖`
- 每批 = 1 PR，可独立 review

## 进度

B1-B10 已落地（面板九视图：timeline/flamegraph/state·时间旅行·值编辑/route/errors/components/pages/graph/device + 开放 API）；**M14 操作录屏回放已排期**（16-record-replay.md，主线 M10/M11 后启用，复用 TraceBus/快照/时间旅行基础）。
