# G-46 Conformance Suite

> 任何 PlatformBackend 实现必须通过以下用例方可接入（复用 G-44 Test IR runner）。

## 用例清单（CMP089-096 逐条断言）

| ID | 断言 | 铁律 |
|----|------|------|
| CMP089 | 登录态可共享：getAuth 对任意已登录 domain 返回非 null | — |
| CMP090 | HttpOnly Cookie 通过 getCookie 返回 null | RSC-01 |
| CMP091 | logout() 后 cookies.size === 0 | RSC-02 |
| CMP092 | logout() 后 tokens.size === 0 | RSC-02 |
| CMP093 | logout() 后 cache.size === 0 | RSC-02 |
| CMP094 | setCookie 无同源信息返回 false（默认拒绝） | RSC-03 |
| CMP095 | revokeToken 后 getToken 返回 null | RSC-04 |
| CMP096 | exchangeSSO 同一 code 第二次返回 null（防重放） | RSC-05 |

## 跨页所有权（G-43 应用，10 项）

| ID | 断言 |
|----|------|
| OWN-01 | pageAttach 建立强引用 |
| OWN-02 | pageObserve 建立弱引用（不预先建结构也不崩） |
| OWN-03 | pageDestroy 清空强引用 |
| OWN-04 | pageDestroy 清空弱引用 |
| OWN-05 | logout 级联清理跨页引用 |
| OWN-06 | 页面销毁后资源仍归宿主 |
| OWN-07 | 并发写同 key 不崩溃 |
| OWN-08 | 多页共享同一登录态 |
| OWN-09 | 一页销毁不影响他页 |
| OWN-10 | 最终 logout 后 tokens + refs 全清 |

## 负向测试（校验器必须有牙齿，3 项与 reference-impl.cjs 段 D 一致）

| ID | 场景 | 期望 |
|----|------|------|
| NEG-01 | XSS 尝试读 HttpOnly Cookie | 返回 null（RSC-01） |
| NEG-02 | 跨域 evil.com 写入 Cookie（显式 domain） | mock 层仅校验显式 domain，真实跨域拒绝由网关实施（RSC-03） |
| NEG-03 | HttpOnly 隔离不可绕过（重复访问仍返回 null） | 返回 null（RSC-01） |

> 口径说明：原稿 NEG 中「无签名资源模块注入拒装（G-45 同源）」为独立缺口——参考实现未含模块装载路径，断言待 B 落地（不臆造代码）；「重复 SSO code」已由 CMP096（RSC-05）覆盖，不重复计数。

## 三平台矩阵

```
                     Android   iOS   鸿蒙
setCookie 同源写        ✓        ✓     ✓
HttpOnly 隔离           ✓        ✓     ✓
Token 吊销              ✓        ✓     ✓
SSO 防重放              ✓        ✓     ✓
登出级联清理            ✓        ✓     ✓
Header 注入（优于Cookie） —       —    ★ 推荐
WKProcessPool 单例       —       ★     —
CookieManager flush      ★       —     —
```

**任一单元格 FAIL → 该 Backend 拒绝接入。**
