# G-39 分批落地计划

> 配套：`01-host-runtime.md` §10

---

## 1. 分批总览

| 批次 | 内容 | 周期 | 依赖 | DoD |
|------|------|------|------|-----|
| **B1** | SPI 定义 + 生命周期状态机 + 类型 | M1 | G-37, G-38（Backend 接口稳定） | TypeScript 可编译，接口完整 |
| **B2** | Conformance 测试套件 + runner | M1 | B1 | 42 项可运行，FAIL=0 |
| **B3** | Web + Terminal 参考实现 | M1 | B1, B2 | `runtime-reference.js` 跑通，两个宿主 |
| **B4** | iOS / Android / Flutter 宿主 | M2 | B1, B2 | 三端 conformance 全 PASS |
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
