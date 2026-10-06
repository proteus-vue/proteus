# App 端安全区 / 系统栏环境变量 · 落地计划（提案 v1）

> 类型：plan（建议登记于 `board-inventory.md`「其他文档」；不占 G 序）
> 关联：**G-09 SafeArea** · **G-21 style-safety** · **G-61 跨端 CSS 引擎（PCE）**（值类型扩展走 INV-CE-07 四同步） · **G-27/G-37 RenderBackend SPI** · HostABI v1（`packages/host-abi/include/proteus_host_abi.h`） · Fluid System（`packages/fluid`） · `<p-safe>`（`packages/components/p-safe`）
> 前置事实：`packages/fluid/src/safe-area.ts`（S2 已落地：Web `env()` 映射 + MP 实测 px + 折叠屏 hinge）——**本 plan 补的是 App 自绘端与三端口径统一**
> 日期：2026-10-06 · 状态：**提案（待裁定）**

---

## 0. 结论先行

**问题一：安卓/鸿蒙能不能拿到系统状态栏、底部安全区？**
**能，而且不需要任何手机厂商私有 API。** 官方 API 已全厂商覆盖：

| 端 | 官方 API | 覆盖度 |
|---|---|---|
| Android | `WindowInsets`（API 20+）/ `WindowInsets.Type.displayCutout()`（API 28+）/ `systemGestures`·`tappableElement`·`ime`（API 29/30+）；API 35 起 edge-to-edge **强制** | ✅ 全厂商（含小米/华为/OPPO/vivo/荣耀/三星） |
| HarmonyOS | `win.getWindowAvoidArea(TYPE_SYSTEM / TYPE_NAVIGATION_INDICATOR / TYPE_CUTOUT)` + `on('avoidAreaChange')` + `display.getCutoutInfo()` | ✅ 原生统一 |
| iOS | `UIView.safeAreaInsets` + `safeAreaLayoutGuide` + `keyboardWillChangeFrame` | ✅ |
| Skyline | `wx.getWindowInfo()`（基础库 2.20.1+）`statusBarHeight` / `safeArea` | ✅ 微信容器提供 |
| Web | `env(safe-area-inset-*)`（需 `viewport-fit=cover`） | ✅ 浏览器原生 |

**厂商私有 API（`ro.miui.notch` / `HwNotchSizeUtil` / `FtFeature.isFeatureSupport` / `ro.oppo.*` / `ro.flyme.notch`）本框架一律不采用**——理由见 §2.3。

**问题二：怎么进"框架内置 CSS 变量"？**
现有 `globalStyle` 令牌通道**装不下**——`parseCssVarTokens` 明确只收**字面值**，`env()` / `calc()` 动态令牌**不解析**（`packages/compiler/src/vapor/template.ts:558-561`）。安全区是**运行期、设备相关、可动态变化**的值。

⇒ 本 plan 的核心是三件事：

1. **值类型扩展**：StyleIR 的 `ResolvedLength` 新增 **`envRef` 变体**（不在编译期折成字面值，发射"环境变量引用"）；
2. **采集+传输**：三端宿主采集归一化 → HostABI `ProteusSurface` 扩展（ABI v2）承载 insets；
3. **契约冻结**：内置变量集 `--pf-inset-*` / `--pf-status-bar-height` / … 统一命名与单位口径，三端同语义。

★**关键合法性论证**（回应 INV-CE-03「运行期零 CSS 解析」）：`envRef` 的**变量名在编译期就解析成字段索引**，运行期只是**一次表查找**（与动态 class 预计算的 O(1) 位图查表同源）——**不是**运行期 CSSOM。本设计与"编译期优先"不冲突。

---

## 1. 现状（本 plan 立项时的代码事实）

