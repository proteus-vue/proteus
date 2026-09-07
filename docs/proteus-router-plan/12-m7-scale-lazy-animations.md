# M7 — 路由超级应用加固：规模、懒加载、转场性能

> 依赖：M1（scan）、M2（tree）、M3/M4/M5（三端 codegen）
> 目标：让路由层在「数百页面 / 深层级导航 / 高频转场」下仍透明、可审计、不卡帧

---

## M7.1 路由表分块（Route Chunking）

### 问题
B2 的 RouteTree 是**单棵树全量构建**。超级应用 300+ 页面时：
- Web 端 `vue-router` 一次性注册全部路由 → 首屏 JS 包含大量永不访问的页面组件
- 小程序端 `pages.json` 全量声明 → 主包体积爆炸（小程序主包有体积上限）
- CLI 构建时间线性增长

### 设计：按「业务域」自动分块

`<route>` 块新增可选字段 `chunk`：

```vue
<route>
  name: 'order-detail'
  path: '/order/:id'
  chunk: 'trade'   # ← 业务域名，同名页面归同一 chunk
  meta:
    lazy: true     # ← 是否懒加载（默认 true）
</route>
```

CLI 扫描后输出**分块 manifest**（不是单一路由表）：

```
dist/.proteus/route-manifest.json
{
  "chunks": {
    "trade": {
      "pages": ["order-list", "order-detail", "refund"],
      "deps": ["shared/cart"],
      "preload": ["order-list"]   # 该 chunk 的入口页（首屏可能需要）
    },
    "user": { ... }
  },
  "root": ["home", "tab-home", "tab-me"]   # 主包页面（不分块）
}
```

### 三端映射

| 端 | chunk 产物 | 加载时机 |
|----|-----------|---------|
| **Web** | `() => import('./pages/order/Detail.vue')` 动态 import | 首次导航到该路由时 |
| **小程序** | **分包**（subPackages） | `app.json` 的 `subPackages[].root = "trade"` |
| **App** | 原生模块懒注册 | `StackNavigator.registerLazy('trade', factory)` |

**关键**：`chunk` 字段是**编译期分块提示**，运行时三端用各自原生机制（动态 import / 分包 / 懒注册），但**源码侧开发者只写一个字段**。这就是透明化的价值。

### 主包白名单
`proteus.config.ts`：

```ts
export default defineConfig({
  router: {
    // 必须进主包（不分块的页面）：tabBar 页、启动页、全局兜底页
    eagerChunks: ['root', 'shared'],
    // 单个 chunk 超过此页面数 → 告警（提示你该拆业务域）
    chunkPageWarnThreshold: 30,
  }
})
```

### transform 契约

```
输入：所有 .vue 的 <route> 块
依赖：01（schema 校验，chunk 必须是合法标识符）
输出：
  - dist/.proteus/route-manifest.json
  - Web: router/chunks/{name}.ts（动态 import 工厂）
  - mp:  app.json 的 subPackages 段
  - app: native-navigator 的 lazy map
trace：
  scan:route-chunk  page=order-detail chunk=trade lazy=true
```

---

## M7.2 智能预加载（Preload / Prefetch）

### 问题
纯懒加载 → 首次进入分包页面有**白屏等待**。超级应用需要在「合适的时机」提前加载。

### 设计：三级预加载策略

```yaml
# <route> 中的 preload 声明
preload:
  strategy: hover | visible | idle | none   # 默认 idle
  deps: ['trade']                            # 进入本页后，预加载哪些 chunk
```

| 策略 | 触发时机 | 适用场景 |
|------|---------|---------|
| `hover` | 链接被触摸/悬停 | 列表 → 详情 |
| `visible` | 页面元素进入视口 | 瀑布流卡片 |
| `idle` | `requestIdleCallback` / 小程序 `wx.nextTick` | 首屏空闲后 |
| `none` | 仅导航时加载 | 低频/敏感页面 |

### 实现要点
- **Web**：`<router-link preload="hover">` + `import()` 触发
- **小程序**：`wx.preLoadSubPackage({ root })`（基础库 3.x+ 支持）
- **App**：原生侧预初始化模块

CLI 生成统一的 `preloadMap`，运行时 `RouterPreloader` 根据当前端调用对应 API——**调用方无平台分支**。

### 性能预算
- 单次预加载不超过 2 个 chunk（避免抢占首屏带宽）
- 总预加载队列上限 5 个，超出 FIFO 丢弃
- `--trace-transform` 输出每次预加载决策，便于性能复盘

