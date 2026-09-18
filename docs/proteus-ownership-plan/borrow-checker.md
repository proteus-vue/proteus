# 借用检查器：编译期 + 运行时分层保证

> **定位**：G-43 层次②
> **核心**：PSS 内编译期完备，PSS 外运行时兜底

---

## 1. 为什么需要分层

### 1.1 一般 JS 的静态分析不可判定

```js
const key = getUserInput()        // 运行时才知道
obj[key] = buffer                 // 静态分析无法追踪
eval(someString)                  // 完全不可分析
fn.call(thisArg, buffer)          // this 绑定动态
```

在**任意 JS**下，完备的借用检查是**不可判定的** ——
这是计算理论的限制，不是工程能力问题。

### 1.2 但受限子集内是可判定的

这正是 ArkTS 的洞察：
**禁止掉那些让分析不可判定的特性，剩下的就是可分析的。**

PSS（Proteus Safe Subset）做的就是这件事。

### 1.3 分层保证模型

| 层级 | 范围 | 检查方式 | 保证强度 |
|------|------|---------|---------|
| **L3** | PSS `strict` 模块 | 编译期完备分析 | **完备** ✅ |
| **L2** | PSS `loose` 模块 | 编译期主路径分析 | 高 |
| **L1** | PSS `off`（普通 JS） | 运行时追踪 | 兜底 |
| **L0** | 所有层级 | DevTools 可观测 | 100% 可见 |

**关键**：L0 可观测是**全层级强制**的。
即使静态分析帮不上忙，你依然能在 DevTools 里看到完整的所有权图。

---

## 2. PSS 限制清单

### 2.1 strict 模式（完整限制）

| # | 禁止项 | 原因 | 违反后果 |
|---|--------|------|---------|
| P1 | `any` / `unknown` | 类型不可推导 | 编译错误 |
| P2 | 对象动态属性增删 | 布局不稳定 | 编译错误 |
| P3 | `delete` 操作符 | 破坏所有权登记 | 编译错误 |
| P4 | `eval` / `new Function` | 完全不可分析 | 编译错误 |
| P5 | `Owned<T>` 逃逸到全局 | 所有权脱离作用域 | 编译错误 |
| P6 | `Owned<T>` 存入跨页面 store | 生命周期越界 | 编译错误 |
| P7 | 闭包捕获 `Owned<T>` | 作用域不可控 | 编译错误 |
| P8 | `with` 语句 | 作用域动态 | 编译错误 |
| P9 | 原型链动态修改 | 破坏类型契约 | 编译错误 |

### 2.2 loose 模式（部分限制）

```
仅 P1（禁 any）+ P2（禁动态属性）
→ 覆盖主路径分析，其余运行时兜底
```

### 2.3 off 模式

```
无限制，完全运行时兜底 + 100% 可观测
```

---

## 3. 编译期检查规则集

### 3.1 规则总表

| 编号 | 规则 | PSS strict | PSS loose | PSS off |
|------|------|-----------|-----------|---------|
| **B-01** | Use-after-move | ✅ 编译期 | ⚠️ 主路径 | 运行时 |
| **B-02** | Double-move | ✅ 编译期 | ⚠️ 主路径 | 运行时 |
| **B-03** | Borrow 逃逸 | ✅ 编译期 | ❌ | 运行时 |
| **B-04** | Borrow 生命周期越界 | ✅ 编译期 | ⚠️ 主路径 | 运行时 |
| **B-05** | Drop 时存在活跃借用 | ✅ 编译期 | ❌ | 运行时 |
| **B-06** | 未处置的 Owned（作用域结束） | ✅ 编译期 | ⚠️ 警告 | 运行时检测 |
| **B-07** | 跨页面强引用 | ✅ 编译期 | ⚠️ 警告 | DevTools |
| **B-08** | 循环引用 | ⚠️ 警告 | ⚠️ 警告 | DevTools |

### 3.2 B-01 Use-after-move（最重要）

```ts
const buf = pageContext.alloc(8 * MB)
buf.transferTo(pageB)
buf.read()
//  ▲ PSS strict 编译期报错：
//    G4001: use after move
//    → `buf` 已在第 2 行转移给 `pageB`
//    → 第 3 行的访问非法
```

**分析原理**（CFG + 数据流）：

```
1. 构建控制流图（CFG）
2. 对每个 Owned<T> 变量做状态格分析：
     状态格 = { Uninit, Alive, Moved, Dropped }
3. transferTo() → 状态 Alive → Moved
4. 任何对 Moved 状态的 read/write → 报错
```

### 3.3 B-03 Borrow 逃逸

```ts
function f(buf: Owned<ArrayBuffer>) {
  const view = buf.borrow()
  globalCache.v = view        // ❌ G4003: borrow escapes scope
  store.set('v', view)        // ❌ G4003
  setTimeout(() => view.get(), 100)  // ❌ G4003: closure capture
}
```

**分析原理**：借用对象的引用**只能出现在其创建作用域内**。
任何向"更长寿"容器（全局、模块级、跨页面 store、闭包）的写入都是逃逸。

### 3.4 B-06 未处置的 Owned

```ts
function f() {
  const buf = pageContext.alloc(8 * MB)
  // 函数结束，buf 既未 drop 也未 transferTo
  // ❌ G4006: owned resource not disposed
  //    建议：显式 drop() 或 transferTo(scope)
}
```

**这个规则直接对应 Rust 的"所有权必须被处置"**。
（Rust 里是自动 Drop，我们要求显式 —— 因为 JS 没有作用域析构的可靠时机）

---

