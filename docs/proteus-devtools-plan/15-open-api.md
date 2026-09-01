# M13 — DevTools 后端开放 API

> 定位：把 Proteus 的 devtools 数据**开放给第三方自己的面板/工具**——对标 `@vue/devtools-api` 的 client-server 架构：
> 我们接入 Vue DevTools 时是"消费方"（`setupDevtoolsPlugin`）；本文定义的是反过来——**我们提供 `DevtoolsSource` 统一数据源接口 + WS 开放协议，任何外部面板（不依赖 Proteus 包）都能接入应用数据**。

## 1. 架构：统一数据源接口 `DevtoolsSource`

所有数据访问统一收敛为一个接口（`packages/devtools/src/source.ts`），**官方面板自身就是这个接口的消费者**——第三方与官方完全平权：

```ts
export interface DevtoolsSource {
  /** 订阅事件流（TraceEvent），返回取消函数 */
  onEvent(cb: (e: TraceEvent) => void): () => void
  /** 连接状态（connecting/connected/closed）——面板「已连接」不依赖事件到达 */
  onStatus?(cb: (s: DevtoolsSourceStatus) => void): () => void
  /** 应用信息（路由表/页面栈：pages 依赖图数据源） */
  appInfo?(): unknown
  /** ★M8 设备信息（环境/能力表数据源） */
  deviceInfo?(): unknown
  /** 命令下发（面板 → relay → 应用侧执行，如 Proteus.restoreStores 时间旅行恢复） */
  sendCommand?(method: string, params?: Record<string, unknown>): void
  close(): void
}
```

### 两种实现（同一接口，进程内/远程）

| 实现 | 场景 | 能力 |
|------|------|------|
| `createTraceBusSource(bus)` | 应用进程内（如我们的悬浮面板） | 事件流 + 状态；无 appInfo/deviceInfo/sendCommand（进程内直连，无需命令通道） |
| `createDevtoolsWsSource(url)` | 跨进程/跨设备（远程面板） | 全量：事件流 + 状态 + appInfo/deviceInfo 查询 + sendCommand 下发 |

**业务侧最省事用法（官方推荐）**——自己的面板直接复用我们面板/源抽象：

```ts
import { createDevtoolsWsSource, createDevtoolsPanel } from '@proteus-vue/devtools'

const source = createDevtoolsWsSource('ws://myhost/proteus-panel') // 连 relay（dev 模式由 devtoolsRelayPlugin 提供）
createDevtoolsPanel(document.getElementById('panel'), { source })   // 直接用官方面板
// 或：只用 source 做自己的 UI：
source.onEvent((e) => myTimeline.push(e)) // 自绘时间线
console.log(source.appInfo?.(), source.deviceInfo?.())
source.sendCommand?.('Proteus.restoreStores', { stores: [{ id: 'player', state: { playing: false } }] })
```

**零依赖方式**（连包都不装，直接说话音协议）——见 `examples/pages/devtools-open-api-demo.vue` 完整示例。

## 2. WS 开放协议（CDP 风格，明文 JSON）

### 端点（由 `devtoolsRelayPlugin` 提供，仅 dev serve）

| 路径 | 角色 | 说明 |
|------|------|------|
| `/proteus-source` | 应用桥 | 应用侧 `createTraceBusWsBridge`（install `remote: true`）上行事件 |
| `/proteus-panel` | 面板 | 任何第三方面板连接，收事件流 + 发命令 |

### 消息格式

**上行命令（面板 → 应用）**：`{ "id": number, "method": string, "params"?: object }`
**响应（应用 → 面板）**：`{ "id": number, "result": unknown }`（与命令 id 一一对应，relay 按 id 路由回发起面板）
**事件（应用 → 全部面板广播）**：`{ "method": "Proteus.event", "params": TraceEvent }`

### 内置命令

| 方法 | 参数 | 响应 | 说明 |
|------|------|------|------|
| `Proteus.enable` | — | `{}` | 握手 + **历史回放**（应用缓冲内已 emit 事件补发；CDP enable 语义） |
| `Proteus.appInfo` | — | 路由表对象 | `{ routes: [...] }`（pages 依赖图数据） |
| `Proteus.deviceInfo` | — | 设备信息 | 环境/屏幕/内存/能力表（M8） |
| `Proteus.restoreStores` | `{ stores: [{ id, state }] }` | `{}` | 逐 store `$patch` 真实恢复（时间旅行/双向调试） |

**命令确认/重试**（面板先开、应用后连也不丢数据）：enable/appInfo 未确认 → 2s 定时重发，收到响应即停（`createDevtoolsWsSource` 内置）。

### 自定义命令扩展

relay 对任意 `{ id, method }` 通用转发到应用侧，`ws-bridge` 按 method 分发——第三方自定义命令需在**应用侧 bridge** 增加对应 handler（`options` 扩展），或复用内置命令面。事件侧则完全开放：任何 source 的 TraceEvent 直接广播。

## 3. 数据面：TraceEvent 协议

```ts
interface TraceEvent {
  source: 'lifecycle' | 'router' | 'store' | 'api' | 'capability' | 'compiler' | 'component' | 'hmr'
  phase: 'start' | 'end' | 'point' | 'error'
  name: string
  payload?: unknown   // JSON-safe（节点引用须转 handle）
  timestamp: number
  traceId?: string    // 跨源链路 ID（采样/串联）
}
```

- **统一入口**：所有运行时层经 `TraceBus` 上报（铁律 1），面板只订阅
- **脱敏**：payload 自动剔除 `password/token/authorization/idcard/phone`（嵌套对象/数组/Map/Set 递归）
- **采样**：`sampleRate` 降采样（同 traceId 同采弃），error 强制全采（tail sampling）
- **生产零开销**：`TraceBus` 默认关闭，`setEnabled(true)` 才采集；业务侧 `import.meta.env.DEV || __PROTEUS_DEBUG__` 门控

## 4. 权限与隐私

- 面板/协议仅 **dev serve** 提供（`devtoolsRelayPlugin` apply: 'serve'），build 产物零残留
- 事件 payload 全程脱敏（见上）；命令面 `restoreStores` 只写回调用方自己的 store
- 无鉴权（dev 工具定位，与本机 dev server 同信任域）；生产构建无任何端点

## 5. 与 M9 插件系统的关系

| 能力 | 入口 | 适用 |
|------|------|------|
| **面板内扩展**（第三方视图/泳道/命令/存储） | `DevToolsPlugin`（`devtools/src/plugins.ts`） | 在**官方面板里**加自己的 tab |
| **面板外消费**（第三方自己的面板） | `DevtoolsSource` / WS 协议（本文） | **完全自建 UI**，只用 Proteus 数据 |

两者互补：插件适合"复用官方 UI + 扩展"；Source/协议适合"全自研面板"。

## 6. 示例

- 零依赖协议客户端完整实现：`examples/pages/devtools-open-api-demo.vue`（连接状态/事件流自绘迷你时间线/appInfo·deviceInfo 查询/命令下发）
- 官方消费方参考：`packages/devtools/src/panel.ts`（`createDevtoolsPanel` 即 DevtoolsSource 的最大消费者）
- 协议实现参考：`packages/devtools/src/source.ts`（ws-source）/ `ws-bridge.ts`（应用桥）/ `packages/plugin-vite/src/devtools-relay.ts`（中转）
