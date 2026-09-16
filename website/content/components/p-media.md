---
title: p-media
group: 内容与表单
order: 1015
---

# p-media

媒体统一入口

> 语义组件（Layer 0）· 域 **内容与表单** · 编译期映射到各端原生控件，业务零平台分支。

| 语义 | 域 | 小程序等价 |
|---|---|---|
| ui.media | 内容与表单 | `<audio>`（L1 原语） · `<video>`（L1 原语） · `<live-player>`（L1 原语） · `<live-pusher>`（L1 原语） |

## 兼容进度

| 端 | 兼容 | 说明 |
|---|---|---|
| Web SPA | ✅ | vue-dom · 双端同源码编译目标（编译期映射 + 事件归一） |
| 微信小程序 | ✅ | skyline（WebView 降级） · 原生控件映射 → `<audio>`（L1 原语） · `<video>`（L1 原语） · `<live-player>`（L1 原语） · `<live-pusher>`（L1 原语） |
| Headless（SSR / 测试） | ✅ | headless · IR 渲染测试档（工具端） |
| iOS 原生 | 🟡 | native-ios（UIKit） · 端原型映射——组件级接线未开始 |
| Android 原生 | 🟡 | native-android（Jetpack） · 端原型映射——组件级接线未开始 |
| 鸿蒙 | 🟡 | native-harmony（ArkUI） · 端原型映射——组件级接线未开始 |
| Flutter 混合 | 🟡 | flutter · widget 级映射——组件级未验证 |
| 快应用 | ⬜ | 快应用引擎（待定） · 端未开始 |

> 状态口径：✅ 端已落地·本组件可用；🟡 端原型映射·组件级接线未开始；⬜ 端未开始。端架构对照（引擎 / 运行时 / 持久化）见 [端与成熟度](/docs/framework/ends-matrix)。

## Props

