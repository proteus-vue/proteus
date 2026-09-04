# G-46 混合 App 超级应用加固 — 宿主级统一资源池

> **一句话**：G-27 解决了「外（渲染）一致性」，G-46 解决「**内（登录态/请求/缓存）一致性**」——两者合起来才是混合 App 的完整一致性。
>
> **方法论定位**：原则 #0「不绑定」第 10 次泛化 — **不绑定资源容器形态**（定义语义 + 后端实现 + conformance）。

---

## 1. 问题：渲染一致了，数据链断了

G-27 允许同 App 不同页面切换渲染后端（VueDom / Native / Flutter / Skia），**页面 A（原生）登录了，页面 B（WebView）还得再登一次**——渲染一致了，登录态断了。

行业现状是**靠业务手写同步，无统一抽象**：

| 方案 | 做法 | 缺陷 |
|------|------|------|
| uni-app | 业务层手动同步 Cookie | 无统一抽象，跨端靠人 |
| Flutter Web | Cookie 透传到 WebView | 仅 Cookie 轨，跨域/SSO 无力 |
| Capacitor | `cookieSync` 插件 | 平台差异大，降级靠业务 |

**根因**：登录态、请求、缓存**散落在各页面各自为政**，没有「资源池」这一等概念。

## 2. 设计：三层资源池 + 双轨策略

```
L1 登录态   Cookie ⇄ Token 自动降级（同根域走 Cookie，跨域走 Token）
L2 请求    SSO + 拦截器（原生/WebView 用同一发件箱）
L3 缓存    TTL + 命名空间隔离（按 origin 分桶，登出全清）
              ↓
      跨页所有权（G-43 Rc/Weak 应用）
   登录态归宿主所有，页面借用，销毁时归还
```

**双轨不是妥协，是必然**：微信小程序 SSO 用 `accountId` + 临时 code（OpenID/UnionID），**不直接共享 Cookie**——必须 Cookie + Token 两条腿走路，缺一对域就崩。

## 3. 三平台事实前提（已核实）

| 平台 | Cookie 容器 | 关键 API | 关键坑 |
|------|------------|---------|--------|
| Android | `CookieManager` | `setCookie()` + `flush()` | **默认不自动同步**，OkHttp CookieJar 与 WebView 是两个世界 |
| iOS | `WKHTTPCookieStore` | `setCookie { completion }` | 异步须 await；**`WKProcessPool` 必须单例**否则多 WebView 冲突 |
| 鸿蒙 | `WebCookieManager` | `setCookie()` + `onInterceptRequest` | **推荐 Header 注入**（比 Cookie 更安全） |

Backend 内抹平这些坑，业务层无感。

## 4. 与既有体系的关系

| 依赖项 | G-46 复用/新增 |
|--------|--------------|
| G-27 渲染后端 | 对偶（外↔内），组合测试 |
| G-39 宿主运行时（host-runtime） | 资源生命周期归属宿主 |
| G-42 宿主容器（host-container） | 能力调用过网关（签名同源） |
| **G-43 资源所有权（ownership）** | **★ 跨页资源所有权（G-43 在登录态/缓存域的应用实例）** |
| 本包 RSC 系（凭证/登录安全） | RSC-01~05 铁律（新增） |
| G-44 测试 IR | conformance 复用 runner |
| G-45 动态装载 | 资源模块可插件化 |

## 5. 诚实边界（先说清不承诺什么）

- 不承诺「像素级一致」，只承诺「**接口可替换 + 降级不崩溃 + conformance 保证核心语义一致**」
- HttpOnly 隔离由**原生层强制**，JS 只读 Token
- SSO 依赖后端协议，框架只规范换取流程
- iOS 异步 API 须 await，Backend 内封装
- Android 5.0 前后 `CookieSyncManager` 兼容差异由 Backend 处理
