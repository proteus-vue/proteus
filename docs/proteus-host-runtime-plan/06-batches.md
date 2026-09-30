# G-39 分批落地计划

> 配套：`01-host-runtime.md` §10

> **★★2026-09-30 状态更新（嵌入式 JS 引擎宿主切片已落地）**
>
> 取证背景：G-39 的「宿主运行时」此前只有**极简 stub**（`host-conformance.ts` 的
> `createHostRuntimeStub`）+ **Web 宿主**（`web-host.ts`）——即 **B4 的 iOS/Android 嵌入式宿主为零**。
> 本轮补上两端的**同族骨架**（Android QuickJS 真机验证；iOS JSC 可复用同一实现）：
>
> | 产物 | 落点 | 判据 |
> |---|---|---|
> | **单线程 JS 引擎宿主运行时** | `packages/render-backend/src/quickjs-host.ts`（纯 TS 零平台依赖） | `tests/quickjs-host.test.ts` **18 条**（含用**真实运行时**替换 stub 跑 G-41 conformance **32/32 PASS**） |
> | **设备端真机装置** | `hosts/android/bridge/entry-host-runtime.ts` + `MainActivity.appHostRun()` + `run-host-runtime.sh` | `check:host-runtime` **16 条**（真机全绿）+ **20 组破坏性验证** |
> | **JNI 支撑（实缺修补）** | `quickjs_jni.c`：**job 泵**（`JS_ExecutePendingJob`）/ `JS_ComputeMemoryUsage` / `JS_RunGC` + 8 符号逐断言 | 补漏前 `await` **半执行**（续体静默丢失）——判据当场抓出并固化 |
>
> **落地的 G-39 条款**（都有机器判据，不是文档声明）：
> · **生命周期唯一拥有**：宿主壳（Activity onPause/onResume）**转发**事件 → runtime 状态机；
>   非法转换（挂起 bootstrap / 重复 resume / 销毁后 enqueue / 重复 destroy）**被拒绝且记账**；
> · **事件循环归属**：队列只由宿主帧（`pumpFrame`）推进；挂起不推进；**job 泵**让 await/Promise 续体可执行；
> · **职责边界**：`runOnThread('background')` 诚实拒绝（`threads.background=false`——不假排队）；
>   未注册原生调用被拒且给出可操作信息（已注册清单）；
> · **诚实能力声明**：逻辑 worker `real=false`（单线程宿主不假装真并行）。
>
> **★同时验证的相邻 plan**：G-41 宿主接入契约用真实运行时全过（H-01~H-08 32 项）；
> G-43 内存治理有了**引擎真实 JS 堆账本**（分配 +320KB → GC 后回到基线，真机读数）。
>
> **★★2026-09-30 续：iOS 腿落地（同一天）——同一份 TS、两个壳**
>
> | 维度 | Android（QuickJS） | iOS（JSC） |
> |---|---|---|
> | JS 入口 | `hosts/shared/bridge/entry-host-runtime.ts`（**平台中立，两端共用一份**） ||
> | 壳 | `MainActivity.appHostRun()` + `quickjs_jni.c` | `ProteusHost/host-runtime-scene.swift`（`--host-runtime` 模式） |
> | 事件循环泵 | `nativeRunPendingJobs`（`JS_ExecutePendingJob`，限 10000） | 让出主线程（JSC 在 `evaluateScript` 返回时排空微任务——本仓已记录的事实） |
> | 生命周期转发 | 覆写 `onPause/onResume` | `willResignActive/didBecomeActive` 通知 |
> | 触发手段 | `am start -n 本Activity`（日志实证 pause→resume；★`input keyevent HOME` 无效） | `devicectl process launch com.apple.Preferences` → 重新 launch 本 App（实测 **PID 不变 ≈ 同进程往返**） |
> | 内存口径 | `scope="engine"`（`JS_ComputeMemoryUsage` 引擎真实 JS 堆） | `scope="process"`（`phys_footprint`——★**JSC 无公开 per-context 内存 API**，本轮取证：公开头只暴露 `JSGarbageCollect`） |
> | 真机读数 | 16/16 全绿 · GC 回收 -319984/+320264B（≈100%） | 16/16 全绿 · 分配 +33.8MB，GC 后 -147456B（★诚实标注：JSC 提示性 GC 把页留 free pool，不即时归还 OS） |
> | 判据 | `check:host-runtime`（**同一脚本；平台由报告 `host_id` 自报**） ||
>
> ★装置要点：两段式驱动（后台 `launch --console` 阻塞 → 等 `HOST_RUNTIME_PHASE_DONE` 内容信号 →
> 触发真实前后台往返 → 等 App 达成退出条件自退）；build_id 走**编译期注入**（与 entry-bench/selfdraw
> 同一机制——不用运行时环境变量，避免第二种形态）。★实测坑：平台参数必须在 **eval bundle 之前**注入
> （IIFE 加载时即捕获常量——首版 Android 因此报默认 `host_id`）。
>
> **诚实边界（仍未做）**：① 多线程 Worker（`threads.background=false` 是对现状的**诚实声明**，不是最终形态）；
> ② Flutter/Harmony 宿主（B5）；③ iOS 侧 `obj_count` 恒 0（JSC 无该读数——不伪造）。
> ⇒ **B4 状态：Android ✅ + iOS ✅（真机双绿）· Flutter 未开始**。