| 能力 | 现状 | 证据 |
|---|---|---|
| Web 端避让 | ✅ `env(safe-area-inset-*)` + `max(env(), Npx)` 兜底 | `packages/fluid/src/safe-area.ts:19-22` |
| MP/Skyline 避让 | ✅ 运行时实测 px（`env()` 在 Skyline **整条声明被丢弃**） | 同上 `:14, 24-30`；`packages/components/p-safe/index.vue:34-50` |
| 折叠屏 hinge | ✅ `--pf-fold-left` / `--pf-fold-width`（Web `env(fold-*)`） | `packages/fluid/src/safe-area.ts:53-64`；`packages/fluid/src/formfactor.ts:679` |
| 框架环境变量前缀 | ✅ `--pf-*` 已是既有约定（`--pf-u` / `--pf-safe-top` / `--pf-safe-bottom` / `--pf-safe-side`） | `packages/fluid/src/formfactor.ts:647-683` |
| **App（自绘）安全区** | ❌ **无接线**：HostABI 无 insets 字段，三端宿主无避让采集 | `packages/host-abi/include/proteus_host_abi.h` 的 `ProteusSurface` 仅 `width/height/density/content_scale` |
| 编译期 `env()` | ◐ 仅 `calc()` 内的 `env(safe-area-inset-*)` 作 fallback 参与常量折叠 | `packages/compiler/src/vapor/template.ts:2582-2590` |
| 配置面 | ◐ `app-config.safeArea.islandGlass` 单字段（Boolean） | `packages/app-config/src/types.ts:62-64` |

⇒ **缺口集中在"App 自绘端"与"三端统一口径"**，Web/MP 已有半成品可直接对齐。

---

## 2. 三端能力取证

### 2.1 Android

**官方唯一正确路径**：`WindowCompat.enableEdgeToEdge()` + `ViewCompat.setOnApplyWindowInsetsListener`（androidx，回落到 API 21）/ API 30+ 用 `WindowManager.getCurrentWindowMetrics().getWindowInsets()`。

可取的 inset 类型（归一化为框架语义）：

| `WindowInsets.Type` | 框架语义 | 用途 |
|---|---|---|
| `statusBars()` / `statusBarsIgnoringVisibility()` | `--pf-status-bar-height` | 状态栏本体高 |
| `navigationBars()` | `--pf-nav-bar-height` | 底部虚拟三键 |
| `tappableElement()` | `--pf-nav-mode` 判定 | **手势导航 vs 三键导航**的判据（手势导航 tappable 显著小于 navigationBars） |
| `displayCutout()`（API 28+） | `--pf-cutout-top/left/right` | 刘海/挖孔 |
| `systemGestures()`（API 29+） | 侧边返回手势带 | 边缘可交互区收缩 |
| `ime()` | `--pf-keyboard-height` | 键盘 |

**两个必须记住的工程点**：
1. **`*IgnoringVisibility` 变体**：沉浸式/隐藏系统栏时，主 inset 会变 0 ⇒ **布局跳动**。稳定值必须取 `IgnoringVisibility` 变体。
2. **Android 15（targetSdk 35）edge-to-edge 强制**：`setDecorFitsSystemWindows` / `setStatusBarColor` / `setNavigationBarColor` 已**废弃**；`GlobalConfiguration.appbounds` 也不再减导航栏与挖孔尺寸（荣耀/华为适配指导明确）⇒ 想拿"除 inset 外的尺寸"只能自己监听 inset 相减。**这对本框架是利好**：自绘 UI 本就 edge-to-edge，官方路径与框架模型天然一致。

### 2.2 HarmonyOS

```ts
const win = await window.getLastWindow(ctx)
const systemArea = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM)               // 状态栏 top + 虚拟三键 bottom
const indicatorArea = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR) // 底部手势条
win.on('avoidAreaChange', (data) => { /* 旋转/折叠/系统栏显隐 */ })
```

