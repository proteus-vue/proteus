# G-39 宿主运行时（Host Runtime）SPI 与职责边界

> 状态：Draft → 待规约合并
> 依赖：G-27（渲染可插拔）、G-28（能力后端）、G-29（编译）、G-30（端接入）、G-37（RenderBackend）、G-38（CompilerBackend）
> 被依赖：proteus-positioning、proteus-roadmap、Website v3（运行时剖面）

---

## 1. 动机：插拔架构在运行期是裸奔的

G-27/28/29/30 建立了"四层可插拔"的方向，G-37/G-38 把渲染后端、编译后端的**插头标准**定义清楚了。但有一个问题始终没人回答：

> **代码跑起来之后——谁管进程生命周期？谁管线程？谁管 JS 引擎实例？谁管 JS↔Native 的通信桥？谁管消息队列和事件循环？**

这些职责不属于框架内核（它只管 IR/Diff/调度），不属于渲染后端（它只管把 C-IR 变成 UI 树），不属于能力后端（它只管扫码/支付）。

**这就是宿主运行时（Host Runtime）。没有它，整个插拔架构在运行期是无主状态。**

### 1.1 三个真实痛点

| 痛点 | 没有 Host Runtime 时 | 有 Host Runtime 后 |
|------|---------------------|-------------------|
| **生命周期无主** | 页面切后台，谁暂停渲染/JS？各 Backend 各自猜 | Runtime 统一定义 `bootstrap/suspend/resume/destroy` |
| **线程混乱** | 渲染在 Main、JS 在 Worker、能力在 IO 线程，谁调度？ | Runtime 是唯一拥有者：线程池 + 任务优先级 |
| **原生桥失控** | 每个 Backend 自己写 JSBridge，重复且不安全 | Runtime 统一 `invokeNative/registerNativeHandler` |

### 1.2 设计原则（源自方法论五支柱 + 原则 #13）

- **语义优先**：Runtime 暴露的是"生命周期/线程/消息队列"语义，不是某个 OS 的 API
- **接口与实现解耦**：`ProteusHostRuntime` 是接口，iOS/Android/Web/Flutter 各自实现
- **验证先于运行**：conformance 42 项，跑通才算兼容（原则 #13）
- **渐进覆盖**：能力声明 `capabilities`，缺啥降级啥（不崩）
- **可泛化**：任何宿主（含 Terminal/车机/TV/Watch）都实现同一套 SPI

---

## 2. 四层职责架构（含唯一拥有者）

```
┌─────────────────────────────────────────────────┐
│  L0  业务应用 (Business App)                     │
│      用 128 原语写业务                            │
├─────────────────────────────────────────────────┤
│  L1  Proteus Framework Core  (框架内核)           │
│      IR 标准 / Diff 算法 / 响应式 / 调度器 / 桥   │
│      ★ 唯一拥有：IR 定义、Diff 算法、组件模型     │
├─────────────────────────────────────────────────┤
│  L2  CapabilityBackend (能力后端, G-28)          │
│      扫码/定位/支付/登录/存储/文件系统             │
│      ★ 唯一拥有：跨端原生能力抽象                  │
├─────────────────────────────────────────────────┤
│  L3  RenderBackend (渲染后端, G-37)              │
│      把 C-IR → 原生 UI 树                         │
│      ★ 唯一拥有：节点创建/布局/绘制/手势          │
├─────────────────────────────────────────────────┤
│  L4  ★Host Runtime (宿主运行时, G-39, 本次)      │
│      生命周期 / 线程 / JS 引擎 / 消息队列 / 原生桥 │
│      ★ 唯一拥有：进程/线程/事件循环/原生桥        │
└─────────────────────────────────────────────────┘
         ↓ 运行在
      原生宿主 (Host)
   (iOS / Android / Flutter / Skia / Harmony / Web / Terminal)
```

### 2.1 唯一拥有者原则（核心）

**每一项职责都有且仅有一个层拥有**。禁止重复实现、禁止越层访问。

