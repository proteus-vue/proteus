# 宿主接入指南（G-41）

> 一步一步把 Proteus 接进你的 App。五个平台各一份对照表。

---

## 0. 通用 8 步流程

```
1  集成 Proteus Runtime 包
2  实现/选用 HostRuntime   （G-39：线程 + 事件循环）
3  选择执行载体           （G-40：JSI / AOT / WASM）
4  选择/实现 RenderBackend（G-27）
5  实现 CapabilityBackend （G-28，按需）
6  宿主生命周期挂钩
7  加载业务产物           （G-38 产出）
8  attachToHost + 跑 host-conformance  ← 硬门禁
```

---

## 1. iOS（UIKit / SwiftUI）

| 步骤 | 做法 |
|------|------|
| 1 | Swift Package 引入 `ProteusRuntime` |
| 2 | `iOSHostRuntime`：Main Thread（UI）+ GCD（后台）+ `CFRunLoop` |
| 3 | 载体：`JSCarrier`（JavaScriptCore via JSI），或 `AOTCarrier` |
| 4 | Backend：`ios-uikit`（内置）或 `flutter` / `skia` |
| 5 | `ios-capability`：AVCapture / CoreLocation / … |
| 6 | `AppDelegate` → `applicationDidBecomeActive` ↔ `resume()` |
| 7 | 加载 `main.js.bundle` 或 AOT 产物 |
| 8 | `attachToHost(window.rootViewController!.view)` |

```swift
// AppDelegate.swift
let runtime = iOSHostRuntime()
let carrier = JSCarrier()                       // 或 AOTCarrier()
let backend = UIKitRenderBackend()              // 或 FlutterRenderBackend()
let caps    = iOSCapabilityBackend()

let app = ProteusApp(runtime: runtime, carrier: carrier)
try app.register(backend)                        // G-41.6：bootstrap 前注册
try app.register(caps)
try app.bootstrap()

let root =ProteusRootView(app: app)
window.rootViewController = UIHostingController(rootView: root)
app.attachToHost(root)                           // 第 8 步
assert(HostConformance.run(app).failed == 0)     // 门禁
```

**生命周期挂钩：**

```swift
func applicationDidEnterBackground(_: UIApplication) { app.suspend() }
func applicationWillEnterForeground(_: UIApplication) { app.resume() }
func applicationWillTerminate(_: UIApplication)       { app.destroy() }
```

---

## 2. Android

| 步骤 | 做法 |
|------|------|
| 1 | Gradle：`implementation 'dev.proteus:runtime'` |
| 2 | `AndroidHostRuntime`：Main Looper + `Handler` + 协程线程池 |
| 3 | 载体：`JSCarrier`（V8/Hermes），或 `AOTCarrier` |
| 4 | Backend：`android-view`（内置）或 `skia` / `flutter` |
| 5 | `android-capability`：CameraX / FusedLocation / … |
| 6 | `Application.onCreate` + `Activity` 生命周期 |
| 7 | 加载 assets 中的 bundle |
| 8 | `attachToHost(binding.root)` |

```kotlin
class MainApp : Application() {
  override fun onCreate() {
    val app = ProteusApp(
      runtime = AndroidHostRuntime(this),
      carrier = JSCarrier()
    )
    app.register(AndroidViewRenderBackend())
    app.register(AndroidCapabilityBackend(this))
    app.bootstrap()
    ProteusHolder.app = app
  }
}

class MainActivity : Activity() {
  override fun onCreate(b: Bundle?) {
    setContentView(R.layout.main)
    ProteusHolder.app.attachToHost(findViewById(R.id.proteus_root))
  }
  override fun onPause()  { ProteusHolder.app.suspend() }
  override fun onResume() { ProteusHolder.app.resume() }
  override fun onDestroy(){ ProteusHolder.app.destroy() }
}
```

---

## 3. Flutter（作为宿主，Proteus 内嵌）

| 步骤 | 做法 |
|------|------|
| 1 | `proteus_flutter` pub 包 |
| 2 | `FlutterHostRuntime`：Isolate（UI）+ `compute()`（后台）+ Dart EventQueue |
| 3 | 载体：`JSCarrier`（`flutter_js`）或 `AOTCarrier` |
| 4 | Backend：`flutter`（Widget Tree，推荐）或 `skia` |
| 5 | `flutter-capability`：platform channel 转发 |
| 6 | `WidgetsBindingObserver` 监听 `AppLifecycleState` |
| 7 | 加载 bundle（`rootBundle.loadString`） |
| 8 | `ProteusWidget()` 作为接入点 |

