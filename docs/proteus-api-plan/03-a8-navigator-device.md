# A8 — 导航（Navigator）适配

> P0 · Batch B4 · 依赖：**Router M5（App 导航）**

> 注意：路由配置（`<route>`、嵌套、转场）归 Router 层；**本模块只做"运行时导航 API"的统一**。

---

## 1. 标准接口

```ts
api.navigator.push(url: string, options?): Promise<void>
api.navigator.replace(url, options?): Promise<void>
api.navigator.back(delta?: number, options?): Promise<void>
api.navigator.switchTab(url): Promise<void>     // 小程序专属，其他端映射
api.navigator.reLaunch(url): Promise<void>
api.navigator.getCurrentPages(): PageInfo[]      // 小程序语义，其他端模拟
api.navigator.setResult(data): void              // 页面回传值（小程序 navigateBack({ success })）
```

## 2. 与 Router 层的关系

| 层 | 职责 |
|----|------|
| Router（M3-M5）| 路由**配置**：`<route>` → vue-router / pages.json / StackNavigator |
| API A8 | 路由**调用**：运行时 `push` / `back` 的统一封装 |

**A8 底层调用 Router 各端产物**：
- Web → `router.push()`（vue-router）
- 小程序 → `wx.navigateTo` / `wx.redirectTo` / `wx.navigateBack`
- App → `StackNavigator.push()`（对接 Router M5 的 Native Bridge）

## 3. 三端映射

| 标准方法 | Web | 微信小程序 | App |
|---------|-----|-----------|-----|
| `push` | `router.push`（history.pushState）| `wx.navigateTo`（栈 +1，≤10）| `navigator.push` |
| `replace` | `router.replace` | `wx.redirectTo` | `navigator.replace` |
| `back` | `router.back` | `wx.navigateBack` | `navigator.pop` |
| `switchTab` | 路由到对应 name | `wx.switchTab` | 回到根栈 |
| `reLaunch` | 重置路由 | `wx.reLaunch` | 重置栈 |

## 4. 小程序特有约束（必须处理）

- **页面栈深度 ≤ 10**：`push` 前检测栈深，超限自动 `replace`
- `wx.navigateTo` 不能跳到 tabBar 页面 → 自动改 `switchTab`
- tabBar 页面不能 `navigateBack` 到 → 需 `reLaunch`
- Skyline：`routeType` 转场由 Router M7.4 的 TransitionScheduler 管理，A8 只负责"触发"，不负责"动画"

## 5. 跨端参数传递

- Web：query string（`?id=1`）
- 小程序：`wx.navigateTo({ url: '...?id=1' })`，无对象传参 → 大对象走 storage 临时 key
- App：直接传对象（Native Bridge）

**统一方案**：A8 内部把 `params` 对象序列化，`back` 时通过 `setResult` + Promise resolve 回传（小程序模拟为 `storage + event`）。

```ts
// 页面 A
const result = await api.navigator.push<{ selected: number }>('/picker')
// 页面 Picker
api.navigator.setResult({ selected: 3 })
api.navigator.back()
```

小程序端 `setResult` 写入临时 storage key，A 页面 `onShow` 时读取并 resolve。

---

# A6 — 设备 / 系统（Device）适配

> P1 · Batch B5 · 依赖：无

## 1. 标准接口

```ts
api.device.getSystemInfo(): Promise<SystemInfo>
api.device.getNetworkType(): Promise<NetworkType>  // 'wifi'|'4g'|'none'...
api.device.onNetworkChange(cb): () => void
api.device.getClipboard(): Promise<string>
api.device.setClipboard(text: string): Promise<void>
api.device.vibrate(pattern?): Promise<void>
api.device.setKeepScreenOn(on: boolean): Promise<void>
api.device.getLaunchOptions(): LaunchOptions       // 冷启动参数（小程序专属，其他端模拟）
```

## 2. SystemInfo 统一字段

```ts
interface SystemInfo {
  platform: 'web' | 'mp-wechat' | 'mp-alipay' | 'app-ios' | 'app-android'
  os: 'ios' | 'android' | 'windows' | 'mac' | 'unknown'
  osVersion: string
  appVersion: string
  language: string
  pixelRatio: number
  screenWidth: number
  screenHeight: number
  statusBarHeight: number
  safeArea: { top: number; bottom: number; left: number; right: number }
  // Skyline 专属
  renderer?: 'webview' | 'skyline'
  componentFramework?: 'glass-easel'
}
```

## 3. 三端实现要点

| 能力 | Web | 微信小程序 | App |
|------|-----|-----------|-----|
| SystemInfo | `navigator.userAgent` + `screen` | `wx.getSystemInfoSync` | 原生 Build 信息 |
| NetworkType | `navigator.onLine` + NetworkInfo API | `wx.getNetworkType` | ConnectivityManager |
| Clipboard | `navigator.clipboard` | `wx.setClipboardData` | 原生剪贴板 |
| Vibrate | 不支持（需 Web API）| `wx.vibrateShort/Long` | Vibrator |

⚠️ **Skyline**：`wx.getSystemInfoSync` 在 Skyline 下部分字段需用新版 `wx.getDeviceInfo` / `wx.getWindowInfo` / `wx.getAppBaseInfo`（API 拆分），适配器要做兼容兜底。

## 4. 安全存储（A3 `encrypt` 依赖此）

```ts
// 敏感数据（token/手机号）走平台安全存储
interface ISecureStorage {
  set(key: string, value: string): Promise<void>
  get(key: string): Promise<string | null>
}
// 微信：wx.setStorageSync（受小程序沙箱保护）
// App：Android Keystore / iOS Keychain
// Web：无真正安全存储 → 降级为 httpOnly cookie 或提示用户
```

## 5. 测试要点

- [ ] `getSystemInfo` 返回字段在三种平台下类型一致
- [ ] 模拟断网 → `onNetworkChange` 回调 + `getNetworkType` 返回 `'none'`
- [ ] Skyline / WebView 切换 → `renderer` 字段正确反映
