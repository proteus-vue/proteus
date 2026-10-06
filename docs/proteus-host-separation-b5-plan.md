# 宿主关注点分离 · 下一批（B5）任务卡

> **本文件是什么**：`docs/proteus-host-separation-ledger.md`（唯一事实源）中判定为 `范围外` 的**实现类**遗留项，正式立为下一批（B5）工单。
> **为什么需要它**：台账 §六.3 要求「`范围外` 全部有独立登记件」——HA0.5/HA4 此前只写了理由、**没有落点文件**，现补上（本文件即它们的登记件）。
> **与主闭环的关系**：主闭环（B0–B4）已收口——「新增一个宿主 = 只实现平台原语」的**关注点分离**已完全打通（台账 `已落地 18 / 进行 0 / 未做 0`）。**本批的两项都不是"分离没做"，而是分离判定后的独立实现/重构批次**（因此当时判 `范围外`，非静默跳过）。

---

## 一、本批工单（2 项）

### B5-1 · HA0.5-android —— Android 文本度量/绘制抽 `platform/android/`

| 项 | 内容 |
|---|---|
| **目标** | 把 Android 端的**文本度量/绘制执行**从 `hosts/android` 抽到 `platform/android/`，与 iOS `platform/ios/ProteusPlatform/ProteusTextAdapter.swift` **对称**（`platform/` = 同平台内通用、换宿主不改；`hosts/` = 每宿主不同的集成）。 |
| **现状（取证）** | · iOS 已抽（`platform/ios/ProteusPlatform/`，门禁绿）；<br>· `platform/android/` **已存在但内容是 SDK/AAR**（`proteus-sdk/ProteusEngine.java` + `proteus-jni/`，属 **HA5 存量 App 嵌入**）——**不是** HA0.5 的对象，勿混；<br>· Android 度量/绘制**仍在** `hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/`（`ProteusHostView` / `JsRenderHost` / `VaporRenderHost`，grep `measureText`/`drawText` 命中）。 |
| **交付** | ① `platform/android/proteus-platform/src/dev/proteus/platform/`（文本度量 `TextPaint`/`StaticLayout` + 绘制执行）；② `hosts/android` 改为**调用** platform（不再自持实现）；③ `check:platform-layering` 的 C 判据**扩到 Android 特征 API**（证明 platform/android 里是**度量/绘制**真代码，不是只有 SDK）。 |
| **✅ 进展（B5-1 已落地 · 2026-10-07）** | **字形 + 度量均抽**到 `platform/android/proteus-platform/src/dev/proteus/platform/ProteusTextPlatform.java`：① 字形（`typefaceOf` + 自定义字体注册表）；② 度量（`measureSingle` 单行 / `measureWrapped` 折行含断词·长串溢出·行高封顶 / `applyWordBreak` / `isUnbreakableToken` / `lineHeightPx`）。宿主 `ProteusHostView`/`VaporRenderHost` 同名方法改**委托**（调用方零改动）；`MainActivity` 计数读取改指平台类；构建脚本接入 `platform/android/proteus-platform/src` 源根；门禁 C 判据收紧为"**必须是 `dev/proteus/platform/` 包**"（+**破坏性验证**：移除该文件 ⇒ 红）+ 新增结构契约测试 `tests/host-platform-extraction.test.ts`。验收：`check:android-host-compile` ✅ · `check:platform-layering`（+破坏性）✅ · 真 APK 构建 ✅ · **Android 真机渲染逐像素一致**（step-2 前后 IM 行区域 MD5 相同 `315259b5…`）✅ · 结构契约测试 3 绿。**余**：**绘制执行**（`mkCmd` 的 StaticLayout/Canvas 上屏）**留在宿主**——与 iOS 同构（绘制载体=平台 View），抽取收益低；如需彻底对称可另立。 |
| **验收判据（可机器判定）** | ① `pnpm check:platform-layering` 绿，且对 `platform/android` 有**实质**校验（非空壳）；② `pnpm check:android-host-compile`（零设备 javac + android.jar）绿；③ 真机渲染**无变化**（重跑 `hosts/android/run-superapp.sh` 截图/golden 与迁移前逐像素一致）；④ `grep` 证明宿主层**不再持有**度量/绘制实现。 |
| **依赖** | 无（纯代码组织重构）。可与 B5-2 并行。 |
| **风险 / 纪律** | Java 度量/绘制与宿主**耦合更深**（`platform/README.md` 既有诚实边界：需先做 JNI 侧解耦）⇒ **禁一次性替换**，逐文件迁 + 每步编译绿（沿用 CSE「并行、逐批切换」纪律）。 |
| **诚实边界** | 鸿蒙侧平台层**未开始**（本批不含）；只抽"同平台通用"部分，"每宿主不同的集成"留在 `hosts/`。 |

### B5-2 · HA4-android —— C-ABI `native_view_*` 回调绑定

