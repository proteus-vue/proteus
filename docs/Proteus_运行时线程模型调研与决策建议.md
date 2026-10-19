# 运行时线程模型调研：要不要自研「线程管理引擎」？

> 调研日期：2026-10-19 · 范围：App 宿主（Android / iOS / 鸿蒙）+ Web/MP 对齐 · 结论面向「引擎 vs 原语」的二选一
> 取证方式：读仓库现状代码与规约，不做外推；未实测的数字一律标注「待测」。

---

## 0. 结论（先给）

**不建议自研「运行时线程管理引擎」；建议补「执行原语」，并按 P0→P3 分四级落地。**

三条理由（每条都有本仓代码/规约支撑，见 §2–§4）：

1. **本仓已经有线程模型的唯一 owner（G-39），而且已经写了「诚实拒绝后台线程」的真实实现**。
   再自研一个引擎 = 出现第二个 owner，直接违反 G-39.1/G-39.2/G-41.1（`host-conformance.ts` 的
   H04.03 就是用断言守着这条）。
2. **JS 侧「引擎」的能力天花板只有消息传递**：三端都是单 VM/单线程（Android QuickJS 非线程安全、
   iOS JSC 的 Context 绑线程、鸿蒙 napi VM 一次性），没有共享内存 ⇒ 所谓「线程引擎」拆开看就是
   「结构化克隆 + 宿主线程池」，与 GCD / ThreadPoolExecutor / TaskPool 完全重合，自研只是包一层。
3. **当前最痛的不是「没有线程」，而是「没有时间片、没有取消、没有观测」**。生产宿主已经在做
   「按 `eval_ms` 自适应的批泵」（鸿蒙 `AppRuntimeDriver.ets`），这说明方向本来就是协作式调度，
   只是还没把这条能力暴露成 JS 侧的**原语**。

**建议路线**（细节在 §6）：

| 级别 | 内容 | 解决什么 | 前置 |
|---|---|---|---|
| **P0** | 长任务观测（>50ms 采样 / 队列水位 / JS 堆斜率） | 把「卡」和「漏」变成数字 | 无 |
| **P1** | 执行原语 `postTask/yield/chunk/cancel+deadline`（主线程协作式） | 长任务可分段、可让出、可取消 | 无（纯 JS + 既有泵） |
| **P2** | CPU 密集下沉原生（Rust core / capability） | 从根上不占主线程 | 有明确热点清单 |
| **P3** | `runOnThread('background')` 真后台执行域 | 仅当 P0 数据证明「无法下沉 + 可序列化」 | 鸿蒙持久 VM 先解决 |

**什么情况下才值得回头做「引擎」**：P0 连续两个版本观测到「单任务 >100ms、且不能下沉、且输入输出可序列化」
的业务热点 ≥3 个 —— 那时也应按 G-39 的 `background` 能力增量实现，**不新建独立子系统**。

---

## 1. 先把前提校正：占主线程 ≠ 内存泄漏

你的描述是「耗时操作长时间占用主线程 → 造成内存泄漏」。这两件事在工程上是**两条独立的因果链**，
混在一起会导致「造了一个线程引擎，泄漏还在」：

| 现象 | 直接原因 | 量具 | 正确解法 |
|---|---|---|---|
| 掉帧 / 点不动 / ANR | 单次同步执行超过帧预算（16.7ms）或超过 ANR 阈值 | 帧间隔、长任务直方图 | 时间片 + 让出 + 下沉 |
| 内存上涨 / OOM | 引用未释放（闭包、队列、订阅、定时器、静态单例）或瞬时大对象峰值 | GC 前后 JS 堆、重复交互斜率 | 所有权治理（G-43）+ 背压 + 上限 |
| 两者同时出现 | 长任务**内部**持有了大对象或不断入队 ⇒ 既卡又涨 | 两者一起看 | 先分割任务，再查持有链 |

本仓已经有过一次「把卡顿当泄漏修」的教训类型：决策 #1095 里「主线程 `while + sleep` 泵循环」
让主线程永不进消息循环 ⇒ 回推排不上、现象像「网络不通」，根因其实是**调度形态**。
所以本轮调研的第一条建议不是加线程，而是**先把两类指标分开采**。

