# G-31 附录：API 语义设计

> 配套 `G-31-component-api-semantics.md` §4。所有 API 遵循"Hook / Promise / 全类型"三原则（G-31.3）。

---

## 1. 三大入口对象

```ts
// ① 渲染/逻辑：Vue 原生 Composition API（无需新造）
import { ref, computed, watch, onMounted } from 'vue'

// ② 原生能力：G-28 ProteusNativeBackend（SPI）
const native = useNative()
const { text } = await native.scanQR()

// ③ 路由：G-17 声明式
const router = useRouter()
router.push({ name: 'detail', params: { id: 1 } })
```

**没有任何 `wx.xxx` / `uni.xxx` 式全局命名空间。**

---

## 2. 能力 API 对照表（小程序 → Proteus）

| 能力 | 小程序（回调/全局） | **Proteus（Hook/Promise）** |
|------|-------------------|---------------------------|
| 网络请求 | `wx.request({ url, success, fail })` | `const { data } = await useFetch(url)` |
| 文件上传 | `wx.uploadFile` | `await useUpload(file)` |
| 路由跳转 | `wx.navigateTo({ url })` | `router.push({ name, params })` |
| 本地存储 | `wx.setStorage(key, val)` | `const store = useStorage()`（响应式） |
| 登录链路 | `login→getUserInfo→request` | `const { user } = await auth.login()` |
| 扫码 | `wx.scanCode({ success })` | `const { text } = await native.scanQR()` |
| 定位 | `wx.getLocation({ success })` | `const loc = await native.getLocation({ accuracy })` |
| 分享 | `wx.shareAppMessage` | `await native.share(payload)` |
| 权限 | 散落在各 API | `const p = await usePermission('camera')` |
| 剪贴板 | `wx.setClipboardData` | `await native.clipboard.write(text)` |
| 震动 | `wx.vibrateShort` | `native.vibrate('short')` |
| 相机 | `wx.createCameraContext` | `native.camera.open()`（能力入口） |

---

## 3. 关键设计：响应式存储（替代 `wx.setStorage`）

```ts
// wx.setStorage / wx.getStorage：手动、无响应、字符串 key
// ↓
// Proteus：响应式 + 类型安全 + Backend 决定存储介质
const settings = useStorage<AppSettings>('app:settings', {
  theme: 'auto',
  language: 'zh'
})

// 直接读写，自动持久化
settings.theme = 'dark'   // → Backend 写入原生存储
```

---

## 4. 关键设计：组合式路由（替代字符串 URL）

```ts
// wx.navigateTo({ url: '/pages/detail?id=1' })
//   → 字符串耦合、无类型、无参数校验
// ↓
// Proteus：命名路由 + 参数类型（G-17）
router.push({ name: 'product-detail', params: { id: 1 } })
//   → 编译期校验路由名 + 参数，重构安全
```

---

## 5. 关键设计：能力调用即类型安全

```ts
// 小程序：success 回调里手动解析，无类型
wx.scanCode({
  success(res) { console.log(res.result) }
})

// Proteus：Promise + 完整类型推导
const { text, format } = await native.scanQR()
//   text: string
//   format: 'qr' | 'aztec' | 'pdf417' | ...
```

---

## 6. 禁止项（CMP007）

以下 API 形态**不得进入 Layer 0**：

- ❌ 全局对象 + 回调：`wx.xxx({ success, fail, complete })`
- ❌ 字符串 URL 路由：`navigateTo('/pages/x?id=1')`
- ❌ 同步阻塞 API：`wx.getStorageSync`（一律异步 + 响应式）
- ❌ 平台 SDK 直接调用：`AVCaptureDevice` / `CameraX`（走 `useNative`，CMP005）

---

## 7. 兼容层 API 形态（Layer 1，`@proteus/compat-miniprogram`）

```ts
// 兼容层提供适配器，让旧代码可渐进迁移
import { wx } from '@proteus/compat-miniprogram'

// 旧代码：wx.request({...})
// → 适配器内部转为 useFetch()
// → 开发者逐步替换为原生 Hook
```

**规则**：兼容层 API 不得在新项目模板中默认引入。

---

## 版本记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1 | 2026-09-02 | 三大入口 + 12 项 API 对照 + 响应式存储/路由/类型安全 + 禁止项 |