| `AvoidAreaType` | 值 | 框架语义 |
|---|---|---|
| `TYPE_SYSTEM` | 0 | 状态栏（`topRect.height`）+ 虚拟三键导航（`bottomRect.height`） |
| `TYPE_CUTOUT` | 1 | 刘海/挖孔（`leftRect` / `rightRect` / `topRect`） |
| `TYPE_SYSTEM_GESTURE` | 2（API 9+） | 系统手势区 |
| `TYPE_KEYBOARD` | 3（API 9+） | 软键盘 |
| `TYPE_NAVIGATION_INDICATOR` | 4（**API 11+**） | 底部导航条 / 手势横条 |

**三个必须记住的工程点**：
1. ★**`TYPE_SYSTEM` 的底部在沉浸式下高度为 0** —— `TYPE_NAVIGATION_INDICATOR` 正是为修这个 bug 而新增（华为开发者论坛明确）⇒ **底部总避让 = `TYPE_SYSTEM.bottomRect` + `TYPE_NAVIGATION_INDICATOR.bottomRect`（两者互斥，通常只有一个有值，必须相加而非取其一）**。
2. ★**`AvoidArea` 单位是 px（物理像素）**，页面布局用 vp ⇒ 必须 `px2vp`。**不转换在 480dpi 设备上会大 3 倍**。这是三端归一化里最容易错的一处。
3. ★**`TYPE_CUTOUT` 默认不生效**：需 `module.json5` 显式声明（API 12+ `"metadata": [{"name":"avoid_cutout","value":"true"}]`，或 `abilities[].display.cutoutEnable: true`）⇒ **必须由 CLI 生成宿主时自动写入**（见 §6 B6），否则开发者踩空且**静默**。
4. 获取时机：必须在 `onWindowStageCreate` 的 `loadContent` **回调内**（窗口未创建时报 1300002，回调外取值不稳定）。

### 2.3 为什么不用厂商私有 API（明确表态）

| 理由 | 说明 |
|---|---|
| ① 官方已全厂商覆盖 | `WindowInsets` + `displayCutout` 是 AOSP 契约，厂商 ROM 必须实现；私有 API 是 **Android 9- 时代**（无 `displayCutout`）的历史包袱 |
| ② API 35 后多余 | edge-to-edge 强制 + 系统栏透明，靠的是 inset，不是"厂商有没有刘海"的布尔标记 |
| ③ 反射本身是崩溃源 | 私有类/属性名可被厂商混淆或移除 ⇒ `ClassNotFoundException` / `NoSuchFieldException`；与框架"缺桥诚实降级不崩溃"原则冲突 |
| ④ 与内核纪律同源 | HostABI 硬约束③「平台能力注入而非分支，内核不得出现 `target_os` 分支」——厂商分支进宿主同样是"用平台差异污染语义层" |

**结论**：厂商私有 API **不实现**；仅作为**最后一级 fallback 并登记**（且需证明"官方路径在该机型不可用"才允许开启，走 `allow-differences.json` 同族登记）。

### 2.4 Skyline（小程序） / iOS / Web

- **Skyline**：`wx.getWindowInfo()`（2.20.1+）返回 `statusBarHeight` 与 `safeArea{top,bottom,left,right,width,height}`。★★**两个坑**：① `safeArea` 是**绝对坐标**不是 inset，必须自行换算 `inset-bottom = screenHeight - safeArea.bottom`（业界通行式：`screenHeight - safeArea.height - statusBarHeight`）；② **部分机型不返回 `safeArea` 字段**（官方明确"开发者需自行兼容"）⇒ 必须降级到 `statusBarHeight` + 0。微信**没有** `safeAreaInsets` 字段（那是 uni-app 的扩展）。
- **iOS**：`UIView.safeAreaInsets`（逻辑点，直接可用）+ `additionalSafeAreaInsets`（宿主可叠加，用于自绘壳的额外避让）+ `keyboardWillChangeFrameNotification`（键盘）。
- **Web**：`env(safe-area-inset-*)`，需 `viewport-fit=cover`；**`env()` 值与框架变量必须判等**（见 §5 判据）。

