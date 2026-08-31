# Deep Link / Universal Link

## 1. 统一解析

```typescript
interface DeepLinkResolver {
  resolve(url: string): ResolvedRoute | null
}
```

`router.resolve(url)` → RouteRecord + params → 直接导航（跳过中间页）。

## 2. 各端入口

| 端 | 系统入口 | 回调 |
|----|---------|------|
| iOS | `AppDelegate.application(_:open:options:)` (custom scheme) + `NSUserActivity` (Universal Link) | 回调 → `resolve` |
| Android | `Activity.intent` + `<intent-filter>` (`<data>` scheme/host/path) | `onCreate` / `onNewIntent` |
| 鸿蒙 | `Want` + `startAbility` + `uri` | `onCreate` / `onNewWant` |
| Web | `window.location` + `popstate` 事件 | Vue Router |

## 3. 冷启动 vs 热启动

- **冷启动**：解析 URL → 构造初始路由栈（可能多层级）→ 直达
- **热启动**：当前栈顶 push 目标页

## 4. 安全性

- URL 白名单（防止恶意 scheme 跳转）
- 参数校验（联动 Style Safety G-31 的类型系统思路）
- 敏感页面（登录态校验）拦截 → 重定向到登录

## 5. 配置示例

```typescript
// app.config.ts
export default defineProteus({
  router: {
    deepLink: {
      scheme: 'proteusdemo',
      host: 'app.proteus.vue',
      universalLinks: ['https://app.proteus.vue/*'],
      routes: [
        { pattern: '/product/:id', path: '/detail/:id' }
      ]
    }
  }
})
```