## 4. 运行时兜底机制

PSS 外（或 strict 分析失败时）由运行时保证：

### 4.1 状态机守卫

```ts
class OwnedImpl<T> implements Owned<T> {
  private _state: OwnedState = 'alive'

  read(): T {
    if (this._state === 'moved')
      throw new UseAfterMoveError(this.id, this.movedTo)
    if (this._state === 'dropped')
      throw new UseAfterDropError(this.id)
    return this._value
  }

  transferTo(target: OwnerScope): void {
    if (this._state !== 'alive')
      throw new IllegalTransferError(this._state)
    this._state = 'moved'
    // ... 登记所有权图边
  }
}
```

### 4.2 借用引用计数

```ts
drop(): DropResult {
  if (this._activeBorrows > 0)
    return {
      ok: false,
      error: {
        code: 'has_active_borrows',
        count: this._activeBorrows
      }
    }
  // ... 执行释放
}
```

### 4.3 页面销毁时的强制清理

即使有活跃借用，页面销毁时（G-42 五原子销毁）也会**强制释放**：

```
五原子销毁步骤 2「解绑事件」包含：
  → 强制失效该页所有 Borrow
  → 强制 drop 该页所有 Owned
  → 归还全部配额
```

**这保证页面销毁是"不可泄漏"的** ——
即使业务代码写得再糟糕，页面销毁那一刻资源必然归还。

---

## 5. 与编译器的集成

### 5.1 借用检查作为 transform 阶段

借用检查器实现为 G-38 `ProteusCompilerBackend` 的一个 **transform 插件**：

```
parse → transform → emit
              ▲
              └─ ★ borrow-checker 插件插入此处
                 输入：IR + PSS 配置
                 输出：IR + 诊断（error/warning）
```

### 5.2 与 CompilerBackend 的关系

```ts
interface BorrowCheckerPlugin extends ProteusTransformer {
  name: 'borrow-checker'
  transform(ir: IRModule, ctx: TransformContext): IRModule {
    const subset = ctx.config.safeSubset
    if (subset === 'off') return ir

    const diagnostics = analyze(ir, { mode: subset })
    ctx.reportDiagnostics(diagnostics)

    // strict 模式下 error 阻断构建
    if (subset === 'strict' && diagnostics.some(d => d.severity === 'error'))
      throw new BuildError('borrow check failed')

    return ir
  }
}
```

**这意味着借用检查是可插拔的** ——
不同 CompilerBackend（Node/Rust/WASM）都可以调用同一个检查器实现，
因为输入是统一的 Compiler IR（G-38 定义）。

---

## 6. Vue 响应式的特殊处理

### 6.1 问题

Vue 的 `ref` / `reactive` 用 Proxy 包装对象。
如果 `Owned<T>` 被 `ref()` 包装，Proxy 会**破坏所有权语义**：

```ts
const buf = ref(pageContext.alloc(8 * MB))
// buf.value 经过 Proxy，内部状态追踪可能失效
// 且 Proxy 产生的额外引用会干扰所有权图
```

### 6.2 解法

```
规则：Owned<T> 默认禁止被 ref/reactive 包装

方案：
1. 显式禁止
   → ref(owned) 在 PSS strict 下编译期报错

2. 提供专用包装
   → useOwned(resource) 返回响应式的所有权状态
   → 内部只暴露 state / byteSize 等元信息
   → 不暴露实际资源引用（避免 Proxy 干扰）

3. 借用可响应式
   → Borrow<T> 可以被 ref 包装（借用不改变所有权）
   → 但失效时自动触发更新（valid 是响应式的）
```

### 6.3 接口

```ts
/** 响应式所有权视图（只读元信息） */
function useOwned<T>(owned: Owned<T>): {
  readonly state: Ref<OwnedState>
  readonly byteSize: Ref<number>
  /** 借用（返回的 Borrow 可安全响应式使用） */
  borrow(): Borrow<T>
}

/** 响应式借用 */
function useBorrow<T>(owned: Owned<T>): Ref<Borrow<T> | undefined>
// → 所有者释放时自动变为 undefined（响应式更新）
```

---

## 7. 渐进采用策略

### 7.1 不强制所有人改写

```
存量代码          → safeSubset: 'off'（运行时兜底 + 可观测）
新模块            → safeSubset: 'loose'
核心/大资源模块    → safeSubset: 'strict'
```

### 7.2 迁移路径

```
Step 1  全局设为 'off'，先收集所有权图数据
Step 2  DevTools 找出高频泄漏模块
Step 3  这些模块逐个升级到 'loose'
Step 4  稳定后升级到 'strict'
Step 5  新项目默认 'strict'
```

### 7.3 与 G-32 迁移策略的一致性

这和 G-32 的小程序迁移策略同构：
**不是一次性切换，是按模块渐进，每步都有可观测反馈。**

---

## 8. Conformance 检查项

| 编号 | 检查 | 期望 |
|------|------|------|
| C-01 | B-01 use-after-move 被拦截 | PSS strict 编译期报错 |
| C-02 | B-02 double-move 被拦截 | 报错 |
| C-03 | B-03 borrow 逃逸被拦截 | 报错 |
| C-04 | B-05 活跃借用时 drop 被拒 | 返回 error |
| C-05 | 运行时 use-after-move 抛错 | `UseAfterMoveError` |
| C-06 | 页面销毁强制回收 | 资源计数归零 |
| C-07 | managed 资源自动释放 | 计数归零 |
| C-08 | 所有权图无孤儿节点 | 一致 |

---

**版本**：v1.0
**日期**：2026-09-03
