# Proteus 二十次泛化 → SPI-First 五步法映射

> 本文证明：Proteus 的二十次"不绑 X"泛化，全部是 SPI-First 五步法的实例。
> 阅读本文 = 同时理解"方法论"与"它的第一性证明"。

---

## 映射总表

| 泛化 | 不绑什么 | SPI 名称 | Step2 语义接口 | Step3 后端 | Step4 conformance | Step5 诚实边界 |
|------|---------|---------|---------------|----------|------------------|--------------|
| G-27/37 | 渲染引擎 | `ProteusRenderBackend` | nodeOps / IR | VueDom, Flutter, Native, Skia, Headless | G-27 conformance 同 shape（RND002） | CMP046 性能数据须实测 |
| G-29/38 | 编译器 | CompilerBackend | IR Transformer | Node, Rust, WASM（规划） | G-29.1 IR Golden / G-38.2 语义等价 | 编译期能力有上限 |
| G-31/32 | 平台 API | 语义原语 + Capability Hook | p-* / useXxx | iOS, Android, Harmony, Web, MP | audit coverage + 语义 conformance 门禁（45 implemented × 6 后端） | 系统能力不齐须降级 |
| G-39 | 宿主运行时 | `HostRuntime` | 生命周期/事件/线程 | Web, Terminal（参考实现） | G-39 运行时契约（C-01~C-10） | jsi::Runtime 线程亲和 |
| G-40 | 执行载体 | `ExecutionCarrier` | 执行环境 | JSI, AOT, WASM | G-40 conformance（C-01~C-10） | AOT 路径语义等价未全证 |
| G-42 | 容器形态 | `HostContainer` | 页面生命周期 | SinglePage, Stack, SuperApp, MiniProgram, Window | G-42 五原子销毁（C-01~C-08） | 崩溃隔离有宿主依赖 |
| G-43 | 内存管理范式 | Ownership SPI | `Owned<T>`/`Borrow<T>` | JS GC + 边界资源 | use-after-move 等 | JS 无法全编译期检查（PSS 分级） |
| G-44 | 测试实现 | TestBackend | Test IR | Node, JSI, AOT, Host, Device | G-44 跨层 INT 套件（INT-01~05） | 模拟器 ≠ 真机（需 Device 后端） |
| G-45 | 基座形态 | DevHost / DynamicBackendModule | 装载协议 | 静态链接 / 动态模块 | NAT-C 快检 | **Install-Once 仅开发态，非线上热更新** |
| G-46 | 资源容器形态 / 数据一致 | ResourcePool | 登录态 / Cookie / Token | Android CookieManager / iOS WKHTTPCookieStore / 鸿蒙 Header（reference-impl） | G-46 conformance（CMP089-096：双轨降级 / OWN 所有权 / RSC 安全） | 真实原生桥接待 B3 |
| G-47 | 测试层级（单层→组合） | CombinedTest | 切后端数据链不断（INV-01~06） | Backend × Pool 组合（reference-impl） | G-47 conformance（CMP097-102：23 断言 / 六不变量） | 多进程 / 真并发（B3/B4） |
| G-48 | 小程序运行时形态 | Runtime SPI + PlatformAdapter SPI | setData / 生命周期 / 代码包 | 微信 / 鸿蒙 Adapter（MVP）+ 标准运行时 | G-48 conformance（CMP103-109 + RT/ADAPT/CAP/SBX-L1，26 断言） | MVP 单进程模拟双线程；支付宝/抖音 Adapter 待补 |
| G-49 | 隔离强度 | SandboxBackend / CapabilityBridge | IsolationLevel L1-L4 + 权限声明 | Android（android:process）/ Harmony（Ability）/ iOS（系统 WebContent） | G-49 conformance（CMP110-117 + SBX-01~08，30 断言） | WebBackend 仅供 conformance；L4 留给 G-50 |
| G-50 | 平台 / 生态形态 | DeveloperPlatform SPI + AppPackage | 注册→审核→双签名→分发→治理 | A 工具链 CLI / B 门户+分发（结构自检） | G-50 conformance（CMP118-131：39 断言清单，文档化） | plan only：B 生态依赖 G-49 L3 |
| G-51 | 验证执行环境 | TestIRRunner / Backend | execute(suite): report | L0 selfcheck / L1 InMemory / L2 NativeAdapter | G-51 三阶梯度 + self-test 36/36（CMP132-139） | NativeAdapter 真实现属阶段 2 |
| G-52 | 设备形态 / 验证维度 | DeviceMatrixRunner（executeOn） | 等价类 + DriftFingerprint + ε | 代表设备采样（reference-impl 44/44） | G-52 conformance（CMP140-146 + INV-D1~D5） | 云端真机调度留 G-53 |
| G-53 | 设备供给方式 | SimulatorBackend / Orchestrator / CoverageGate | 设备档位能力声明 + 覆盖率门槛 | in-memory、web/DOM、ios-sim 本地/远程、cloud-device（reference-impl 41/41） | G-53 conformance（CMP147-154 + INV-M1~M8） | 云真机 Provider 未实现；Apple EULA 仅限内部共享 |
| G-54/55 | IDE 形态 | FrameworkKnowledgeProvider / ProtocolAdapter（G-55 落地：+HostAdapter / PerfBudget / Rust 常驻内核） | 六项纯查询能力（导航/分层/断言/拓扑/影响面/预览） | LSP、RPC、DAP、CLI、raw（reference-impl 51/51 + 58/58） | G-54 conformance（CMP155-162 + INV-DT-01~08）/ G-55 conformance（CMP163-170 + INV-PF-01~08） | 能力⑤⑥数据 Mock；仅 VSCode 参考适配未实测；预算为对标目标值 |
| G-56 | 宿主来源（含自有宿主） | StudioShell / EmbedStrategy / CompanionLink | 能力边界矩阵 + 归一化坐标 + 五档嵌入降级 | Tauri 壳 / VSCode / Web（reference-impl 67/67） | G-56 conformance（CMP171-178 + INV-ST-01~08） | libmpv 真嵌入需 PoC；Tauri 数字为对标未实测 |
| G-57 | 可观测性来源 | InspectorService / 扩展注册表 | 三层数据模型（L0 宿主探针 / L1 语义增强 / L2 框架语义）+ ext. 命名规约 | VM Service / Flipper / CDP / 自起服务（reference-impl 64/64） | G-57 conformance（CMP179-186 + INV-INSP-01~08） | L0 为模拟数据；真实宿主接入未实现 |

