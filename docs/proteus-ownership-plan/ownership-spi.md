# 资源所有权 SPI 规范

> **定位**：G-43 层次① 的完整接口定义
> **原则溯源**：#13.21 资源所有权可插拔

---

## 1. 类型体系总览

```
Resource<T>
  ├─ Owned<T>        唯一所有权（可 Move / Drop）
  ├─ Borrow<T>       借用（有作用域，不可 Move / Drop）
  ├─ Weak<T>         弱引用（不阻止释放）
  └─ Managed<T>      框架代管（跟随页面生命周期自动释放）
```

**默认路径是 `Managed<T>`** —— 业务零心智负担。
`Owned<T>` 只在大资源 / 跨页面场景下显式使用。

---

## 2. Owned<T>：唯一所有权

### 2.1 接口定义

```ts
interface Owned<T> {
  /** 类型标记 */
  readonly __brand: 'Owned'
  readonly resourceType: ResourceType

  /** 读取内容（借用视角，作用域内有效） */
  read(): T

  /** 可变借用（PSS 内受借用检查约束） */
  write(): T

  /** ★ Move：转移所有权，调用后本对象作废 */
  transferTo(target: OwnerScope): void

  /** ★ Borrow：创建借用，受作用域约束 */
  borrow(): Borrow<T>

  /** ★ Weak：创建弱引用，不阻止释放 */
  weak(): Weak<T>

  /** ★ Drop：确定性释放 */
  drop(): DropResult

  /** 资源大小（用于配额记账） */
  readonly byteSize: number

  /** 所有权状态 */
  readonly state: 'alive' | 'moved' | 'dropped'

  /** ★ 跨设备转移（分布式扩展） */
  transferToDevice(deviceId: string): Promise<DeviceTransferResult<T>>
}
```

### 2.2 Move 语义

```ts
const buf: Owned<ArrayBuffer> = pageContext.alloc(8 * MB)

buf.transferTo(pageB)
// buf.state === 'moved'

buf.read()      // ❌ PSS strict：编译期错误
                // ⚠️ PSS loose/off：运行时抛 UseAfterMoveError
buf.transferTo(pageC)  // ❌ 重复转移
buf.drop()             // ❌ 已转移，无权释放
```

**Move 后原所有者作废，这是所有权的定义性特征。**

### 2.3 Drop 语义

```ts
const buf = pageContext.alloc(8 * MB)
const result = buf.drop()

type DropResult =
  | { ok: true; freedBytes: number; freedHandles: number }
  | { ok: false; error: DropError }

type DropError =
  | { code: 'already_dropped' }
  | { code: 'already_moved' }
  | { code: 'has_active_borrows'; count: number }   // ★ 有活跃借用，不能释放
  | { code: 'not_owner' }
```

**关键约束 `has_active_borrows`**：
有活跃借用时禁止释放 —— 这就是借用检查的运行时兜底。
（PSS strict 下这个情况在编译期就被拦截了，运行时是第二道防线）

---

## 3. Borrow<T>：借用

### 3.1 接口定义

```ts
interface Borrow<T> {
  readonly __brand: 'Borrow'
  readonly source: Weak<T>

  /** 读取 */
  get(): T | undefined     // undefined = 源已释放

  /** 是否仍然有效 */
  readonly valid: boolean

  /** 借用时长（用于 DevTools 检测长期借用） */
  readonly borrowedAt: number
  readonly durationMs: number

  /** 显式归还（可提前结束借用） */
  release(): void
}
```

### 3.2 借用约束

```
1. 借用不得比所有者活得更久
   → 所有者 drop 时，所有 Borrow 自动失效（valid = false）

2. 借用不可 Move、不可 Drop
   → 借用者不是所有者，无权处置

3. 借用不得逃逸其作用域
   → PSS strict：编译期拦截
   → PSS 外：DevTools 检测并告警

4. 有活跃借用时，所有者不可 Drop
   → 防止悬垂借用
```

### 3.3 借用作用域（PSS strict）

```ts
function process(buf: Owned<ArrayBuffer>) {
  // ✅ 借用作用域：函数内
  const view = buf.borrow()
  doSomething(view.get())
  // 函数结束，借用自动释放

  // ❌ 逃逸：借用存到外部
  globalCache.view = buf.borrow()      // 编译期错误
  store.save('view', buf.borrow())     // 编译期错误
  setTimeout(() => view.get(), 1000)   // 编译期错误（闭包捕获）
}
```

---

## 4. Weak<T>：弱引用

### 4.1 用途：打破循环

```ts
// 问题：循环引用
pageA.ref = pageB      // A 持有 B
pageB.ref = pageA      // B 持有 A
// → 两者互相持有，谁都不会被释放

// 解法：一方用 Weak
pageA.ref = pageB                    // 强引用
pageB.backRef = pageContext.weak(pageA)   // ✅ 弱引用
// → A 销毁时，B 的 backRef 自动失效
```