---

## 1. 分批总览

| 批次 | 内容 | 周期 | 依赖 | DoD |
|------|------|------|------|-----|
| **B1** | SPI 定义 + 生命周期状态机 + 类型 | M1 | G-37, G-38（Backend 接口稳定） | TypeScript 可编译，接口完整 |
| **B2** | Conformance 测试套件 + runner | M1 | B1 | 42 项可运行，FAIL=0 |
| **B3** | Web + Terminal 参考实现 | M1 | B1, B2 | `runtime-reference.js` 跑通，两个宿主 |
| **B4** | iOS / Android / Flutter 宿主 | M2 | B1, B2 | 三端 conformance 全 PASS（★Android 切片已落地，见上） |
| **B5** | Harmony / TV / Watch 宿主 | M2-M3 | B4 | 能力声明 + 降级链完整 |

---

## 2. B1：SPI 定义（M1，最高优先）

**产出**：
- `ProteusHostRuntime` 接口（TS 完整签名）
- `RuntimeCapabilities` 类型
- 生命周期状态机（`bootstrapping/running/suspended/destroyed`）
- 与 G-37（RenderBackend）、G-38（CompilerBackend）的同形性对照表

**DoD**：
- [x] 接口 15 + 3 可选方法齐全
- [x] TypeScript `tsc --noEmit` 通过
- [x] 与 G-37/G-38 接口数量同级（18±2）
- [x] 编号避让（G-39.1-6, CMP035-043）

---

## 3. B2：Conformance（M1）

**产出**：`05-conformance-suite.md` + `conformance-runner.js`（42 项）

**DoD**：
- [x] C-01 ~ C-10 全覆盖
- [x] Terminal + Web 两后端 → 合并 42 PASS
- [x] SKIP 规则按 `capabilities`
- [x] CI Gate：`node conformance-runner.js` 退出码门禁

---

## 4. B3：参考实现（M1）

**产出**：`runtime-reference.js`
- `WebHostRuntime`：Worker + EventLoop + JSEngine + 原生桥（全量）
- `TerminalHostRuntime`：单线程 libuv + 内存文件系统（受限，诚实降级）

**DoD**：
- [x] `node runtime-reference.js` 退出码 0
- [x] 生命周期/线程/桥/降级全部演示
- [x] 无未处理 Promise rejection

---

## 5. B4：原生宿主（M2）