---

## 逐条拆解：以 G-45 为例演示五步法

**Step 1｜找耦合点**：
传统基座把"运行时壳 + 原生插件 + 业务页面"打包成一个 APK/IPA → 改任何一边都要重打整个基座。**耦合点是"基座形态"本身**——它被硬编码成了"构建产物"。

**Step 2｜语义收敛**：
- ❌ 含技术名词：`CustomBaseApk`、`cloudPackage`、`re-sign IPA`
- ✅ 语义接口：`DevHost`（装载协议）+ `DynamicBackendModule`（manifest + factory）

**Step 3｜可插拔后端**：

| 后端 | 适用 |
|------|------|
| 静态链接后端 | 发布态（App Store 合规） |
| 动态模块后端 | 开发态 / 内部分发 |
| Mock 后端 | conformance 快检 |

**Step 4｜conformance**：
NAT-C 套件 —— 动态模块装载时跑快检，**同能力必须产出同 shape 结果**，不过门禁 → 拒绝装载 + 降级后端兜底。

**Step 5｜诚实边界**：
**Install-Once 是开发调试 + 内部分发语义，不是线上热更新**。App Store 2.5.2 禁止下载可执行代码；鸿蒙 HSP 须随宿主打包。这条边界若不声明，方法论会被包装成"能热更新"的银弹，最终踩合规红线。

---

## 方法论的复利效应

G-44（测试框架）落地后，后续所有 SPI 的 conformance **自动复用 TestBackend**：

```
G-27 渲染 conformance → 跑在 TestBackend Node/JSI/AOT/Device
G-40 载体 conformance → 同上
G-45 NAT-C 快检        → 同上
```

**这是"先有方法论、再有实例"的红利**：新 SPI 不需重新发明验证手段，直接套五步法即可。这也是为什么我们说 ——

> **二十次泛化不是二十份独立设计，而是同一套五步法重复执行二十次。**

---

## 反向校验：用映射表找缺口

映射表有一个用途：**逐行检查，缺哪格就是缺口**。

例如 G-43 Ownership 那行：
- Step4 列写着"JS 无法全编译期检查（PSS 分级）" → **说明 conformance 尚未完备**，是已知缺口（G-43 borrow-checker 的 loose 模式）
- 这比"觉得哪里不太对"精确一万倍 —— **缺口被显式化为一行表格**。

建议每次新增泛化后，回填此表。

---

*本映射表是"方法论 ↔ 实例"的双向索引，应随 Proteus 演进持续更新。*
