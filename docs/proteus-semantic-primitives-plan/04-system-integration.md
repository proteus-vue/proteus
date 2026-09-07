# 系统集成映射规范（打通全客户端的关键，System 家族）

> 这是"全客户端开发"的最后一块拼图：把通知/权限/窗口/深链等系统能力语义化。

## 映射表（统一语义 → 五端原生）

| 能力 | 语义 | iOS | Android | 鸿蒙 | Web |
|------|------|-----|---------|------|-----|
| 通知 | p-notify | UNUserNotificationCenter | NotificationManager | notificationManager | Notification API |
| 权限 | p-permission | AuthorizationStatus | ActivityResult | abilityAccessCtrl | Permissions API |
| 分享 | p-share | UIActivityViewController | ShareCompat | share | Web Share API |
| 剪贴板 | p-clipboard | UIPasteboard | ClipboardManager | pasteboard | Clipboard API |
| 生物识别 | p-biometric | LocalAuthentication | BiometricPrompt | userAuth | WebAuthn |
| 窗口 | p-window | UIWindowScene | WindowManager | WindowStage | Window API |
| 深链 | p-deeplink | Universal Links | App Links | Want | URL Router |
| 角标 | p-badge | UIApplication.badge | notification badge | badge | — |

## 使用范式

```vue
<!-- 通知 -->
<button @click="pNotify({ title: '新消息', body: '来自系统通知' })">
  发送通知
</button>

<!-- 权限（前置声明，Compiler 校验） -->
<button @click="requestPhoto" v-permission="'photo'">选照片</button>

<!-- 分享 -->
<button @click="pShare({ url, text })">分享</button>
```

**开发者写一次，系统原生呈现。**

## 权限前置（重要）

`p-permission` 在 **Compiler 期校验清单**，自动生成各端权限声明：
- iOS `Info.plist`
- Android `AndroidManifest.xml`
- 鸿蒙 `module.json5`

→ **杜绝"运行时才发现有漏配权限"。**

## 窗口管理（桌面核心）

```vue
<p-window :mode="'fullscreen' | 'minimized' | 'alwaysOnTop'">
  <App />
</p-window>
```
映射：iOS `UIWindowScene` / 鸿蒙 `WindowStage` / Web Window API（Electron/Tauri 桥接）。

## 深链（Universal Links / App Links）

```ts
// 路由配置天然支持（G-17）
router.onDeepLink((url) => { ... })
```
Compiler 自动生成：
- iOS `Associated Domains` + `apple-app-site-association`
- Android `intent-filter`
- 鸿蒙 `Want` 声明

## 原则 #10.8 在此家族的应用

- ✅ `p-notify` / `p-permission`：有明确系统原生对应 → **进框架**
- ❌ 推送业务封装（个推/极光）：**组件层 / 插件层**
- ❌ IM 能力：**插件层**

**框架只收敛"语义 + 系统原生映射"，业务长尾交给组件/插件层。**