---

## 3. 变量契约（框架内置）

**前缀沿用既有 `--pf-*`**（Fluid System 环境变量族，`packages/fluid/src/formfactor.ts` 已在使用）。单位口径统一为**逻辑像素（dp / vp / pt）**。

### 3.1 A 组 · 避让量（inset）——"内容该离屏幕边多远"

| 变量 | 语义 | 端来源 |
|---|---|---|
| `--pf-inset-top` | 顶部避让（状态栏 ∪ 挖孔） | Android `statusBars ∪ displayCutout` · 鸿蒙 `TYPE_SYSTEM.topRect` · iOS `safeAreaInsets.top` · MP 换算 · Web `env(safe-area-inset-top)` |
| `--pf-inset-right` | 右侧避让（横屏挖孔） | 同族 |
| `--pf-inset-bottom` | 底部避让（导航栏 ∪ 手势条） | Android `navigationBars` · 鸿蒙 `TYPE_SYSTEM.bottomRect + TYPE_NAVIGATION_INDICATOR.bottomRect` · iOS `safeAreaInsets.bottom` · MP 换算 · Web `env(...)` |
| `--pf-inset-left` | 左侧避让 | 同族 |

### 3.2 B 组 · 系统栏本体尺寸——"系统栏本身多高"（用于给状态栏区域铺背景色）

| 变量 | 语义 |
|---|---|
| `--pf-status-bar-height` | 状态栏高度 |
| `--pf-nav-bar-height` | 底部虚拟三键导航高度（手势机 = 0） |
| `--pf-indicator-height` | 底部手势横条高度（三键机 = 0） |
| `--pf-nav-bar-total` | 派生 = `--pf-nav-bar-height + --pf-indicator-height`（**A 组与 B 组的分野**：A 组问"内容让多远"，B 组问"栏本身多高"） |

### 3.3 C 组 · 环境态（flags / 局部量）

| 变量 | 语义 |
|---|---|
| `--pf-nav-mode` | `gesture` \| `three-button`（决定底部能否放交互元素；Web 端无对应，取 `unknown`） |
| `--pf-cutout-top` / `--pf-cutout-left` / `--pf-cutout-right` | 挖孔区域尺寸（横屏左右挖孔需动态） |
| `--pf-keyboard-height` | 软键盘高度（**不参与布局**，仅供"贴键盘"场景；默认 `0`） |
| `--pf-fold-left` / `--pf-fold-width` | ✅ 已存在（折叠屏 hinge） |

### 3.4 与既有 `--pf-safe-*` 的关系（不冲突、要写清优先级）

`--pf-safe-top` / `--pf-safe-bottom` / `--pf-safe-side` 是 **form-profile 推导的默认值**（平板/车机/手表的"设计默认安全距离"），与本 plan 的**实测值**是两回事：

```
--pf-safe-top（设计默认，profile 推导）
--pf-inset-top（运行期实测，宿主采集）
解析优先级：实测值 > profile 默认 > 0
派生（给开发者的"意图"变量，向后兼容）：
  --pf-safe-top: max(--pf-inset-top, profile 默认)
```

★**纪律**：`--pf-safe-*` 保留既有语义**不改**（避免破坏 formfactor 既有消费者），新增 `--pf-inset-*` 承载实测值；两者的合成规则进契约，避免"两个语义相近的变量各端解析不同"。

---

## 4. 传输链（三端统一）

