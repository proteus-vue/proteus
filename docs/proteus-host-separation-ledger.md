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
| G3 | **手势分类**收敛到 `packages/gesture`（iOS 停止自研复刻）；各端只喂原始 down/move/up + 时间戳 | 范围外 | `file:packages/slot-runtime/src/dispatch.ts`（共享事件派发已落地） | **触摸采集/分类 = 平台原语**（目标定义里的"触摸采集"）——Android/iOS/鸿蒙触控 API 各异；跨语言事件协议属过度设计。共享层（冒泡派发 dispatch.ts）已落地。 |
| G4 | **能力桥契约**（方法名清单 + 结果封装）抽成机器可读契约 + 薄分发器；补鸿蒙 `invoke`/能力注册 | 已落地 | `cmd:pnpm check:host-invoke-contract` | 本轮 |
| G5 | **mountPage 门面**（Android/鸿蒙各加等价门面，照 iOS `ProteusHostController.mountPage`） | 范围外 | `file:packages/render-backend/src/screen-runtime.ts`（共享内容实例化已落地） | **宿主挂载调用 = 平台原语**——`renderCurrent`/`mount` 各端调自己的宿主 API；可共享的内容实例化已在 `screen-runtime.ts`（B1）落地。 |
| G6 | **防回归门禁**：`--pf-*` 名闭集 / invoke 方法契约 / tab 规格硬编码，三项均机器守 | 已落地 | `cmd:pnpm check:host-tab-spec`（+ check:env-vars / check:host-invoke-contract） | 本轮 |

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
| HA0.5 | `hosts/`→`platform/` 拆分 + 门禁（**三端**） | 已落地 | `cmd:pnpm check:platform-layering` | **三端平台适配层均已抽出**：iOS（`ProteusTextAdapter`，CoreText）· **Android（B5-1 · 2026-10-07）**：`ProteusTextPlatform.java`（字形 + 文本度量）· **鸿蒙（B5-1 · 2026-10-07）**：`proteus_text_platform.h`（OH_Drawing 度量 + 字体）；宿主只做**委托/调用**，真机渲染**无回归**（Android 逐像素一致 · 鸿蒙函数体逐字一致）。门禁 C 判据收紧为"**必须有平台适配层**"（`PLATFORM_ADAPTATION` = ios/android/harmony 三段路径，**破坏性验证**：删文件 ⇒ 红）+ 结构契约测试 `tests/host-platform-extraction.test.ts`（三端）。**绘制执行**（`mkCmd`/Canvas 上屏）**留在宿主**（三端同构：绘制载体=平台 View）。★`platform/android/proteus-sdk`（SDK/AAR）= **HA5 存量嵌入**，非本项对象。登记件 `docs/proteus-host-separation-b5-plan.md`。 |
| HA1 | 现有 App 宿主改造（双路几何逐字节一致） | 已落地 | `file:platform/ios/ProteusPlatform/ProteusTextAdapter.swift` | — |
| HA2 | 能力注入重构（度量 trait ✅ · 内核零平台分支 ✅ · **图像解码 trait 无消费点**） | 范围外 | `file:packages/host-abi/src/lib.rs`（decode_image 声明） | **内核不处理图像**（图像由各宿主各自解码——见 HostABI 文档；`decode_image` 无内核消费点）⇒ 该 trait 为 ABI 契约声明（保留），**登记终止态**（非"待实现"）。 |
| HA3 | 能力插件（注册/调用/清单校验） | 已落地 | `file:packages/capabilities/src` | — |
| HA4 | 原生组件宿主（引擎驱动生命周期；**C-ABI `native_view_*` 回调**） | 范围外 | `file:packages/host-abi/include/proteus_host_abi.h` | Rust 核心（引擎驱动生命周期）+ 单测已落地。**Android C-ABI 绑定：B5-2（`docs/proteus-host-separation-b5-plan.md`）已落地（2026-10-07）**——`ProteusHost` 加三回调（opt-in default）、`proteus-jni/src/host.rs` 三蹦床 + GlobalRef 句柄注册表、embed-demo **真机**建真 Android View（`native_view_created=1 · frame=24,221,342,140`）。**余**：**iOS ABI 探针路径**（`selfdraw-scene.swift`）仍传 `nil`——iOS 无生产原生组件消费者（selfdraw 是 ABI 探针）⇒ 具名边界。 |
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
1. **本轮范围全部 `已落地`**：R1–R6 · G1/G2/G4/G6 全绿；**HA2 判为终止态**、**HA4 的 iOS 侧为具名边界**（`范围外` + 理由 + 登记指向，非静默跳过）；**HA0.5 已 `已落地`**（三端平台适配层均抽出）——见 §四各行；
2. **每项先有判据再标已落地**：`已落地` 的 `判据` 指向的脚本/文件真实存在且可跑；
3. **`范围外` 全部有独立登记件**（`doc:` 指向的文件存在）；
4. **不接受"做一半"**：任何 `进行`/`未做` 项在收尾时必须二选一——做完（→`已落地`）或显式改 `范围外` + 理由 + 独立登记件。

> 本台账由门禁 `scripts/check-host-separation-ledger.mjs` 校验；`REQUIRED_IDS`（门禁内）保证"删行变绿"被拦。

## 七、收尾（B4 · 2026-10-07）：独立复评 + 真机交互证据

**① 独立子代理复评（基准 = Web）**——四端 index 截图逐端判定：**Web PASS · Android PASS · iOS PASS · HarmonyOS PASS**（行数/顺序/左右列/配色一致；lavender 卡片 `rgb(228,229,243)`、页底 `rgb(244,245,247)` 逐端吻合）。
- **两处上轮"缺陷"证伪**：a) Android 左缘灰竖条 = **MIUI 系统侧边把手**（x=19–26，页面内容起于 x≥32，**浮在系统 gutter、从不压内容**；同机 Settings 同位置同样存在）——非应用缺陷；b) HarmonyOS **非空白**（首页完整渲染：标题 + 计数卡 + 13 行）。

**② 三端真机交互证据（首页可点 → 跳页）**——三端各走**与真触摸同一条链**（宿主 hitTest → 共享运行期 `dispatchGesture` → `$nav` → `router.push`/`mountScreen`）：
- **Android**：`am start --es tap x,y`（SuperappActivity 内置判据钩子）⇒ `SUPERAPP_TAP target=7 → cur=text navlog=["text"]`；点计数卡 `count 0→1`（响应式）。
- **iOS**：`run-selfdraw.sh --superapp --tap=x,y`（★本轮新增钩子，与 Android `--es tap` 对称）⇒ `SUPERAPP_TAP inject target=7 gestures_fired=1 → SUPERAPP_RENDER page=text → rendered_page=text`。
- **HarmonyOS**：`uinput -T -m` 真输入栈（`.onTouch` → `appScreenHitAt`）⇒ `SUPERAPP_TAP chain=[2,0] current=text-shadow depth=2` → 返回 `SUPERAPP_BACK current=index depth=1`；拖动可滚。

**③ 诚实边界**：Web/MP 走各自原生路由（不经共享运行期）；Android `--es tap` 为进程内注入（与真触摸同链，非 adb 合成——MIUI 拦 `adb input tap` 的 INJECT_EVENTS）；App CSS 仍限类/元素/通配/结构伪类子集。
