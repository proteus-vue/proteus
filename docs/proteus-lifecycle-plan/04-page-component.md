# 04 — M6: 页面级与组件级生命周期

## 一、三级生命周期回顾

```
App 级（defineApp）    → 全局一次
页面级（definePage）   → 每页一次
组件级（defineComponent）→ 每个组件实例
```

## 二、页面级：definePage

### API
```ts
import { definePage } from '@proteus-vue/runtime'
import { usePlayerStore } from '@/stores/player'

export default definePage({
  // —— 生命周期 ——
  onLoad(query, ctx) {
    // 页面参数解析、数据初始化
    this.store = usePlayerStore()
  },
  onReady() {
    // 视图就绪，可操作 DOM/节点
  },
  onShow() {
    // 页面可见（含从后台切回）
    this.store.resume()
  },
  onHide() {
    // 页面隐藏（未销毁）
    this.store.pause()
  },
  onUnload() {
    // 页面销毁 ← 关键：清理 + store dispose
    this.store.$dispose()
    clearInterval(this.timer)
  },

  // —— 状态保留配置 ——
  retainState: true,  // onHide 时不销毁，onShow 恢复（类似 keep-alive）
})
```

### 三端映射

| definePage 钩子 | Skyline (Page) | Web (Vue) | App |
|----------------|---------------|-----------|-----|
| `onLoad(query)` | `onLoad(query)` | `setup()` + `onMounted` | VC `viewDidLoad` |
| `onReady()` | `onReady()` | `onMounted` + nextTick | `viewDidLayout` |
| `onShow()` | `onShow()` | `onActivated` / `visibility` | `viewDidAppear` |
| `onHide()` | `onHide()` | `onDeactivated` | `viewDidDisappear` |
| `onUnload()` | `onUnload()` | `onUnmounted` | `dealloc` / `onDestroy` |

### retainState（重要）
```ts
// 编译期：retainState: true → Skyline 下用 <keep-alive> 语义
// 页面 onHide 时不销毁组件树，onShow 时直接复用
// 用于：播放页、表单页等需要保留状态的场景
```

## 三、组件级：defineComponent 生命周期

### 标准钩子（对齐 Vue + glass-easel）
```ts
defineComponent({
  setup(props, ctx) {
    // —— 对应 glass-easel 生命周期 ——
    onAttached(() => { /* 组件挂载 */ })
    onReady(() => { /* 视图就绪 */ })
    onDetached(() => { /* 组件销毁 ← 清理时机 */ })

    // —— 页面级（组件内监听）——
    onPageShow(() => { /* 页面显示 */ })
    onPageHide(() => { /* 页面隐藏 */ })
  },
})
```

### 映射表

| 组件钩子 | glass-easel | Vue | Web Component |
|---------|-------------|-----|---------------|
| `onAttached` | `attached` | `mounted` | `connectedCallback` |
| `onReady` | `ready` | `updated` + nextTick | — |
| `onDetached` | `detached` | `unmounted` | `disconnectedCallback` |
| `onPageShow` | `pageLifetimes.show` | — | — |
| `onPageHide` | `pageLifetimes.hide` | — | — |

## 四、关键设计：页面级 Store 生命周期

**这是 Pinia M7.5 的落地点**——页面级 store 必须在 `onUnload` 时 `$dispose`：

```ts
// 编译器自动注入（当检测到 useStore 在页面级）
Page({
  onLoad(query) {
    this.$store = usePlayerStore()  // 绑定到 page 实例
  },
  onUnload() {
    if (this.$store) {
      this.$store.$dispose()  // ← 自动清理，防内存泄漏
      this.$store = null
    }
  },
})
```

`--trace-transform` 记录：`useStore(PlayerStore) in page → onUnload.$dispose`

**例外**：`retainState: true` 的页面，store 不销毁，跟随页面实例保留。

## 五、全局组件生命周期（appBar / 播放条）

全局组件（如 `<p-player-bar>`）**跟随 App 级生命周期，不随 Page 销毁**：

```ts
// 编译器生成 app-bar/index.js
Component({
  lifetimes: {
    attached() {
      // App 启动时创建一次
      this.store = usePlayerStore()  // 全局单例 store
    },
    // 无 detached —— 应用生命周期内常驻
  },
})
```

业务页面切换时，全局播放条：
- 实例不重建（状态/进度不丢）✓
- 通过 `onShow/onHide` 暂停/恢复播放 ✓
- 这正是对齐你前面"全局播放控制条"的需求

## 六、跨页面状态传递

```ts
// 方案 1：通过 store（推荐）
// Page A → store.setX() → Page B 读 store.getX()

// 方案 2：通过 launchOptions（URL query）
// Page A → navigateTo({ url: '/b?id=1' }) → Page B onLoad(query)

// 方案 3：通过事件（Module 层 ModuleEvent）
// Page A → module.emit('order:paid') → Page B 监听
```

## 七、Skyline 特殊坑

1. **页面栈深度限制**：小程序页面栈通常 ≤ 10 层，`redirectTo` vs `navigateTo` 需业务判断
2. **`onUnload` 不一定触发**：页面被系统回收时可能只走 `onHide`
   → 关键清理（持久化）在 `onHide` 也做一份兜底
3. **组件 `detached` 时机**：v-if 为 false 即触发，注意与"页面隐藏"的区别
4. **`pageLifetimes` 需在组件定义里显式声明**：编译器自动处理

## 八、铁律

1. 页面级 `onUnload` 必须清理：store dispose + 定时器 + 事件监听
2. 全局组件（appBar 类）不得依赖页面生命周期
3. 业务不得直接写 `Page({...})` / `Component({...})`，一律走 `definePage` / `defineComponent`
4. 页面间状态优先用 store，次选 query，避免事件耦合