```
[采集层]  宿主/运行时（每端一次实现，换 App 不改）
  Android : WindowCompat.enableEdgeToEdge + setOnApplyWindowInsetsListener → WindowInsetsCompat
            取 statusBars ∪ displayCutout（避免重复 padding）/ navigationBars / tappableElement / ime
            *IgnoringVisibility 变体取稳定值；px ÷ density → 逻辑像素
  Harmony : getWindowAvoidArea(TYPE_SYSTEM + TYPE_NAVIGATION_INDICATOR + TYPE_CUTOUT) + on('avoidAreaChange')
            + on('keyboardHeightChange')；px2vp()
  iOS     : view.safeAreaInsets + additionalSafeAreaInsets + keyboardWillChangeFrame
  Skyline : wx.getWindowInfo() + getMenuButtonBoundingClientRect + wx.onWindowResize（自行换算 + 缺 safeArea 降级）
  Web     : env(safe-area-inset-*)（浏览器原生，框架不干预）
        │
        ▼ 归一化为统一语义（逻辑像素）
[传输层]  App：HostABI —— `ProteusSurface` 扩展（ABI v2）
        · 新增字段：inset_top/right/bottom/left、status_bar_height、nav_bar_height、indicator_height、
                    nav_mode(u8)、cutout_top/left/right、keyboard_height
        · 复用既有入口 `proteus_surface_changed(engine, surface)`（旋转/折叠/键盘/分屏天然同源同生命周期）
        · ★为什么走 Surface 而不是 capability：inset 与 viewport **同源、同生命周期、必须同批到达**；
          capability（`ProteusCapabilityFn`）是"按需问答"通道，语义上不适合每帧环境几何。
          （零 ABI 变更的备选路径仍保留：注册 `device.env` capability —— 但**不推荐作主路**）
        │
        ▼
[求值层]  引擎 `EngineState.env`（环境变量表：name → 逻辑像素值）
        · 变更即置脏 → **一次 relayout**（对齐批处理红线：一帧内 N 次变更聚合为一次 submit）
        │
        ▼
[消费层]  编译期已把 `var(--pf-inset-top)` 解析为 **`envRef`**（不再折字面值）
        → 布局时 O(1) 查表求值（**不是**运行期 CSS 解析，INV-CE-03 不破）
        · `<p-safe area="top">` / `useSafeArea()` / `createDeviceEnv()` 读同一份表
        │
        ▼
[判据层]  三层判据继续（G-61）：env 值进 snapshot，参与「各端 ≡ Web ≤0.5dp」
```

---

## 5. StyleIR 值类型扩展（走 INV-CE-07 四同步）

```ts
// 现值类型（Proteus_CSS_Profile规格.md §4.5）
type ResolvedLength =
  | { kind: 'absolute'; dp: number }
  | { kind: 'ratio'; ratio: number; base: 'width' | 'height' | 'viewportWidth' | 'viewportHeight' | 'fontSize' }

// ★新增（本 plan）
  | { kind: 'env'; name: EnvVarName; fallback?: number }   // fallback 取 CSS 第二参数语义（var(--x, 0px)）
```

**四同步清单**（INV-CE-07，缺一即红）：

1. IR 规范：`02-style-ir-contract.md` 增 `env` 变体 + `EnvVarName` 闭集；
2. 三端 Applier：Web（A 档 = IR 探针，`envRef` 映射回原生 `env()`）/ Skyline（换算 px）/ App（引擎 env 表查表）；
3. 三层判据：`envRef` 的**已解析值**进 snapshot（与 absolute 同口径 ≤0.5dp）；
4. 编译期 lint：`--pf-*` 白名单 + 未知 `--pf-*` 名报错（禁止拼写漂移静默为 0）。

**编译器改造点**：`substituteCssVars`（`template.ts:592-607`）对 `--pf-*` 前缀**不替换**，改发射 `envRef`；`foldCalc`（`:2586-2590`）内的 `env(safe-area-inset-*)` 同源映射为 `envRef`（**唯一实现**口径，见决策 #591）。

---

## 6. 落地批次