| 属性 | 说明 | 类型 | 默认值 | 必填 |
|---|---|---|---|---|
| `kind` | 媒体类型：image / video / audio / live | `String` | `'image'` | 否 |
| `src` | 资源地址（★官方 video src） | `String` | `''` | 否 |
| `duration` | 指定视频时长（★官方 duration） | `Number` | `0` | 否 |
| `controls` | 显示控制条（★官方 controls） | `Boolean` | `true` | 否 |
| `danmuList` | 弹幕列表（★官方 danmu-list） | `Array as () => Record<string` | `() => []` | 否 |
| `danmuBtn` | 显示弹幕按钮（★官方 danmu-btn，仅初始化有效） | `Boolean` | `false` | 否 |
| `enableDanmu` | 展示弹幕（★官方 enable-danmu，仅初始化有效） | `Boolean` | `false` | 否 |
| `autoplay` | 自动播放（★官方 autoplay） | `Boolean` | `false` | 否 |
| `loop` | 循环（★官方 loop） | `Boolean` | `false` | 否 |
| `muted` | 静音（★官方 muted） | `Boolean` | `false` | 否 |
| `initialTime` | 初始播放位置（★官方 initial-time） | `Number` | `0` | 否 |
| `pageGesture` | 非全屏下开启亮度/音量手势（★官方 page-gesture，已废弃） | `Boolean` | `false` | 否 |
| `direction` | 全屏方向（★官方 direction，不指定按宽高比自动判断） | `Number` | `0` | 否 |
| `showProgress` | 显示进度条（★官方 show-progress） | `Boolean` | `true` | 否 |
| `showFullscreenBtn` | 显示全屏按钮（★官方 show-fullscreen-btn） | `Boolean` | `true` | 否 |
| `showPlayBtn` | 显示底部控制栏播放按钮（★官方 show-play-btn） | `Boolean` | `true` | 否 |
| `showCenterPlayBtn` | 显示中间播放按钮（★官方 show-center-play-btn） | `Boolean` | `true` | 否 |
| `enableProgressGesture` | 开启控制进度手势（★官方 enable-progress-gesture） | `Boolean` | `true` | 否 |
| `objectFit` | 视频与容器尺寸不一致时的表现（★官方 object-fit：contain/fill/cover） | `String` | `'contain'` | 否 |
| `poster` | 封面图（★官方 poster） | `String` | `''` | 否 |
| `showMuteBtn` | 显示静音按钮（★官方 show-mute-btn） | `Boolean` | `false` | 否 |
| `title` | 视频标题（全屏顶部展示，★官方 title） | `String` | `''` | 否 |
| `playBtnPosition` | 播放按钮位置（★官方 play-btn-position） | `String` | `'bottom'` | 否 |
| `enablePlayGesture` | 双击切换播放/暂停手势（★官方 enable-play-gesture） | `Boolean` | `false` | 否 |
| `autoPauseIfNavigate` | 跳转本小程序其他页时自动暂停（★官方 auto-pause-if-navigate） | `Boolean` | `true` | 否 |
| `autoPauseIfOpenNative` | 跳转微信原生页时自动暂停（★官方 auto-pause-if-open-native） | `Boolean` | `true` | 否 |
| `vslideGesture` | 非全屏下亮度/音量手势（★官方 vslide-gesture） | `Boolean` | `false` | 否 |
| `vslideGestureInFullscreen` | 全屏下亮度/音量手势（★官方 vslide-gesture-in-fullscreen） | `Boolean` | `true` | 否 |
| `showBottomProgress` | 展示底部进度条（★官方 show-bottom-progress） | `Boolean` | `true` | 否 |
| `adUnitId` | 视频前贴广告单元 id（★官方 ad-unit-id） | `String` | `''` | 否 |
| `posterForCrawler` | 搜索引擎封面图（★官方 poster-for-crawler，仅网络地址） | `String` | `''` | 否 |
| `showCastingButton` | 显示投屏按钮（★官方 show-casting-button） | `Boolean` | `false` | 否 |
| `pictureInPictureMode` | 小窗模式：push / pop（可数组，★官方 picture-in-picture-mode） | `[String, Array] as unknown as () => string \| string[]` | `''` | 否 |
| `pictureInPictureShowProgress` | 小窗模式下显示播放进度（★官方 picture-in-picture-show-progress） | `Boolean` | `false` | 否 |
| `pictureInPictureInitPosition` | 小窗初始显示位置（★官方 picture-in-picture-init-position） | `String` | `''` | 否 |
| `enableSystemPip` | 支持 iOS 系统画中画（★官方 enable-system-pip） | `Boolean` | `true` | 否 |
| `enableAutoRotation` | 手机横屏自动全屏（★官方 enable-auto-rotation） | `Boolean` | `false` | 否 |
| `showScreenLockButton` | 显示锁屏按钮（★官方 show-screen-lock-button） | `Boolean` | `false` | 否 |
| `showSnapshotButton` | 显示截屏按钮（★官方 show-snapshot-button） | `Boolean` | `false` | 否 |
| `showBackgroundPlaybackButton` | 展示后台小窗播放按钮（★官方 show-background-playback-button） | `Boolean` | `true` | 否 |
| `backgroundPoster` | 后台小窗播放通知栏图标（Android，★官方 background-poster） | `String` | `''` | 否 |
| `referrerPolicy` | 防盗链 referrer 策略（★官方 referrer-policy） | `String` | `'no-referrer'` | 否 |
| `isDrm` | 是否 DRM 视频源（★官方 is-drm） | `Boolean` | `false` | 否 |
| `isLive` | 是否直播源（★官方 is-live） | `Boolean` | `false` | 否 |
| `provisionUrl` | DRM 设备身份认证 url（Android，★官方 provision-url） | `String` | `''` | 否 |
| `certificateUrl` | DRM 设备身份认证 url（iOS，★官方 certificate-url） | `String` | `''` | 否 |
| `licenseUrl` | DRM 获取加密信息 url（★官方 license-url） | `String` | `''` | 否 |
| `preferredPeakBitRate` | 码率上界 bps（★官方 preferred-peak-bit-rate） | `Number` | `0` | 否 |
| `width` | 宽 px（0=自适应） | `Number` | `0` | 否 |
| `height` | 高 px（0=自适应） | `Number` | `0` | 否 |

### 属性详解

#### `kind`

- **类型**：`String`　**默认值**：`'image'`　**必填**：否
- **说明**：媒体类型：image / video / audio / live

#### `src`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：资源地址（★官方 video src）

#### `duration`

- **类型**：`Number`　**默认值**：`0`　**必填**：否
- **说明**：指定视频时长（★官方 duration）

#### `controls`

