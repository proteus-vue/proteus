# @proteus-vue/devtools

Proteus DevTools 面板（devtools-plan **B3-M7 UI 层**）——把 TraceBus 事件流渲染成可交互调试界面。**浏览器端开发工具**，不随业务产物发布；数据层消费 `@proteus-vue/devtools-runtime`（六源 → TraceBus → 五视图）。

## 导出

| API | 说明 |
|-----|------|
| `createDevtoolsPanel(root, { source, onTimeTravel? })` | **面板装配**：tab 布局（timeline/flamegraph/state/route/errors）+ 数据层收集器 + 五视图渲染（16ms 渲染节流）；`show(view)` 切视图 / `destroy()` 清理 |
| `createDevtoolsWsSource(url, createSocket?)` | **WS 数据源**：连接 dev server → `Proteus.enable`（CDP 协议，对接 `@proteus-vue/hmr/cdp` 桥）→ `Proteus.event` 重组 TraceEvent 分发；断线 1s 重连 |
| `renderTimeline` / `renderFlamegraph` / `renderState` / `renderRoute` / `renderErrors` | 五视图**纯渲染函数**（data → DOM，jsdom 可单测） |

## 视图

| 视图 | 渲染内容 |
|------|---------|
| **timeline** | 按 source 泳道分组 + span 线段（宽度 ∝ 耗时 + 相对定位）+ pending（橙）/竖线（蓝） |
| **flamegraph** | 按 depth 分行的堆叠块（宽度 ∝ durationMs）+ inclusive/exclusive 标注 +「开始/停止录制」按钮 |
| **state** | store 列表 + JSON 预览 + 时间旅行滑块（`onTimeTravel` 命令下发，业务侧适配器接入） |
| **route** | 导航链（from → to + 耗时 + traceId）+ 守卫徽章（next 绿 / redirect 橙 / cancel·error 红） |
| **errors** | 根因卡片（attribution ⚑ 高亮 + causedBy 调用链 + 影响范围 chips + 复现脚本步骤） |

## 使用

```html
<script type="module">
  import { createDevtoolsPanel, createDevtoolsWsSource } from '@proteus-vue/devtools'
  const source = createDevtoolsWsSource('ws://127.0.0.1:5174/')
  createDevtoolsPanel(document.getElementById('root'), { source })
</script>
```

本地直接打开 `node_modules/@proteus-vue/devtools/panel.html`（`?ws=ws://127.0.0.1:<port>` 覆盖连接地址）。

## 设计约束（对齐 plan 铁律）

- **铁律 1**：UI 只消费事件流（TraceBus 唯一入口），不直接碰运行时
- 面板侧 state 视图为**只读展示**（跨进程无法 writeState）；时间旅行命令经 `onTimeTravel` 回调下发
- route 视图用轻量适配（router nav 事件 → NavRecord，无需依赖 Router 包）