### 4.2 接口

```ts
interface Weak<T> {
  readonly __brand: 'Weak'
  /** 提升为借用（可能失败） */
  upgrade(): Borrow<T> | undefined
  /** 源是否存活 */
  readonly alive: boolean
}
```

---

## 5. Managed<T>：框架代管（默认路径）

### 5.1 设计目标：零心智负担

```ts
// 业务代码：只申请，不释放
const timer = pageContext.timer(1000, tick)
const sub   = pageContext.subscribe(ch, handler)
const req   = pageContext.fetch(url)

// 页面销毁时，框架自动：
//   clearInterval(timer)
//   emitter.off(sub)
//   req.abort()
```

**这是 99% 场景的路径** —— 开发者不需要知道所有权模型的存在。

### 5.2 为什么这消灭了 80% 的泄漏

传统泄漏的主要来源是**定时器 / 订阅 / 事件监听忘清**。
改由框架代管后，这三类**从根上不再可能泄漏** ——
因为释放动作不在业务代码里，业务代码里没有"忘记"的机会。

### 5.3 接口

```ts
interface ManagedResource<T> {
  readonly __brand: 'Managed'
  readonly value: T
  /** 手动提前释放（可选，不释放也会自动回收） */
  dispose(): void
  readonly disposed: boolean
}

interface PageContext {
  timer(ms: number, fn: () => void): ManagedResource<TimerHandle>
  interval(ms: number, fn: () => void): ManagedResource<TimerHandle>
  subscribe(ch: string, fn: Handler): ManagedResource<SubHandle>
  fetch(url: string, init?: RequestInit): ManagedResource<AbortableRequest>
  // ... 其他可代管资源
}
```

---

## 6. ResourceType 分类

```ts
type ResourceType =
  // 内存类
  | 'shared-buffer'      // G-40 零拷贝 ArrayBuffer
  | 'native-view'        // 原生 View / Widget 句柄
  | 'image-bitmap'
  // 句柄类
  | 'file-handle'
  | 'db-connection'
  | 'camera-handle'
  | 'audio-stream'
  | 'sensor-stream'
  // 订阅类
  | 'timer'
  | 'subscription'
  | 'event-listener'
  | 'network-request'
```

**不同 ResourceType 的释放动作不同**，由各 Backend 实现：

| ResourceType | 释放动作 |
|-------------|---------|
| `shared-buffer` | 归还底层字节 + 配额记账 |
| `native-view` | 调用 Backend 的 `deleteNode` |
| `camera-handle` | 调用 `useCamera().release()` |
| `timer` | `clearInterval` |
| `subscription` | `emitter.off` |
| `network-request` | `abort()` |

---

## 7. 所有权图（Ownership Graph）

### 7.1 数据结构

框架内部维护一张图，这是 DevTools 可视化的数据源：

```ts
interface OwnershipGraph {
  nodes: Map<ResourceId, OwnershipNode>
  edges: OwnershipEdge[]
}

interface OwnershipNode {
  id: ResourceId
  type: ResourceType
  byteSize: number
  owner: OwnerScope | null        // null = 无主（异常）
  state: 'alive' | 'moved' | 'dropped'
  createdAt: number
  createdAtSource?: SourceLocation  // ★ 源码位置（调试关键）
}

type OwnershipEdge =
  | { kind: 'owns';    from: OwnerScope;  to: ResourceId }
  | { kind: 'borrows'; from: OwnerScope;  to: ResourceId; since: number }
  | { kind: 'weak';    from: OwnerScope;  to: ResourceId }
```

### 7.2 为什么这张图是 DevTools 的关键

传统 DevTools 只有**堆快照**（一堆对象 + 可达性），
我们有**所有权图**（Owner + Borrow + Weak + 源码位置 + 生命周期）。

**差异**：
- 堆快照告诉你"这个对象还活着"
- 所有权图告诉你"**谁持有它、凭什么持有、该不该持有、在哪创建的**"

**后者才是排查泄漏真正需要的信息。**

---

## 8. Conformance 检查项

| 编号 | 检查 | 期望 |
|------|------|------|
| O-01 | `Owned` 转移后不可访问 | PSS strict 编译期 / 运行时抛错 |
| O-02 | 重复转移被拒绝 | 抛 `already_moved` |
| O-03 | 有活跃借用时禁止 Drop | 抛 `has_active_borrows` |
| O-04 | Borrow 在所有者 drop 后失效 | `valid === false` |
| O-05 | Weak 不阻止释放 | 所有者 drop 成功 |
| O-06 | Managed 资源随页面自动释放 | 页面销毁后计数归零 |
| O-07 | 所有权图节点数与实资源数一致 | 无孤儿节点 |
| O-08 | 跨设备转移原子性 | 成功则原端 drop，失败则原端保留 |

---

**版本**：v1.0
**日期**：2026-09-03
