# 路由分批策略（G-32 / M1-M4）

## 1. 依赖图

```
Compiler B1 (IR)
    ↓
M1: Router Core (栈 diff + Web/Skyline)  ← 零依赖，可单测
    ↓
App Renderer M2 (iOS) ──→ M2: iOS UINavigationController
    ↓
App Renderer M3 (Android/鸿蒙) ──→ M3: Android + 鸿蒙
    ↓
Glass M1 + Safe Area M1 ──→ M4: 转场事务 + 玻璃 + Deep Link
```

## 2. 各批次

| 批次 | 内容 | 依赖 | 可单测 | Prompt 模板 |
|------|------|------|--------|------------|
| **M1** | Router Core：栈 diff + Vue Router 兼容 API + Web/Skyline 适配 | Compiler B1 | ✅ 纯逻辑 | 见下 |
| **M2** | iOS `UINavigationController` + 手势返回 + 安全区避让 | App Renderer M2 | 🔶 Xcode | — |
| **M3** | Android `FragmentTransaction` + 鸿蒙 `NavPathStack` | App Renderer M3 | 🔶 | — |
| **M4** | 转场事务 + 玻璃集成 + Deep Link + TabBar | Glass M1, Safe Area M1 | 🔶 | — |

## 3. M1 Prompt 模板（可直接使用）

```
实现 @proteus-vue/router 的 Core 层（纯 TypeScript，零原生依赖，可单元测试）：

【目标】
1. 实现 RouteRecord 类型（兼容 Vue Router 写法 + meta.stack/transition/gesture/safeArea/glass 语义）
2. 实现 createRouter + router.push/replace/back/present + useRouter/useRoute
3. 实现路由栈 diff：输入 Route[]，输出 RoutePatch[]（push/pop/replace/tab 操作序列）
4. 实现 Web 适配（history.pushState）与 Skyline 适配（wx.navigateTo 桩）
5. 参数序列化（JSON，避免循环引用，联动 Memory G-06）
6. 转场竞态队列（ROUTE005）

【验收】
- 单元测试：push/pop/replace/tab 栈状态正确；嵌套路由；参数传递；竞态队列
- 性能：栈 diff < 2ms（1000 条路由）
- 遵循 Architecture 原则 #10（语义 → 原生，本层只产 IR，不调原生）
- 集成 TraceBus（每次导航 emit trace）
```

## 4. 风险与缓解

| 风险 | 缓解 |
|------|------|
| iOS/Android 手势返回差异大 | M2/M3 各自封装，语义层统一 |
| 鸿蒙 NavPathStack API 演进 | 版本适配层（adapter） |
| 转场与玻璃协同复杂 | M4 独立批次，先跑通无玻璃转场 |
| Deep Link 冷启动栈构造 | 复用栈 diff，直达目标页 |

## 5. 关联执行位

- **G-32**（本方案）
- G-05 App Renderer（页面栈）
- G-09 安全区（转场避让）
- G-07 Glass（导航栏玻璃）
- G-31 Style Safety（路由组件样式）
