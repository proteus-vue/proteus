# Proteus Router —— 声明式路由 + 原生导航映射

> 执行位：**G-32**（P0，与 App Renderer G-05、安全区 G-09 协同）
> 依赖：`proteus-app-renderer-plan`（页面栈 diff）、`proteus-safe-area`（转场避让安全区）、`proteus-glass-plan`（导航栏玻璃）、Architecture 原则 #10
> 目标：让 `router.push()` 在五端（Web / Skyline / iOS / Android / 鸿蒙）映射到**各自最优的原生导航实现**，业务代码零平台分支。

---

## 1. 问题定义

### 1.1 为什么路由必须框架收敛

跨端框架的路由是**最容易"各端各写"、也最容易暴露原生差异**的能力：

| 平台 | 原生导航模型 |
|------|-------------|
| iOS | `UINavigationController` 栈 + 模态 `present` + `UIViewController` 转场动画 |
| 鸿蒙 | `Navigation` 组件 + `NavPathStack` + `NavDestination` |
| Android | `Activity` / `Fragment` 栈 + `FragmentTransaction` + Navigation Component |
| Web | History API + `<router-view>` |
| Skyline | 小程序页面栈 `wx.navigateTo` |

如果让组件开发者手动调 `uni.navigateTo` / `plus.webview` / `UINavigationController.pushViewController`，**等于放弃三端同源**，且转场、手势返回、安全区避让全要重写。

### 1.2 竞品现状（痛点）

| 方案 | 路由能力 | 缺陷 |
|------|---------|------|
| uni-app | `uni.navigateTo` + `pages.json` | 配置与组件分离，运行时黑盒；App 端依赖 WebView 栈，原生转场受限 |
| uni-app x (uvue) | 新 `Navigation` API | 编译期绑定原生，但脱离 JS 生态；配置仍碎片化 |
| RN | `@react-navigation` | JS 层维护栈，原生转场需自定义 `createStackNavigator`；手势返回需额外配置 |
| Flutter | `Navigator` + `GoRouter` | 声明式但自绘，转场是 widget 动画，非原生 |

**共性缺陷**：要么配置与组件分离（维护两份事实源），要么原生转场能力受限，要么放弃 JS 生态。

### 1.3 Proteus 的差异化

> **声明式路由配置（单一事实源） + Vue Router 兼容写法 + 转场 diff → 五端原生导航栈**

- 配置与页面组件**合一**（SFC + `route` 字段）
- 转场由框架生成（开发者不写 `presentViewController`）
- 手势返回、安全区、导航栏玻璃**自动集成**

---

## 2. 核心设计

### 2.1 路由语义层（统一）

```typescript
// app.config.ts 或各页面 SFC 的 <route> 块
interface RouteRecord {
  path: string                    // 声明式路径（兼容 Vue Router）
  name?: string
  component: Component            // 直接引用 SFC（单一事实源）
  meta?: {
    stack?: 'push' | 'present' | 'replace' | 'tab'  // 转场语义
    transition?: 'slide' | 'fade' | 'flip' | 'none' // 转场类型
    gesture?: boolean             // 是否允许手势返回
    safeArea?: boolean            // 是否避让安全区（默认 true）
    glass?: boolean               // 导航栏是否玻璃（默认跟随主题）
    keepAlive?: boolean           // 是否缓存页面实例
  }
}
```

**关键**：`stack` / `transition` 是**语义**，不是平台 API。框架映射到各端原生实现。

### 2.2 五端映射

| 语义 | iOS | Android | 鸿蒙 | Web | Skyline |
|------|------|---------|------|-----|---------|
| `push` | `pushViewController` | `FragmentTransaction.add` | `NavPathStack.push` | `history.pushState` | `wx.navigateTo` |
| `present` | `presentViewController` (modal) | `Activity.start` (new task) | `Navigation.pushDestination` | 路由 replace | 无（降级 push） |
| `replace` | `setViewControllers` | `replace` | `replace` | `replaceState` | `redirectTo` |
| `tab` | `UITabBarController` | `BottomNavigationView` | `Tabs` + `TabContent` | SPA 路由 | `switchTab` |
| `back` | `popViewController` | `popBackStack` | `pop` | `history.back` | `navigateBack` |

### 2.3 页面栈 diff（核心机制）

App Renderer 的 Reconciler 不仅 diff VNode，**也对路由栈做 diff**：

```
Route[] (声明式，开发者维护)
    ↓ Vue Router 计算差异
RoutePatch (push/pop/replace/tab)
    ↓ Router Adapter（按平台生成转场事务）
五端原生导航 API（JSI 同步调用）
```

**转场事务**（类比 PageTeardownTransaction）：框架生成一个"转场描述"，包含入场页、出场页、动画类型、手势、**安全区避让**——开发者只写 `router.push('/detail')`。

---

## 3. 手势返回与安全区集成

### 3.1 手势返回

