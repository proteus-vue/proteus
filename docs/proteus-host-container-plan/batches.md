# G-42 分批落地计划（B1-B6）

> **定位**: 将容器契约从规范变为可运行实现
> **依赖**: G-39（运行时）· G-41（接入）· G-27（渲染后端）

---

## 总览

| 批次 | 目标 | 交付物 | 周期 | 依赖 |
|------|------|--------|------|------|
| **B1** | 容器 SPI + 类型定义 | `HostContainer` 接口 + TS 类型 | 0.5 月 | G-27 B1 |
| **B2** | StackContainer 参考实现 | 页面栈 + 五原子销毁 | 1 月 | B1 |
| **B3** | Conformance 套件 | C-01~C-08（38 项）+ CI 集成 | 0.5 月 | B2 |
| **B4** | SuperAppContainer | 沙箱 + 崩溃隔离 + 配额 | 1.5 月 | B3 |
| **B5** | 安全网关 + 仓库治理工具 | 签名/白名单 + fork 扫描 CLI | 1 月 | B4 |
| **B6** | 其余 4 种容器 + 生产验证 | SinglePage/Window/Embedded + 真实 App | 1.5 月 | B5 |

---

## B1 容器 SPI + 类型定义

> **✅ B1 已落地（决策 #347）**：`@proteus-vue/render-backend` 新增 `container-spi.ts`——**容器 SPI + 类型定义权威 TS 版**（对齐 container-spi.md §1-7：`ProteusHostContainer` 接口（id/version/capabilities + initialize/dispose + createPage/destroyPage + push/pop + createSandbox + quota + onMemoryPressure + on）与 G-27/G-39/G-40 同形）+ `ContainerCapabilities`（CMP065 诚实声明）/ `PageHandle`/`PageState`/`DestroyReport`（五原子）/ `ResourcePool`（G-42.3 框架代管）/ `QuotaManager`（CMP061 超限 null）/ `StackPolicy`/`SuperAppPolicy`；**可测纯逻辑**：页面生命周期状态机（`PAGE_STATE_TRANSITIONS` + `canTransitionPageState`——created→mounted→hidden↔mounted→destroyed→recycled + mounted→crashed 异常路径，G-42.2 入口任意态→destroyed）+ 五原子校验（`FIVE_ATOMIC_STEPS` + `assertAtomicDestroy`——步数≠5 或顺序错抛错，G-42.2 铁律）+ 六种容器能力画像（`CONTAINER_PROFILES`：singlepage/stack/superapp(L2 隔离)/miniprogram/window/embedded——CMP065 诚实默认）；测试 `tests/container-spi.test.ts` 12 用例全过（类型可编译 + 状态机合法/非法/崩溃路径 + 五原子步数/顺序校验 + 容器画像/未知诚实默认）；全量 1705 无回归（一次 flaky 复跑全绿）。

**目标**：定义插头形状

| 任务 | 产出 |
|------|------|
| `HostContainer` 接口 | TypeScript 定义 |
| `ContainerCapabilities` | 能力声明结构 |
| `PageHandle` / `PageState` | 页面模型 |
| `DestroyReport` | 五原子报告 |
| `QuotaManager` 接口 | 配额管理 |

**验收**：类型可编译，与 G-27/G-39/G-40 接口同形（方法数/命名风格一致）

---

## B2 StackContainer 参考实现

> **✅ B2 已落地（决策 #348）**：`@proteus-vue/render-backend` 新增 `stack-container.ts`（`createStackContainer(opts?)`——StackContainer 参考实现权威 TS 版）：**页面栈 push/pop**（基础导航 + 状态机校验：created→mounted 非法转换拒绝）+ **五原子销毁**（G-42.2：unmount→unbindEvents→releaseResources→destroyIR→releaseQuota，`assertAtomicDestroy` 校验步数与顺序——DestroyReport steps=5）+ **框架代管资源池**（G-42.3：`createResourcePool`——timer/interval/on/bus/fetch/subscribe 登记 + 页面销毁 `releaseAll` 自动清零）+ **配额管理**（`createQuotaManager`——CMP061 超限 request→null + 压力分级 warning 80%/critical 100%）+ **深度治理**（destroy-oldest LRU 销毁栈底 / reject 抛错——CMP060 显式 overflow 事件）+ **keep-alive 配额**（maxCount 超限 LRU 销毁栈底）+ 事件（page-created/page-destroyed/overflow）+ `createSandbox` 能力外诚实报错（stack 画像 multiBusiness=false）；测试 `tests/stack-container.test.ts` 11 用例全过（资源池 releaseAll 清零 / 配额记账+超限 null+压力分级 / push-pop 栈深度 / destroyPage 五原子步序 / 事件触发 / LRU 淘汰 / reject 抛错 / 画像断言）；全量 1716 无回归。

