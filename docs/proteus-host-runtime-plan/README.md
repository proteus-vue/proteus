# Proteus G-39：宿主运行时（Host Runtime）SPI 与职责边界

> **独立的包**（不进 website-v3），与 G-37（渲染后端）、G-38（编译后端）并列，构成"三层可插拔 SPI"。

## 一句话

**代码跑起来之后，谁管生命周期、线程、JS 引擎、原生桥、消息队列？——宿主运行时（L4），职责唯一拥有者。**

## 动机

G-37/G-38 定义了渲染/编译后端的"插头标准"，但没有人定义"运行载体"。结果是：Backend 各自管线程、生命周期没人统一、原生桥每人写一份。**宿主运行时就是这块拼图。**

## 核心：五层职责架构（唯一拥有者）

```
L0  业务应用 (128 原语)
     ↓ 只能调 Framework
L1  Framework Core          ← 唯一拥有: IR 定义 / Diff
     ↓ 调度
L2  CapabilityBackend (G-28) ← 唯一拥有: 原生能力
L3  RenderBackend (G-37)     ← 唯一拥有: UI 树
L4  Host Runtime (G-39) ★    ← 唯一拥有: 进程/线程/事件循环/原生桥
     ↓ 运行在
   原生宿主 (iOS/Android/Flutter/Skia/Harmony/Web/Terminal)
```

**禁止跳层（CMP036）**：业务不得直接调宿主 API，必须 业务→框架→Backend→Runtime→Native。

## 文件清单

| 文件 | 角色 |
|------|------|
| `01-host-runtime.md` | ★ 主文档（动机/架构/接口/生命周期/线程/桥/降级/铁律/分批） |
| `02-responsibility-matrix.md` | ★ 职责矩阵 + 跨层调用规则（机器校验） |
| `03-lifecycle-threading.md` | 生命周期状态机 + 线程模型 + 宿主映射 |
| `04-native-bridge.md` | JS↔Native 桥（白名单/安全/线程切换） |
| `05-conformance-suite.md` | 42 项 conformance（C-01~C-10） |
| `conformance-runner.js` | ★ **真实可运行**：Terminal + Web → 42 PASS / FAIL=0 |
| `runtime-reference.js` | ★ **完整参考实现**：WebHostRuntime + TerminalHostRuntime |
| `06-batches.md` | B1-B5 + DoD + 跨 plan 协同矩阵 |
| `07-rules.md` | G-39.1-6 + CMP035-043 |
| `00-architecture-update.md` | 原则 #13.8-13.10 + L0-L4 全景图 + 54→55 份 |
| `MANIFEST` | ★ 白名单（pack.sh 的唯一事实源） |
| `verify.sh` | ★ 10 步骤校验（含跨层调用合法性 + 真实运行） |
| `pack.sh` | 读 MANIFEST 打包（store 模式，MANIFEST 本身进包） |
| `run-all-verify.sh` | 三场景独立校验（工作区/包内/隔离目录） |

## 快速开始

```bash
# 1. 校验 (10 步骤)
bash verify.sh
# → 应看到 "VERIFY: PASS", 最后 "FAIL=0"

# 2. 跑 conformance (真实运行两个后端)
node conformance-runner.js
# → 应看到 "PASS=42  FAIL=0  SKIP=0", 退出码 0

# 3. 跑参考实现
node runtime-reference.js
# → 应看到两个宿主完整生命周期 + 无报错, 退出码 0

# 4. 打包 (读 MANIFEST, 不漏打)
bash pack.sh
# → 生成 proteus-host-runtime.zip

# 5. 三场景独立校验 (模拟下载解压)
bash run-all-verify.sh
# → 应看到 "场景 1/3 PASS / 场景 2/3 PASS / 场景 3/3 PASS"
```

## 设计原则（源自方法论 + 原则 #13）

- **语义优先**：Runtime 暴露"生命周期/线程/队列"语义，不是某 OS 的 API
- **接口与实现解耦**：`ProteusHostRuntime` 是接口，各宿主实现
- **验证先于运行**：42 项 conformance（原则 #13）
- **渐进覆盖**：能力声明 → 缺啥降级啥（不崩）
- **可泛化**：任何宿主（含 Terminal/TV/Watch）同 SPI
- **★ 同形性**：G-37（渲染）、G-38（编译）、G-39（运行时）三层 SPI 接口数量同级、都有 conformance + 参考实现 + 铁律

## 关键接口

```typescript
interface ProteusHostRuntime {
  readonly id: string;
  readonly capabilities: RuntimeCapabilities;
  bootstrap(): Promise<AppInstance>;   // 生命周期
  suspend(): void; resume(): void; destroy(): void;
  createWorker(script): WorkerHandle;   // 线程
  runOnThread(thread, task): void;
  createEngine(): JSEngine;             // JS 引擎
  invokeNative(name, args): Promise<Result>;   // 原生桥
  registerNativeHandler(name, fn): void;
  enqueue(task, priority?): void;      // 消息队列
  nextTick(fn): void;
}
```

详见 `01-host-runtime.md` §3。

## 与既有体系

| Plan | 关系 |
|------|------|
| G-37 渲染后端 | Runtime 保证渲染操作在 UI 线程 |
| G-38 编译后端 | Runtime 提供 Worker/缓存/消息队列 |
| G-28 能力后端 | CapabilityBackend 运行在 Runtime 之上 |
| G-30 端接入 | 宿主运行时 = "端" 的运行载体 |
| G-39 AI Agent | Agent 生成代码运行在 Runtime 沙箱 |
| Website v3 | 柔性框架六端 = 六宿主运行时实例 |

详见 `06-batches.md` §7 协同矩阵。

## 为什么单独打包

按用户要求，G-39 **不进 website-v3**，独立目录 + 独立 zip。每个 SPI 层（G-37/G-38/G-39）都是独立可发布的包，符合"可插拔必须有可验证支撑"（原则 #13）。