| 平台 | 原生能力 | Proteus 处理 |
|------|---------|-------------|
| iOS | 系统自带 `interactivePopGestureRecognizer` | 默认开启，`meta.gesture=false` 关闭 |
| Android | `OnBackPressedDispatcher` + `SwipeBackLayout`（需实现） | 框架提供 `SwipeBackLayout` 通过 JSI 监听 touch |
| 鸿蒙 | `NavPathStack` 默认支持侧滑返回 | 直接启用 |
| Web | 浏览器后退 + 手势库 | `vue-router` 默认 |

### 3.2 安全区避让（联动 G-09）

转场过程中导航栏/内容区自动应用 `p-safe-*`：

- iOS：转场时 `additionalSafeAreaInsets` 动画过渡
- 鸿蒙/Android：`padding` 随转场进度插值
- 灵动岛区域：`<pg-glass>` 导航栏在转场中保持融合（G-09 的 `containerRelativeAnchor`）

**开发者零感知**——这是路由与 Safe Area 协同的关键价值。

---

## 4. API 设计（业务零平台分支）

```vue
<!-- pages/detail.vue -->
<route>
{
  "path": "/detail/:id",
  "meta": { "stack": "push", "transition": "slide", "glass": true }
}
</route>

<template>
  <p-view class="detail">
    <pg-glass preset="navigationBar">
      <p-text>详情 {{ $route.params.id }}</p-text>
    </pg-glass>
    <p-button @tap="goBack">返回</p-button>
  </p-view>
</template>

<script setup>
import { useRouter } from '@proteus-vue/router'
const router = useRouter()
const goBack = () => router.back()
</script>
```

```typescript
// 编程式导航（兼容 Vue Router API）
router.push({ path: '/detail', params: { id: 1 } })
router.replace('/home')
router.present('/modal')  // 语义：模态弹出
```

**`useRouter()` / `useRoute()` 与 Vue Router 同名同义** —— 降低迁移成本。

---

## 5. 导航栏玻璃集成（联动 Glass G-07）

`meta.glass = true` 时，框架自动：
- iOS：导航栏应用 `UIGlassEffect`（含灵动岛融合）
- 鸿蒙：`backgroundBlur` + `blendMode`
- Android：`RenderEffect.createBlurEffect`
- Web/Skyline：`<pg-glass>` 降级为 `backdrop-filter`

开发者只需 `<pg-glass preset="navigationBar">`，**转场时玻璃效果随导航栏动画一致**。

---

## 6. 严格规则（--strict-router）

| 规则 | 说明 | 处理 |
|------|------|------|
| ROUTE001 | 禁止直接调用平台导航 API（`UINavigationController` / `wx.navigateTo`） | error → 改用 `router.push` |
| ROUTE002 | 页面必须声明 `<route>` 或注册在 `routes` | error |
| ROUTE003 | `path` 必须 kebab-case，参数用 `:name` | error |
| ROUTE004 | `meta.stack` 非法值 | error |
| ROUTE005 | 转场中修改路由（竞态） | warn + 队列化 |

---

## 7. 分批策略

| 批次 | 内容 | 依赖 | 可单测 |
|------|------|------|--------|
| **M1** | Router Core：栈 diff + Web/Skyline 实现 | Compiler B1 | ✅（纯逻辑） |
| **M2** | iOS `UINavigationController` + 手势返回 + 安全区 | App Renderer M2 | 🔶（需 Xcode） |
| **M3** | Android + 鸿蒙 NavPathStack | App Renderer M3 | 🔶 |
| **M4** | 转场事务 + 玻璃集成 + Deep Link | Glass M1 | 🔶 |

**M1 零依赖可单测** —— 纯逻辑实现栈 diff + Web 适配，可直接跑单元测试验证路由计算正确性。

---

## 8. 对标总结

| 能力 | uni-app | RN Navigation | Flutter | **Proteus** |
|------|---------|---------------|---------|------------|
| 声明式配置 | ✅ pages.json | ✅ | ✅ | ✅（与组件合一） |
| 单一事实源 | ⚠️ 配置分离 | ⚠️ | ✅ | ✅ |
| 原生转场 | ⚠️ | ⚠️ | ❌ 自绘 | ✅ |
| 手势返回 | ✅ | 🔶 配置 | ✅ | ✅（自动） |
| 安全区集成 | ❌ | ❌ | ❌ | ✅ |
| 导航栏玻璃 | ❌ | ❌ | ❌ | ✅ |

**Proteus = 唯一同时做到"声明式 + 单一事实源 + 原生转场 + 安全区/玻璃自动集成"的路由方案。**

---

## 9. 关联文档

- `proteus-app-renderer-plan`：页面栈 diff 机制、Custom Renderer
- `proteus-safe-area`：转场安全区避让、灵动岛融合
- `proteus-glass-plan`：导航栏玻璃映射
- `proteus-style-safety`：路由组件样式也受 Validator 管控
- Architecture 原则 #10：路由语义 → 原生实现
- `proteus-positioning.md`：杀手特性之一（声明式路由 + 原生转场）