> 需要你补的信息：具体是哪个操作？单次持续多久？是稳定复现还是长时间使用后出现？
> 这三个答案会直接改变 P1/P2 的优先级（见 §11）。

---

## 2. 取证：三端运行时现状（本仓当前代码，不是规划）

| 端 | JS 引擎 | 执行线程 | 运行时生命周期 | 关键证据 |
|---|---|---|---|---|
| **Android** | QuickJS（C + JNI） | **主线程**；注释明写「非线程安全：所有 eval 必须在同一线程」 | **进程级单 runtime**（`g_rt`/`g_ctx` static），换 Activity 靠 `resetEngine()` | `hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/QuickJsEngine.java:19-20`、`hosts/android/js-engine/quickjs_jni.c:39-41` |
| **iOS** | JavaScriptCore | **主线程**（UIKit 驱动持有 `JSContext`） | 持久 Context；dev 热刷时整体重建 | `packages/cli/templates-host/ios/shell/ProteusApp.swift:6,69-75` |
| **鸿蒙** | ArkTS napi VM | **主线程**（ArkTS `setInterval` 驱动泵） | **每次调用新建 VM → eval bundle → 驱动 → 有界泵 → 读 → 销毁** | `packages/cli/templates-host/prebuilt/harmony/proteus_render/src/main/cpp/host_app_runtime_impl.h:20-23`（决策 #540） |
| **Web** | 浏览器 | 主线程 + 可注入 Worker 工厂 | 页面生命周期 | `packages/render-backend/src/web-host.ts:40-52` |
| **小程序** | 逻辑层单线程 | 逻辑层（与渲染层分离） | 小程序运行时 | 平台既定 |

**两条对决策影响最大的事实：**

1. **鸿蒙不是「有线程但没用」，而是「运行时本身不跨调用存活」**。决策 #540 记录得很清楚：
   跨 napi 调用复用同一 JSVM 会在微任务排空阶段崩（`HandleScope::Extend` 溢出 / SIGSEGV），
   所以改成一次性 VM。**在这种形态下谈「把任务 post 到后台线程」是没有意义的**——
   没有可投递的目标对象，每次调用结束后 VM 就没了。
2. **Android 的「单运行时」是桥的限制，不是引擎的限制**（QuickJS 支持多 `JSRuntime`），
   但桥里所有状态都是 `static` 且没有 `AttachCurrentThread` 的线程管理，改成多线程要动 JNI 全局态。

---

## 3. 已有资产：线程模型已定案，且已有一个「诚实拒绝」的实现

### 3.1 规约已经写好（`docs/proteus-host-runtime-plan/03-lifecycle-threading.md`）

- 线程角色：Main/UI、Background、Native；宿主映射 iOS=GCD、Android=ThreadPoolExecutor、Web=Worker、鸿蒙=TaskPool；
- API 已定：`runOnThread(thread, task)` / `createWorker(script)` / `postMessage(target, msg)` / `enqueue(task, priority)` / `nextTick(fn)`；
- 规则：**G-39.1 生命周期唯一拥有**、**G-39.2 线程唯一拥有**（Backend 不得 `pthread_create`）、
  G-39.3 能力诚实声明、G-39.4 降级可观测；
- 优先级 0/1/2/3 + 帧循环 + `drainMicrotasks` 也已写明。

### 3.2 真实实现只有「单线程版」，而且明确拒绝后台

`packages/render-backend/src/quickjs-host.ts`：

- `capabilities.threads = { main: true, background: false, count: 1 }`（`:105`）；
- `runOnThread('background')` **抛错并记账**，理由写得很直白：
  「不做假排队——假排队会让调用方以为任务已并行完成」（`:220-227`）；
- `createWorker()` 返回 `real: false` 的**逻辑执行域**（`:50-56,163-174`），不伪装真并行；
- 一致性套件 `host-conformance.ts:250-252` 用断言守着「框架不得直接建线程，须委托 `runtime.createWorker`（G-41.1）」。

### 3.3 ★ 但它没有接进生产（这是真正该修的那件事）

全仓检索 `createQuickJsHostRuntime` 的调用点：**只有 `tests/quickjs-host.test.ts`**。
生产宿主（`packages/cli/templates-host/**`）各自直接操作引擎，不经过这个 runtime。