**目标**：最常用容器跑通

| 任务 | 产出 |
|------|------|
| 页面栈 push/pop | 基础导航 |
| 五原子销毁 | G-42.2 实现 |
| 框架代管资源池 | G-42.3 实现 |
| 深度限制 + LRU | StackPolicy |
| keep-alive 配额 | 内存预算控制 |

**验收**：conformance C-01~C-06（28 项）全过

---

## B3 Conformance 套件

> **✅ B3 已落地（决策 #349）**：`@proteus-vue/render-backend` 新增 `container-conformance.ts`——**C-01~C-08 38 项权威 TS 版套件**（register 组 + `runContainerConformance(container)` + `formatContainerConformance` 报告，与 G-38/G-41 同构）：C-01 身份能力（4）/ C-02 页面生命周期（5）/ **C-03 五原子销毁（6，G-42.2 核心）** / C-04 页面栈治理（4）/ **C-05 泄漏检测（5，页面销毁无残留机器证据）** / C-06 配额管理（4）/ **C-07 沙箱崩溃隔离（6，SuperApp 能力——B4 落地后全过）** / C-08 安全网关+仓库治理（4）+ **`scanRepoForFork`（G-42.6 严禁 fork 机器指纹——4 个签名正则独立纯函数）** + **`checkBizManifest`（安全网关纯函数：G39_SIGN 无签名/G39_CAP 越权拒绝）**；★**能力门控（诚实原则，对齐 G-38/G-40）**：C-07 仅 multiBusiness 容器、C-08-01/02 仅声明安全网关的容器——未声明能力 SKIP + reason（Stack 容器 PASS=31 FAIL=0 SKIP=7；声明的能力必须全过）；★顺带修复 B2 的 keep-alive 配额 bug（mounted 页全计数 → 只统计 keepAlive 标记页）；测试 `tests/container-conformance.test.ts` +10（scanRepoForFork 指纹/checkBizManifest 三态/套件零 FAIL + C-03·C-05 组全 PASS + 假容器 C-01-01 FAIL 抓不合规 + 报告格式）；全量 1726 无回归。

**目标**：让"合规"可机器判定

| 任务 | 产出 |
|------|------|
| C-01~C-08 共 38 项 | 测试套件 |
| `proteus conformance --container` CLI | 命令行工具 |
| CI 集成模板 | GitHub Actions / Jenkins |
| 泄漏检测专项 | C-05 组 |

**验收**：`node container-reference.cjs` → PASS=38 FAIL=0

---

## B4 SuperAppContainer

> **✅ B4 已落地（决策 #350）**：`@proteus-vue/render-backend` 新增 `superapp-container.ts`（`createSuperAppContainer(opts?)`——SuperAppContainer 权威 TS 版，页面栈委托 StackContainer）：**① 业务沙箱**（独立 scope——业务间不共享可变全局状态，G-42.5 崩溃隔离前提；`createSandbox` 校验 maxSandboxes G39_LIMIT）+ **② 崩溃隔离 L1-L3**（`executeInSandbox(bizId, fn)`：try/catch 捕获 → crashLog + sandbox-crashed 事件 + **hostAlive=true + 其他业务不受影响** + **自动重启 maxRestartCount**（超限 crashed 永久禁用）+ **③ 资源配额**（继承 Stack 配额 + 沙箱内存预算）+ **④ 安全网关**（`validateManifest` 复用 B3 `checkBizManifest`：G39_SIGN 无签名拒绝 / G39_CAP 越权能力拒绝）；capabilities = superapp 画像（multiBusiness/crashIsolation=policy 等级）；**C-07 沙箱组转 PASS**（conformance 能力门控放行 + 真断言）；测试 `tests/superapp-container.test.ts` 7 用例全过（沙箱 A/B 创建 + scope 隔离 + 网关 G39_SIGN/G39_CAP/G39_LIMIT + 崩溃隔离 hostAlive/其他存活 + 自动重启 3 次语义 + 画像 + C-07 转 PASS + destroySandbox 清理）；全量 1733 无回归。

