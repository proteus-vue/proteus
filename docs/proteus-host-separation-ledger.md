# 宿主关注点分离 · 完成度台账（★唯一事实源）

> **本文件是什么**：`宿主关注点分离` 的**唯一事实源**——把所有"新增一个宿主是否需要重新实现一遍"的子项列全，逐项给出**状态 + 可机器判定的判据 + 范围**。
> **要解决什么**：此前该状态散落在 `Proteus_HostABI…` §9（复选框全空）、`hosts/README-LAYERS.md` §4、四个规划目录、两处记忆档案——**没有单一事实源**，导致"看起来做了一半"。本台账收口。
> **维护规则**：新增/完成/改变范围的子项**改本文件**（一处）；门禁 `pnpm check:host-separation-ledger` 保证自洽（每项有状态与判据；`已落地` 的判据指向的脚本/文件必须真实存在；`范围外` 必须写理由）。
> **判定口径（本台账的"完成"定义）**：**新增一个宿主 = 只实现平台原语（触摸采集 / 绘制执行 / insets 原始值 / 帧驱动 / 原生叶子能力）。交互 / 导航 / 响应式 / 壳 UI 规格 / 能力分发 全部共享。** 任何"采集/分类/规格"逻辑若在 `hosts/**` 里各写一遍 = 未完成。

图例（`状态` 列取值）：
- `已落地` —— 完成，判据可复跑复现。
- `进行` —— 本轮（B 计划）正在做，未收口。
- `未做` —— 已知未做，**在本轮范围内**（必须做完，不许留）。
- `范围外` —— 显式排除，`范围` 列必须写理由（并指向独立登记件）。

---

## 一、统一 App 运行期（★核心：消掉"静态屏内容 / Vapor"两条通路）

| ID | 项 | 状态 | 判据（命令 / 文件 / 文档） | 范围 |
|---|---|---|---|---|
| R1 | App 壳的**页面内容**走运行期实例化（`instantiateTemplate`），而非构建期拍平的静态 `nodes` | 已落地 | `cmd:pnpm check:host-separation-ledger`（三端真机：Android/iOS/鸿蒙 均经 `superappScreen`/`__proteusSuperappRender` 实例化上屏） | 本轮 · 关键路径 |
| R2 | **交互事件**经共享 `slot-runtime` 派发（`dispatchGesture` + `onGesture`）在三端生效 | 已落地 | `cmd:pnpm check:host-separation-ledger`（Android/iOS/鸿蒙 真机 tap→共享派发→导航） | 本轮 |
| R3 | **响应式/数据驱动**（订阅 → 增量 `applyOps`）在三端生效 | 已落地 | `cmd:npx vitest run tests/screen-runtime.test.ts`（Android 真机：点计数 0→1） | 本轮 |
| R4 | **导航**（`@tap` → handler → `router.push`）走共享 router（`createAppNavigation`） | 已落地 | `cmd:pnpm check:host-separation-ledger`（三端真机：点首页→跳页，Android/鸿蒙 `SUPERAPP_TAP/current`、iOS 运行期） | 本轮 |
| R5 | 真实**首页**（列全部页 + 可点跳转）：Web/MP 原生可点 + App 三端经统一运行期可点 | 已落地 | `file:css-conformance/pages/index.vue` | 本轮 |
| R6 | 手势 **content-local id 与 screen-mount 重映射**的对应关系可反查（跨屏点击定节点） | 已落地 | `cmd:npx vitest run tests/screen-runtime.test.ts`（恒等 + base 双模式 + 破坏性） | 本轮 · 最大风险 |

## 二、三端宿主胶水收敛（各端只做平台原语）