| 项 | 内容 |
|---|---|
| **目标** | 让 **C-ABI 消费方**实现 `native_view_create` / `native_view_update` / `native_view_destroy` 三个回调，使**含 `nativeHost` 节点的产物经 Host ABI 渲染出真原生视图**（与 headless 参考实现 parity）。 |
| **现状（取证）** | · ABI 声明三回调在 vtable（**可选**）；Rust 核心在"树含 nativeHost 但宿主未提供 create"时**显式报错**（`packages/host-abi/src/lib.rs:993`，`native_view_create_failed` 计数）；<br>· **生产宿主目前均未绑**：`platform/android/proteus-jni/src/host.rs:174` = `native_view_create: None`；iOS `hosts/ios/ProteusHost/runtime/selfdraw-scene.swift:6236` = `nil`（三回调皆 nil）；<br>· **仅测试绑定**：`packages/host-abi/src/lib.rs:1420`（`test_native_create`）、`packages/host-abi/tests/c_host/headless_host.c:280`（`on_nv_create`）。<br>★**关键澄清**：Android 的 `ProteusHostView` **native-host** 是**宿主内 Java 机制**（自建 View，**不经** C-ABI vtable）——台账 HA4 里「Android 原生视图宿主可用」指的是它，与本工单（C-ABI 回调绑定）**不同源**，勿互相替代。 |
| **交付** | ① `platform/android/proteus-jni/src/host.rs` 实现三回调（映射到 Android `View` 的 add/update/remove）；② iOS C-ABI 路径（若消费）同办；③ `proteus_sync_native_views` 在**滚动/动画后**调用接线（几何变了要跟着动）；④ 文档更新（`proteus-host-abi-integration.md` 补"原生组件"接入说明）。 |
| **验收判据（可机器判定）** | ① 设备/集成测试：含 `nativeHost` 节点的树经 **C-ABI** 产出真原生视图（非 nil 路径）；② **z-order 判据**（宿主所有——重叠区原生在上）与**滚动跟随**（`sync_native_views` 生效）；③ "未提供回调 ⇒ 引擎显式报错"仍保留（**不静默**）；④ 与 `ProteusHostView`（宿主内机制）**行为对拍一致**（位置/渲染/z-order 三判据，沿用既有口径）。 |
| **依赖** | 可独立于 B5-1；若同批做，先 B5-1（platform 分层）再 B5-2（回调接线）。 |
| **风险 / 纪律** | z-order 与滚动同步是**平台成本**（既定"不抽象"）；AAR SDK（`platform/android/proteus-sdk`）是 C-ABI 消费主入口，其宿主回调需一并走通。 |
| **诚实边界** | 门禁**无法机器判定"回调已绑"**（vtable 运行时装配）⇒ 判据落到 device test；iOS 是否也走 C-ABI 消费面，实施前**先取证**（当前 selfdraw 传 nil）。 |

---

## 二、非本批（各自已有归属，列出以免重复建设）

| 项 | 状态 | 归属 |
|---|---|---|
| **G3** 手势分类收敛到 `packages/gesture` | **不待办** | 触摸采集/分类 = **平台原语**（目标定义里的"触摸采集"）；共享冒泡派发 `packages/slot-runtime/src/dispatch.ts` 已落地 |
| **G5** mountPage 门面 | **不待办** | 宿主挂载调用 = **平台原语**；共享内容实例化 `packages/render-backend/src/screen-runtime.ts` 已落地（B1） |
| **HA2** `decode_image` | **终止态** | 内核不处理图像（图像由各宿主各自解码）；该 trait 是 ABI 契约声明，**非"待实现"** |
| **L5 / L6** runtime 三端独立发布包 | 独立专项 | `docs/proteus-host-runtime-package-plan.md` |
| **X1** G-39 Flutter/鸿蒙/TV/Watch 宿主 | 独立特性线 | `docs/proteus-host-runtime-plan/` |
| **X2** G-41 五宿主真机接入 | 独立特性线 | `docs/proteus-host-integration-plan/` |
| **X3** G-42 宿主容器生产验证 | 独立特性线 | `docs/proteus-host-container-plan/` |
| **X4** G-45 dev-host B3b/B4–B6 | 独立特性线 | `docs/proteus-dev-host-plan/` |
| **X5** 平台成本（z-order / 滚动同步归宿主） | 非缺陷 | `docs/Proteus_HostABI宿主抽象层设计方案.md` §0.4.2（"绕不开的平台成本"） |

---

## 三、验收（B5 收口判据）

1. **本批 2 项各自有 device/零设备判据全绿**（见各卡"验收判据"）；
2. 台账 `HA0.5` / `HA4` 由 `范围外` → **`已落地`**（判据指向本批产物）；
3. 分离闭环**不被破坏**：`check:host-separation-ledger` 仍绿（`进行 0 / 未做 0`）；
4. **禁一次性替换**：每步编译绿 + 真机渲染无回归（迁移类改动逐文件落）。
