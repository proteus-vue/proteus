# G-46 架构：宿主级统一资源池

## 1. 分层

```
┌─ 应用层（页面：原生 / WebView / Flutter） ─┐
│   页面只声明「我需要登录态」，不关心来源       │
├─ 资源门面（ResourceFacade）                   │
│   getAuth() / fetch() / cache()              │
├─ 资源池（ResourcePool，宿主持有）             │
│   L1 登录态 │ L2 请求 │ L3 缓存               │
├─ 双轨桥接                                    │
│   CookieBackend ⇄ TokenBackend ─→ 自动降级    │
├─ 能力网关（G-42，签名同源）                   │
│   所有跨页能力调用须过网关                     │
└─ 平台 Backend（可插拔，conformance 验证）     │
    Android / iOS / 鸿蒙
```

**核心洞察**：资源池是**宿主的单例**，页面是**借用者**。这与 G-43 资源所有权（ownership）模型「宿主拥有资源、页面借用」完全同构。

## 2. 三层资源池

| 层 | 内容 | 生命周期 | 隔离 |
|----|------|---------|------|
| L1 | Cookie + Token + SSO | 登录→登出 | HttpOnly / 同源白名单 |
| L2 | 请求队列 + 拦截器 | 请求周期 | 统一发件箱 |
| L3 | 缓存（origin 命名空间） | TTL / 登出 | 按 origin 分桶 |

**登出 = L1→L2→L3 级联销毁**（RSC-02），含跨页 Weak 引用一并清理。

## 3. 双轨策略

```
getAuth(domain, origin):
  if Cookie 可用 (同根域 + 非 HttpOnly): → 'cookie'
  else if Token 可用 (origin 已换取):    → 'token'
  else:                                  → null（降级不崩溃）
```

- **同根域** → Cookie 同步轨（Wildcard Cookie + HttpOnly/Secure/SameSite）
- **跨域 / 第三方小程序** → Token 注入轨（鸿蒙 Header 注入 / SSO code 换取）
- **Cookie 不可用** → 自动降级 Token 轨（原则 #4 降级不崩溃）

## 4. 生命周期

```
登录 ─→ L1 写入（Cookie 或 Token） ─→ 页面 attach（Rc+1）
                                            ↓
操作 ─→ 门面取 auth ─→ 双轨桥接 ─→ 平台 Backend
                                            ↓
登出 ─→ L1 清空 ─→ L2 取消进行中请求 ─→ L3 全清 ─→ 跨页引用清空
```

## 5. 组合测试（与 G-27 集成）

这是 G-44 INT 系列的下一个靶点：**「切换渲染后端时，登录态不丢」**。

```
页面 A (NativeBackend) 登录 → 资源池 L1 写入
        ↓ 切到
页面 B (VueDomBackend) → 门面 getAuth() 仍返回同一登录态
```

G-27（外）+ G-46（内）形成**一致性闭环**，由一份集成 conformance 验证。
