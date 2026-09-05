# G-57 宿主接入：三种技术栈

## 总原则

> **复用宿主已有协议，只注册自定义扩展。**
> 不劫持、不替换、不 patch 宿主协议本身。

## 路径 A：Flutter / Dart（推荐，官方机制最成熟）

```
App (debug)
  ├─ registerExtension('ext.proteus.runtime',  → L0)
  ├─ registerExtension('ext.proteus.semantic', → L1)
  └─ registerExtension('ext.proteus.framework',→ L2)
       ↓ Dart VM Service (WebSocket)
  DevTools Extension（pub 包，自动多一个标签页）
       ↓ serviceManager 访问 VM service
  桌面看到三层数据
```

**要点：**

- 用 `dart:developer` 的 `registerExtension`
- **每个 isolate 注册一次**（官方强制）
- 调用带 `isolateId`
- 配合 `devtools_extensions` pub 包 → **自动在 DevTools 多一个 "Proteus" 标签页**
- 扩展用 Flutter Web 写，通过 postMessage 与 DevTools 通信

**实证**：`bloc_devtools_extension` 完全用的这条路（`ext.bloc_devtools.getState`）。

## 路径 B：React Native / Flipper

```
App (debug)
  └─ Flipper Client Plugin（自定义）
       ├─ onMessage('proteus:L0')  → 推送指标
       ├─ onMessage('proteus:L1')  → 推送标注后指标
       └─ send('getFrameworkState')→ 响应 L2
       ↓
  Flipper Desktop Plugin（自定义 TSX）
       ↓ createState / useValue
  桌面看到三层数据
```

**要点：**

- Desktop Plugin 与 Client Plugin 的 `id` **必须一致**
- 双向：`client.onMessage` 收事件、`client.send` 调方法
- 后台未激活时消息**排队**，激活后补发
- 用 `flipper-pkg init` 脚手架

## 路径 C：Web / 自起服务

```
App (debug)
  └─ 内置 HTTP + WebSocket 服务（GCDWebServer / Node http）
       ├─ GET  /proteus/L0
       ├─ GET  /proteus/L1
       └─ WS   /proteus/framework  (L2 推送)
       ↓ 局域网或 adb forward
  浏览器打开 → 看到三层数据
```

**要点：**

- **绑定 localhost 优先**，局域网暴露需显式开启
- iOS 需 `com.apple.security.network.server` entitlement（**官方允许**）
- Android 无特殊权限要求
- Release **编译期剔除**，不是运行时判断

## 路径 D：CDP（仅在框架自己控制 WebView 时）

**一般不推荐自定义 CDP domain**——需要 patch Chromium 并重新编译，成本极高。

**除非**你的框架本身就分发定制 WebView（类似 BrowserOS 的做法）。
否则走路径 C（自起服务）更实际。

## 接入方式对比

| 路径 | 成本 | 官方支持 | 推荐度 |
|------|------|---------|--------|
| **A Flutter/Dart** | 低 | ✅ `dart:developer` | ★★★★★ |
| **B Flipper** | 中 | ✅ `flipper-plugin` | ★★★★ |
| **C 自起服务** | 中 | ✅ 系统 socket API | ★★★★ |
| D CDP 自定义域 | **极高** | ⚠️ 需 patch Chromium | ★ |

## 统一抽象

无论哪条路径，**数据模型是同一套**（L0/L1/L2）。
差别只在传输层——这正是「不绑定可观测性来源」的含义。

```typescript
interface InspectorTransport {
  send(payload: L0Snapshot | L1Snapshot | L2Snapshot): void
  onRequest(handler: (method: string) => Promise<any>): void
}
```
