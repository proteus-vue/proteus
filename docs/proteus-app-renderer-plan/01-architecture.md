# 01 分层架构与 JSI 双引擎

## 1. 整体分层

```
┌─────────────────────────────────────────────────┐
│  SFC（同一份，三端共享）                          │
│  <pg-glass preset="regular">                    │
├─────────────────────────────────────────────────┤
│  Compiler IR（平台无关中间表示）                  │
├──────────────┬──────────────┬───────────────────┤
│  Web         │  Skyline     │  App（本方案）     │
│  DOM / CSS   │  WXML        │  Custom Renderer   │
│              │              │       │            │
│              │              │  ┌────▼────────┐   │
│              │              │  │ JSI Binding  │   │
│              │              │  │ (同步直调)    │   │
│              │              │  └────┬────────┘   │
│              │              │       │            │
│              │              │  iOS  │ Android    │
│              │              │  UIKit│ View       │
│              │              │  Swift│ Kotlin     │
│              │              │  ArkUI│           │
└──────────────┴──────────────┴───────────────────┘
```

## 2. 为什么不用 React Native 的异步 Bridge

| 维度 | RN Bridge | JSI（本方案） |
|------|-----------|---------------|
| 调用方式 | 异步序列化 JSON | 同步直调 |
| 跨线程 | 必须 | 可选 |
| 延迟 | ms 级 | < 1ms |
| 手势/动画 | 受限 | 原生级 |
| 类型 | 手动 | 自动生成 |

**结论**：Bridge 的序列化成本对动画/手势/渲染类 API 是致命的。JSI 直接在 JS 引擎与 Native 间建立同步通道，借鉴 NativeScript 的 binding 思路。

## 3. JSI 双引擎

### 3.1 iOS：JavaScriptCore + Swift

```
JS (V8/JSC) ←→ JSI Host Object (C++) ←→ Swift Native View
```

- JSI Host Object 暴露 `createView(type)` / `setProp(id, key, value)` / `appendChild`
- Swift 侧实现 `ProteusViewRegistry`，维护 View 树

### 3.2 Android：V8 + JNI

```
JS (V8) ←→ JSI Host Object (C++) ←→ JNI ←→ Kotlin Native View
```

- 同一套 Host Object 接口（C++ 共享），Android 侧 JNI 桥到 Kotlin

### 3.3 鸿蒙：ArkUI + Node-API

```
JS (ArkCompiler) ←→ Node-API ←→ ArkUI Native View
```

- 鸿蒙使用 ArkUI 的 Native 模式，通过 Node-API 对接

## 4. 渲染管线（一帧）

```
1. Compiler 产出 IR（平台无关）
2. Custom Renderer 接收 IR，diff 出 View 指令
3. 指令入队（UI 线程安全）
4. JSI 同步执行：createView / updateProp / removeView
5. Native 渲染树提交，GPU 合成
6. DevTools TraceBus 记录耗时
```

## 5. 线程模型（概要，详见 05）

| 线程 | 职责 |
|------|------|
| JS 线程 | 逻辑 / diff |
| UI 线程（主线程） | 视图操作（**必须**） |
| Worklet 线程 | 手势 / 动画 |

**铁律 A-05**：跨线程访问必须显式标注（`@UI` / `@Worklet`）。

## 6. 与 Glass 的对接点

```
<preset="regular">
  ├─ Web/Skyline → backdrop-filter（L1）
  └─ App → JSI → UIGlassEffect(.regular)（L3，iOS 26+）
           → ArkUI blur（L3，鸿蒙 NEXT）
           → RenderEffect（L3，Android API 31+）
```

详见 `07-glass-l3-integration.md`。
