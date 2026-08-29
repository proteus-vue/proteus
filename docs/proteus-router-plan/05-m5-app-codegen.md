# M5 — App 端 codegen（StackNavigator 抽象）

> **里程碑**：M5（B5）
> **输入依赖**：`02-m2-route-tree.md`（RouteNode[]）
> **产出**：`packages/router/src/codegen/app.ts`、`createAppRouter()`、转场 native 映射
> **LLM 批次**：B5

---

## 1. 目标

App 端走 **Vue Custom Renderer + 原生桥**（前面架构决策），页面栈语义与小程序不同：
- Web：SPA 单根，`<router-view>` 切换组件
- mp：MPA，每页独立 `Page()`
- **App：栈式导航（Stack Navigator）**——`push` 压栈、`pop` 出栈，每屏对应原生 ViewController/Activity

把 `RouteNode[]` 编译为 **栈式导航配置** + 生成各屏的原生组件挂载代码，转场映射到原生动画。

## 2. 导航模型抽象

```
Proteus Router（端无关）        App 端具体
─────────────────              ──────────────────
push(path, params)    ──→      nativeBridge.pushScreen(url, anim)
pop()                 ──→      nativeBridge.popScreen(anim)
replace(path)         ──→      nativeBridge.replaceScreen(url)
goBack(n)             ──→      pop n 次
```

`Router` API **三端一致**（Web 用 vue-router 实现、mp 用 `wx.navigateTo` 实现、App 用原生栈实现），业务代码不写平台分支。

## 3. 映射规则

### 3.1 路由表 → 屏（Screen）注册表

```ts
// dist/.proteus/navigation.generated.ts
export const screens = {
  home: { component: () => import('/abs/Home.vue'), transition: 'slideUp' },
  user: { component: () => import('/abs/User.vue'), transition: 'slide' },
  // ...
}
```

Custom Renderer 启动时把 `screens` 注册进原生桥：**key → 原生组件类 + Vue 组件工厂**。

### 3.2 转场 native 映射

| `<route>.meta.transition` | iOS (UIViewController) | Android (Activity) |
|---------------------------|------------------------|--------------------|
| `slide` | `.push` (默认) | `overridePendingTransition` 右滑 |
| `slideUp` | `.modal` 从底部 | 底部上滑 |
| `halfScreen` | `.pageSheet` (UISheetPresentationController) | BottomSheet |
| `scaleDown` | 自定义 `UIViewControllerTransitioning` | 自定义 ActivityOptions |
| `slideDown` | dismiss 下滑 | 下滑 finish() |

映射写在 `transforms/transform-transition.ts`（**与 M3/M4 共用同一份枚举**，三端一致）：
```ts
export const APP_TRANSITION_MAP = {
  slideUp: { ios: 'presentModal', android: 'slideUp' },
  halfScreen: { ios: 'pageSheet', android: 'bottomSheet' },
  // ...
}
```

### 3.3 嵌套 → 嵌套栈

App 支持原生**嵌套导航器**（stack-in-stack，如 tab 里的每个 tab 各有一个栈）：
```ts
// RouteNode.children → NavigationStack
{
  tabBar: [
    { name: 'home', stack: [home, homeProfile] },
    { name: 'user', stack: [user, userSettings] },
  ]
}
```
`children` 在 App 端**有意义**（不同于小程序平铺），编译为嵌套栈结构。

## 4. codegen 实现 `app.ts`

```ts
export function generateAppNavigation(nodes: RouteNode[]): string {
  const screens = nodes.map(n => `
  ${n.name ?? pathToName(n.path)}: {
    component: () => import(${JSON.stringify(n.componentPath)}),
    transition: ${JSON.stringify(TRANSITION_MAP[n.meta.transition] ?? 'slide')},
    children: [${n.children.map(c => c.name!).join(', ')}]
  }`).join(',\n  ')

  return `
import { registerScreens } from '@proteus/runtime/app'
export const screens = { ${screens} }
registerScreens(screens)
`
}
```

产物 `navigation.generated.ts` 在 App 入口调用：
```ts
// main.app.ts
import { createAppRouter } from '@proteus/runtime'
import { screens } from '../.proteus/navigation.generated'

const router = createAppRouter({ screens, root: 'home' })
router.push('user')
```

## 5. 原生桥约定（Renderer 层）

`proteus/runtime/app` 提供：
```ts
interface NativeBridge {
  pushScreen(name: string, params: any, anim: Transition): void
  popScreen(anim: Transition): void
  replaceScreen(name: string): void
}
```
- iOS 侧：Swift 实现 `pushScreen` → `UINavigationController.pushViewController`
- Android 侧：Kotlin 实现 → `FragmentTransaction` / `Activity.startActivity`
- **桥协议是 JSON-RPC 风格**（对齐前面架构决策），同步调用用 JSI（推荐，零序列化开销）

## 6. 与 Custom Renderer 的关系

- Router 只管**栈操作 + 屏注册**，不管组件渲染（Renderer 职责）
- 屏内的 Vue 组件由 Renderer 渲染为原生 widget；Router 只负责"哪个屏在当前栈顶"
- 参数传递：`push('user', { id: 1 })` → 序列化存栈项 → 新屏 `useRouteParams()` 读（**响应式，对齐 Pinia store 注入**）

## 7. 测试

- 快照：`navigation.generated.ts` 稳定
- 栈操作单测（mock NativeBridge）：push/pop/replace 调用正确 anim
- 嵌套栈：children → 嵌套结构正确
- 转场映射：每个 transition 枚举有 iOS/Android 对应

---

## LLM 执行提示（B5）

> 读 `00-overview.md` + `02-m2-route-tree.md` + 本文件。先实现 `generateAppNavigation` + `createAppRouter`（**mock NativeBridge**），跑通栈操作单测；原生侧（Swift/Kotlin）实现放最后，不影响 TS 逻辑验证。
