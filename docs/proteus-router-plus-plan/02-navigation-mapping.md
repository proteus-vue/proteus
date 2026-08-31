# 导航映射细则（五端原生实现）

> 配套：`01-router.md` §2.2

## 1. 栈操作映射

### 1.1 push

| 端 | 实现 | JSI 调用 |
|----|------|---------|
| iOS | `navigationController?.pushViewController(_:animated:)` | `UINavigationController.pushViewController(animated: true)` |
| Android | `FragmentTransaction.addToBackStack` + `commit` | `FragmentManager.beginTransaction().add().addToBackStack().commit()` |
| 鸿蒙 | `NavPathStack.pushPath` | `NavPathStack.pushPath({ name })` |
| Web | `history.pushState` + Vue Router | `history.pushState({}, '', path)` |
| Skyline | `wx.navigateTo` | 小程序 API |

### 1.2 present（模态）

| 端 | 实现 |
|----|------|
| iOS | `presentViewController(_:animated:completion:)` + `UIModalPresentationStyle`（sheet/fullScreen/pageSheet） |
| Android | 新 `Activity` + `Intent.FLAG_ACTIVITY_NEW_TASK`，或 `DialogFragment` |
| 鸿蒙 | `Navigation` 的 `navDestination` + `mode: Dialog` |
| Web | 路由 replace（无原生模态概念，降级为路由切换） |
| Skyline | 降级为 `navigateTo`（无模态） |

### 1.3 tab

| 端 | 实现 |
|----|------|
| iOS | `UITabBarController` + `viewControllers` |
| Android | `BottomNavigationView` + `Fragment` 切换 |
| 鸿蒙 | `Tabs` + `TabContent` |
| Web | SPA 路由 + 组件切换 |
| Skyline | `switchTab` |

## 2. 转场动画映射

| 语义 | iOS | Android | 鸿蒙 |
|------|-----|---------|------|
| slide | `UINavigationController` 默认 | `FragmentTransaction.setCustomAnimations` | `NavPathStack` 默认 |
| fade | `UIView.transition` | `Fade` animator | `opacity` 转场 |
| flip | `UIView.transition(with: .flip)` | 自定义 `Transition` | 自定义 |
| none | `animated: false` | 无动画 | 无动画 |

## 3. Deep Link / Universal Link

- **统一入口**：`router.resolve(url)` 解析 URL → RouteRecord
- iOS：`AppDelegate.application(_:open:options:)` + `NSUserActivity`
- Android：`Intent` + `<intent-filter>` + `deepLink`
- 鸿蒙：`Want` + `startAbility`
- Web：浏览器地址栏
- **解析结果缓存**，冷启动直达目标页

## 4. 参数传递

- 声明式：`/detail/:id`
- 编程式：`router.push({ path, params })`
- **跨端序列化**：参数自动 JSON 序列化（避免 JSI 传递复杂对象导致循环引用，联动 Memory Plan G-06）

## 5. 嵌套路由

- Vue Router 的 `children` 语义保留
- iOS：嵌套 `UINavigationController`
- Android：嵌套 `Fragment`
- 鸿蒙：嵌套 `NavDestination`
- Web：嵌套 `<router-view>`