```dart
final app = ProteusApp(
  runtime: FlutterHostRuntime(),
  carrier: JSCarrier(),
);
await app.register(FlutterRenderBackend());
await app.bootstrap();

runApp(MaterialApp(home: ProteusWidget(app: app)));
```

---

## 4. HarmonyOS（ArkUI）

| 步骤 | 做法 |
|------|------|
| 1 | ohpm：`@proteus-vue/runtime` |
| 2 | `HarmonyHostRuntime`：Main Thread + `TaskPool` + `EventHandler` |
| 3 | 载体：`JSCarrier`（ArkCompiler）或 `AOTCarrier` |
| 4 | Backend：`harmony-arkui` |
| 5 | `harmony-capability`：`@ohos.*` 系列 |
| 6 | `UIAbility` 的 `onForeground` / `onBackground` |
| 7 | 加载 `rawfile` 中的 bundle |
| 8 | `attachToHost` 到 `Column` 容器 |

```ts
// EntryAbility.ets
onCreate() {
  const app = new ProteusApp(new HarmonyHostRuntime(), new JSCarrier())
  app.register(new ArkUIRenderBackend())
  app.register(new HarmonyCapabilityBackend())
  app.bootstrap()
  AppStorage.setOrCreate('proteusApp', app)
}
onForeground() { (AppStorage.get('proteusApp') as ProteusApp).resume() }
onBackground() { (AppStorage.get('proteusApp') as ProteusApp).suspend() }
```

---

## 5. Web（含 SSR）

| 步骤 | 做法 |
|------|------|
| 1 | npm：`@proteus-vue/runtime` |
| 2 | `WebHostRuntime`：Main + Worker + Event Loop |
| 3 | 载体：`JSCarrier`（V8）或 `WasmCarrier` |
| 4 | Backend：`vue-dom`（内置，零成本） |
| 5 | `web-capability`：Geolocation / MediaDevices / … |
| 6 | `visibilitychange` 事件 |
| 7 | 加载 bundle（或 SSR 直出 HTML） |
| 8 | `attachToHost(document.getElementById('app'))` |

```js
const app = new ProteusApp(new WebHostRuntime(), new JSCarrier())
app.register(new VueDomBackend())      // ★ 基于 Vue createRenderer，零成本
app.register(new WebCapabilityBackend())
await app.bootstrap()
app.attachToHost(document.getElementById('app'))
```

**SSR**：`HeadlessBackend` 产出 HTML 字符串， hydration 时切回 `VueDomBackend`。

---

## 6. 各平台对照总表

| | iOS | Android | Flutter | Harmony | Web |
|---|-----|---------|---------|---------|-----|
| Runtime | GCD+CFRunLoop | Looper+协程 | Isolate+compute | TaskPool+EventHandler | EventLoop+Worker |
| Carrier | JSC / AOT | V8 / AOT | flutter_js / AOT | ArkCompiler / AOT | V8 / WASM |
| 默认 Backend | ios-uikit | android-view | flutter | harmony-arkui | vue-dom |
| 可选 Backend | flutter, skia | skia, flutter | skia | — | — |
| 根容器 | UIView | ViewGroup | Widget | Column | HTMLElement |
| 生命周期 | AppDelegate | Activity | WidgetsBinding | UIAbility | visibilitychange |
| Tier | 1 | 1 | 1 | 1 | 1 |

---

## 7. 常见接入错误

| 错误 | 后果 | 修复 |
|------|------|------|
| bootstrap 后才 register backend | 行为未定义 | 遵守 G-41.6：注册先于 bootstrap |
| 宿主直接解析 IR | 违反 G-41.2，引擎不可换 | IR 解析只在框架层 |
| 框架代码 `Thread {}` / `new Thread` | 违反 G-41.1 | 走 `runtime.createWorker` |
| 引擎里 import vue | 违反 G-41.3 | 引擎只认 IR |
| 业务写 `if (isIOS)` | 违反 G-41.4 | 用 `@conditional` 降级 |
| 跳过 conformance 上线 | 违反 G-41.6 | CI 门禁强制 |