---

## M7.3 嵌套层级限制 + 扁平化降级

### 问题
Skyline 的 `routeType` + 小程序页面栈有**层级约束**（页面栈深度有限，过深转场异常）。超级应用深链接可达 8-10 层。

### 设计

**M2 的 RouteTree 增加层级校验**：

```ts
// tree-builder.ts
const MAX_DEPTH = {
  web: 20,        // vue-router 无硬限制，保守值
  mp: 10,         // 小程序页面栈建议上限（微信实际 10 层）
  app: 20,
}

function validateDepth(node: RouteNode, depth: number, platform: Platform) {
  if (depth > MAX_DEPTH[platform]) {
    // 降级：把超深层级「扁平化」为该父级下的平铺子页
    // 转场退化为 slideUp（放弃父子嵌套转场效果）
    node.meta.__flattened = true
  }
}
```

### mp 端降级规则（关键）
小程序**不支持真正的嵌套路由**，M4 已做平铺。M7 在此基础上：
- 深度 ≤ 3：保留 `parent` 关系 + 转场动画
- 深度 > 3：自动打平，`meta.__parent` 仅用于面包屑/返回栈，**不产生嵌套转场**
- 告警：`[router] page "a/b/c/d/e" depth=5, flattened (mp max 3)`

### trace 输出
```
scan:route-depth  page=community/group/post  depth=4  platform=mp  action=flatten
codegen:mp:parent  page=community/group/post  parent=null  reason=depth>3
```

---

## M7.4 转场动画性能调度

### 问题
「转场/动画性能」是你的核心痛点（前面讨论过 Skyline Worklet）。超级应用常见：
- 半屏弹层（halfScreen）+ 手势下滑关闭
- 底部弹层（bottom-sheet）+ 背景模糊
- 图片预览（scaleDown）+ 共享元素过渡
- 同时多个转场 → 掉帧

### 设计：转场调度器（TransitionScheduler）

`proteus/runtime` 新增 `TransitionScheduler`：

```ts
// 三端统一的转场 API（M4 的 transition 枚举升级）
router.push('/comment', {
  transition: {
    type: 'halfScreen',   // slideUp | halfScreen | scaleDown | flip | none
    duration: 300,
    gesture: 'panDown',   # 手势关闭（Skyline 走 Worklet，Web 走 Pointer Events）
    sharedElement: '#avatar'  # 共享元素（图片预览场景）
  }
})
```

### 三端实现差异（透明化核心）

| 端 | 转场实现 | 手势 | 性能 |
|----|---------|------|------|
| **Web** | CSS `transform` + `transition` + FLIP | Pointer Events | 主线程，可能掉帧 |
| **Skyline** | `wx.worklet` + `applyAnimatedStyle` + `routeType` | Worklet（UI 线程）| **60fps** |
| **App** | 原生导航转场（iOS CATransition / Android Transition）| 原生手势 | **60fps** |

**关键约束**：转场**必须串行**——同时只一个转场在执行，Scheduler 用队列管理：

```ts
class TransitionScheduler {
  private queue: TransitionTask[] = []
  private running = false

  enqueue(task: TransitionTask) {
    this.queue.push(task)
    if (!this.running) this.run()
  }

  private async run() {
    this.running = true
    while (this.queue.length) {
      const task = this.queue.shift()!
      await task.execute()   # 三端各自实现，统一返回 Promise
    }
    this.running = false
  }
}
```

### Skyline 专项优化（对应前面 Worklet 讨论）
- `type: 'halfScreen'` → 编译期生成 `routeType: "wx://bottom-sheet"` + `backgroundColorContent`
- 手势 `panDown` → 生成 `wx.onTouchMove` + `wx.worklet.shared()` 驱动 `translateY`
- **禁止**在转场中读取 Pinia（跨线程），只走 `shared` 值

### transform 契约

```
输入：router.push 的 transition 配置（源码）
输出（mp）：
  - pages.json 的 routeType 字段
  - 页面对应的 .js 中注册 worklet 函数
输出（web）：
  - CSS transition class + JS 手势绑定
输出（app）：
  - 原生转场配置
trace：
  codegen:transition  page=comment  type=halfScreen  platform=skyline  gesture=panDown
```

---

## M7.5 路由栈管理（App 端重点）