| 批次 | 内容 | 验收判据 |
|---|---|---|
| **B0 契约冻结** | 变量命名 + 语义 + 单位口径 + 优先级（§3）+ `ResolvedLength.env` 变体 + `EnvVarName` 闭集 | `check:style-ir-schema` 绿；两处白名单同步（铁律 #9）；文档与生成物一致 |
| **B1 采集层（三端宿主）** | Android（edge-to-edge + WindowInsets）/ 鸿蒙（avoidArea 三型 + 监听 + px2vp）/ iOS（safeAreaInsets + 键盘） | 三端零设备编译过；采集值写入宿主诊断日志；**真机读数与系统"开发者选项→安全区"对照** |
| **B2 传输层（ABI v2）** | `ProteusSurface` 扩字段 + `proteus_surface_changed` 语义（含"inset 变更 ⇒ 置脏 relayout"） | `check-host-abi.mjs` 跨语言对账绿；版本协商（ABI v1 宿主须**明确报错**而非静默少字段） |
| **B3 求值层** | 引擎 `EngineState.env` 表 + `envRef` 求值 + 变更置脏（一批一次） | 单测：envRef 求值 == 给定表值；**变更仅触发一次 relayout**（对齐批处理红线读数） |
| **B4 消费层** | 编译器 `--pf-*` → `envRef` + `p-safe` 接同一份表 + `useSafeArea()` | `proteus explain --style` 可 trace「该值来自 envRef → --pf-inset-top」 |
| **B5 Skyline/Web 对齐** | MP 换算（含缺 `safeArea` 降级）+ Web `env()` 判等 | 三端同一设备可比（MP/Web 与 App 逐项 ≤0.5dp） |
| **B6 CLI 宿主模板** | 生成宿主时自动写入：鸿蒙 `module.json5` 挖孔 metadata / Android edge-to-edge 调用 | `proteus create host <端>` 产物**免手工配置**即可正确避让（防"静默不生效"） |
| **B7 门禁** | `check:env-vars`（变量闭集 + 三端采集覆盖 + 真机矩阵） | 接 CI + `verify`；新增变量必须四同步 |

**依赖**：B0 →（B1 ∥ B2）→ B3 → B4 →（B5 ∥ B6）→ B7。

---

## 7. 坑清单（诚实边界 · 必读）

| # | 坑 | 后果 | 处置 |
|---|---|---|---|
| **P1** | 鸿蒙 `TYPE_SYSTEM` 底部在沉浸式下为 0 | 底部避让恒 0 ⇒ Tab 栏被手势条压住 | 必须 `+ TYPE_NAVIGATION_INDICATOR`（**加而非取其一**） |
| **P2** | 鸿蒙返回 **px 物理像素**，未 `px2vp` | 高密度机上避让大 3 倍 | 采集层出口强制转逻辑像素（三端统一出口，不在消费侧转） |
| **P3** | 鸿蒙 `TYPE_CUTOUT` **默认不生效**（无 metadata） | 挖孔区不避让且**静默** | B6：CLI 生成宿主时自动写入 metadata |
| **P4** | 小程序 `safeArea` 是绝对坐标、且**部分机型不返回** | 直接当 inset 用 ⇒ 计算错；缺失 ⇒ 崩 | 换算 + 降级到 `statusBarHeight`（+ 登记为允许差异） |
| **P5** | 隐藏系统栏时主 inset 变 0 | 沉浸式页面布局跳动 | 取 `*IgnoringVisibility` 变体 |
| **P6** | 采集时机过早（窗口未创建 / `loadContent` 回调外） | 鸿蒙报 1300002、值不稳定 | 采集时机写进宿主模板（B6），不由开发者记 |
| **P7** | 环境变量变更未触发 relayout / 触发多次 | 旋转后布局不更新，或一帧内多次 relayout | 变更置脏 + **一批一次**；判据读批处理计数 |
| **P8** | 与 `--pf-safe-*`（profile 默认）语义混淆 | 两个相近变量各端解析不同 | §3.4 写死优先级：**实测 > profile 默认 > 0** |
| **P9** | 键盘 inset 被误当布局避让 | 键盘弹起整页上移（鸿蒙 `KeyboardAvoidMode.OFFSET` 下还会**双重补偿**） | `--pf-keyboard-height` 明确"不参与布局"；键盘避让归 ③ 组件通道（`p-keyboard-accessory`），由组件消费 |
| **P10** | 厂商私有 API 的诱惑 | 崩溃 + 与内核纪律冲突 | §2.3：不实现，仅最后一级 fallback + 登记 |