- **类型**：`Boolean`　**默认值**：`true`　**必填**：否
- **说明**：显示控制条（★官方 controls）

#### `danmuList`

- **类型**：`Array as () => Record<string`　**默认值**：`() => []`　**必填**：否
- **说明**：弹幕列表（★官方 danmu-list）

#### `danmuBtn`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：显示弹幕按钮（★官方 danmu-btn，仅初始化有效）

#### `enableDanmu`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：展示弹幕（★官方 enable-danmu，仅初始化有效）

#### `autoplay`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：自动播放（★官方 autoplay）

#### `loop`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：循环（★官方 loop）

#### `muted`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：静音（★官方 muted）

#### `initialTime`

- **类型**：`Number`　**默认值**：`0`　**必填**：否
- **说明**：初始播放位置（★官方 initial-time）

#### `pageGesture`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：非全屏下开启亮度/音量手势（★官方 page-gesture，已废弃）

#### `direction`

- **类型**：`Number`　**默认值**：`0`　**必填**：否
- **说明**：全屏方向（★官方 direction，不指定按宽高比自动判断）

#### `showProgress`

- **类型**：`Boolean`　**默认值**：`true`　**必填**：否
- **说明**：显示进度条（★官方 show-progress）

#### `showFullscreenBtn`

- **类型**：`Boolean`　**默认值**：`true`　**必填**：否
- **说明**：显示全屏按钮（★官方 show-fullscreen-btn）

#### `showPlayBtn`

- **类型**：`Boolean`　**默认值**：`true`　**必填**：否
- **说明**：显示底部控制栏播放按钮（★官方 show-play-btn）

#### `showCenterPlayBtn`

- **类型**：`Boolean`　**默认值**：`true`　**必填**：否
- **说明**：显示中间播放按钮（★官方 show-center-play-btn）

#### `enableProgressGesture`

- **类型**：`Boolean`　**默认值**：`true`　**必填**：否
- **说明**：开启控制进度手势（★官方 enable-progress-gesture）

#### `objectFit`

- **类型**：`String`　**默认值**：`'contain'`　**必填**：否
- **说明**：视频与容器尺寸不一致时的表现（★官方 object-fit：contain/fill/cover）

#### `poster`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：封面图（★官方 poster）

#### `showMuteBtn`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：显示静音按钮（★官方 show-mute-btn）

#### `title`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：视频标题（全屏顶部展示，★官方 title）

#### `playBtnPosition`

- **类型**：`String`　**默认值**：`'bottom'`　**必填**：否
- **说明**：播放按钮位置（★官方 play-btn-position）

#### `enablePlayGesture`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：双击切换播放/暂停手势（★官方 enable-play-gesture）

#### `autoPauseIfNavigate`

- **类型**：`Boolean`　**默认值**：`true`　**必填**：否
- **说明**：跳转本小程序其他页时自动暂停（★官方 auto-pause-if-navigate）

#### `autoPauseIfOpenNative`

- **类型**：`Boolean`　**默认值**：`true`　**必填**：否
- **说明**：跳转微信原生页时自动暂停（★官方 auto-pause-if-open-native）

#### `vslideGesture`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：非全屏下亮度/音量手势（★官方 vslide-gesture）

#### `vslideGestureInFullscreen`

- **类型**：`Boolean`　**默认值**：`true`　**必填**：否
- **说明**：全屏下亮度/音量手势（★官方 vslide-gesture-in-fullscreen）

#### `showBottomProgress`

- **类型**：`Boolean`　**默认值**：`true`　**必填**：否
- **说明**：展示底部进度条（★官方 show-bottom-progress）

#### `adUnitId`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：视频前贴广告单元 id（★官方 ad-unit-id）

#### `posterForCrawler`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：搜索引擎封面图（★官方 poster-for-crawler，仅网络地址）

#### `showCastingButton`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：显示投屏按钮（★官方 show-casting-button）

#### `pictureInPictureMode`

- **类型**：`[String, Array] as unknown as () => string \| string[]`　**默认值**：`''`　**必填**：否
- **说明**：小窗模式：push / pop（可数组，★官方 picture-in-picture-mode）

#### `pictureInPictureShowProgress`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：小窗模式下显示播放进度（★官方 picture-in-picture-show-progress）

#### `pictureInPictureInitPosition`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：小窗初始显示位置（★官方 picture-in-picture-init-position）

