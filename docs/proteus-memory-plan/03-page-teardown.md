# 页面销毁事务（PageTeardownTransaction）

> 页面关闭**不能退化为设置可见标志**，而须执行完整的引用断开序列——并由**框架生成**，不要求每个页面开发者手工实现。

---

## 为什么需要销毁事务

**页面栈问题的本质是"最后一个引用未被切断"，不是"页面已经不可见"。**

常见泄漏路径：
- 全局路由 / dialog 队列持有当前页面
- WebView JS context 被 native bridge 强引用
- `plus.webview` / 自定义 WebView 未在 `onUnload`/`onDestroy` 关闭
- `setInterval` / WebSocket / EventBus / `uni.$on` 仍指向旧页面
- Activity/Fragment 被静态集合或单例滞留
- Native callback / Handler / Thread 持有 JS 闭包

---

## PageTeardownTransaction

路由层定义的**原子销毁序列**，贯穿四层治理体系：

```
beforeDestroy
  │
  ├─ 1. cancelPendingIO          // 取消未完成 fetch/下载/解码
  ├─ 2. unsubscribeAll(owner)    // 按 owner 撤销全部订阅（EventBus/WebSocket/IntersectionObserver）
  ├─ 3. stopTimers / animations  // 清除 setInterval/requestAnimationFrame/帧动画
  ├─ 4. clearBridgeHandlers      // 清空 native↔js bridge 回调
  ├─ 5. detachViewTree           // 从父容器移除视图树
  ├─ 6. nativeDestroy            // 调用平台原生销毁（见下方平台差异）
  ├─ 7. releaseJSRefs            // 释放 JSI global refs / WeakRef 清理
  └─ 8. afterDestroy             // 断言：无强引用根残留
```

**第 8 步是门禁关键**：调试模式下触发 GC，扫描该 owner epoch 下是否仍有强引用根，若有 → 抛出 `RetainedRootError` 并打印 retainer 链。

---

## 平台差异

### WebView（Android）
Android 官方要求完整序列：
```
stopLoading → clearHistory → removeFromParent → destroy() → ref = null
```
⚠️ `destroy()` 后 **RSS 未必立即回落**（原生运行时缓存、共享库、已分配页仍驻留，由系统后续回收）→ "RSS 未立即归零"**不能直接等同于泄漏**。判断是否泄漏须看**重复导航后的单调增长趋势**。

### iOS
须显式清除：
- `delegate` / `WKScriptMessageHandler`
- `userContentController` 注入的脚本
- `NotificationCenter` observer
- Block / JSValue 闭包捕获

### 小程序 Skyline / 共享渲染器
**只销毁页面局部状态，不销毁共享引擎**。这正是 Skyline 的优势（多页面共享一个渲染引擎）——但共享池须用弱引用 / 引用计数 / 租约机制，否则一个长生命周期错误引用影响多页面。

### App 端（JSI/FFI）
见 `07-jsi-ffi-references.md`：销毁时须 `releaseNativePeer`，把 JS 侧持有的 native global ref 清零，避免"JS 已回收但 native 仍被 global ref 保活"。

---

## Owner Epoch：让 HMR / 热替换安全

**问题**：HMR 加载新模块后，旧模块的闭包、全局 Map、单例、原生 View listener 可能仍被运行中的回调引用。

**方案**：每次热替换生成 `ownerEpoch`，所有副作用进入 `EffectRegistry`：

```ts
interface Effect {
  id: string
  ownerEpoch: number        // 所属版本
  dispose: () => void
}

// 旧 epoch 的 effect 在下次 tick 批量撤销
registry.revokeBefore(epoch + 1)
```

- 原生侧持有 `ownerEpoch`；旧组件 View 收到事件时**拒绝回调已失效版本**
- HMR 无法安全迁移的状态**显式重置**，不假装保留
- CI 回归："修改组件 → accept → 反复导航 → 抓取 heap snapshot"

---

## 框架生成 vs 开发者手写

**原则**：销毁序列由框架生成，开发者只负责**注册自己的副作用**（通过返回 disposer）。

```vue
<script setup>
// ✅ 推荐：框架自动收集 disposer
const ws = useWebSocket('/api')
onCleanup(() => ws.close())   // 注册到当前 owner

// ❌ 反模式：手动监听却忘记 off
bus.on('x', handler)          // Compiler 警告：未配对 unsubscribe
</script>
```

**Compiler 构建期检测**：
- 未配对的全局监听（`on` 无对应 `off`）
- `setInterval` 未在 `onUnmounted` 清除
- 全局 Map/Set 直接持有组件/View 引用

---

## 验收

详见 `10-benchmark-budgets.md`。核心场景：**重复打开同一页面 20 次**，断言：
- 第 20 次稳定驻留 ≈ 第 2 次（差值 < 阈值）
- `afterDestroy` 无 `RetainedRootError`
- 活跃 cell / WebView / Timer / Subscription / JSI peer 计数归零
