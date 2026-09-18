# Drop 协议：确定性资源释放

> **定位**：把 G-42 的「五原子销毁」泛化为通用资源释放链
> **原则溯源**：#13.22 确定性 Drop

---

## 1. 为什么需要确定性 Drop

### 1.1 GC 的问题是"时机不确定"

```js
{
  const buf = allocate(8 * MB)
  // ... 使用
}
// buf 离开作用域，但何时释放？
// → GC 决定。可能是 1ms 后，也可能是 60s 后
// → 期间 8MB 一直占着
```

对于**边界资源**（原生句柄、共享内存、文件句柄），
"不知道什么时候释放"是不可接受的 —— 因为：

- 内存配额被持续占用（G-42 配额机制失效）
- 文件句柄可能耗尽（操作系统限制）
- 摄像头不释放，其他应用打不开
- DevTools 看到的内存曲线无法解释

### 1.2 Rust 的启示

```rust
{
    let buf = vec![0u8; 8 * 1024 * 1024];
    // ... 使用
}   // ← 作用域结束，确定性地、立即地 Drop
```

**Rust 的 Drop 是确定的**：作用域结束的那一刻，资源必然释放。

### 1.3 我们的目标

> **在 JS 里实现"作用域级确定性释放"** ——
> 不依赖 GC 时机，释放点是可预测的。

---

## 2. Drop 协议设计

### 2.1 释放链的五个阶段

```
┌─ Drop 生命周期 ────────────────────────────────┐
│                                                │
│  ① prepare    检查前置条件（有活跃借用？）      │
│       ↓                                        │
│  ② invalidate 失效所有 Borrow / Weak            │
│       ↓                                        │
│  ③ release    调用 Backend 的实际释放动作        │
│       ↓                                        │
│  ④ unregister 从所有权图移除节点                │
│       ↓                                        │
│  ⑤ reclaim    归还配额（G-39 记账）             │
│                                                │
└────────────────────────────────────────────────┘
```

### 2.2 为什么是五个阶段

| 阶段 | 必要性 |
|------|--------|
| ① prepare | 防止悬垂借用（有借用时拒绝释放） |
| ② invalidate | 保证借用方立即感知，不会用到已释放资源 |
| ③ release | 实际归还底层资源 |
| ④ unregister | 保持所有权图与实际状态一致（DevTools 可信） |
| ⑤ reclaim | 配额记账必须准确，否则 G-42 配额机制失效 |

**跳过任何一步都会导致不一致** —— 这就是为什么叫"协议"而不是"函数"。

### 2.3 接口

```ts
interface DropProtocol {
  /** 执行完整释放链 */
  drop(resource: ResourceId): DropResult

  /** 强制释放（忽略活跃借用，用于页面销毁） */
  forceDrop(resource: ResourceId): DropResult
}

type DropResult =
  | {
      ok: true
      freedBytes: number
      freedHandles: number
      invalidatedBorrows: number
    }
  | { ok: false; error: DropError }
```

---

## 3. 与 G-42 五原子销毁的关系

### 3.1 G-42 已有的五原子

```
G-42 页面销毁：
  1. unmount        卸载 Backend 挂载点
  2. unbindEvents   解绑事件/手势
  3. releaseResources 清定时器/订阅/请求
  4. destroyIR      销毁 IR 实例
  5. releaseQuota   归还内存配额
```

### 3.2 G-43 的泛化

**G-42 的第 3 步「releaseResources」在 G-43 中被具体化为 Drop 协议**：

```
G-42 步骤 3「releaseResources」
    ↓ 泛化
G-43：遍历该页所有权图上的所有节点
      → 对每个节点执行 Drop 五阶段
      → 使用 forceDrop（页面销毁场景下强制释放）
```

### 3.3 关系图

```
G-42 五原子销毁
  ├─ 1. unmount           （原地）
  ├─ 2. unbindEvents      （原地）
  ├─ 3. releaseResources  → ★ 委托给 G-43 Drop 协议
  ├─ 4. destroyIR         （原地）
  └─ 5. releaseQuota      → ★ 与 G-43 阶段⑤ 合并
```

**G-42 提供"何时销毁"，G-43 提供"怎么释放"。**

---

## 4. 作用域级释放（PSS strict）

### 4.1 问题

JS 没有可靠的作用域析构钩子（`using` 提案尚未普及）。

### 4.2 解法：编译期插入 drop

PSS strict 下，编译器在作用域结束处**自动插入 drop 调用**：

```ts
// 开发者写的
function process() {
  const buf = pageContext.alloc(8 * MB)
  doWork(buf)
}

// 编译器转换后
function process() {
  const buf = pageContext.alloc(8 * MB)
  try {
    doWork(buf)
  } finally {
    if (buf.state === 'alive') buf.drop()   // ★ 自动插入
  }
}
```

**这实现了与 Rust 同等的确定性** ——
作用域结束（包括异常路径）必然释放。

### 4.3 与 B-06 规则的关系

- **B-06**（未处置的 Owned）：在 PSS `loose` 下是警告
- **PSS `strict` 下**：编译器自动插入 drop，不再报错

**strict 模式下业务代码可以不写 drop** —— 编译器帮你写。
这是"限制换能力"的又一个体现。

---

## 5. 各类资源的释放动作

由对应 Backend 实现，框架只定义契约：

| ResourceType | 释放动作 | 负责方 |
|-------------|---------|--------|
| `shared-buffer` | 归还底层字节 | G-39 HostRuntime |
| `native-view` | `backend.deleteNode()` | G-27 RenderBackend |
| `camera-handle` | `capability.release()` | G-28 CapabilityBackend |
| `file-handle` | `fs.close()` | G-28 |
| `timer` | `clearInterval` | 框架内置 |
| `subscription` | `emitter.off` | 框架内置 |
| `network-request` | `abort()` | 框架内置 |
| `audio-stream` | 原生侧停止 + 归还 | G-40 实时逃逸通道 |

**关键**：释放动作由**创建该资源的 Backend** 负责。
这符合原则 #0 —— 谁提供能力，谁负责清理。

---

## 6. 失败处理

### 6.1 释放失败必须可观测

```ts
const result = buf.drop()
if (!result.ok) {
  // 不允许静默失败
  logger.error('drop failed', result.error)
  // 且资源仍在所有权图中标记为 alive（而非假装已释放）
}
```

### 6.2 禁止的行为

```
❌ 释放失败后仍标记为 dropped     → 所有权图失真
❌ 释放失败后静默忽略             → 泄漏被隐藏
❌ 部分释放（只释放一半）          → 状态不一致
```

### 6.3 重试与兜底

```
1. 释放失败 → 记录 + 保持 alive 状态
2. 页面销毁时再次尝试 forceDrop
3. 仍失败 → 报告给宿主（G-39），由宿主导地位是否强杀
4. 全过程在 DevTools 可见
```

---

## 7. Conformance 检查项

| 编号 | 检查 | 期望 |
|------|------|------|
| D-01 | Drop 五阶段完整执行 | 顺序正确 |
| D-02 | 有活跃借用时 drop 被拒 | `has_active_borrows` |
| D-03 | forceDrop 忽略借用强制释放 | 成功 |
| D-04 | drop 后借用自动失效 | `valid === false` |
| D-05 | drop 后配额归还 | 记账一致 |
| D-06 | 释放失败不静默 | 返回 error |
| D-07 | 作用域级自动 drop（strict） | 异常路径也释放 |
| D-08 | 重复 drop 被拒 | `already_dropped` |

---

**版本**：v1.0
**日期**：2026-09-03
