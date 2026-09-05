---
title: 所有权工程
order: 34
group: 专题深入
---

# 所有权工程

跨端应用里最容易泄漏的资源，恰恰是 **GC 管不到的那一类**：原生 View 句柄、零拷贝 ArrayBuffer、定时器、事件订阅、音视频流……传统写法靠「申请-释放」手动配对，只要存在异常、提前 return、路由跳转的中间路径，就会漏掉释放；页面销毁后资源仍被 store 持有，是最常见的内存事故。

> **G-43 不是替代 GC，是治理 GC 的盲区**。GC 管「可达性」，所有权管「意图」：每个边界资源必须有唯一 Owner，谁申请、谁转移、谁释放，全部显式登记、100% 可观测。

## 默认路径：框架代管

99% 的场景不需要手动管理。页面提供所有权上下文与代管资源池，定时器 / 监听 / 请求 / 订阅登记进 `ResourcePool`（`timer` / `interval` / `on` / `bus` / `fetch` / `subscribe`），框架代管资源挂 `page.managed`（ManagedRegistry）：

```ts
import { createPageOwnership, getProteusOwnershipGraph } from '@proteus-vue/render-backend'

const page = createPageOwnership('pageA', {
  graph: getProteusOwnershipGraph(),
  quotaBytes: 32 * 1024 * 1024, // 页面配额上限（超限申请直接抛错）
})

const buf = page.alloc({ byteSize: 8 * 1024 * 1024 }) // 登记进页面 scope + 所有权图 + 配额
```

页面销毁（容器五原子销毁第 3 步 `releaseResources`）委托所有权 Drop 协议：**force drop 该页全部 Owned、失效全部借用、归还全部配额**：

```ts
const report = page.destroy() // force 默认 true
// { freedCount, freedBytes, invalidatedBorrows, managedDisposed, quotaRemaining }
```

页面销毁是「不可泄漏」的：即使业务代码忘写释放，那一刻资源必然归还。

## Owned / Borrow：显式路径

大资源、跨页面场景用类型系统强制处理释放。`Owned<T>` 是唯一所有者句柄：

| API | 语义 |
|---|---|
| `read()` | 读取资源（moved / dropped 状态直接抛 `UseAfterMoveError` 等） |
| `transferTo(targetOwner)` | **Move**：转移所有权，返回目标方的 `Owned<T>`；原句柄此后不可访问 |
| `borrow(scopeName?)` | **Borrow**：临时借用，返回 `Borrow<T>`（`valid` / `get()` / `release()`），计入活跃借用 |
| `weak()` | 弱引用 `Weak<T>`（`alive` / `upgrade()`），打破循环引用 |
| `drop({ force? })` | **Drop**：确定性释放（五阶段协议），返回 `{ ok, freedBytes, freedHandles, invalidatedBorrows }` |
| `subscribe(cb)` | 订阅状态变化（`alive` / `moved` / `dropped`） |

```ts
const buf = pageA.alloc({ byteSize: 8 * 1024 * 1024, transferable: true })

const view = buf.borrow('preview') // 临时借用
view.get() // 读
view.release() // 用完即还

const buf2 = buf.transferTo('pageB') // Move：pageB 接管
buf.read() // ❌ 抛 UseAfterMoveError——原句柄已死
```

## 编译期借用检查（B-01 ~ B-08）

运行时兜底之外，借用检查器在编译期对 `Owned` 变量做状态格分析（Uninit / Alive / Moved / Dropped），按 PSS 模式分级报告：

| 编号 | 规则 | strict | loose |
|---|---|---|---|
| B-01 | Use-after-move / use-after-drop | error | error |
| B-02 | Double-move | error | error |
| B-03 | Borrow 逃逸（闭包捕获 / 写入更长寿容器） | error | warning |
| B-04 | Borrow 生命周期越界 | error | error |
| B-05 | Drop / 转移时存在活跃借用 | error | error |
| B-06 | 作用域结束未处置的 Owned | warning | warning |
| B-07 | 跨页面强引用（存入跨页容器） | error | warning |
| B-08 | 循环引用（打破循环用 Weak） | warning | warning |

**strict 模式下出现任何 error 即阻断构建**；off 模式全部转为运行时兜底 + DevTools 可观测（诊断消息携带 `G4001`~`G4008` 错误码，与规则编号对应）。

## PSS：三级安全子集

任意 JS 下完备的借用检查不可判定（闭包捕获、`eval`、动态属性）。Proteus 的解法与鸿蒙 ArkTS 同源——**限制换能力**：模块文件头声明 Proteus Safe Subset（PSS），付出受限表达力换取静态可分析性。

```ts
// @proteus-pss: strict
// ↑ 文件头 20 行内的模块级声明（strict / loose / off，缺省 off）

const buf = pageContext.alloc(8 * 1024 * 1024)
buf.transferTo('pageB')
buf.read()
// ▲ strict 编译期报错 G4001: use after move
```

| 模式 | 限制 | 保证 |
|---|---|---|
| `off` | 无 | 运行时兜底 + 所有权图可观测 |
| `loose` | P1 禁 `any`、P2 禁动态属性写入 | 主路径编译期检查 |
| `strict` | 完整 P1~P9（禁 `eval` / `delete` / `with` / 原型链修改 / `Owned` 逃逸全局或被闭包捕获等） | 编译期完备 |

strict 还有**自动 drop 插入**：函数作用域内未处置的 `Owned`，编译器在函数闭合前自动插入 `x.drop()`——业务不写 drop 也能正确释放。整套管线（B 规则 + P 限制 + autoDrop + 构建阻断）由 `runPss` 一次跑齐，作为编译管线的独立步骤接入。

## 与 Vue 响应式集成

`Owned` 默认禁止被 `ref` / `reactive` 包装——Proxy 会破坏所有权语义（CMP071，strict 编译期报错）。响应式需求走专用 Hook（`createOwnershipEngineering` 注入式创建，api 包零 vue 运行时依赖）：

```ts
const { useOwned, useBorrow } = createOwnershipEngineering({ reactivity: { ref } })

const view = useOwned(buf) // { state: Ref<'alive'|'moved'|'dropped'>, byteSize, borrow(), stop() }
const handle = useBorrow(buf) // Ref<Borrow | undefined>——所有者释放时自动变 undefined
```

`useOwned` 只暴露状态元信息、不暴露资源引用；`useBorrow` 的失效是响应式的，模板可直接消费。

## 诚实边界

- `transferToDevice()` 跨设备所有权转移：接口定义 + 参考实现模拟验证（📋 B6 待真机）
- PSS 外的动态 JS 无法做完备编译期检查——这是可判定性的固有限制，运行时兜底 + 所有权图可观测补位
- 存量代码渐进采用：off 收集所有权图 → 高频泄漏模块升 loose → 核心模块升 strict

## 下一步

- [容器与宿主](/docs/33-containers-hosts)：五原子销毁如何委托 Drop 协议
- [状态管理](/docs/15-state-management)：store 与页面级资源的边界
- [一致性验证](/docs/29-conformance)：所有权 conformance 全套件