| 职责 | 唯一拥有者 | 反例（违规） |
|------|-----------|-------------|
| IR 定义 / Diff 算法 | L1 Framework Core | Backend 自己发明 IR |
| 跨端原生能力 | L2 CapabilityBackend | 业务直接调系统 API |
| UI 节点/布局/绘制 | L3 RenderBackend | 框架直接操作 UIView |
| **进程/线程/事件循环** | **L4 Host Runtime** | **Backend 自己 spawn 线程** |
| **JS 引擎实例** | **L4 Host Runtime** | 业务直接拿 V8 isolate |
| **JS↔Native 桥** | **L4 Host Runtime** | RenderBackend 自己写 JSBridge |

详见 `02-responsibility-matrix.md`。

---

## 3. 核心接口：ProteusHostRuntime

```typescript
/**
 * 宿主运行时 SPI
 * 任何宿主（iOS/Android/Web/Flutter/Harmony/Terminal）实现此接口即可接入 Proteus
 */
interface ProteusHostRuntime {
  readonly id: string;                 // 'ios' | 'android' | 'web' | 'flutter' | 'harmony' | 'terminal'
  readonly version: string;
  readonly capabilities: RuntimeCapabilities;

  // === 生命周期（唯一拥有） ===
  bootstrap(ctx: BootstrapContext): Promise<AppInstance>;
  suspend(): void;                     // 切后台
  resume(): void;                      // 切前台
  destroy(): void;                     // 销毁

  // === 线程模型（唯一拥有） ===
  createWorker(script: string): WorkerHandle;
  postMessage(target: WorkerHandle | 'main', msg: any): void;
  runOnThread(thread: 'main' | 'background', task: () => void): void;

  // === JS 引擎抽象（唯一拥有） ===
  createEngine(config: EngineConfig): JSEngine;
  evalInEngine(engine: JSEngine, code: string): any;

  // === 原生桥（唯一拥有） ===
  registerNativeHandler(name: string, handler: (args: any) => any): void;
  invokeNative(name: string, args: any): Promise<any>;

  // === 消息队列 / 事件循环（唯一拥有） ===
  enqueue(task: () => void, priority?: number): void;
  nextTick(fn: () => void): void;
  setInterval(fn: () => void, ms: number): TimerHandle;
}
```

**共 15 个方法**（含 3 可选）+ 生命周期 4 方法。对比：G-37 渲染 18+1，G-38 编译 16+3——**同量级，符合原则 #13 的同形性**。

### 3.1 RuntimeCapabilities（能力自描述，G-39.3）

```typescript
interface RuntimeCapabilities {
  threads: {
    main: boolean;        // 有主线程
    background: boolean;  // 有后台线程/Worker
    count: number;        // 线程池大小（Terminal=1）
  };
  engine: 'v8' | 'jsc' | 'quickjs' | 'arkcompiler' | 'node' | 'none';
  nativeBridge: boolean;       // 支持 JS↔Native
  lifecycle: 'full' | 'basic' | 'none';  // Terminal=none（无前后台）
  filesystem: boolean;
  net: boolean;
  // ...对应 G-32 能力矩阵
}
```

**能力诚实声明**（CMP 原则 #13）：Terminal 宿主 `threads.background=false, lifecycle='none'`，框架编译期据此决定降级（不创建 Worker、不监听前后台）。

---

## 4. 生命周期状态机（唯一拥有）

```
        bootstrap()
   ┌──────────┐
   │ bootstrap │
   │  -ing    │◄──────────────┐
   └────┬─────┘               │
        │ bootstrap 完成       │
        ▼                     │ resume()
   ┌──────────┐  suspend()  ┌──────────┐
   │ running  │────────────▶│suspended │
   └──────────┘◄────────────└──────────┘
        │                     │
        │ destroy()            │ destroy()
        ▼                     ▼
   ┌──────────┐
   │ destroyed │
   └──────────┘
```

**四状态**：`bootstrapping / running / suspended / destroyed`，转换由 Runtime **唯一拥有**。Backend 只订阅生命周期事件，**不得自己判断前后台**。

---

## 5. 线程模型（唯一拥有）

| 宿主 | 主线程 | 后台线程 | 消息队列 |
|------|--------|---------|---------|
| iOS | Main (UI) | GCD | CFRunLoop |
| Android | Main Looper | ThreadPool | Handler/Looper |
| Web | Main | Web Worker | Event Loop |
| Flutter | UI Isolate | Compute Isolate | Dart EventQueue |
| Harmony | Main | TaskPool | EventHandler |
| Terminal | 单线程 | ❌ | libuv |

