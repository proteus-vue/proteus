# @proteus-vue/devtools

Proteus DevTools（devtools-plan **UI 层**）——把 TraceBus 事件流渲染成可交互调试面板。**浏览器端开发工具，不随业务产物发布**；数据层消费 `@proteus-vue/devtools-runtime`（六源 → TraceBus → **九视图**）。

## 导出

### 面板装配 / 数据源

| API | 说明 |
|-----|------|
| `createDevtoolsPanel(root, options)` | **面板装配**：tab 布局（九视图）+ 数据层收集器 + 渲染节流；`show(view)` 切视图 / `exportSnapshot()/importSnapshot()` 快照 / `destroy()` 清理 |
| `createDevtoolsWsSource(url, createSocket?)` | **WS 数据源**：连 relay（CDP 协议 `Proteus.enable/event/appInfo/deviceInfo`）→ 事件流重组 + 元数据缓存 + `sendCommand()` 下发；断线 1s 重连 + enable 未确认 2s 重发 |
| `createTraceBusSource(bus)` | **TraceBus 直连源**：进程内事件流 → DevtoolsSource（Web 端接入用） |
| `createTraceBusWsBridge(bus, options)` | **远程查看桥**：应用侧 TraceBus → WS（`/proteus-source`）上行 → 电脑端面板下行；处理 enable 回放 / appInfo / deviceInfo / restoreStores |

### 一键接入（推荐）

| API | 说明 |
|-----|------|
| `installProteusDevtools(app, options)` | **★一键接入**：TraceBus 单例 + Vue DevTools 插件（Timeline/Inspectors）+ store/组件追踪 + 本地面板浮动挂载（◈ 按钮，可拖拽记忆位置）+ 远程桥 + HMR 事件源，一行完成全部接线 |
| `installProteusTimeline(api, options)` | 接入 Vue 官方 DevTools：注册 `proteus` Timeline layer（事件流推为 Vue DevTools Timeline） |
| `installProteusInspectors(api, options)` | 接入 Vue 官方 DevTools：**Router / App Config / Style Safety** 三个自定义 Inspector |
| `PROTEUS_DEVTOOLS_PLUGIN_DESCRIPTOR` | Vue DevTools 插件描述符（logo 占位 + 三 Inspector 图标：⚙️ settings / 🛡 gpp-good / 🛣 route） |
| `installComponentTrace(app, bus)` / `buildDomTree(el)` | 组件树追踪（mount/unmount 事件 + 元素 registry）+ DOM 树构建（组件视图详情/页面高亮） |

### 视图渲染（纯函数 data → DOM，jsdom 可单测）

`renderTimeline` / `renderFlamegraph` / `renderState` / `renderRoute` / `renderErrors` / `renderComponents` / `renderPages` / `renderGraph` / `renderDevice` + 配套类型。

### 插件 / 工具

| API | 说明 |
|-----|------|
| `createPluginRegistry / createMemoryStorage / createCommandRegistry / resolveActivationOrder` | **M9 插件宿主**：第三方视图/事件订阅/命令/持久化（激活拓扑序、循环依赖报错、崩溃隔离） |
| `createNetworkPlugin` | 内置插件：API 瀑布增强 + 请求重放 |
| `serializeStoreSnapshot / parseStoreSnapshot` | 状态快照导出/导入（JSON 校验重建） |
| `createTooltipLayer / bindTooltip / attachTip / resolveTipData` | hover 浮层 |
| `detectRuntimePlatform / detectBrowserVersion / detectMpLibVersion` | 设备信息采集纯函数（真实平台/基础库探测） |

## 九视图

