# M6 — 路由守卫 + tabBar + lazy + redirect

> **里程碑**：M6（B6）
> **输入依赖**：M3（Web）、M4（mp）、M5（App）codegen
> **新增依赖**：Pinia M1-M2（`router.beforeEach` 需读登录态 store）
> **LLM 批次**：B6

---

## 1. 目标

把 `<route>` 里声明的**跨端通用导航能力**收敛到统一抽象，三端各自实现：
- 路由守卫（基于 `meta.needLogin` + 全局 `router.guards`）
- tabBar（基于嵌套树 / `router.tabBar`）
- lazy（已分散在 M3-M5，此处统一策略）
- redirect（`<route>.redirect`）

## 2. 路由守卫

### 2.1 声明方式

**页面级**（就近，写在 `<route>`）：
```json
{ "path": "/order", "meta": { "needLogin": true } }
```

**全局级**（写在 `proteus.config.ts`）：
```ts
router: {
  guards: {
    beforeEach: (to, from, next) => {
      const user = useUserStore()
      if (to.meta.needLogin && !user.isLogin) {
        return next({ name: 'login', query: { redirect: to.fullPath } })
      }
      next()
    }
  }
}
```

### 2.2 三端实现

| 端 | 守卫挂载点 |
|----|-----------|
| Web | vue-router `router.beforeEach`（原生支持）|
| mp | `wx.beforeRouteChange`（需 polyfill，或劫持 `wx.navigateTo` 系列 API）|
| App | NativeBridge `willPushScreen` 拦截 + JS 侧回调 |

**统一封装**：`createRouter().beforeEach(...)` 三端 API 一致，内部 delegate 到各端实现。

### 2.3 Pinia 依赖

守卫内 `useUserStore()` → **依赖 Pinia M1-M2 完成**（store 实例已存在）。
- Web：直接 `useUserStore()`（同一 Vue app）
- mp：从 `App.globalData.$pinia` 取（MPA 每页需重新绑定，见 Pinia M4 SSR 隔离的等价处理）
- App：共享 JS 线程 store，直接 `useUserStore()`

### 2.4 执行时机

```
push('order')
  → beforeEach 全局 (guards.beforeEach)
  → 检查 to.meta.needLogin
  → 未登录 → redirect 到 login（三端各自导航 API）
  → afterEach (guards.afterEach)
```

`--trace-router` 打印守卫链路：
```
[guard] beforeEach → /order (needLogin=true) → redirect /login
```

## 3. tabBar

### 3.1 声明

`proteus.config.ts`（唯一来源）：
```ts
router: {
  tabBar: {
    color: '#999', selectedColor: '#007AFF',
    list: [
      { name: 'home', text: '首页', icon: '/icons/home.png' },
      { name: 'user', text: '我的', icon: '/icons/user.png' },
    ]
  }
}
```

### 3.2 三端映射

| 端 | 产物 |
|----|------|
| Web | `<TabBar>` 组件（包裹 `<router-view>`），`router-link` 激活态 |
| mp | `app.json.tabBar`（原生小程序 tabBar，限制：仅首页级 + 最多 5 个）|
| App | 原生 `UITabBarController` / `BottomNavigationView` |

**嵌套关系**：`tabBar.list[i].name` 对应 `RouteNode.name` → 该节点的 `children` 组成 tab 内的导航栈（App 端原生嵌套栈，见 M5）。

### 3.3 mp 限制兜底

小程序 tabBar 仅支持"首页级 + 5 个" → 超出时在 `codegen/mp.ts` 里**告警并降级**：多余 tab 用普通页面 + 自定义底部栏实现，文档说明差异。

## 4. lazy 统一策略（汇总 M3-M5）

| 端 | `<route>.lazy: true` 含义 |
|----|--------------------------|
| Web | `() => import()` 代码分割 ✅ |
| mp | 忽略异步语义，仅标记按需注入（`lazyCodeLoading`）|
| App | 屏组件懒注册（首次 push 时才注册原生类）|

`lazy: false` → 首屏打包（适合 tab 首页、启动必需页）。

## 5. redirect

`<route>` 里 `redirect` 字段：
- **Web**：vue-router `redirect` 原生支持 ✅
- **mp**：无原生 redirect → 在页 `onLoad` 里 `wx.redirectTo({url})` 模拟（codegen 自动生成该页的 onLoad 片段）
- **App**：NativeBridge `replaceScreen` 实现

`redirect` 与 `parent` 互斥（Schema 已校验，见 M1）。

## 6. 测试

- 守卫：未登录访问 `needLogin` 页 → 跳转 login（三端 mock）
- tabBar：配置生成正确产物（Web 组件 / mp `app.json` / App 栈）
- lazy：`true/false` 三端产物差异正确
- redirect：mp 端 `redirectTo` 被调用

---

## LLM 执行提示（B6）

> 读 `00-overview.md` + `03/04/05` + 本文件。先实现守卫（依赖 Pinia），再 tabBar，最后 redirect。**mp 的 `wx.beforeRouteChange` polyfill 是最复杂部分**，单独拆函数 + 单测。