**关键规则**：Backend 要执行耗时任务 → 调 `runtime.runOnThread('background', ...)`，不得自己 `pthread_create`。这保证线程安全（G-39.2 / CMP036）。

---

## 6. 原生桥（JS↔Native，唯一拥有）

```
JS 侧                    Host Runtime (L4)              Native 侧
  │                            │                            │
  │── invokeNative('scan') ──▶│── 序列化 + 线程切换 ──────▶│
  │                            │                            │
  │                            │◀── 结果 ──────────────────│
  │◀── Promise<Result> ───────│                            │
  │                            │                            │
  │  registerNativeHandler     │                            │
  │  ('onPush')               │─── 保存回调 ───────────────│
  │                            │                            │
```

**安全规则**（CMP037）：
- 白名单：只允许预注册的能力名
- 超时：原生调用超时可取消
- 线程切换：Native → JS 必须切回 JS 线程（不能在任何线程回调）

详见 `04-native-bridge.md`。

---

## 7. 降级策略（FallbackRuntime）

```typescript
// 生产环境：原生桥可用 → 用原生；不可用 → 自动降级
const runtime = selectRuntime({
  preferred: 'ios',
  fallback: 'web'   // 兜底到 Web (JSEngine + postMessage)
});
```

| 缺失能力 | 降级行为 |
|---------|---------|
| 后台线程 | 任务排队在主线程（Terminal） |
| 文件系统 | `useStorage()` → 内存 Map |
| 原生桥 | 能力调用返回 `Err('unsupported')` |
| 生命周期 | 忽略 suspend/resume |

**降级必须可观测**（G-39.4）：每次降级打印结构化日志 + 上报指标。

---

## 8. 与 G-37/G-38 的协同（三层 SPI 同形）

| 维度 | RenderBackend (G-37) | CompilerBackend (G-38) | **HostRuntime (G-39)** |
|------|---------------------|------------------------|------------------------|
| 层 | L3 | 编译期 | **L4 运行期** |
| 接口数 | 18 + 1 可选 | 16 + 3 可选 | **15 + 3 可选** |
| Conformance | 42 (C-01~C-10) | 42 | **42** |
| 降级 | StubBackend | FallbackBackend | **FallbackRuntime** |
| 参考实现 | vue-dom / terminal | node / terminal | **web / terminal** |

**三层 SPI 同形**是方法论一致性的体现，由 verify 步骤 7 自动断言。

---

## 9. 铁律（详见 07-rules.md）

- **G-39.1** 生命周期唯一拥有：Backend 不得自己判断前后台
- **G-39.2** 线程唯一拥有：Backend 不得直接创建线程
- **G-39.3** 能力诚实声明：`capabilities` 不得虚报
- **G-39.4** 降级可观测：降级必须日志/指标
- **G-39.5** 原生桥白名单：仅预注册能力可调用
- **G-39.6** 禁止循环依赖：Framework → Runtime，不得反向

补充规则：CMP035（宿主不得假设业务）、CMP036（禁止跳层访问）、CMP037（禁止循环依赖）。

---

## 10. 分批落地（详见 06-batches.md）

- **B1**：SPI 定义 + 生命周期状态机 + 类型（M1）
- **B2**：conformance 测试套件 + runner（M1）
- **B3**：WebHostRuntime + TerminalHostRuntime 参考实现（M1）
- **B4**：iOS / Android / Flutter 宿主（M2）
- **B5**：Harmony / TV / Watch 宿主（M2-M3）

---

## 11. 验收标准（DoD）

1. ✅ `ProteusHostRuntime` 接口完整，TypeScript 可编译
2. ✅ conformance 42 项，Terminal + Web 两个后端全跑通（FAIL=0）
3. ✅ 跨层调用扫描：零跳层违规
4. ✅ `runtime-reference.js` 真实运行：Worker/事件循环/原生桥可演示
5. ✅ 与 G-37/G-38 同形性检查通过
6. ✅ 编号无冲突（避让 G-38 CMP029-034）
