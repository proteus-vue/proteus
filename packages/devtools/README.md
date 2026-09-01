# @proteus-vue/devtools

Proteus DevTools 面板（devtools-plan **B3-M7 UI 层**）——把 TraceBus 事件流渲染成可交互调试界面。**浏览器端开发工具**，不随业务产物发布；数据层消费 `@proteus-vue/devtools-runtime`（六源 → TraceBus → 五视图）。

## 导出

| API | 说明 |
|-----|------|
| `createDevtoolsPanel(root, { source, onTimeTravel? })` | **面板装配**：tab 布局（timeline/flamegraph/state/route/errors）+ 数据层收集器 + 五视图渲染（16ms 渲染节流）；`show(view)` 切视图 / `destroy()` 清理 |
| `createDevtoolsWsSource(url, createSocket?)` | **WS 数据源**：连接 dev server → `Proteus.enable`（CDP 协议，对接 `@proteus-vue/hmr/cdp` 桥）→ `Proteus.event` 重组 TraceEvent 分发；断线 1s 重连 |
| `createTraceBusSource(bus)` | **TraceBus 直连源**：进程内 TraceBus 事件 → DevtoolsSource（Web 端运行时接入用） |
| `installProteusTimeline(api, { source })` | **★接入 Vue 官方 DevTools**：注册 `proteus` Timeline layer，把 Proteus 事件流推为 Vue DevTools Timeline 事件（按 traceId 分组） |
| `renderTimeline` / `renderFlamegraph` / `renderState` / `renderRoute` / `renderErrors` | 五视图**纯渲染函数**（data → DOM，jsdom 可单测） |

## 视图

| 视图 | 渲染内容 |
|------|---------|
| **timeline** | 按 source 泳道分组 + span 线段（宽度 ∝ 耗时 + 相对定位）+ pending（橙）/竖线（蓝） |
| **flamegraph** | 按 depth 分行的堆叠块（宽度 ∝ durationMs）+ inclusive/exclusive 标注 +「开始/停止录制」按钮 |
| **state** | store 列表 + JSON 预览 + 时间旅行滑块（`onTimeTravel` 命令下发，业务侧适配器接入） |
| **route** | 导航链（from → to + 耗时 + traceId）+ 守卫徽章（next 绿 / redirect 橙 / cancel·error 红） |
| **errors** | 根因卡片（attribution ⚑ 高亮 + causedBy 调用链 + 影响范围 chips + 复现脚本步骤） |

## ★接入 Vue 官方 DevTools（Web 端）

Proteus 的 **Web 端即标准 Vue 应用**——浏览器装 [Vue DevTools 扩展](https://devtools.vuejs.org) 后：

| 能力 | 提供方 | 说明 |
|------|--------|------|
| 组件树 / Pinia 状态 / Vue 性能 | **Vue DevTools 原生** | 零代码——Web 端直接可见 |
| 编译/路由/API/生命周期事件 | **Proteus Timeline layer** | 经 `@vue/devtools-api` 推入 Vue DevTools **Timeline** 面板 |
| MP 端 / 编译管线 / HMR / 火焰图 / 根因 | **Proteus 独立面板**（本包） | Vue DevTools 看不到的部分 |

```ts
// 应用侧接入（examples/main.ts 已示范）
import { setupDevtoolsPlugin } from '@vue/devtools-api'
import { createTraceBusSource, installProteusTimeline } from '@proteus-vue/devtools'

setupDevtoolsPlugin({ id: 'proteus', label: 'Proteus', app }, (devtoolsApi) => {
  installProteusTimeline(devtoolsApi, { source: createTraceBusSource(traceBus) })
})
```

**安全降级**：`setupDevtoolsPlugin` 在无扩展/无 hook 时不执行回调（devtools-kit 8.x 机制）——生产零开销（实测无扩展时应用零副作用）。

## 使用（独立面板）

```html
<script src="@proteus-vue/devtools/panel"></script> <!-- IIFE bundle：file:// 双击可直接打开 -->
<script>
  const source = ProteusDevtools.createDevtoolsWsSource('ws://127.0.0.1:5174/')
  ProteusDevtools.createDevtoolsPanel(document.getElementById('root'), { source })
</script>
```

本地直接双击打开 `node_modules/@proteus-vue/devtools/panel.html`（`?ws=ws://127.0.0.1:<port>` 覆盖连接地址；需先起 dev server）。

## 设计约束（对齐 plan 铁律）

- **铁律 1**：UI 只消费事件流（TraceBus 唯一入口），不直接碰运行时
- 面板侧 state 视图为**只读展示**（跨进程无法 writeState）；时间旅行命令经 `onTimeTravel` 回调下发
- route 视图用轻量适配（router nav 事件 → NavRecord，无需依赖 Router 包）
