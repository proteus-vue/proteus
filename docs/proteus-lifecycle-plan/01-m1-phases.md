# 01 — M1: 阶段定义与 defineApp API

## 一、目标

定义 Proteus 应用生命周期的 **5 个启动阶段 + 运行时钩子 + 终止钩子**，
并提供统一的 `defineApp()` API，业务只用写一次，三端编译期映射。

## 二、完整钩子清单

| 钩子 | 时机 | 小程序原生 | Web | App Native |
|------|------|-----------|-----|------------|
| `bootstrap` | 框架初始化开始 | `onLaunch` 前半 | `beforeMount` | `didFinishLaunching` |
| `coreReady` | 核心服务就绪 | — | — | — |
| `navigationReady` | 可导航 | — | — | — |
| `beforeFirstPaint` | 首屏渲染前 | — | — | — |
| `interactive` | 可交互 | — | `mounted` | `viewDidAppear` |
| `onShow` | 前台 | `onShow` | `visibilitychange` | `didBecomeActive` |
| `onHide` | 后台 | `onHide` | `visibilitychange` | `didEnterBackground` |
| `onMemoryWarning` | 内存警告 | `onMemoryWarning` | — | `didReceiveMemoryWarning` |
| `onNetworkChange` | 网络变化 | `onNetworkStatusChange` | `online/offline` | reachability |
| `onDestroy` | 应用销毁 | — | `beforeunload` | `willTerminate` |
| `onRecover` | 崩溃/强杀后恢复 | `onLaunch` 区分 | sessionStorage | 状态文件 |
| `onError` | 未捕获错误 | `onError` | `error`/`unhandledrejection` | crash handler |

## 三、defineApp API

```ts
// app.ts（三端通用）
import { defineApp } from '@proteus-vue/runtime'

export default defineApp({
  // —— 启动阶段（按顺序执行）——
  bootstrap(ctx) {
    // Platform: 探测能力
    // Module: 加载注册表
  },
  async coreReady(ctx) {
    // Pinia: createPinia + hydrate
    // API: request + auth refresh
  },
  navigationReady(ctx) {
    // Router: 路由表解析
    // 分包预加载
    // 处理 deep link / 扫码 path
  },
  beforeFirstPaint(ctx) {
    // 根组件挂载准备
  },
  interactive(ctx) {
    // 首屏完成
    // 非关键模块懒加载
    // trace 上报
  },

  // —— 运行时 ——
  onShow(ctx) { /* 恢复播放 / 轮询 / token */ },
  onHide(ctx) { /* 暂停播放 / 动画 / 定时器 */ },
  onMemoryWarning(ctx) { /* 释放图片缓存 / 离线包 */ },
  onNetworkChange(ctx, info) { /* WiFi→4G: 降画质 */ },

  // —— 终止 / 恢复 ——
  onDestroy(ctx) { /* 紧急持久化 + 释放资源 */ },
  onRecover(ctx) { /* 恢复上次会话状态 */ },

  // —— 错误 ——
  onError(err, ctx) { /* 上报 + 降级 */ },
})
```

## 四、上下文对象（LifecycleContext）

```ts
interface LifecycleContext {
  launchType: 'cold' | 'warm' | 'recover'
  launchOptions?: { path: string; query: Record<string, string> }
  network: 'wifi' | '4g' | '3g' | 'none'
  platform: 'web' | 'skyline' | 'app'
  trace: LifecycleTracer  // --trace-lifecycle
  store: (id: string) => any  // 读取 Pinia store
  module: (domain: string) => any  // 读取 Module
}
```

## 五、阶段配置（超时 + 降级）

```ts
defineApp({
  phases: {
    bootstrap: { timeout: 3000, fallback: 'warn' },
    coreReady:  { timeout: 5000, fallback: 'minimal' }, // 超时走 minimal 模式
    navigationReady: { timeout: 2000, fallback: 'home' },
    beforeFirstPaint: { timeout: 3000, fallback: 'skeleton' },
    interactive: { timeout: 5000, fallback: 'lazy' },
  },
})
```

`fallback` 策略：
- `warn` → 打 warning，继续
- `minimal` → 进入精简模式（不加载非核心模块）
- `home` → 强制跳首页
- `skeleton` → 显示骨架屏，异步补齐
- `lazy` → 延后到空闲时段执行

## 六、冷热启动区分

```ts
// Skyline / 微信
App({
  onLaunch(options) {
    const isRecover = wx.getStorageSync('__last_session__') &&
                      !wx.getStorageSync('__graceful_close__')
    // → 标记为 recover
  },
})

// Proteus 统一
ctx.launchType:
  'cold'   → 首次启动 / kill 后重启
  'warm'   → 后台切回（onShow）
  'recover'→ 崩溃/强杀后重启，需恢复会话
```

## 七、编译期映射（透明化）

`defineApp({ bootstrap })` → 编译期生成：

- **Web**：`app.mount()` 前后包裹 `bootstrap()` / `coreReady()` 调用
- **Skyline**：`App({ onLaunch: bootstrap, onShow: onShow, ... })`
- **App**：Custom Renderer 对接原生生命周期，调用同名钩子

产物里可审计：每个钩子对应哪段业务代码，写在 `app.json` 的 `__proteus_lifecycle__` 字段（开发模式）。

## 八、AI 协作规范

- 业务钩子里**只允许读 `ctx` + 调已注册服务**，禁止直接 `wx.*`/`window.*`
- 耗时操作必须 `await`，禁止阻塞阶段
- 新增阶段需更新 `00-overview.md` 的阶段图 + `10-execution-batches.md` 依赖图