这与 #1094 记录的形态同族：**「做完了但没接上」比「缺能力」更是问题**。
所以如果现在再自研一个「线程管理引擎」，会得到第三个互不相认的调度层：

```
生产宿主泵（AppActivity.pumpFrames / AppRuntimeDriver.pumpBeat / ProteusApp 驱动）
   └── 直接调引擎（QuickJsEngine.eval / JSContext.evaluateScript / napi VM）
G-39 runtime（quickjs-host.ts）—— 只有测试用
新「线程引擎」 —— 又一套 owner
```

---

## 4. 为什么「引擎」的天花板很低（技术约束，不是偏好）

1. **没有共享内存**：本仓 Android 桥未暴露 `SharedArrayBuffer`/`Atomics`，也没有 Worker 入口；
   `quickjs-host.ts` 头部直接写「无线程原语：没有 Worker / message channel」。
   JSC 侧 `JSValue` 与 `JSVirtualMachine` 绑定，跨 VM 只能传可序列化值。
   ⇒ 任何「引擎」最终都是 **消息传递 + 结构化克隆**，没有共享可变状态可用。
2. **Vue 的运行期图不可序列化**：响应式依赖图、组件实例、闭包都过不了结构化克隆。
   ⇒ 业务代码不可能「搬到后台线程跑」，能搬的只有纯函数（解析、计算、编解码）。
   这条决定了「线程引擎」的用户面极窄：**它只能服务纯计算，不能服务组件逻辑**。
3. **每线程一份堆**：多开一个 JS 运行时就多一份 GC 堆 + 引擎自身开销。
   鸿蒙的一次性 VM 已经证明「建 VM + eval 整包」是重操作；把它 ×N 线程，和「省内存」的目标反向。
4. **不可抢占**：本轮检索 `quickjs_jni.c` 无 `JS_SetInterruptHandler`（零命中）。
   即使开了后台线程，主线程上的长任务依然无法被打断——**线程解决不了「不可中断」**，
   只有「分段 + 让出」或「native 中断钩子」能解决。
5. **语义无法统一**：鸿蒙 taskpool 只能跑 ArkTS 可序列化任务；Android 要自己管 JNIEnv；
   iOS 要自己管串行队列与 VM。所谓「统一线程引擎」最后一定退化成三份平台特化代码。

**对照业界**：React Native 也没有通用 Worker（只有 Reanimated worklet 这种专用通道），
小程序 Worker 能力受限，主流跨端框架的做法都是「JS 单线程 + 重活下沉原生」。
这不是能力不足，是 JS 的对象模型决定的。

---

## 5. 方案取舍

| 方案 | 成本 | 收益 | 主要风险 | 可验证性 | 结论 |
|---|---|---|---|---|---|
| **A. 自研线程管理引擎**（线程池 + 抢占 + 跨线程通信） | 高：三端 × 两形态（持久 VM / 一次性 VM）+ JNI 线程附着 + 双堆 | 中：纯计算可并行 | 与 G-39/G-41 双 owner；鸿蒙无持久 VM 根本落不了地；内存反向 | 差：只能测「更卡还是更快」，跨端不可比 | **不做** |
| **B. 线程原语**（补真后台：`runOnThread('background')` + Worker 句柄） | 中高：Android 第二 JSRuntime + 线程；iOS 第二 JSVM + 串行队列；鸿蒙需先解决持久 VM | 中：同上 | 需要序列化契约 + 生命周期绑定，否则泄漏更严重 | 中：可断言「不阻塞 UI」 | **条件做（P3）** |
| **C. 执行原语**（任务调度：优先级/时间片/让出/取消/背压） | 低：纯 JS + 复用既有泵 | **高：直接治「卡」与「取消不掉」** | 需要宿主泵配合（已有） | 好：长任务 P95、取消生效、队列水位都可机测 | **先做（P0+P1）** |
| **D. 原生下沉**（热点移出 JS） | 中：按热点逐个做 capability / Rust core | **最高：彻底不占主线程** | 需要先有热点清单 | 好：对比下沉前后同场景耗时 | **并行做（P2）** |

