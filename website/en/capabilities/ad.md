---
title: useAd (capability.ad)
group: 通知与分享
order: 6008
---

# useAd

useAd: ad handle — rewardedVideo / interstitial / banner (wx.createRewardedVideoAd/createInterstitialAd/createBannerAd; web has no ad-network standard → throws on create)

> Capability primitive C64 · `capability.ad` · returns `AdAPI` · **Hook implemented** (API ready — target bridges in the table below)

## Signature

```ts
useAd(): CapResult<AdAPI>
```

## Returns

`Promise<CapResult<T>>` — iron rule: no callbacks, no try/catch duty; branch on `res.ok`:

| Property | Type | Doc |
|---|---|---|
| `ok` | `boolean` | Succeeded `true` / failed `false` |
| `data` | `AdAPI` | Success payload (methods below) |
| `error` | `CapError` | Present on failure: `code` (machine code) / `message` (human-readable reason) / `cause` (original exception) |

## Methods

| Method | Signature | Doc |
|---|---|---|
| [`rewardedVideo`](#rewardedvideo) | `rewardedVideo(adUnitId: string): RewardedVideoAdHandle` | — |
| [`interstitial`](#interstitial) | `interstitial(adUnitId: string): InterstitialAdHandle` | — |
| [`banner`](#banner) | `banner(options: { adUnitId: string; style: BannerAdStyle }): BannerAdHandle` | — |

### `rewardedVideo`

```ts
rewardedVideo(adUnitId: string): RewardedVideoAdHandle
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `adUnitId` | `string` | Yes | — |

**Returns**: `RewardedVideoAdHandle`

### `interstitial`

```ts
interstitial(adUnitId: string): InterstitialAdHandle
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `adUnitId` | `string` | Yes | — |

**Returns**: `InterstitialAdHandle`

### `banner`

```ts
banner(options: { adUnitId: string; style: BannerAdStyle }): BannerAdHandle
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `options` | `{ adUnitId: string; style: BannerAdStyle }` | Yes | — |

**Returns**: `BannerAdHandle`

## Referenced types

### `RewardedVideoAdHandle`

激励视频广告句柄（wx.createRewardedVideoAd）

| Method | Signature | Doc |
|---|---|---|
| `load` | `load(): Promise<CapResult<void>>` | 拉取广告（缺省 show 前自动 load） |
| `show` | `show(): Promise<CapResult<void>>` | 展示广告（返回是否因激励观看完毕而闭合的 Promise 解析在 onClose 载荷） |
| `onLoad` | `onLoad(cb: () => void): () => void` | 订阅加载成功（可缓存预热） |
| `onClose` | `onClose(cb: (res: { isEnded: boolean }) => void): () => void` | 订阅用户关闭广告。 |
| `onError` | `onError(cb: (err: { errCode: number; errMsg: string }) => void): () => void` | 订阅错误 |
| `off` | `off(): void` | 销毁 |

### `InterstitialAdHandle`

插屏广告句柄（wx.createInterstitialAd）

| Method | Signature | Doc |
|---|---|---|
| `load` | `load(): Promise<CapResult<void>>` | 拉取广告 |
| `show` | `show(): Promise<CapResult<void>>` | 展示广告 |
| `onLoad` | `onLoad(cb: () => void): () => void` | 订阅加载成功 |
| `onClose` | `onClose(cb: () => void): () => void` | 订阅用户关闭 |
| `onError` | `onError(cb: (err: { errCode: number; errMsg: string }) => void): () => void` | 订阅错误 |
| `destroy` | `destroy(): void` | 销毁 |

### `BannerAdStyle`

横幅广告样式（wx.createBannerAd style）

| Prop | Type | Default | Doc |
|---|---|---|---|
| `left` | `number` | — | 左侧偏移（px） |
| `top` | `number` | — | 顶部偏移（px） |
| `width` | `number` | — | 宽度（px） |

### `BannerAdHandle`

横幅广告句柄（wx.createBannerAd）

| Method | Signature | Doc |
|---|---|---|
| `show` | `show(): Promise<CapResult<void>>` | 展示广告 |
| `hide` | `hide(): Promise<CapResult<void>>` | 隐藏广告 |
| `destroy` | `destroy(): void` | 销毁 |
| `onLoad` | `onLoad(cb: () => void): () => void` | 订阅加载成功 |
| `onResize` | `onResize(cb: (size: { width: number; height: number }) => void): () => void` | 订阅尺寸变化 |
| `onError` | `onError(cb: (err: { errCode: number; errMsg: string }) => void): () => void` | 订阅错误 |

## Error codes

| code | Doc |
|---|---|
| `ad.unsupported` | The ad API is missing (web has no ad-network standard API — needs a host bridge) |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge implementation (direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.createRewardedVideoAd/createInterstitialAd/createBannerAd |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | 🟡 | native-ios (UIKit) · prototype mapping — capability bridge not wired |
| Android native | 🟡 | native-android (Jetpack) · prototype mapping — capability bridge not wired |
| HarmonyOS | 🟡 | native-harmony (ArkUI) · prototype mapping — capability bridge not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but bridge missing → explicit `Err` degradation · 🟡 prototype mapping — capability bridge not wired · ⬜ target not started. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Usage

```ts
const res = await useAd()

if (res.ok) {
  console.log(res.data)
} else if (res.error.code.endsWith('.unsupported')) {
  // platform unsupported → degradation path
}
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->