| 视图 | 渲染内容 |
|------|---------|
| **timeline** | 按 source 泳道分组 + span 线段 + pending 标注 + wheel 缩放/拖拽平移/双击重置 + 虚拟滚动 |
| **flamegraph** | **经典嵌套堆叠火焰图**（子块相对父定位 + source 八色）+ 合成「录制会话」根 + 点击聚焦 zoom + 面包屑 + 对比模式（±10% 回归红/优化绿） |
| **state** | store 选择器 + inspector 树 + actions/patches 时间线 + 时间旅行滑块 + **★值编辑双向调试**（点值改 → `$patch` 写回真实状态） |
| **route** | 导航链 + 守卫徽章（next 绿 / redirect 橙 / cancel·error 红）+ 耗时 |
| **errors** | 根因卡片（attribution ⚑ + causedBy 链 + 影响范围 + 复现步骤） |
| **components** | 组件树（props/state 快照 + count）+ 选中 → 页面元素高亮（scrollIntoView + 描边）+ DOM 树详情 |
| **pages** | 当前页面栈 + 主包/分包路由清单（Proteus.appInfo 数据源） |
| **graph** | 页面依赖图（appInfo 路由表 → 父子关系） |
| **device** | ★M8 环境概览卡（平台/基础库/屏幕/JS 堆）+ 能力表（✅/❌ + required/fallback/worklet）+ 内存曲线（每秒采样） |

## ★一键接入（Web 端，examples/main.ts 已示范）

```ts
import { installProteusDevtools } from '@proteus-vue/devtools'
import { getProteusTraceBus } from '@proteus-vue/devtools-runtime'

const traceBus = getProteusTraceBus()
if (import.meta.env.DEV || __PROTEUS_DEBUG__) traceBus.setEnabled(true) // 门控：生产零开销

installProteusDevtools(app, {
  pinia,                       // → store 追踪 + 时间旅行 + 值编辑
  getConfig, setConfig,        // → Vue DevTools App Config Inspector
  styleGuard,                  // → Vue DevTools Style Safety Inspector
  pages: { routes },           // → pages/依赖图面板
  remote: true,                // → 远程查看桥（移动端/真机：电脑开面板看）
  hmr: import.meta.hot,        // → HMR 事件（vite:update/full-reload/error → timeline）
})
```

面板浮动按钮 **◈**（可拖拽、位置记忆）；remote 开启后电脑浏览器开 dev server 打印的 `http://localhost:5173/proteus-devtools` 查看。

## ★后端开放 API（第三方接入自己的面板）

`DevtoolsSource` 是统一数据源接口（**官方面板自身就是它的消费者**，对标 `@vue/devtools-api` 的 client 角色）：

```ts
const source = createDevtoolsWsSource('ws://host/proteus-panel') // 远程；进程内用 createTraceBusSource(bus)
source.onEvent((e) => myTimeline.push(e))   // 自绘 UI，只用数据
console.log(source.appInfo?.(), source.deviceInfo?.())           // 元数据查询
source.sendCommand?.('Proteus.restoreStores', { stores })        // 命令下发（双向调试）
```

**零包依赖**：协议是明文 JSON WebSocket（`Proteus.enable/event/appInfo/deviceInfo/restoreStores`，relay 端点 `/proteus-source` + `/proteus-panel`）——第三方仅需 WebSocket + 几行 JSON。完整规范见 `docs/proteus-devtools-plan/15-open-api.md`，零依赖实现见 `examples/pages/devtools-open-api-demo.vue`。

## 插件扩展（M9）

第三方在官方面板里加自定义视图/泳道/命令（`DevToolsPlugin` + `PluginContext`：bus/panel/commands/storage）：

```ts
import { createDevtoolsPanel, createPluginRegistry } from '@proteus-vue/devtools'
// options.plugins: [{ name, version, setup(ctx) { ctx.panel.addView('my', '我的视图', (el) => {...}) } }]
```

## 使用（独立面板）

```html
<script src="@proteus-vue/devtools/panel"></script> <!-- IIFE bundle：file:// 双击可直接打开 -->
<script>
  const source = ProteusDevtools.createDevtoolsWsSource('ws://127.0.0.1:5174/')
  ProteusDevtools.createDevtoolsPanel(document.getElementById('root'), { source })
</script>
```

dev 模式更推荐浏览器直接开 `http://localhost:5173/proteus-devtools`（devtoolsRelayPlugin 提供页面端点 + 注入默认 WS）。

## 设计约束（对齐 plan 铁律）

- **铁律 1**：UI 只消费事件流（TraceBus 唯一入口），不直接碰运行时
- 双向写回经回调/命令（`onApplyState` / `sendCommand('Proteus.restoreStores')`）——本地 `$patch` + 远程 relay 双通道
- 事件 payload 全程脱敏（password/token/authorization/idcard/phone）；生产构建零端点零开销