**目标**：超级应用加固

| 任务 | 产出 |
|------|------|
| 业务沙箱 | 独立 scope/storage/router |
| 崩溃隔离 L1-L3 | G-42.5 实现 |
| 资源配额 | 内存/CPU/存储/并发 |
| 自动重启策略 | maxRestartCount |

**验收**：conformance C-07 全过（特别是 C-07-05 宿主存活 / C-07-06 B 业务不受影响）

---

## B5 安全网关 + 仓库治理工具

> **✅ B5 已落地（决策 #351）**：**① CLI `proteus conformance --repo <dir>`**（cli 包新增 `repo-conformance.ts`：collectSourceFiles 递归收集（跳过 node_modules/.git/dist/.proteus）+ scanRepoDirectory 读文件 → `scanRepoForFork`（复用 B3 指纹集）+ formatRepoReport（合规 0 命中 PASS / fork 列出文件+指纹 FAIL 阻断）；parseConformanceArgs 加 --repo（不破坏 --backend/--only）；args.ts usage + index.ts case 分发；cli 加 `@proteus-vue/render-backend` 依赖 + esbuild external（含 @vue/runtime-core））+ **② 权限网关纯函数 `checkCapabilityAuthorization`**（render-backend；SENSITIVE_CAPABILITIES 敏感集 location/camera/contacts/phone-call/biometric/payment/storage/clipboard——敏感能力须宿主授权 G39_AUTH，G-28 协同；非敏感能力不要求授权）；验收 C-08 全过 + fork 检出/合规零误报机器化；测试 `tests/cli-repo-conformance.test.ts` 8 用例全过（--repo 解析/缺参报错 + 目录扫描合规 0 命中/fork 命中/跳目录 + 报告 PASS/FAIL + 权限网关授权拒绝/放行/敏感集）；全量 1741 无回归。

**目标**：G-42.6 可执行

| 任务 | 产出 |
|------|------|
| 代码签名校验 | 业务包签名 |
| 能力白名单 | 与 G-28 协同 |
| fork 扫描 CLI | `proteus conformance --repo` |
| 权限网关 | 敏感能力宿主授权 |

**验收**：conformance C-08 全过；fork 仓库被检出、合规仓库零误报

---

## B6 其余容器 + 生产验证

**目标**：覆盖全场景

| 任务 | 产出 |
|------|------|
| SinglePageContainer | 单页/卡片/IoT |
| WindowContainer | 桌面多窗口 |
| MiniProgramContainer | 小程序容器 |
| EmbeddedContainer | 嵌入宿主页面 |
| 真实 App 验证 | 一个生产级 App 接入 |

**验收**：6 种容器全部通过 conformance；真实 App 无泄漏（profiling 验证）

---

## 跨 Plan 协同矩阵

| Plan | 协同点 |
|------|--------|
| G-27 RenderBackend | 容器调用 `createMountPoint` / `destroyMountPoint` |
| G-39 HostRuntime | 容器运行在其上，使用线程/桥/载体 |
| G-40 执行载体 | 沙箱配额依赖载体能力声明 |
| G-41 接入流程 | 容器选择是接入第 5 步 |
| G-28 能力后端 | 安全网关的能力白名单来源 |
| G-30 任意端 | Embedded 容器对应 Tier 3 |
| G-36 AI Agent | 容器策略可声明式生成 |

---

## Definition of Done

- [ ] 6 种容器全部实现并通过 conformance（38 项）
- [ ] 五原子销毁在生产 App 中无泄漏（profiling 证据）
- [ ] 崩溃隔离验证：业务崩溃后宿主 100% 存活
- [ ] fork 扫描 CLI 上线，生态仓库零 fork
- [ ] 容器策略 100% 声明式配置（无硬编码）
- [ ] 与 G-27/G-39/G-40/G-41 接口同形性检查通过
- [ ] 至少一个生产级超级 App 接入验证

---

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 五原子销毁与 Backend 卸载时序冲突 | 泄漏 | B2 阶段用 Terminal Backend 先验证，再接真实 Backend |
| 沙箱隔离开销大 | 性能 | 提供 L1/L2/L3 三档，按需选择 |
| fork 扫描误报 | 生态阻力 | 白名单机制 + 明确公开 API 边界 |
| 容器策略组合爆炸 | 复杂度 | 预设 6 种 + 组合配置，禁止自定义基础类型 |
