---
title: useLive（capability.live）
group: 媒体与扫码
order: 4004
---

# useLive

**它能做什么**：嵌入直播间（观看与互动）。

**什么时候用**：电商带货、活动观看。

**端实现边界**：仅小程序提供直播组件；App 端需自行接入第三方直播 SDK。

> 技术标识：能力原语 C49 · `capability.live` · 返回 `LiveRoom` · **Hook 已实现**（各端支持情况见下方兼容进度表）

useLive：直播房间（wx live 组件形态/宿主桥——缺省 Err）

## 签名

```ts
useLive(options: LiveRoomOptions): Promise<CapResult<LiveRoomHandle>>
```

## 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `options` | `LiveRoomOptions` | 是 | C49 直播房间（wx live 组件形态/宿主桥——缺省 Err） |

#### `options` 的属性

| 属性 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `roomId` | `string` | 是 | 直播间 ID（同时作为 `<live-player id>` 组件 id——wx.createLivePlayerContext(roomId)） |
| `mode` | `'video' \| 'audio'` | 否 | 拉流模式 |

## 返回值

`Promise<CapResult<T>>`——铁律：无回调、无 try/catch 义务，`res.ok` 分支处理：

| 属性 | 类型 | 说明 |
|---|---|---|
| `ok` | `boolean` | 成功 `true` / 失败 `false` |
| `data` | `LiveRoomHandle` | 成功载荷（方法结构见下） |
| `error` | `CapError` | 失败时存在：`code`（机器码）/ `message`（人读原因）/ `cause`（原始异常） |

## 方法