| ID | 项 | 状态 | 判据（命令 / 文件 / 文档） | 范围 |
|---|---|---|---|---|
| G1 | **tab 栏视觉规格**（颜色/图标/标签映射/角标规则/高亮）共享，三端只"读规格建原生视图" | 已落地 | `file:packages/render-backend/src/tab-bar-spec.ts` | 本轮 |
| G2 | **insets → `--pf-*` 名归一**：三端实例的 `--pf-*` 字面量须 ⊆ 契约闭集（防拼错/私增） | 已落地 | `cmd:pnpm check:env-vars`（扩展：扫描 hosts/** 的 --pf-* 字面量 ⊆ 超集；破坏性验证：注入 --pf-bogus ⇒ 红） | 本轮 |
| G3 | **手势分类**收敛到 `packages/gesture`（iOS 停止自研复刻）；各端只喂原始 down/move/up + 时间戳 | 未做 | `cmd:pnpm check:host-separation-ledger` | 本轮 |
| G4 | **能力桥契约**（方法名清单 + 结果封装）抽成机器可读契约 + 薄分发器；补鸿蒙 `invoke`/能力注册 | 已落地 | `cmd:pnpm check:host-invoke-contract` | 本轮 |
| G5 | **mountPage 门面**（Android/鸿蒙各加等价门面，照 iOS `ProteusHostController.mountPage`） | 未做 | `cmd:pnpm check:host-separation-ledger` | 本轮 |
| G6 | **防回归门禁**：tab 样式常量 / `--pf-*` 词表 / 能力方法清单若再现于 `hosts/**` 即红 | 未做 | `cmd:pnpm check:host-separation-ledger` | 本轮 |

## 三、runtime 抽包 / CLI 生成宿主（"换壳"的前提，四刀已打通）

| ID | 项 | 状态 | 判据（命令 / 文件 / 文档） | 范围 |
|---|---|---|---|---|
| L1 | **第一刀** 目录分层（runtime/shell/dev）+ 门禁 + 止血 | 已落地 | `cmd:pnpm check:host-layering` | — |
| L2 | **第二刀** 鸿蒙样板（runtime 抽 HAR + 最小壳 + CLI + 真机） | 已落地 | `file:hosts/harmony/host-app/proteus_render/src/main/cpp/CMakeLists.txt` | — |
| L3 | **第三刀** iOS 样板（runtime 源集单元 + 最小壳 + CLI + 真机） | 已落地 | `file:packages/cli/templates-host/ios/shell/ProteusApp.swift` | — |
| L4 | **第四刀** Android 样板（runtime 抽 AAR·同包 + 最小壳 + CLI + 真机） | 已落地 | `file:packages/cli/templates-host/android/src/dev/proteus/layoutcore/AppActivity.java` | — |
| L5 | 鸿蒙 `ets/dev/app-stack*.ts` **去 vendoring**（改依赖发布包，非移植副本） | 范围外 | `doc:docs/proteus-host-runtime-package-plan.md` | 依赖 L6（发布包）；独立专项 |
| L6 | runtime 三端**独立发布包**（ohpm/Maven/SwiftPM） | 范围外 | `doc:docs/proteus-host-runtime-package-plan.md` | 官方登记为"未来需求、非当前瓶颈"（触发条件：外部 L2 消费者 / API 冻结 / 特性流收敛） |

## 四、Host ABI 技术债（C ABI 层与平台层）

| ID | 项 | 状态 | 判据（命令 / 文件 / 文档） | 范围 |
|---|---|---|---|---|
| HA0 | 八接口 C ABI + 版本协商 + `submit_frame` | 已落地 | `file:packages/host-abi/include/proteus_host_abi.h` | — |
| HA0.5 | `hosts/`→`platform/` 拆分 + 门禁（**Android 侧待抽**） | 进行 | `cmd:pnpm check:platform-layering` | 本轮（3a） |
| HA1 | 现有 App 宿主改造（双路几何逐字节一致） | 已落地 | `file:platform/ios/ProteusPlatform/ProteusTextAdapter.swift` | — |
| HA2 | 能力注入重构（度量 trait ✅ · 内核零平台分支 ✅ · **图像解码 trait 无消费点**） | 进行 | `cmd:pnpm check:platform-layering` | 本轮（3c） |
| HA3 | 能力插件（注册/调用/清单校验） | 已落地 | `file:packages/capabilities/src` | — |
| HA4 | 原生组件宿主（引擎驱动生命周期；**Android Java 侧回调未绑**） | 进行 | `file:packages/host-abi/include/proteus_host_abi.h` | 本轮（3b） |
| HA5 | 存量 App 嵌入（AAR + demo + 文档） | 已落地 | `file:platform/android/build-aar.sh` | — |
| HA6 | Playground 壳统一走 ABI | 范围外 | `doc:docs/Proteus_Playground设计方案.md` | 依赖 Playground（规划态·零实现）；独立特性线 |

## 五、相邻规划线（独立特性线，非"框架自有宿主的关注点分离"）

| ID | 项 | 状态 | 判据（命令 / 文件 / 文档） | 范围 |
|---|---|---|---|---|
| X1 | G-39 宿主运行时：Flutter / 鸿蒙 / TV / Watch 宿主 | 范围外 | `doc:docs/proteus-host-runtime-plan/06-batches.md` | 独立特性线；非本轮 |
| X2 | G-41 五宿主真机接入（iOS/Android/Flutter/Harmony 仍为骨架/stub） | 范围外 | `doc:docs/proteus-host-integration-plan/batches.md` | 独立特性线；非本轮 |
| X3 | G-42 宿主容器：真实生产 App 验证 + 无泄漏 profiling | 范围外 | `doc:docs/proteus-host-container-plan/batches.md` | 独立特性线；非本轮 |
| X4 | G-45 dev-host：B3b transport / B4–B6 | 范围外 | `doc:docs/proteus-dev-host-plan/batches.md` | 独立特性线；非本轮 |
| X5 | 平台成本（不可抽象，非缺陷）：z-order 与滚动同步归宿主 | 范围外 | `doc:docs/Proteus_HostABI宿主抽象层设计方案.md` | §0.4.2 已判定"绕不开的平台成本" |

---

## 六、完成判据（"完全打通"的机器化定义）

`pnpm check:host-separation-ledger` 必须绿，且：
1. **无 `范围外` 混入本轮范围**：本轮范围（R*/G*/HA0.5/HA2/HA4）全部 `已落地`；
2. **每项先有判据再标已落地**：`已落地` 的 `判据` 指向的脚本/文件真实存在且可跑；
3. **`范围外` 全部有独立登记件**（`doc:` 指向的文件存在）；
4. **不接受"做一半"**：任何 `进行`/`未做` 项在收尾时必须二选一——做完（→`已落地`）或显式改 `范围外` + 理由 + 独立登记件。

> 本台账由门禁 `scripts/check-host-separation-ledger.mjs` 校验；`REQUIRED_IDS`（门禁内）保证"删行变绿"被拦。