一句话：**A 是把 C+D 的活重做一遍还更贵；B 是 C 修不好时的兜底；C+D 是主线。**

---

## 6. 建议落地：P0 → P3

### P0 观测（没有它，后面全是猜）

- 宿主泵里加**长任务采样**：单次同步段 >50ms 记一条 `{phase, ms, page, taskKind}`，落 devtools `/perf`；
- **队列水位**：`enqueue` 后的 pending 数、峰值、拒绝数（背压生效证据）；
- **JS 堆斜率**：已有 `QuickJsEngine.nativeMemoryUsage()`/`nativeRunGC()`（Android）与 iOS 对应读数，
  做「重复交互 N 次 → GC → 堆是否回基线」的机测；
- 判据：不改任何行为，只出数据；先跑出一个真实基线再决定 P1 的切片粒度。

### P1 执行原语（本轮真正要「加的东西」）

形态：**一个 package 内的调度原语，不是引擎**。放 `packages/runtime/src/scheduler.ts`（或 api 层，按归属定），
三端同构、零原生改动，Web/MP 走 `MessageChannel`/`setTimeout(0)`，App 走既有泵。

```ts
export type TaskPriority = 0 | 1 | 2 | 3 // 帧/交互/普通/空闲（与 G-39 的优先级对齐）

export interface TaskOptions {
  priority?: TaskPriority
  /** 单个时间片预算（ms）；超预算自动让出并续跑（协作式，不抢占） */
  sliceMs?: number
  /** 取消信号（AbortSignal 同形，MP 产物安全：不用 ?. / ??） */
  signal?: { aborted: boolean }
  /** 诊断标签（落到 P0 的长任务采样里，回答「谁占的主线程」） */
  label?: string
}

export interface Scheduler {
  /** 投递一个任务；返回 Promise，取消 ⇒ reject(CancelledError) */
  postTask<T>(fn: (ctx: TaskContext) => T | Promise<T>, opts?: TaskOptions): Promise<T>
  /** 主动让出一帧/一个宏任务（长循环里每 N 次迭代调一次） */
  yield(opts?: { label?: string }): Promise<void>
  /** 把一个数组分片处理（内部用 yield，业务不用手写分段） */
  forEachChunked<T>(list: readonly T[], each: (item: T, i: number) => void, opts?: TaskOptions): Promise<void>
  /** 空闲执行（App 端 = 低优先级队列；Web = requestIdleCallback 兜底 rAF） */
  idle<T>(fn: () => T, opts?: TaskOptions): Promise<T>
  /** 诊断：当前水位 / 峰值 / 拒绝数 / 最近长任务 */
  stats(): SchedulerStats
}
```

关键设计点（这几点决定它是不是「原语」而不是「小引擎」）：

1. **不创建线程、不建 VM、不管线程安全**——只做「主线程上的任务准入 + 时间片 + 取消 + 背压」；
2. **让出必须真的回到宿主消息循环**：App 端 `yield()` 的实现 = 一次 `await` + 宿主 `nativeRunPendingJobs`
   已经接入的泵（`AppActivity.java:231,621,626,827,845`），不是 `setTimeout(0)`（App 没有）；
3. **背压**：队列上限（默认 256）+ 超限返回 `rejected` 并记账，**不静默丢弃**（对齐 `RuntimeRefusal` 的风格）；
4. **取消语义**：合作式（任务自己在 `ctx.isCancelled()` 处退出）+ 投递侧立即出队；
   杀不掉的同步纯计算要在 dev 下告警（P0 采样会看到它）；
5. **不接管渲染帧**：帧调度仍归宿主泵（G-39.1），scheduler 只是排队者。

### P2 原生下沉（按热点做，不按能力做）

优先级从高到低（按「最容易占主线程且最容易下沉」排序）：

1. **大 JSON / 大字节解析**：已有 `invokeBytes` + `PRSP` 二进制帧通道（决策 #903），
   能走 bytes 就不要 `JSON.parse` 大字符串；
2. **列表 diff / 大树 patch**：Rust layout core 已在原生侧，考虑把 patch 合并也下沉；
3. **加解密 / 压缩 / 哈希 / 图片缩放**：纯 CPU、输入输出都是字节，最适合下沉；
4. **正则批量 / 文本清洗**：可下沉为「规则串 + 文本进、结果出」的 capability。