### 5.1 iOS 宿主
| 映射 | 实现 |
|------|------|
| Main 线程 | UIKit Main RunLoop |
| Background | GCD `dispatch_async` |
| JS 引擎 | JavaScriptCore |
| 原生桥 | `JSContext[name] = block` |
| 生命周期 | `UIApplicationDelegate` → Runtime 状态机 |

### 5.2 Android 宿主
| 映射 | 实现 |
|------|------|
| Main 线程 | Main Looper |
| Background | ThreadPoolExecutor |
| JS 引擎 | J2V8 / V8 |
| 原生桥 | `addJavascriptInterface` / V8 binding |
| 生命周期 | `Activity/Fragment` → Runtime |

### 5.3 Flutter 宿主
| 映射 | 实现 |
|------|------|
| Isolate | UI Isolate / Compute Isolate |
| 消息队列 | Dart EventQueue |
| JS 引擎 | QuickJS（嵌入） |
| 原生桥 | MethodChannel |

**DoD**：三端 conformance **42/42 PASS**（或能力受限项正确 SKIP）。

---

## 6. B5：Harmony / TV / Watch（M2-M3）

### 6.1 Harmony 宿主
- 进程：`Ability` 生命周期 → Runtime
- 线程：`TaskPool`
- 引擎：ArkCompiler
- 桥：Native API

### 6.2 TV / Watch 宿主
- **复用宿主运行时**（与手机/平板同 Runtime，不同设备形态）
- TV：`10ft` 交互 → 焦点导航（对接柔性框架 G-22）
- Watch：`wearable` → 表冠/触控（对接柔性框架）

**关键洞察**：TV/Watch 是"同一宿主的不同端形态"，**不新建 Runtime**，只调整 `capabilities` + 交互映射。这与柔性框架的"一套代码多端呈现"完全对齐。

**DoD**：
- Harmony conformance PASS
- TV/Watch 复用验证：同一 Runtime 实例，不同 `deviceClass` 渲染正确

---

## 7. 跨 Plan 协同矩阵

| Plan | 与 G-39 的关系 | 接口点 |
|------|--------------|--------|
| G-27 渲染可插拔 | RenderBackend 通过 Runtime 桥接 Native | `invokeNative` |
| G-28 能力后端 | CapabilityBackend 运行在 Runtime 之上 | `runOnThread` / `invokeNative` |
| G-29 编译 | CompilerBackend 用 Runtime 的线程池做增量编译 | `createWorker` |
| G-30 端接入 | 宿主运行时是"端"的运行载体 | 宿主 = Runtime 实现 |
| G-31/32 语义入口 | 业务代码运行在 Runtime 提供的 JS 引擎里 | `createEngine` |
| G-36 AI Agent | Agent 生成代码运行在 Runtime | 沙箱隔离 |
| G-37 RenderBackend | 渲染操作在 UI 线程（Runtime 保证） | 线程切换 |
| G-38 CompilerBackend | 编译器后端用 Runtime 线程/缓存 | Worker / 消息队列 |
| Website v3 | 柔性框架六端 = 六宿主运行时实例 | — |

---

## 8. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 各宿主线程模型差异大 | `runOnThread` 统一抽象，宿主自行映射 |
| 原生桥安全漏洞 | 白名单 + schema + 超时 + 线程切换（CMP037） |
| 生命周期不一致 | 统一状态机，Backend 只订阅（G-39.1） |
| 降级不可见 | `onFallback` 强制可观测（G-39.4） |
| 性能回归 | benchmark 强制 + CI 门禁（CMP043） |

---

## 9. 里程碑

- **M1**（B1+B2+B3）：SPI + Conformance + 参考实现 → **可验证的 MVP** ✅（本轮完成）
- **M2**（B4+B5）：iOS/Android/Flutter/Harmony → 生产可用
- **M3**（TV/Watch + 生态）：全端覆盖，对齐柔性框架六端展示
