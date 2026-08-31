# 四层治理体系

> 组件层、资源层、跨运行时层、诊断层联动，把"对象是否仍被使用"从隐式闭包关系转化为**显式 owner + 生命周期状态**。

---

## 总览

```
┌──────────────────────────────────────────────┐
│ ④ 诊断层  ProteusMemoryPanel / proteus memory │  ← 可观测、可阻断
├──────────────────────────────────────────────┤
│ ③ 跨运行时层  JSI/FFI IDL 所有权 + weak bridge │  ← 防循环引用
├──────────────────────────────────────────────┤
│ ② 资源层  Owner + Budget + Disposer            │  ← 统一生命周期
├──────────────────────────────────────────────┤
│ ① 组件层  可回收视图 / 分页 / keyed state      │  ← 防节点累积
└──────────────────────────────────────────────┘
              ↑ PageTeardownTransaction 贯穿四层
```

---

## ① 组件层：把回收变成不变量

**长列表不应依赖开发者主动优化，而应由组件模型默认保证回收。**

详见 `05-recyclable-views.md`。要点：
- 超过阈值（默认 **50 项**）的线性列表**强制**走可回收视图，Compiler 构建期检测全量 `v-for` 无 key 并报错
- 区分四种策略：定高 recycle-view / 动态高测量缓存 / 瀑布流 layout provider / 富交互 keyed state
- `list-data`（数据源，可保存领域模型）与 `list-view`（视图，只绑定窗口数据）**分离**
- 分页仓储管理全量数据，视图只保留窗口数据

---

## ② 资源层：Owner + Budget + Disposer

**所有跨运行时资源必须登记 owner，并具备显式释放能力。**

详见 `04-resource-owner-model.md`。统一资源接口：

```ts
interface Resource {
  id: string
  owner: Page | Component | Session   // 必有所有者
  kind: 'image' | 'bitmap' | 'canvas'
      | 'shader' | 'socket' | 'native-peer' | 'subscription'
  retainers: RefEdge[]                 // 引用边，可构建 retainer 图
  dispose(): void                      // 必有显式释放
}
```

页面销毁时，框架自动调用所有子资源 `dispose()`；开发者也可手动提前释放。

**资源生命周期矩阵**：

| 资源 | 默认策略 | 页面隐藏 | 页面销毁 | 内存压力 |
|------|---------|---------|---------|---------|
| ImageBitmap | LRU + 降采样 | 保留可见窗口 | trim 至窗口 | 清除不可见 |
| OffscreenCanvas | 帧池复用 | 保留静态缓存 | 释放 | 释放全部临时 |
| Shader/Program | 程序缓存、引用计数 | 保留 | 释放 | 释放可重建项 |
| WebSocket | 页面级 owner | 暂停 | close | close |
| JSI/Native Peer | weak/owner | release UI refs | release native peer | release non-essential |
| Event Subscription | disposer 列表 | 保留必要项 | unsubscribe all | unsubscribe all |

---

## ③ 跨运行时层：JSI/FFI 所有权 + weak bridge

详见 `07-jsi-ffi-references.md`。**三原则**：
1. **单向 ownership**：JS → Native 默认短生命周期本地句柄；Native → JS 默认弱引用 / owner epoch
2. **显式 release**：所有 Native 资源实现 `dispose()`，通过 EffectRegistry 自动释放
3. **weak bridge**：禁止任意对象自由跨边界，IDL 明确标注所有权

**IDL 所有权标注**：
- `[value]`：按值拷贝
- `[borrow]`：短生命周期借用
- `[owned]`：转移所有权并自动释放
- `[callback]`：生成弱引用 safe callback

禁止将 `Activity/ViewController/View/Canvas` 直接映射为普通持久 JS 对象。

---

## ④ 诊断层：让泄漏从偶发变为可阻断的回归

详见 `09-diagnostics-ci.md`。

**`proteus memory` CLI 标准场景**：
打开页面 → 滚动列表 → 打开 WebView → 播放动画 → 触发 HMR → **返回并重复 20 次**

采集：Java/Native Heap、JS Heap、GPU/Graphics、PSS/RSS、活跃资源计数。

**验收门槛（相对增长为主，不虚构 MB 红线）**：
- 同一设备、同一页面重复打开 20 次，第 20 次与第 2 次稳定驻留差值 ≈ 0
- 退出页面 + 触发 GC 后，活跃 cell / 页面 / WebView / Timer / Subscription / JSI peer 数量归零或可解释
- 峰值不超过设备分级预算

**`ProteusMemoryPanel`（调试模式）**：列出当前页面、活动 cell、图片、Timer、Subscription、JSI peer、GPU 资源 → "退出页面后仍存活的对象"可直接定位。

---

## 页面销毁事务（贯穿四层）

详见 `03-page-teardown.md`。路由层定义 `PageTeardownTransaction`：

```
beforeDestroy
  → cancelPendingIO
  → unsubscribeAll(owner)
  → stopTimers / animations
  → clearBridgeHandlers
  → detachViewTree
  → nativeDestroy
  → releaseJSRefs
  → afterDestroy  assert no strong root
```

- **WebView**：`stopLoading → clearHistory → removeFromParent → destroy() → ref = null`
- **iOS**：显式清除 delegate / script handler / observer / closure capture
- **Skyline/共享渲染器**：只销毁页面局部状态，**不销毁共享引擎**

---

## 三作用域（动画/GPU）

| 作用域 | 资源 | 释放时机 |
|-------|------|---------|
| 帧 | Path / 临时 Gradient / Transform / Command Buffer / 中间图 | 每帧结束 |
| 动画 | Reusable Cache / Shared Texture / Rasterized Layer | 动画取消或 owner 卸载 |
| 页面 | 静态背景 / Shader Program / 图集 | 页面销毁 |

跨作用域持有大对象会破坏自动回收前提（JS Path 已 GC，但 GPU command buffer 仍驻留 → 时间差泄漏）。