#### `enableSystemPip`

- **类型**：`Boolean`　**默认值**：`true`　**必填**：否
- **说明**：支持 iOS 系统画中画（★官方 enable-system-pip）

#### `enableAutoRotation`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：手机横屏自动全屏（★官方 enable-auto-rotation）

#### `showScreenLockButton`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：显示锁屏按钮（★官方 show-screen-lock-button）

#### `showSnapshotButton`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：显示截屏按钮（★官方 show-snapshot-button）

#### `showBackgroundPlaybackButton`

- **类型**：`Boolean`　**默认值**：`true`　**必填**：否
- **说明**：展示后台小窗播放按钮（★官方 show-background-playback-button）

#### `backgroundPoster`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：后台小窗播放通知栏图标（Android，★官方 background-poster）

#### `referrerPolicy`

- **类型**：`String`　**默认值**：`'no-referrer'`　**必填**：否
- **说明**：防盗链 referrer 策略（★官方 referrer-policy）

#### `isDrm`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：是否 DRM 视频源（★官方 is-drm）

#### `isLive`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：是否直播源（★官方 is-live）

#### `provisionUrl`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：DRM 设备身份认证 url（Android，★官方 provision-url）

#### `certificateUrl`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：DRM 设备身份认证 url（iOS，★官方 certificate-url）

#### `licenseUrl`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：DRM 获取加密信息 url（★官方 license-url）

#### `preferredPeakBitRate`

- **类型**：`Number`　**默认值**：`0`　**必填**：否
- **说明**：码率上界 bps（★官方 preferred-peak-bit-rate）

#### `width`

- **类型**：`Number`　**默认值**：`0`　**必填**：否
- **说明**：宽 px（0=自适应）

#### `height`

- **类型**：`Number`　**默认值**：`0`　**必填**：否
- **说明**：高 px（0=自适应）

## Events

| 事件 | 说明 | 载荷 |
|---|---|---|
| `play` | — | — |
| `pause` | — | — |
| `ended` | — | — |
| `timeupdate` | — | — |
| `fullscreenchange` | — | — |
| `waiting` | — | — |
| `error` | 加载/执行失败 | — |
| `progress` | — | — |
| `loadedmetadata` | — | — |
| `controlstoggle` | — | — |

### 事件详解

#### `play`

- **说明**：—
- **载荷**：无

#### `pause`

- **说明**：—
- **载荷**：无

#### `ended`

- **说明**：—
- **载荷**：无

#### `timeupdate`

- **说明**：—
- **载荷**：无

#### `fullscreenchange`

- **说明**：—
- **载荷**：无

#### `waiting`

- **说明**：—
- **载荷**：无

#### `error`

- **说明**：加载/执行失败
- **载荷**：无

#### `progress`

- **说明**：—
- **载荷**：无

#### `loadedmetadata`

- **说明**：—
- **载荷**：无

#### `controlstoggle`

- **说明**：—
- **载荷**：无

## 实现要点

- kind image/video/audio/live 统一入口（消灭 video/audio 分离组件）
- ★端对齐批次3（2026-09-16）：video/live 分支补齐官方 <video> 全量属性（47 项）——
- 播放控制（controls/autoplay/loop/muted/initial-time/duration）、控件显隐族（show-*）、
- 手势族（page-gesture/vslide-gesture/enable-progress-gesture/enable-play-gesture）、
- 弹幕族（danmu-list/danmu-btn/enable-danmu）、画中画族（picture-in-picture-*/enable-system-pip）、
- 投屏/截屏/后台播放、DRM 族（is-drm/provision-url/certificate-url/license-url）、
- 展示（object-fit/poster/poster-for-crawler/direction/play-btn-position/title/referrer-policy）。
- ★双端实现：MP 端原生 <video>（属性全量透传）；Web 端 <video> 元素（标准属性映射：controls/autoplay/loop/muted/
- poster/object-fit→objectFit；controlsList 表达 show-* 显隐；画中画/DRM 等无对等项诚实不伪造）。
- ★B2 Web-first：kind 决定元素（img/video/audio 显式 v-if——MP 编译器不支持动态标签）

## 用法

```vue
<p-media :kind="'image'" :src="'…'" :duration="0">
  <p-text>内容</p-text>
</p-media>
```

<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：packages/components/p-media/index.vue -->