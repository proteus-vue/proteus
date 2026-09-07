# P2 增强能力模块（A7 / A10 / A11）

> Batch B6 · 依赖：A1（A10 可选推送注册走 request）

---

## A7 — 媒体（Media）适配

### 1. 能力范围
图片、音频、视频的**采集 + 播放 + 编辑**。

### 2. 标准接口

```ts
// 图片
api.media.chooseImage(opts?): Promise<FileInfo[]>
api.media.previewImage(urls: string[], current?: number): void
api.media.compressImage(path: string, quality?: number): Promise<string>

// 音频
api.media.createAudioContext(id: string): AudioContext
api.media.startRecord(): Promise<void>
api.media.stopRecord(): Promise<FileInfo>

// 视频
api.media.chooseVideo(opts?): Promise<FileInfo>
api.media.createVideoContext(id: string): VideoContext
api.media.compressVideo?(path: string): Promise<string>
```

### 3. 三端差异

| 能力 | Web | 微信小程序 | App |
|------|-----|-----------|-----|
| 选图 | `input[type=file]` + FileReader | `wx.chooseMedia` | 原生相册/相机 |
| 预览 | 自建 Lightbox | `wx.previewImage` | 原生图片查看器 |
| 录音 | `MediaRecorder` | `wx.startRecord`（已废弃→`RecorderManager`）| 原生录音 |
| 视频播放 | `<video>` | `<video>` + `wx.createVideoContext` | 原生播放器 |
| 压缩 | Canvas / WebAssembly | `wx.compressImage` | 原生压缩 |

### 4. Skyline 约束

- `<input type="file" capture="camera">` 在小程序不可用 → 必须 `wx.chooseMedia`
- Skyline 下 `<video>` 是原生组件，层级最高，**覆盖自定义 UI 需用 `cover-view`**（旧）或 Skyline 新方案的 `cover` 机制
- 音频播放：`wx.createInnerAudioContext`（小程序）/ `wx.getBackgroundAudioManager`（后台播放）

### 5. 统一 AudioContext

```ts
interface AudioContext {
  src: string
  play(): void
  pause(): void
  stop(): void
  seek(position: number): void
  onEnded(cb): void
  destroy(): void
}
```

三端分别映射为：Web `HTMLAudioElement` / 小程序 `InnerAudioContext` / App 原生播放器。

---

## A10 — 消息 / 推送（Messaging）适配

### 1. 标准接口

```ts
api.messaging.requestPermission(): Promise<boolean>
api.messaging.getToken(): Promise<string>           // 推送设备 token
api.messaging.onMessage(cb: (msg: PushMessage) => void): () => void
api.messaging.subscribe(topic: string): Promise<void>  // 小程序订阅消息
api.messaging.unsubscribe(topic: string): Promise<void>
```

### 2. 三端实现

| 平台 | 实现 |
|------|------|
| 微信小程序 | `wx.requestSubscribeMessage`（一次性订阅，需用户点击）+ `wx.getSystemInfo` 拿 token |
| Web | Web Push API（`Notification.requestPermission` + Service Worker）|
| App | FCM（Android）/ APNs（iOS）|

### 3. 小程序订阅消息约束（⚠️）

- **必须由用户点击触发**（不能进入页面自动弹）
- 一次调用最多订阅 3 个模板
- 长期订阅需「长期订阅」类目资质
- 适配器封装：`api.messaging.subscribe` 内部校验调用时机，否则抛错提示

### 4. 消息统一格式

```ts
interface PushMessage {
  id: string
  title: string
  body: string
  data?: Record<string, any>
  // 点击跳转（三端统一处理）
  route?: { name: string; params?: Record<string, any> }
}
```

### 5. 与 Navigator 联动
收到推送点击 → `onMessage` → 调用 `api.navigator.push(msg.route)`。

---

## A11 — 分享（Share）适配

### 1. 标准接口

```ts
api.share.setDefaultShareData(data: ShareData): void   // 设置默认分享内容
api.share.share(data?: ShareData): Promise<ShareResult>  // 主动调起分享
api.share.onShareAppMessage(cb: () => ShareData): void   // 监听"转发"按钮
```

```ts
interface ShareData {
  title: string
  desc?: string
  path?: string          // 小程序页面路径（带参数）
  imageUrl?: string      // 图片链接（需同域或配置域名）
  query?: Record<string, any>  // 携带参数
}
```

### 2. 三端实现

| 平台 | 实现 |
|------|------|
| 微信小程序 | `wx.shareAppMessage`（页面 `onShareAppMessage` 钩子）+ 右上角菜单分享 |
| Web | Web Share API（`navigator.share`，兼容性有限）/ 复制链接兜底 |
| App | 原生分享面板（UIActivityViewController / Intent）|

### 3. 小程序约束

- **分享图片 URL 必须配置「下载域名白名单」**，否则 `imageUrl` 加载失败
- `path` 必须是以 `/` 开头的页面路径，参数拼 query string
- 被动分享（右上角菜单）→ 需页面定义 `onShareAppMessage`，适配器提供 mixin 自动注入
- Skyline：分享 API 不受影响（不走渲染层）

### 4. 统一主动分享

```ts
// 业务调用（三端一致）
await api.share.share({
  title: '快来一起玩',
  path: '/pages/index/index?ref=abc',
  imageUrl: 'https://cdn.xxx.com/share.png',
})
// Web 走 navigator.share，失败时降级为复制链接
// 小程序走 wx.shareAppMessage
// App 走原生分享面板
```

### 5. 分享回流归因
`path` 中的 `ref` / `inviterId` 参数 → 落地页读取 → 上报归因（配合业务埋点）。

---

## P2 执行策略

A7 / A10 / A11 互相独立，**可与 P0（A1-A4、A8）并行开发**，不强依赖。
建议顺序：A11（分享，最常用）→ A7（媒体）→ A10（推送，依赖后端）。

测试要求较 P0/P1 宽松（部分能力需真机/用户交互），以**接口契约测试 + mock 适配器**为主。
