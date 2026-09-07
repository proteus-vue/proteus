# 页面生命周期治理：根治页面栈内存泄漏

> **定位**: G-42 核心文档之一
> **核心论点**: 泄漏不是 bug，是"生命周期没有单一 Owner"的结构性缺陷

---

## 1. 传统框架为什么必然泄漏

### 1.1 根因：两套生命周期靠人工配对

```
JS 侧：   VNode 树 / 组件实例 / 事件监听 / 定时器 / store 引用
原生侧：  UIViewController / Activity / Widget

两者没有共同 Owner
靠开发者手动 onDestroy 配对释放
```

**只要以下任意一条路径漏掉配对，就泄漏：**

| 泄漏路径 | 说明 |
|---------|------|
| 路由跳转 | push 后 pop，但某个回调没解绑 |
| 手势返回 | 系统返回手势绕过框架路由 |
| 热重载 | 开发期 HMR 反复创建实例 |
| 异常退出 | 页面崩溃，清理逻辑没执行 |
| 跨页面引用 | 页面 A 的闭包被页面 B 持有 |
| store 持有 | 全局 store 引用了页面实例 |

**uni-app / RN / Flutter 全部如此**——这不是它们写错了，是架构没有提供"单一 Owner"。

### 1.2 为什么加了各种"最佳实践"还是漏

社区的解法是"记得在 onUnmounted 里清理"——但这是**把架构问题转嫁给开发者记忆**：

```js
// 传统写法：开发者必须自己记住清理
onMounted(() => {
  timer = setInterval(...)        // 忘了 clear → 泄漏
  bus.on('event', handler)        // 忘了 off → 泄漏
  window.addEventListener(...)    // 忘了 remove → 泄漏
})
onUnmounted(() => {
  clearInterval(timer)            // 漏一行就泄漏
  bus.off('event', handler)       // 漏一行就泄漏
})
```

**只要"配对"是人工的，就一定有漏的一天。**

---

## 2. Proteus 的解法：IR 作为单一 Owner

### 2.1 结构差异

```
传统：
  JS 状态 ←──── 人工配对 ────→ 原生 View
  （两个 Owner，靠开发者同步）

Proteus：
  IR 实例 ── 唯一真相 ──→ Backend 挂载点
       ↑
  框架持有，可完全管控
```

**因为我们有 IR 这一层，框架天然拥有页面状态的完整视图**——不需要开发者手动同步。

### 2.2 五原子销毁

```typescript
interface PageLifecycleOwner {
  destroyPage(pageId: string): DestroyReport
}

// 五步原子操作，不可部分执行
function destroyPage(pageId: string): DestroyReport {
  const page = this.pages.get(pageId)
  const report = { steps: [], leaked: [] }

  // ① 卸载 Backend 挂载点（原生 View 释放）
  this.backend.unmount(page.mountPoint)
  report.steps.push('unmount')

  // ② 解绑事件/手势（框架登记过的全部）
  page.eventRegistry.unbindAll()
  report.steps.push('unbindEvents')

  // ③ 清定时器/订阅（框架代管，不是业务自己管）
  page.resourcePool.releaseAll()
  report.steps.push('releaseResources')

  // ④ 销毁 IR 实例
  this.irRegistry.delete(page.irId)
  report.steps.push('destroyIR')

  // ⑤ 归还内存配额
  this.quota.release(page.quotaHandle)
  report.steps.push('releaseQuota')

  // 校验：五步必须全部完成
  if (report.steps.length !== 5) {
    throw new Error('G-42.2 违反：页面销毁必须五原子')
  }
  return report
}
```

**关键：第 ③ 步的"框架代管资源"是根治 80% 泄漏场景的核心。**

---

## 3. 框架代管资源（G-42.3）

### 3.1 业务不再裸用全局 API