判据：同一场景「下沉前 vs 下沉后」主线程最长任务耗时；目标把 P95 压到 <16ms。

### P3 真后台执行域（条件触发，别现在做）

触发条件（三条同时满足）：

- P0 显示存在 ≥3 个「单次 >100ms」热点；
- 这些热点**无法下沉原生**（业务自定义算法、必须跑 JS）；
- 输入输出可序列化（纯数据进出，不碰响应式图/组件实例）。

实现要点（按 G-39 接口增量，不新建子系统）：

| 端 | 做法 | 必须先解决 |
|---|---|---|
| Android | 第二个 `JSRuntime` + 专属线程；消息走 `PRSP` 帧；JNI 需 `AttachCurrentThread` + 去掉 `static g_rt` 单例假设 | 桥全局态改「运行时句柄」 |
| iOS | 第二个 `JSVirtualMachine` + 串行 `DispatchQueue`；只传可序列化值 | Context 生命周期与销毁时序 |
| 鸿蒙 | 先把「一次性 VM」改成「可跨调用复用的持久 VM」（决策 #540 的崩溃要先解） | **硬前置**：没有持久 VM 就没有投递目标 |
| Web/MP | 已有 Web Worker / 小程序 Worker 通道，可直接接 | 序列化契约统一 |

---

## 7. 「内存泄漏」的真实形态：本仓可查的五个持有链

线程不是解药；下面这些才是「长期使用后内存上涨」的可查路径（按可疑度排序）：

1. **无界任务队列**：`quickjs-host.ts` 的 `enqueue` 没有上限，`queue` 只在 `destroy()` 清空（`:154-161,181-189`）；
   若运行时处于 `suspended`，`pumpFrame` 直接返回 0（`:202-204`）⇒ **挂起期间入队的任务永久堆积**。
   这是结构性的，不是使用不当。
2. **进程级单例不清**：Android `g_rt/g_ctx/g_host_obj` 是 `static`，换 Activity 靠 `resetEngine()`；
   任何「reset 前入队/注册的回调」都会把旧 Java 对象挂住（全局引用 `g_host_obj`）。
3. **一次性 VM 的堆抖动**：鸿蒙每次调用建 VM + eval 整包 ⇒ 大量短命大对象，
   宏观表现是「内存高位不降」而不是「线性泄漏」，但一样会被系统判为内存压力。
4. **无主订阅/定时器**：G-43 已治理一部分（WS/键盘/传感器/capture），但 `screenTrees` 等仍是「生产零调用」；
   同理 `setInterval` 泵在 `stop()` 漏调时会持续持有 driver。
5. **长任务里的大对象**：一次 `JSON.parse` 出 20MB 中间结构 + 闭包捕获，任务结束后若被缓存/日志引用即长留。

**泄漏判据（可机测）**：

- 重复同一交互 N=50 次 → `nativeRunGC()` → 读 `memory_used_size`；
  斜率 > 阈值（如每轮 >64KB 且不回落）= 泄漏；一次性 VM 场景看进程 PSS 的锯齿是否收敛；
- 任务队列：交互结束后 `pending` 必须回 0；`suspended` 期间入队必须被拒（P1 的背压会强制这一点）。

---

## 8. 验收判据（建议直接进 CI / 真机脚本）

| 判据 | 阈值（建议） | 量具 |
|---|---|---|
| 交互期最长单任务 | <50ms（P95 <16ms） | P0 采样落盘 |
| 取消生效 | `cancel()` 后 1 帧内不再执行该任务 | 计数器 + 单测 |
| 队列背压 | 超上限 ⇒ `rejected` 计数 >0，且**不增长** | `scheduler.stats()` |
| 让出不掉帧 | `forEachChunked(10k)` 期间帧间隔 P95 <20ms | 宿主帧统计（已有 Choreographer/CADisplayLink） |
| 堆回落 | 50 轮交互 + GC 后 ≤ 基线 ×1.1 | `nativeMemoryUsage` |
| 三端同构 | 同一 scheduler 单测在三端 bundle 下全绿 | `tests/` + 真机脚本 |

---