---

## 8. 厂商兼容矩阵（读者最关心的那张表）

| 厂商 / 系统 | 状态栏 | 底部安全区 | 挖孔 | 结论 |
|---|---|---|---|---|
| 小米 / Redmi（MIUI / 澎湃） | `statusBars` | `navigationBars` / `systemGestures` | `displayCutout` | ✅ 官方 API，**无需** `ro.miui.notch` |
| 华为 / 荣耀（EMUI / MagicOS） | `statusBars` | `navigationBars` | `displayCutout` | ✅ 官方 API，**无需** `HwNotchSizeUtil` |
| OPPO / 一加 / realme（ColorOS） | `statusBars` | `navigationBars` | `displayCutout` | ✅ 官方 API，**无需** `ro.oppo.*` |
| vivo / iQOO（OriginOS） | `statusBars` | `navigationBars`（手势机靠 `tappableElement` 判据） | `displayCutout` | ✅ 官方 API，**无需** `FtFeature` |
| 魅族（Flyme） | `statusBars` | `navigationBars` | `displayCutout` | ✅ 官方 API，**无需** `ro.flyme.notch` |
| 三星（One UI） | `statusBars` | `navigationBars` / `gesture nav` | `displayCutout` | ✅ 官方 API |
| Android 15+（targetSdk 35） | 同上（edge-to-edge 强制） | 同上 | 同上 | ★**必须**处理 inset（否则内容被系统栏遮盖） |
| HarmonyOS / NEXT | `TYPE_SYSTEM.topRect` | `TYPE_SYSTEM.bottomRect` + `TYPE_NAVIGATION_INDICATOR` | `TYPE_CUTOUT`（需 metadata） | ✅ 官方 API |
| 折叠屏（Android） | — | — | — | `androidx.window` `FoldingFeature`（`bounds` / `orientation` / `isSeparating`）→ 喂 `--pf-fold-*` |
| 折叠屏（鸿蒙） | — | — | — | `on('avoidAreaChange')` 是折叠适配核心（折叠/展开避让区会变） |

---

## 9. 给开发者的两层 API

```vue
<!-- 低层：任意样式位置直接消费内置变量 -->
<template>
  <div class="page">
    <header class="bar">标题</header>
    <main class="content">…</main>
  </div>
</template>

<style>
/* ✅ 状态栏区域铺背景色（B 组：本体高） */
.bar {
  height: var(--pf-status-bar-height);
  background: var(--brand);
}
/* ✅ 内容避让（A 组：避让量） */
.content {
  padding-top: var(--pf-inset-top);
  padding-bottom: calc(var(--pf-inset-bottom) + 12px);
}
</style>
```

```vue
<!-- 高层：语义组件（③ 组件通道），内部按端映射，业务零平台分支 -->
<p-safe area="top">
  <p-view class="header">…</p-view>
</p-safe>
```

**反模式拦截**（并入既有 `--strict-css` / E-CSS 族）：

| 反模式 | 建议 |
|---|---|
| 裸写 `env(safe-area-inset-top)` | 用 `var(--pf-inset-top)`（否则 App 端无此通道 ⇒ 静默 0） |
| 硬编码 `padding-top: 44px` / `24px` | 用 `var(--pf-inset-top)`；**这是"刘海机对了、三键机错了"的经典来源** |
| 用 `--pf-nav-bar-height` 算底部避让 | 用 `--pf-inset-bottom`（含手势条；两者在手势机不等） |