```js
// ❌ 违反 G-42.3：裸用全局定时器
const timer = setInterval(tick, 1000)   // 页面销毁后仍在跑

// ✅ 合规：框架代管
const timer = pageContext.timer(() => tick(), 1000)
// 页面销毁时框架自动回收，业务无需 clear
```

### 3.2 代管资源清单

| 资源类型 | 传统写法 | Proteus 代管写法 |
|---------|---------|-----------------|
| 定时器 | `setTimeout` / `setInterval` | `pageContext.timer()` |
| 事件监听 | `addEventListener` | `pageContext.on()` |
| 事件总线 | `bus.on()` | `pageContext.bus.on()` |
| 网络请求 | `fetch()`（悬浮） | `pageContext.fetch()`（可取消） |
| 订阅 | `store.subscribe()` | `pageContext.subscribe()` |
| 手势绑定 | 手动 bind/unbind | `pageContext.gesture()` |

**铁律 G-42.3**：业务代码不得裸用 `setTimeout` / `addEventListener` / `setInterval`——编译期检测拦截。

---

## 4. 页面栈治理策略

### 4.1 深度限制

```typescript
interface StackPolicy {
  maxDepth: number        // 默认 10
  overflowStrategy: 'destroy-oldest' | 'reject' | 'flatten'
}
```

超出深度时：
- `destroy-oldest`：销毁最旧页面（LRU）
- `reject`：拒绝新页面（安全但体验差）
- `flatten`：合并中间页面

### 4.2 keep-alive 配额

```typescript
interface KeepAlivePolicy {
  maxKeepAlive: number    // 默认 3
  memoryBudget: number    // 默认 64MB
}
```

keep-alive 页面保留 IR 实例但卸载挂载点，超出配额时按 LRU 完全销毁。

### 4.3 LRU 回收

```
页面栈：[P1, P2, P3, P4, P5]  maxDepth=3
push P6 → 销毁 P1 → [P2, P3, P4, P5, P6]
                     ↑ 实际保留 [P4, P5, P6]
```

---

## 5. 编译期泄漏检测

### 5.1 检测规则（CI 门禁）

| 规则 | 检测内容 | 严重度 |
|------|---------|--------|
| **L-01** | 业务代码裸用 `setTimeout`/`setInterval`/`addEventListener` | error |
| **L-02** | 组件持有跨页面引用（模块级变量存页面实例） | error |
| **L-03** | store 持有页面实例或组件实例 | error |
| **L-04** | 页面级大对象（>1MB）未声明 lazy | warning |
| **L-05** | 事件监听无对应解绑（静态分析可达路径） | warning |

### 5.2 运行时泄漏检测（conformance 用）

| 测试 | 断言 |
|------|------|
| **L-01** | 页面销毁后 IR 实例数 = 0 |
| **L-02** | 事件监听注册表清零 |
| **L-03** | 定时器池清零 |
| **L-04** | 页面对象无强引用（弱引用探测） |
| **L-05** | 内存配额已归还 |

详见 `conformance-suite.md` C-06 组。

---

## 6. 与竞品对比

| 维度 | uni-app / RN / Flutter | **Proteus (G-42)** |
|------|----------------------|-------------------|
| 生命周期 Owner | 双边（JS + 原生） | **单边（IR）** |
| 清理方式 | 开发者手动配对 | **框架代管 + 五原子** |
| 泄漏检测 | 运行时 profiling | **编译期 CI 拦截** |
| 页面栈治理 | 框架硬编码 | **可插拔策略（StackPolicy）** |
| keep-alive | 有，无配额 | **有配额 + LRU** |
| 热重载泄漏 | 常见 | **框架代管，自动回收** |

---

## 7. 小结

> **页面栈泄漏的根因是"生命周期没有单一 Owner"。**
> **Proteus 因为有 IR 层，天然拥有这个 Owner——**
> **解法不是"记得清理"，而是"框架代管 + 五原子销毁 + 编译期检测"。**

**这不是优化，是架构红利。**
