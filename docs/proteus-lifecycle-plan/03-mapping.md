# 03 — M3/M4/M5: 三端生命周期映射

## 一、映射总表

| Proteus 钩子 | Web | Skyline (glass-easel) | App (Native) |
|-------------|-----|----------------------|--------------|
| `bootstrap` | `window.onload` 前 | `App.onLaunch` | `application:didFinishLaunching` |
| `coreReady` | `app.mount()` 前 | `App.onLaunch` 中段 | `didFinishLaunching` 中段 |
| `navigationReady` | `router.isReady()` | `App.onLaunch` 后段 | 原生导航栈 ready |
| `beforeFirstPaint` | `app.mount()` | `App.onLaunch` 末尾 | `viewDidLoad` |
| `interactive` | `mounted` + nextTick | `Page.onReady` | `viewDidAppear` |
| `onShow` | `visibilitychange` (visible) | `App.onShow` / `Page.onShow` | `didBecomeActive` |
| `onHide` | `visibilitychange` (hidden) | `App.onHide` / `Page.onHide` | `didEnterBackground` |
| `onMemoryWarning` | — (无标准) | `wx.onMemoryWarning` | `didReceiveMemoryWarning` |
| `onNetworkChange` | `online`/`offline` | `wx.onNetworkStatusChange` | reachability 监听 |
| `onDestroy` | `beforeunload` | — (无) | `willTerminate` |
| `onRecover` | `sessionStorage` 判断 | `getStorageSync` 判断 | 状态文件判断 |
| `onError` | `window.onerror` + `unhandledrejection` | `App.onError` | crash handler |

## 二、Web 端映射（M3）

### 启动
```ts
// 编译产出
const app = createApp(Root)
// bootstrap
await runPhase('bootstrap', ctx)
await app.mount('#app')
// coreReady / navigationReady 在 mount 前执行
// beforeFirstPaint → mount 完成后
// interactive → mounted + nextTick
```

### 前后台
```ts
document.addEventListener('visibilitychange', () => {
  if (document.hidden) orchestrator.emit('hide')
  else orchestrator.emit('show')
})
```

### 销毁
```ts
window.addEventListener('beforeunload', () => orchestrator.runDestroy())
```

## 三、Skyline 端映射（M4，重点）

### App() 映射
```ts
// 编译产出 app.js
App({
  onLaunch(options) {
    const ctx = createContext({ launchOptions: options })
    orchestrator.run()  // 执行全部 5 阶段
  },
  onShow() { orchestrator.emit('show') },
  onHide() { orchestrator.emit('hide') },
  onError(err) { orchestrator.emit('error', err) },
})
```

### 页面级映射（Page）
```ts
// 编译产出 pages/home/home.js
Page({
  onLoad(query) { /* onLoad */ },
  onReady() { /* ready */ },
  onShow() { /* show */ },
  onHide() { /* hide */ },
  onUnload() { /* detach store + 清理 */ },
})
```

### 关键：Skyline 页面级 store 销毁
```ts
// Pinia M7.5 依赖此项
Page({
  onUnload() {
    if (this.$store) this.$store.$dispose()  // ← 挂载在 onUnload
    cleanupTimers()
  },
})
```

### 全局组件（appBar / 播放条）
```ts
// 全局组件在 bootstrap 阶段注册
// Skyline: ComponentSpace.setGlobalUsingComponent
// 生命周期跟随 App，不随 Page 销毁
```

### 内存警告
```ts
wx.onMemoryWarning((res) => {
  orchestrator.emit('memoryWarning', res.level)
  // level: 5(低) / 10(中) / 15(高/临界)
})
```

### 网络变化
```ts
wx.onNetworkStatusChange(({ isConnected, networkType }) => {
  orchestrator.emit('networkChange', { connected: isConnected, type: networkType })
})
```

### Skyline 特殊坑
1. **无 `onDestroy`**：页面/应用被系统回收时不一定走 `onUnload`/`onHide`
   → 关键状态在 `coreReady` 阶段就持久化，不只依赖 `onDestroy`
2. **`onShow` 在冷启动也会触发**：需靠 `launchType` 区分
3. **App.onShow 与 Page.onShow 顺序**：先 App 后 Page，trace 需标注层级

## 四、App 端映射（M5，Custom Renderer）

### iOS
```objc
- (BOOL)application:(UIApplication *)application
    didFinishLaunchingWithOptions:(NSDictionary *)launchOptions {
    // bootstrap → coreReady → navigationReady → beforeFirstPaint
    [ProteusBridge runLifecycle:@"bootstrap" context:ctx];
    [ProteusBridge runLifecycle:@"coreReady" context:ctx];
    // ...
    return YES;
}

- (void)applicationDidBecomeActive:(UIApplication *)application {
    [ProteusBridge emit:@"show"];
}

- (void)applicationDidEnterBackground:(UIApplication *)application {
    [ProteusBridge emit:@"hide"];
}

- (void)applicationDidReceiveMemoryWarning:(UIApplication *)application {
    [ProteusBridge emit:@"memoryWarning"];
}

- (void)applicationWillTerminate:(UIApplication *)application {
    [ProteusBridge runLifecycle:@"destroy"];
}
```

### Android
```kotlin
override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    ProteusBridge.runLifecycle("bootstrap", ctx)
    ProteusBridge.runLifecycle("coreReady", ctx)
}

override fun onResume() { ProteusBridge.emit("show") }
override fun onPause() { ProteusBridge.emit("hide") }
override fun onLowMemory() { ProteusBridge.emit("memoryWarning") }
override fun onDestroy() { ProteusBridge.runLifecycle("destroy") }
```

### JS 桥接层
```ts
// @proteus-vue/runtime-app
export const NativeLifecycle = {
  on(event: string, handler: () => void) {
    // JSI: 注册原生 → JS 回调
  },
}
```

## 五、编译期产物示例

### 输入（业务源码）
```ts
// app.ts
export default defineApp({
  bootstrap(ctx) { /* ... */ },
  interactive(ctx) { /* ... */ },
  onShow(ctx) { /* ... */ },
})
```

### 输出（Skyline app.js）
```js
App({
  onLaunch(options) {
    const orchestrator = createOrchestrator({
      phases: [
        { name: 'bootstrap', handler: bootstrap, timeout: 3000 },
        { name: 'coreReady', handler: coreReady, timeout: 5000 },
        // ...
      ],
    })
    orchestrator.run()
  },
  onShow() { orchestrator.emit('show') },
  // ...
})
```

`--trace-transform` 记录：`defineApp.bootstrap → App.onLaunch[0]` 映射链。

## 六、铁律

1. 三端映射由编译器自动生成，**业务不得手动写平台分支**
2. Skyline 端必须正确处理"无 onDestroy"的边界（靠持久化兜底）
3. 页面级生命周期（Page）与 App 级生命周期严格分离
4. 全局组件生命周期跟随 App，不随 Page 销毁