---

## 10. 与既有方案的关系（不造第二套）

| 既有资产 | 本 plan 的处理 |
|---|---|
| `resolveSafeAreaStyle`（S2） | **保留**：它解决"Web env / MP px / 折叠屏"三路，本 plan 为它补 **App 路**（envRef → 引擎表） |
| `--pf-safe-*`（formfactor 默认值） | **不改语义**，新增 `--pf-inset-*` 承载实测值（§3.4） |
| `p-safe` 组件 | **收编**：`index.vue:3` 的 TODO「待 adapter 增 `getSafeAreaInsets` 后收编」正是本 plan 的 B4 交付 |
| `app-config.safeArea.islandGlass` | 保留（是"玻璃材质"开关，不是几何量）；几何量走内置变量 |
| HostABI | **扩字段不造第二套 SPI**；`ProteusSurface` 是既有的唯一视口几何入口 |
| G-61 StyleIR / 四同步 | `env` 变体走 INV-CE-07；一致性判据复用三层，不另起 |
| `allow-differences.json` | P4（MP 缺 `safeArea`）等**允许差异**追加到既有 6 条之后（沿用既有 schema） |

---

## 11. 证据索引

| 结论 | 证据 |
|---|---|
| 令牌只收字面值，`env()`/`calc()` 不解析 | `packages/compiler/src/vapor/template.ts:558-561` |
| `substituteCssVars` 替换逻辑 | 同上 `:592-607` |
| `calc()` 内 `env(safe-area-inset-*)` 参与折叠（唯一实现口径） | 同上 `:2582-2590` |
| Web/MP/折叠屏三路避让已落地 | `packages/fluid/src/safe-area.ts:19-79` |
| `--pf-*` 前缀既有约定 | `packages/fluid/src/formfactor.ts:647-683` |
| `p-safe` 的 TODO（待 adapter 提供 insets） | `packages/components/p-safe/index.vue:3, 34-50` |
| HostABI v1 `ProteusSurface` 字段 + 入口 | `packages/host-abi/include/proteus_host_abi.h`（①Surface / `proteus_surface_changed`） |
| HostABI 硬约束③「平台能力注入而非分支」 | 同上文件头注释 |
| IR 现值类型 | `docs/Proteus_CSS_Profile规格.md §4.5` |
| 四同步不变量 INV-CE-07 | `docs/proteus-css-engine-plan/README.md §6` |
| 允许差异清单（6 条 A-1~A-6） | `docs/allow-differences.json` |

**外部依据**：Android 15 行为变更（edge-to-edge 强制 / inset 相关 API 废弃）· Android `WindowInsets` 类型表（官方 insets 文档）· 华为开发者论坛 `AvoidAreaType` 值表与 `TYPE_NAVIGATION_INDICATOR` 新增原因 · 鸿蒙挖孔 `metadata avoid_cutout` 配置要求 · 微信 `wx.getWindowInfo()` 官方文档（2.20.1+，`safeArea` 部分机型不返回）· uni-app `getWindowInfo` 的 `safeAreaInsets` / `cutoutArea` 扩展（对照参考，非本框架依赖）。

---

## 12. 待裁定

1. 变量前缀是否就用 `--pf-*`（`formfactor.ts` 已用）——或另立 `--pt-*` 保留给跨端通用变量？（**建议 `--pf-*`**，避免第二套前缀）
2. ABI 走 `ProteusSurface` 扩展（v2）——还是先以 `device.env` capability 落地、后续再升 ABI？（**建议前者**，insets 与 viewport 同源）
3. `--pf-keyboard-height` 是否纳入 v1（**建议纳入但标记"不参与布局"**，否则"贴键盘"场景无标准答案）
4. iOS 是否一并做（**建议一并**：三端不齐会重蹈"以别批次未落地为由跳过端"的红线）