| 方法 | 说明 |
|---|---|
| [`play`](#play) | 开始播放 |
| [`pause`](#pause) | 暂停播放 |
| [`resume`](#resume) | 从暂停处恢复播放 |
| [`stop`](#stop) | 停止播放 |
| [`mute`](#mute) | 静音切换（同步，无 Promise） |
| [`snapshot`](#snapshot) | 截图（返回临时文件路径） |
| [`requestFullScreen`](#requestfullscreen) | 请求全屏（direction 0 竖屏 / 90 横屏；缺省不变） |
| [`exitFullScreen`](#exitfullscreen) | 退出全屏 |
| [`status`](#status) | 当前播放状态 |
| [`onStateChange`](#onstatechange) | 订阅播放状态变化（返回取消） |
| [`leave`](#leave) | 离开直播间（= stop 的语义别名） |

### `play`

```ts
play(): Promise<CapResult<void>>
```

**说明**：开始播放

**返回值**：`Promise<CapResult<void>>`

### `pause`

```ts
pause(): Promise<CapResult<void>>
```

**说明**：暂停播放

**返回值**：`Promise<CapResult<void>>`

### `resume`

```ts
resume(): Promise<CapResult<void>>
```

**说明**：从暂停处恢复播放

**返回值**：`Promise<CapResult<void>>`

### `stop`

```ts
stop(): Promise<CapResult<void>>
```

**说明**：停止播放

**返回值**：`Promise<CapResult<void>>`

### `mute`

```ts
mute(): void
```

**说明**：静音切换（同步，无 Promise）

**返回值**：`void`

### `snapshot`

```ts
snapshot(): Promise<CapResult<string>>
```

**说明**：截图（返回临时文件路径）

**返回值**：`Promise<CapResult<string>>`

### `requestFullScreen`

```ts
requestFullScreen(direction?: number): Promise<CapResult<void>>
```

**说明**：请求全屏（direction 0 竖屏 / 90 横屏；缺省不变）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `direction` | `number` | 否 | 数值参数 |

**返回值**：`Promise<CapResult<void>>`

### `exitFullScreen`

```ts
exitFullScreen(): Promise<CapResult<void>>
```

**说明**：退出全屏

**返回值**：`Promise<CapResult<void>>`

### `status`

```ts
status(): LivePlayState
```

**说明**：当前播放状态

**返回值**：`LivePlayState`

### `onStateChange`

```ts
onStateChange(cb: (state: LivePlayState) => void): () => void
```

**说明**：订阅播放状态变化（返回取消）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(state: LivePlayState) => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `leave`

```ts
leave(): Promise<CapResult<void>>
```

**说明**：离开直播间（= stop 的语义别名）

**返回值**：`Promise<CapResult<void>>`

## 类型引用

### `LiveRoomOptions`

C49 直播房间（wx live 组件形态/宿主桥——缺省 Err）

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `roomId` | `string` | — | 直播间 ID（同时作为 `<live-player id>` 组件 id——wx.createLivePlayerContext(roomId)） |
| `mode` | `'video' \| 'audio'` | — | 拉流模式 |

### `LiveRoomHandle`

★能力颗粒度对齐：C49 直播房间操作句柄（原仅 leave/status → 播放控制全套）
观看端（LivePlayerContext）；推流端（LivePusherContext：美颜/连麦/推流）为诚实边界（需推流类目，未纳入）。
注：live-player 组件需在页面声明 + 直播类目资质；Web 无对等 → Err。

| 方法 | 签名 | 说明 |
|---|---|---|
| `play` | `play(): Promise<CapResult<void>>` | 开始播放 |
| `pause` | `pause(): Promise<CapResult<void>>` | 暂停播放 |
| `resume` | `resume(): Promise<CapResult<void>>` | 从暂停处恢复播放 |
| `stop` | `stop(): Promise<CapResult<void>>` | 停止播放 |
| `mute` | `mute(): void` | 静音切换（同步，无 Promise） |
| `snapshot` | `snapshot(): Promise<CapResult<string>>` | 截图（返回临时文件路径） |
| `requestFullScreen` | `requestFullScreen(direction?: number): Promise<CapResult<void>>` | 请求全屏（direction 0 竖屏 / 90 横屏；缺省不变） |
| `exitFullScreen` | `exitFullScreen(): Promise<CapResult<void>>` | 退出全屏 |
| `status` | `status(): LivePlayState` | 当前播放状态 |
| `onStateChange` | `onStateChange(cb: (state: LivePlayState) => void): () => void` | 订阅播放状态变化（返回取消） |
| `leave` | `leave(): Promise<CapResult<void>>` | 离开直播间（= stop 的语义别名） |

### `LivePlayState`

直播播放状态（LivePlayerContext.onXxx 归一）

| 取值 | 说明 |
|---|---|
| `'playing'` | — |
| `'paused'` | — |
| `'stopped'` | — |
| `'error'` | — |

### `CapError`

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `code` | `string` | — | — |
| `message` | `string` | — | — |
| `cause` | `unknown` | — | — |

## 错误码

| code | 说明 |
|---|---|
| `live.unsupported` | 桥未提供 joinLiveRoom（useLive 不可用） |
| `live.failed` | wx 直播  |

> 平台不支持 → `*.unsupported` 族；业务按 code 分支处理，无需 try/catch。

## 兼容进度

| 端 | 兼容 | 说明 |
|---|---|---|
| Web SPA | ⚠️ | vue-dom · webBridge joinLiveRoom 是纯空壳（全部出口 unsupported）→ 恒 Err |
| 微信小程序 | ✅ | skyline（WebView 降级） · wx 桥 → wx...（直播组件） |
| Headless（SSR / 测试） | ✅ | headless · mock 桥注入（测试 / SSR 档） |
| iOS 原生 | 🟡 | native-ios（UIKit + CoreAnimation） · 渲染核心已落地——能力桥未接线 |
| Android 原生 | 🟡 | native-android（自绘 Canvas） · 渲染核心已落地——能力桥未接线 |
| 鸿蒙 | 🟡 | native-harmony（ArkUI RenderNode） · 渲染核心已落地——能力桥未接线 |
| Flutter 混合 | 🟡 | flutter · 同一 JS 逻辑层——能力桥未接线 |
| 快应用 | ⬜ | 快应用引擎（待定） · 端未开始 |

> 状态口径：✅ 端已落地·本能力可用；⚠️ 端已落地·桥未提供**或桥是纯空壳**→Err 显式降级（方法存在但每一条路径都返回 unsupported 不算可用）；🟡 能力桥未接线；⬜ 端未开始。★**各端判据严格度不同**：微信/Web 要求桥方法存在**且方法体真有平台对接**；iOS/Android 要求 App 桥工厂里有该方法；鸿蒙要求 JS 桥 + 宿主分派**双证据**。端架构对照见 [端与成熟度](/docs/framework/ends-matrix)。

> 铁律：能力原语全部返回 `Result<T>`（无回调 / 无全局对象）；平台不支持 → `Err` 显式降级，业务零平台分支。

## 用法

```ts
const res = await useLive({ roomId: 'room-42', mode: 'video' })

if (res.ok) {
  console.log('房间状态:', res.data.status())
  // await res.data.leave() 退出房间
} else if (res.error.code.endsWith('.unsupported')) {
  // 直播需宿主桥 → 降级路径
}
```

<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->