### 问题
App 端（Custom Renderer）是**栈式导航**，超级应用常见问题：
- 重复压栈（连续 push 同一个页面 → 返回要按 N 次）
- 栈溢出（超过原生导航栈上限）
- 深层页面返回首页需要清空栈

### 设计：导航指令扩展

```ts
router.push('/detail')        // 压栈（默认）
router.replace('/login')      // 替换当前
router.pop()                  // 返回上一页
router.popTo('home')          # 返回到指定页（清空中间栈）
router.popToRoot()            # 返回首页
router.reset('tab-home')      # 重置栈（清空 + 设置根）
```

### 三端映射一致性

| 指令 | Web | 小程序 | App |
|------|-----|--------|-----|
| `push` | `router.push` | `wx.navigateTo` | `navigator.push` |
| `replace` | `router.replace` | `wx.redirectTo` | `navigator.replace` |
| `pop` | `router.back` | `wx.navigateBack` | `navigator.pop` |
| `popTo` | 手动遍历 | `wx.navigateBack({delta})` | `navigator.popTo` |
| `popToRoot` | `router.push('/')` | `wx.reLaunch` | `navigator.popToRoot` |
| `reset` | `router.replace` | `wx.reLaunch` | `navigator.reset` |

**Web 端 `popTo` 实现**（vue-router 无原生 API）：

```ts
// router/extras.ts
export function popTo(router: Router, name: string) {
  const history = router.options.history
  # 遍历 history 栈找到目标 index，逐个 back
  # （实际实现需访问内部栈，或用 sessionStorage 记录）
}
```

### 栈溢出保护
- App 端监听栈深度 > 15 → 自动 `popToRoot` + 告警
- 小程序端 `navigateTo` 失败（栈满）→ 自动降级 `redirectTo`
- `--trace-transform` 输出每次栈操作，便于复现导航异常

---

## M7.6 路由级代码分割 + 构建优化

### 问题
300 页面全量构建 → Vite/Rollup 产物巨大、HMR 卡顿。

### 设计

**按 chunk 生成独立 entry**：

```
dist/
  chunks/
    trade/
      OrderList.[hash].js
      OrderDetail.[hash].js
      chunk-manifest.json
    user/
      ...
  router/
    chunks/
      trade.ts   # export const load = () => import('../../chunks/trade/OrderList.vue')
```

**Web 端动态 import 映射表**（CLI 生成，开发者不手写）：

```ts
// router/chunks/trade.ts（自动生成，勿手改）
export const tradeRoutes = [
  {
    path: '/order/:id',
    component: () => import('../../pages/order/Detail.vue'),  # Vite 自动分 chunk
    name: 'order-detail',
  },
]
```

**小程序分包配置**（CLI 自动注入 `app.json`）：

```json
{
  "subPackages": [
    {
      "root": "chunks/trade",
      "name": "trade",
      "pages": [
        "OrderList",
        "OrderDetail",
        "Refund"
      ]
    }
  ]
}
```

### 构建性能优化
- **增量构建**：CLI 缓存 chunk 依赖图，`proteus dev` 只重建变更的 chunk
- **并行 codegen**：M3/M4/M5 三端 codegen 对同一 chunk 并行执行
- **chunk 体积告警**：单 chunk > 500KB → 提示拆业务域

---

## M7 验收标准

| 指标 | 目标 |
|------|------|
| 首屏注册路由数（Web） | ≤ 20（其余懒加载） |
| 主包页面数（小程序） | ≤ 30（其余分包） |
| 冷启动到可交互 | < 1.5s（首屏仅加载 root chunk） |
| 转场帧率（Skyline） | ≥ 58fps（halfScreen + 手势） |
| 路由表构建时间（300 页） | < 3s |
| 导航栈深度 | ≤ 15（超出自动保护） |
| `popTo` 准确性 | 100%（测试矩阵覆盖） |

---

## 执行批次（追加到 09）

```
B7.1 = M7.1 + M7.6（chunk 分块 + 构建优化）  [依赖 M1/M2]
B7.2 = M7.2（预加载）                        [依赖 B7.1]
B7.3 = M7.3（层级降级）                      [依赖 M2]
B7.4 = M7.4（转场调度器）                    [依赖 M3/M4/M5]
B7.5 = M7.5（栈管理）                        [依赖 M5]
B7.6 = M7.6（构建优化，与 B7.1 合并）
```

**B7.1 优先**：chunk manifest 是 M7 其他模块的地基，先跑通扫描 + 分块 + 三端 codegen 输出。
