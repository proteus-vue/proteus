# 05 — M7/M8: 超级应用加固 + 可观测性

## 一、M7: 可靠性加固

### M7.1 启动性能优化

**目标**：冷启动首屏 < 1s（中等机型）

策略：
1. **关键路径并行**：`coreReady` 内 Pinia/Auth/Modules 并行初始化
2. **非关键延迟**：`interactive` 之后用 `requestIdleCallback` 加载非核心模块
3. **分包预加载**：`navigationReady` 阶段触发 `preloadRule`
4. **骨架屏占位**：`beforeFirstPaint` 超时时 fallback 到骨架屏

```ts
defineApp({
  phases: {
    coreReady: {
      timeout: 5000,
      parallel: ['pinia', 'auth', 'criticalModules'], // ← 并行
    },
    interactive: {
      timeout: 5000,
      defer: ['analytics', 'feedback', 'nonCriticalModules'], // ← 延迟
    },
  },
})
```

**懒加载非关键模块**：
```ts
async interactive(ctx) {
  requestIdleCallback(() => {
    import('./modules/analytics')
    import('./modules/feedback')
  })
}
```

### M7.2 超时与降级

每个阶段独立超时（默认见 `01-m1-phases.md`），超时后按 fallback 策略降级：

| 场景 | fallback | 用户感知 |
|------|----------|---------|
| `coreReady` 超时 | `minimal` | 进入精简模式，隐藏非核心入口 |
| `navigationReady` 超时 | `home` | 忽略 deep link，跳首页 |
| `beforeFirstPaint` 超时 | `skeleton` | 显示骨架屏，数据异步补齐 |
| `interactive` 超时 | `lazy` | 非关键模块等空闲再加载 |

**minimal 模式标记**：
```ts
ctx.isMinimalMode = true
// 业务可读此标记跳过非必要逻辑
if (!ctx.isMinimalMode) loadHeavyFeature()
```

### M7.3 错误隔离

**单层失败不阻塞其他层**：

```ts
async coreReady(ctx) {
  const results = await Promise.allSettled([
    piniaStore.restore(),      // 失败
    api.auth.refreshToken(),   // 成功
    loadModules(),             // 成功
  ])
  // 仅 pinia 失败 → 走无状态模式，其他正常
  if (results[0].status === 'rejected') {
    ctx.noStateMode = true
  }
}
```

错误边界：
- `bootstrap` 失败 → 致命，显示错误页（不可恢复）
- `coreReady` 失败 → 降级 minimal 模式
- `navigationReady` 失败 → 跳首页
- `beforeFirstPaint` 失败 → 骨架屏 + 重试
- `interactive` 失败 → 非关键，忽略

### M7.4 冷热启动与状态恢复

**launchType 三态**：
```ts
type LaunchType = 'cold'   // 首次启动 / kill 后重启
                  | 'warm'   // 后台切回
                  | 'recover' // 崩溃/强杀后重启
```

**recover 恢复策略**：
```ts
async coreReady(ctx) {
  if (ctx.launchType === 'recover') {
    // 恢复上次会话
    const session = await restoreSession()
    if (session) applySession(session)
  }
}
```

**持久化时机**（防 Skyline 无 onDestroy）：
- `onHide` → 紧急持久化关键状态
- `coreReady` 阶段 → 主动持久化核心数据
- 不只在 `onDestroy`（可能不触发）

### M7.5 内存管理

**onMemoryWarning 响应**：
```ts
onMemoryWarning(ctx, level) {
  if (level >= 15) { // 临界
    // 释放图片缓存
    imageCache.clear()
    // 卸载非活跃模块
    moduleRegistry.unloadInactive()
    // 清理离线包（保留核心）
    offlinePack.purgeNonCritical()
  }
}
```

**页面级清理清单**（`onUnload`）：
- [ ] store `$dispose()`
- [ ] 定时器 `clearInterval` / `clearTimeout`
- [ ] 事件监听 `off()`
- [ ] 网络请求 `cancel()`（AbortController）
- [ ] 文件句柄 / 数据库连接关闭

编译器可自动检测：未清理的 `setInterval` → 编译警告。

### M7.6 网络变化处理

```ts
onNetworkChange(ctx, { connected, type }) {
  if (!connected) {
    // 进入离线模式
    ctx.offline = true
    queueRequests()  // 请求排队
  } else {
    ctx.offline = false
    flushQueue()     // 恢复后重放
    if (type === 'wifi') upgradeQuality()  // WiFi 升画质
  }
}
```

## 二、M8: 可观测性

### M8.1 --trace-lifecycle

输出每个阶段的耗时 + 状态：
```
[bootstrap]        120ms ✓
[coreReady]        480ms ✓
  ├─ pinia: 120ms
  ├─ auth: 210ms
  └─ modules: 150ms
[navigationReady]  190ms ✓
  ├─ router: 90ms
  └─ preload: 100ms
[beforeFirstPaint] 310ms ⚠ fallback=skeleton
[interactive]      520ms ✓
  └─ lazy modules: 320ms
Total: 1620ms
```

实现：`LifecycleOrchestrator` 收集 `LifecycleTrace[]`，`--trace-lifecycle` 打印。

### M8.2 DevTools 集成

浏览器/小程序 DevTools 面板：
- 阶段时间线（瀑布图）
- 每阶段耗时对比（历史基线）
- 超时/降级告警
- 当前 lifecycle 状态

### M8.3 与 Pinia/Router/API trace 打通

统一 `traceId`，四层 trace 可关联：
```
[Lifecycle] bootstrap 120ms
  [Pinia]     hydrate UserStore 45ms
  [API]       auth.refresh 210ms (traceId: abc)
  [Router]    resolve routes 90ms
```

`--trace-all` 一键输出全链路。

### M8.4 CI 性能门禁

```
启动耗时基线（CI 存档）：
  cold start (中端机): ≤ 1000ms
  warm start: ≤ 300ms

PR 检测：
  若 cold start 超过基线 20% → 阻断合并
```

### M8.5 崩溃回放

`onError` + `onRecover` 配合：
- 崩溃时保存 trace + 状态快照
- 重启时 `launchType === 'recover'` 上报
- DevTools 可导入快照复现

### M8.6 审计规则

`proteus audit lifecycle`：
- [ ] 所有 `setInterval` 在 `onUnload` 清理
- [ ] 无直接 `wx.onMemoryWarning` 调用（必须走 `onMemoryWarning` 钩子）
- [ ] 无直接 `App()` / `Page()` 调用（必须走 `defineApp` / `definePage`）
- [ ] 阶段超时已配置
- [ ] 关键状态持久化不止依赖 `onDestroy`

## 三、铁律

1. 启动性能是超级应用的硬指标，必须有基线 + CI 门禁
2. 任何阶段失败都必须有降级策略，不允许白屏
3. Skyline 下"无 onDestroy"必须靠 `onHide` 持久化兜底
4. trace 数据是调试核心，默认开发模式全开，生产采样