## 9. 如果最终还是要做「引擎」：最小可行路径（诚实版）

给未来留个口子，避免下次从零讨论：

1. **先接上现有的 G-39 runtime**（把 `quickjs-host.ts` 接进生产宿主），让「线程唯一拥有」真的成立；
2. **只实现一个执行域**（1 个后台线程，不搞线程池），接口就是 G-39 的 `runOnThread` + `postMessage`；
3. **传输只允许二进制帧**（复用 `PRSP`），禁止传对象/闭包 —— 这会把「不可序列化」在编译期/运行期直接拒掉；
4. **后台域不持有任何 UI 引用**，生命周期跟 runtime 走（destroy 必须 join 线程，否则就是新的泄漏源）；
5. **只在 P0 数据支持时开启**，并在 `capabilities.threads` 里如实上报 `background:true`（鸿蒙先解决持久 VM）。

代价预估（量级，不是承诺）：Android 桥改造 + iOS VM/队列 + 鸿蒙持久 VM 三条并行，
每条都不是「加个 API」的量级；且需要新的 conformance 用例来守「不假并行」。

---

## 10. 不建议做的事（明确写下来，避免下次反复）

- ❌ 把「加线程」当成「修卡顿」的默认答案——**不可中断**才是根因，线程不解决它；
- ❌ 为了并行去 `JSON.parse(JSON.stringify(x))` 做深拷贝——这本身就是主线程长任务；
- ❌ 在一次性 VM（鸿蒙当前形态）上做「后台投递」——没有投递目标；
- ❌ 新建一个与 G-39 并列的调度层——双 owner 的代价会在生命周期/销毁时序上成倍出现。

---

## 11. 需要你确认的三件事（会改变优先级）

1. **具体是哪个操作卡**：页面启动 / 大列表滚动 / 表单提交 / 导入导出 / 图片处理？
2. **单次持续多久**：几十毫秒（时间片能治）还是几秒（必须下沉/分片）？
3. **内存现象的证据**：是「越用越涨不回落」还是「偶发 OOM」？有没有 Instruments / `dumpsys meminfo` 的截图或数值？

有这三条，我可以把 P1 的 API 直接落到具体调用点，并把 P2 的下沉清单按你的真实热点排序。

---

## 附：本次取证的文件索引

| 事实 | 文件:行 |
|---|---|
| Android 单运行时 / 非线程安全 / 主线程 | `hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/QuickJsEngine.java:19-20` |
| 进程级 `static g_rt/g_ctx` | `hosts/android/js-engine/quickjs_jni.c:39-41` |
| iOS `JSContext` 由驱动持有（主线程） | `packages/cli/templates-host/ios/shell/ProteusApp.swift:6,69-75` |
| 鸿蒙一次性 VM（#540 崩溃后定案） | `packages/cli/templates-host/prebuilt/harmony/proteus_render/src/main/cpp/host_app_runtime_impl.h:20-23` |
| 鸿蒙批泵按 `eval_ms` 自适应（>80ms 减半 / <20ms 加倍） | `packages/cli/templates-host/prebuilt/harmony/proteus_render/AppRuntimeDriver.ets:150-160` |
| Android 主线程泵推进 JS job 队列 | `packages/cli/templates-host/android/src/dev/proteus/layoutcore/AppActivity.java:231,621,626,827,845` |
| G-39 线程模型与 API 草案 | `docs/proteus-host-runtime-plan/03-lifecycle-threading.md` §2 |
| G-39.1–G-39.6 规则 | `docs/proteus-host-runtime-plan/01-host-runtime.md:245-250` |
| 单线程实现「诚实拒绝后台」 | `packages/render-backend/src/quickjs-host.ts:105,220-227` |
| 「框架不得直接建线程」断言 | `packages/render-backend/src/host-conformance.ts:250-252` |
| 该实现仅被测试引用（未接生产） | 全仓检索 `createQuickJsHostRuntime` → 仅 `tests/quickjs-host.test.ts` |
| Web 宿主 Worker 工厂（可注入，失败降级 fake） | `packages/render-backend/src/web-host.ts:40-52` |
| 无 `JS_SetInterruptHandler`（不可抢占） | `hosts/android/js-engine/quickjs_jni.c` 全文零命中 |
