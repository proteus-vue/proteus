# M5 — 路由回溯

## 目标

完整还原导航路径，可视化守卫执行，定位"为什么跳到了这里 / 为什么没跳过去"。

## 数据结构

```ts
interface NavRecord {
  id: string
  from: RouteLocation
  to: RouteLocation
  guards: Array<{ name: string; duration: number; result: 'next' | 'redirect' | 'cancel' | 'error' }>
  duration: number
  traceId: string
}
```

每次 `router.push/replace` 产生一条，栈结构保留（Web history / 小程序页面栈）。

## UI：路由树 + 时间线

- **路由树**：嵌套路由按父子展开，`redirect` 用虚线，`cancel` 用 ✗
- **每条边**：hover 显示守卫耗时瀑布（对齐 M6 火焰图）
- **点击守卫**：跳转对应 `beforeEach`/`beforeEnter` 源码（source map）

## 回溯场景

1. **"我怎么到这页的？"** → 从当前页逆推父链 + query 来源
2. **"为什么重定向了？"** → 高亮触发 redirect 的守卫及其返回值
3. **"为什么没跳转？"** → cancel 节点标红，显示哪个守卫返回 false / throw

## 与 Router plan 的对接

- 消费 Router M5（`beforeEach/afterEach`）钩子，通过 `installRouter(bus, router)` 注入采集
- 守卫耗时由 `router.guard` 事件（`start`/`end`）计算

## 依赖

依赖 Router 计划导出的 `Router` 实例类型（Types 层 `RouterNavRecord`）。

## 验收

- 构造 redirect + cancel 嵌套场景，路由树准确还原且标色正确
- 守卫耗时与火焰图数据一致（同 traceId 比对）
- 小程序 MPA 多页跳转，页面栈重建无误（含 tab 切换）
