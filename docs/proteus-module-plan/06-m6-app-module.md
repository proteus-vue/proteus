# M6 App 端模块化（Native Module + JSI）

## 目标

App 端（Custom Renderer）用 iOS Framework / Android AAR 做物理模块隔离，JS 通过 JSI 桥接调用原生能力。

## 映射规则

| Module 契约 | App 产物 |
|------|------|
| `name: 'trade'` | iOS: `TradeModule.framework` / Android: `:trade:aar` |
| `capabilities` | Native 侧实现（PaymentCapability 等） |
| `dependencies` | Native 模块依赖声明（Pod / Gradle） |
| 服务调用 | JSI / TurboModule 同步桥 |

## 架构

```
JS 线程                    Native 主线程
─────────                  ─────────────
ModuleOrchestrator  ←JSI→   ModuleRegistry
  ├─ trade (js)             ├─ TradeModule (iOS)
  └─ user (js)              └─ UserModule (Android)
       ↕                         ↕
  services (js)            native services (objc/kotlin)
```

## Native 模块协议

```objc
// iOS: TradeModule.h
@protocol ProteusModule <NSObject>
@property (nonatomic, strong) NSString *name;
@property (nonatomic, strong) NSString *version;
- (void)onInit:(NSDictionary *)config;
- (void)onDestroy;
@end

@interface TradeModule : NSObject <ProteusModule>
@end
```

```kotlin
// Android: TradeModule.kt
interface ProteusModule {
  val name: String
  val version: String
  fun onInit(config: Map<String, Any>)
  fun onDestroy()
}

class TradeModule : ProteusModule { ... }
```

## JSI 桥接

```ts
// JS 侧获取原生模块
const trade = ms.getNativeModule('trade')
trade.openOrderDetail({ orderId: '123' })  // 同步调用（JSI）
```

JSI 优势：同步、零序列化开销、无跨线程等待（对齐你前面定的"Custom Renderer 优先 JSI"）。

## 动态加载

- iOS：Framework 动态加载（`dlopen`）— 受 App Store 政策限制，建议首发内置全部模块，后续热更新走 JS bundle
- Android：Dynamic Feature Module（Play Core）支持真正的按需下载

## 模块生命周期对齐

Native 模块生命周期与 JS 侧 M2 一致：`onInit` / `onReady` / `onDestroy` 双向触发。

## 测试

- JSI 调用单测（mock native，验证调用参数）
- Native 模块单测（XCTest / JUnit）
- 生命周期对齐单测（JS destroy → native onDestroy 触发）
- 循环依赖检测（Native 模块图同样检测）
