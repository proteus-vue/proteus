# Proteus 高频原生能力组件方案

> 代号 **Hephaestus**（火神/工匠之神）——为开发者锻造开箱即用的原生能力组件
> 备选：Talos（青铜自动机/守护者）。**定名前须做正式商标与包名检索。**
> 版本 v1 · 关联：Janus（原生资产复用）、VC1-d（能力支持度矩阵）、Morpheus、SC（滚动编排）
> **入库**：2026-10-03（决策 #467；不占 G 序，登记于 `board-inventory.md`「其他文档」）
> **★★验收标准（用户 2026-10-03 明示）**：本方案的验收 = **超级应用标准**，**不是传统跨端框架的 demo 级**。
>   含义落到可执行层面：① 每个组件都要有**真机矩阵**（多品牌/多版本，不是模拟器跑通）② 静默失败项**必须有单测**
>   （不得靠现象发现）③ 支持度矩阵**必须含"是否需打原生基座"列**（这是与 uni-app 的分水岭指标）
>   ④ `unsupported` 编译期报错（禁静默空白）⑤ 允许差异**显式登记**（不得当 bug 修、也不得视而不见）。

---

## 0.0 ★入库对账（2026-10-03：三处发现 + 一处规模修正）

**① ★★§5 清单与**本仓既有资产**存在大量重叠——必须先盘存量，否则重复建设**

对账方法：逐项查 `@proteus-vue/component-ir` 的 `PRIMITIVE_CATALOG` + `packages/components/p-*` 目录
（取证命令：按语义键 grep + 按组件目录名 ls）。结果（20 项中的**已有**部分）：

| 清单项 | 本仓既有形态 | 状态 |
|---|---|---|
| 地图 | `U26 ui.map` = `p-map` + `C4 useMap()` | ✅ 组件+Hook 双形态 |
| 定位 | `C3 capability.location` = `p-location` | ✅ Hook（组件为入口壳） |
| 相机/相册 | `U25 ui.camera` = `p-camera` + `C1 capability.camera` = `p-pick-photo` + `C52 album` | ✅ 完整 |
| 扫码 | `p-scan-qr`（能力入口组件） | ✅ 组件形态 |
| 剪贴板 | `C9 useClipboard()` | ✅ Hook |
| 网络状态 | `C8 useNetwork()` + `p-network-status`（desktop 家族） | ✅ Hook+组件 |
| 分享 | `C18 useShare()` | ✅ Hook |
| 推送/通知 | `C17 useNotification()` | ✅ Hook（不含厂商通道） |
| 后台音频 | `C62 capability.audio` = `p-media` | ✅ 部分（不含 UIBackgroundModes 声明） |
| 键盘避让 | `S15 shell.keyboard-accessory` = `p-keyboard-accessory` | ✅ 组件 |
| 状态栏/安全区 | `p-safe`（`PSafe`）+ `Fluid System` 安全区避让 | ✅ 组件（**但"状态栏样式控制"未覆盖**） |
| 生物识别 | `C38 capability.biometric has()` 已有**能力探测** | 🟡 有探测，**无交互流程**（enroll/verify/错误码归一） |

**⇒ 结论（写进任务卡纪律）**：**本方案不是 20 个组件的从零建设**——它是
「**存量能力组件的"超级应用级"补齐 + 缺口项新增**」。逐卡领取时必须先跑存量对账：
**已有且达标的卡直接标"已具备（引既有实现）"，不得重写**（重写 = 制造两套实现，本仓已为这类
分叉付过代价）。真正的新增集中在：**画中画 / 支付 / 蓝牙 / 文件系统 / 传感器 / 屏幕常亮 /
深链 / 应用内评价**（8 项），以及**存量项的"基座零依赖 + 支持度矩阵 + 真机矩阵"补齐**。

**② 引用的既有设施均已存在（核对通过，非虚构）**
· `VC5-d 允许差异清单` = `docs/allow-differences.json`（**6 条** A-1~A-6，schema 门禁随
  `check:consistency-metrics`）⇒ §6.4 的四条应**追加**为 A-7~A-10（沿用既有 schema，不另起）
· `L1 编译期静态校验` = `docs/generated/end-support-matrix.json` + `check:end-support`
  （28 字段 × 3 端实测登记 + 防漂移）⇒ §6.1 的 `@support` 矩阵应**并入**该体系（不另起 schema）
· 《可停靠滚动容器与滚动编排能力方案》存在（SC 引用有效）
· `Janus` 方案（原生资产复用）已入库（决策 #466）——本方案 §3.3 的分工表与之一致

**③ 规模/口径修正**：§7.1 拟对外讲"我们的 **20 个**高频原生组件，**0 个**需要打自定义基座"——
按 ① 的盘存量结果，该句**今天不成立**（20 项里 8 项尚无实现）⇒ 改为**分期口径**：
对外只能说"**已交付的那批**，0 个需要打自定义基座"，并在 HP7 对照表里**逐项标注交付状态**
（数字不粉饰——与官网专项铁律同条）。★另：本方案承诺"一行声明"的价值主张，
其成立前提是 **HP0 的真机实测**（§1.2 语义分裂 + §4.x 七条硬约束）——**不得在 HP0 前对外使用**。

---

## §0 一句话定位

> **把"每个 App 都要写一遍、与业务无关、各端实现完全不同"的原生能力胶水代码，
> 固化成框架内置组件，让开发者只写业务意图。**

---

## §1 两个层次的判断（横向重复 / 纵向差异）

> **澄清**：本文所说"实现都一样"，指的是**同一平台、不同项目**之间——画中画的胶水代码
> 在每个 App 里都是同一套、与业务无关、逐字重复。这是**框架必须内置的判据**。
> 而**跨平台**之间实现并不同（甚至存在语义分裂），那是**框架内部一次性承担**的事，
> 不该让每个项目重复承担。

### 1.1 横向（项目间）：你的判断完全成立

| | 说明 |
|---|---|
| **同一平台、不同项目，胶水代码逐字重复** | ✅ **成立**——这是"框架该内置"的判据 |
| 与业务无关 | ✅ 成立——所有视频 App 的 PiP 接入代码长得一模一样 |
| 每个项目都要写一遍 | ✅ 成立——且写完还要各自踩一遍同样的坑 |

**这才是本方案的第一性理由**：重复的不是"能力"，是**每个项目都要重交一遍的学费**。

### 1.2 纵向（端到端）：实现并不一样，且存在语义分裂

跨端差异**不改变**"必须内置"的结论，但决定了**对外的 API 形状必须是单一的**——
端差异由框架一次性吸收在内部，不上浮给开发者。

| | 判断 |
|---|---|
| 跨端实现一样 | ❌ **不成立**——五端差异极大，且有根本性语义分裂 |
| 对外 API 必须单一 | ✅ **必须**——否则开发者又要写分端分支，等于没解决 |

### 1.3 ★ 最关键的发现：Android 与 iOS 的 PiP 语义是分裂的

这不是参数差异，是**模型差异**：

| | 进入 PiP 的是什么 |
|---|---|
| **Android** | **整个 Activity 缩小**（`Activity.enterPictureInPictureMode`） |
| **iOS** | **只有播放器内容进 PiP**，ViewController 仍留在屏幕上 |

第三方 SDK 官方文档原话（THEOplayer，权威性较高）：

> "iOS moves the player into PiP, **while keeping the ViewController on the screen**.
> Android moves **the whole Activity** into PiP.
> Aligning these will be investigated in the next iterations."

**同一个"进小窗"，一端动的是窗、一端动的是内容。**

这是本方案**存在的根本理由**——如果实现真的一样，那只需要一个薄封装就够了。

### 1.3 五端能力矩阵（画中画）

| 端 | API | 版本门槛 | 自动进入 | 关键约束 |
|---|---|---|---|---|
| **Android** | `PictureInPictureParams` | **API 26+** | `setAutoEnterEnabled`（**API 31+**） | 宽高比必须 ∈ [2.39:1, 1:2.39]；manifest 需 `supportsPictureInPicture`；PiP 时 Activity 为 paused **但不得暂停播放**；**窗口不接收触摸事件**，须走 `MediaSession.setCallback()`；仅顶层 Activity 进入 |
| **iOS** | `AVPictureInPictureController` | 播放 **iOS 9+**；视频通话 **iOS 15+** | `canStartPictureInPictureAutomaticallyFromInline` | **必须强引用**（弱引用会静默 dealloc，调用无反应且无回调）；音频 session 必须 `.playback`/`.playAndRecord`；**必须实现 `restoreUserInterface`**；PiP 窗口**只能渲染一个视频层** |
| **鸿蒙** | `@ohos.PiPWindow` | **API 11+** | `setAutoStartEnabled(true)` | 需 `SystemCapability.Window.SessionManager`；**后台不得调 `startPiP`**，须用 `setAutoStartEnabled`；XComponent 的 type 必须 `SURFACE`；用 Navigation 时**必须设置 id 并传给控制器**；**HarmonyOS 6.0 前仅 Phone/Tablet** |
| **Web** | `requestPictureInPicture()` | Chrome 70+ / Safari 13.1+ | ❌ **不支持** | **需瞬态用户激活**；Firefox 桌面仅预览（153）、**Firefox Android 不支持**、**Android WebView 不支持**；同一时刻仅一个 PiP 窗口；退出用 `document.exitPictureInPicture()`（**不是 video 上的方法**） |
| **小程序** | `video` 组件 `picture-in-picture-mode` | 基础库 **2.11.0+** | push / pop 路由触发 | 缺 `enable-play-gesture` 等前置属性会**静默拒绝**（仅日志 `pip: context not ready`）；**必须处于 playing 状态**；Android 需"显示在其他应用上层"权限；iOS 需系统画中画开关开启；**鸿蒙 OS 部分事件暂不支持** |

### 1.4 补充：Web 端还有**第二套** PiP API

**Document PiP**（Chrome 116+，另一套 API）：可把任意 DOM 渲染进可分离的浮窗。

- 与 Video PiP **是两个 API、两件事**
- Firefox 151+ 桌面已支持；Safari 与移动端仍缺失
- 需要 `createPortal(node, pipWindow.document.body)` + **手动复制样式表**

**所以 Web 端一个"画中画"要处理两套 API + 兼容性探测。**

---

## §2 痛点证据：这确实是无人解决的公开痛点

### 2.1 uni-app：**官方承认不支持，只能靠插件**

DCloud 官方问答（权威性中等）原话：

> "在 uni-app 中，原生 App（Android 和 iOS）的 video 组件**默认不支持小窗/画中画功能**。"

于是插件市场诞生了一批画中画插件——而它们本身就在证明痛点：

| 插件 | 平台支持 | 说明 |
|---|---|---|
| `my-floatwindow` | **仅 Android** | 基于 `WindowManager + TYPE_APPLICATION_OVERLAY` |
| `wrs-uts-videoplayer` | Android / iOS / 鸿蒙 | **微信小程序不支持** |
| `kux-pip` | uni-app / uni-app x | 🔴 **"需要打包自定义基座方可正常使用"** |
| `Ba-VideoPip` | App 端 | 需 `requireNativePlugin` |

**"需要打包自定义基座"这七个字是全部痛点的浓缩**——它正是 Janus 方案里论证的**动态化断裂**：改一个画中画参数，就要重打基座、重新发版。

而插件平台支持残缺（只支持一端）意味着：**开发者要为每个端找不同插件、学不同 API、处理不同降级**。

### 2.2 Flutter：**框架自身限制导致能力缺失**

Flutter `pip` 插件源码注释（权威性较高）原文：

```java
@ChecksSdkIntAtLeast(api = Build.VERSION_CODES.S)
public boolean isAutoEnterSupported() {
    // We could support this on Android 12+, but Flutter limitations prevent it
    return false;
}
```

并注明："Flutter **不正确地委托 Android 生命周期事件**，如 `onPause` 和 `onPiPModeChanged`。"

**这是框架架构缺陷直接导致能力不可用**——不是插件写得不好，是 Flutter 自绘 + 单 Activity 模型拿不到这些生命周期。

另外 Flutter 生态里大量画中画插件**仅支持 Android**（`floating`、`simple_pip_mode`、`pip_flutter`）。

### 2.3 rome 一句话总结

> **同一个"画中画"，uni-app 要装插件 + 打基座，Flutter 要认栽关掉自动进入，
> 而我们只要一行声明。**

---

## §3 分层设计

### 3.1 四层

```
L3  声明层    <pip> / <map> / <biometric> ...     开发者只碰这层
L2  语义层    start/stop/autoEnter/restore/state   跨端统一语义
L1  适配层    五端各自实现（Rust 宿主 / 平台代码）
L0  探测层    isSupported / isEnabled / 权限状态
```

### 3.2 ★ L2 是核心：定义跨端统一语义

必须定义的五件事：

| 语义 | 要解决的问题 |
|---|---|
| **enter** | Android 动 Activity、iOS 动内容——对外必须是一个动作 |
| **exit** | Web 用 `document.exitPictureInPicture()`，其他各异 |
| **autoEnter** | 四端触发条件完全不同（Home 键 / 内联 / 后台 / 路由 push-pop / Web 不支持） |
| **restore** | iOS 必须实现否则用户回到错页面；其他端无此概念 |
| **state** | 五端事件名与时机全不同，需归一为 `idle/starting/active/stopping/error` |

**Android 与 iOS 的语义分裂必须由 L2 吸收，不能上浮到 L3。**

### 3.3 与 Janus 的分工

| | Janus | Hephaestus |
|---|---|---|
| 对象 | **业务方自己的原生资产**（自研 SDK、历史模块） | **系统/通用的高频能力** |
| 谁写实现 | 业务方（我们给契约与 codegen） | **我们写**（一次性，内置） |
| 典型 | 公司内部的支付 SDK | 画中画、地图、扫码、生物识别 |

> **规则：能用 Hephaestus 内置组件的，不要让业务方用 Janus 自己桥一遍。**

---

## §4 硬约束（组件设计必须遵守）

### 4.1 🔴 用户手势约束——Apple 审核红线

Apple 官方文档（权威性极高）原文：

> "**Only begin PiP playback in response to user interaction and never programmatically.**
> The App Store review team rejects apps that fail to follow this requirement."

**所以 `<pip>` 组件必须：**
- 提供 `autoEnter` 声明（后台/返回时自动进入，这是系统级行为，合规）
- **禁止暴露"程序化立即进入"的裸调用**——或至少在 iOS 端编译期警告

这条特别重要，因为**它是唯一一个"框架不拦就会上架被拒"的约束**。

### 4.2 强引用约束（iOS）

`AVPictureInPictureController` 若为局部变量或 weak property 会**静默释放**：

> 症状：`startPictureInPicture()` 什么都不做，delegate 回调全不触发。

**组件实现必须持有强引用，且这条要写进单测**——静默失败无法靠现象定位。

### 4.3 音频会话约束（iOS）

`.ambient` / `.soloAmbient` 会导致 **PiP 静音**。必须按场景配置：
- 点播 → `.playback`
- 通话 → `.playAndRecord` + mode `.videoChat`

**这是配置遗漏型的静默失败**：不报错，就是没声音。

### 4.4 restore 约束（iOS）

不实现 `pictureInPictureController(_:restoreUserInterfaceForPictureInPictureStopWithCompletionHandler:)` 会导致：

> **用户点"返回 App"时停留在错误页面。**

官方原话："Symptom that looks harmless in QA, embarrassing in the App Store reviews."

**框架必须内建默认 restore 行为**（回到触发 PiP 的页面），不允许开发者忽略。

### 4.5 后台启动约束（鸿蒙）

华为官方文档原文：

> "For security purposes, **do not start a PiP window by calling the `startPiP` API when the application is running in the background**. Instead, call the `setAutoStartEnabled(true)` API."

**即"自动进入"在鸿蒙不是用 start 实现的，是用开关实现的**——适配层必须区分，不能统一调 start。

### 4.6 生命周期约束（Android）

> Activity 进入 PiP 时是 **paused 状态但应继续播放**。
> 官方明确：**不得在 `onPause()` 暂停播放**，应在 `onStop()` 暂停、`onStart()` 恢复。

这是最容易踩的坑——常规写法在 `onPause` 暂停，一进 PiP 就黑屏。

### 4.7 宽高比约束（Android）

```
setAspectRatio:        必须 ∈ [2.39:1, 1:2.39]
setExpandedAspectRatio: 必须 ∉ [2.39:1, 1:2.39]   ← 互补区间
```

**写反了会被系统忽略（静默）**。编译期应校验参数区间。

另外 action 数量会被 `getMaxNumPictureInPictureActions()` **静默截断**——组件应暴露上限并给警告。

---

## §5 高频原生能力组件清单（不止画中画）

按"每个 App 都要写、与业务无关、各端实现不同"三条标准筛选：

| # | 组件 | 典型跨端差异 |
|---|---|---|
| 1 | **画中画 PiP** | 见 §1（语义分裂最严重） |
| 2 | **地图** | Android/iOS 原生 SDK vs 小程序 `map` 组件 vs Web 三家 SDK |
| 3 | **支付** | 微信/支付宝，App 端 SDK vs 小程序 API vs Web 跳转 |
| 4 | **推送** | 厂商通道（小米/华为/OPPO…）vs APNs vs 小程序订阅消息 |
| 5 | **扫码** | 相机权限 + 各端 SDK，`camera` 小程序是原生组件（层级最高） |
| 6 | **生物识别** | Face ID / 指纹 / 鸿蒙生物认证，API 与错误码各异 |
| 7 | **定位** | 权限模型完全不同，Android 前后台权限分离 |
| 8 | **蓝牙** | 权限模型与 API 差异极大，小程序仅支持 BLE |
| 9 | **相机/相册** | 权限 + 裁剪 + EXIF 方向，各端不一致 |
| 10 | **文件系统** | 沙箱路径、临时目录、持久化机制各异 |
| 11 | **分享** | 系统分享面板 vs 小程序转发 vs Web Web Share API |
| 12 | **后台音频** | iOS 需 UIBackgroundModes，Android 需前台服务 |
| 13 | **传感器** | 陀螺仪/加速度，采样率与坐标系各异 |
| 14 | **剪贴板** | 权限与格式差异 |
| 15 | **网络状态** | 监听机制各异 |
| 16 | **状态栏/安全区** | 刘海/挖孔/手势条，各端获取方式不同 |
| 17 | **屏幕常亮** | 各端 flag 不同 |
| 18 | **深链 / Universal Link** | 完全不同的配置体系 |
| 19 | **应用内评价** | iOS SKStoreReviewController vs Android In-App Review |
| 20 | **键盘避让** | 各端行为不一致（经典痛点） |

### 5.1 分批策略

```
第一批（P0）：画中画、扫码、定位、生物识别、状态栏/安全区
第二批（P1）：地图、支付、推送、相机/相册、后台音频
第三批（P2）：其余
```

**画中画排第一**——它的语义分裂最严重，最能验证 L2 层设计是否成立。**它过了，其余都是同构工作量。**

---

## §6 与已有设施的对接

### 6.1 接 VC1-d（原生能力支持度矩阵）

每个组件必须产出 `@support` 矩阵：

```
端 × 版本门槛 × 权限要求 × 是否需原生基座
```

**关键：矩阵必须包含"是否需要打原生基座"这一列**——这是区分我们与 uni-app 的核心指标。

> 对外可讲：**"我们的 20 个高频原生组件，0 个需要打自定义基座。"**

### 6.2 接 L1 编译期静态校验

```vue
<requires os="android" min-api="26" />   <!-- 低于则编译期报错或降级 -->
```

`unsupported` **一律编译期报错**，禁止运行时变空白（与层级规范同原则）。

### 6.3 接 Janus §5.3

**组件不得引入运行时查表**——所有能力判定在编译期完成，否则 conformance 与 AI 可校验失效。

### 6.4 接 VC5-d（允许差异清单）

以下差异**是设计使然，必须显式登记，不得当 bug 修**：

| 差异 | 原因 |
|---|---|
| Android 进 PiP 时**整个页面缩小** vs iOS **仅内容缩小** | 系统模型不同，**无法也不应统一** |
| Web/Android WebView **无自动进入** | 平台限制 |
| 鸿蒙 6.0 前**不支持 PC/2in1** | 系统能力限制 |
| 小程序 PiP **由路由触发**而非系统手势 | 宿主模型不同 |

**特别强调第一条**：若有人试图"让 Android 也只缩小内容"，那要绕开系统 PiP 自绘悬浮窗——**会撞上 Android SAW 禁令**（官方明确：不要用 system alert window 实现 PiP）。

---

## §7 对外表述边界

### 7.1 ✅ 可以说

- "高频原生能力开箱即用，**零胶水代码**"
- "**0 个组件需要打自定义基座**"（对照 uni-app 插件生态）
- "我们吸收了 Android 与 iOS 的 PiP 语义分裂，开发者只写一个 `enter`"

### 7.2 ❌ 不能说

| 禁语 | 原因 |
|---|---|
| "我们的 PiP 比原生更好" | iOS/Android 原生是系统级实现，手感最优 |
| "所有端行为完全一致" | §6.4 差异是设计使然 |
| "我们支持所有原生能力" | C-API 是子集（见鸿蒙方案）；Web 端能力天然受限 |
| "自动进入全端一致" | Web 端根本不支持 |

### 7.3 推荐落点

> **"uni-app 要装插件 + 打基座，Flutter 因为拿不到生命周期只能关掉自动进入，
> 而我们是一行声明。"**

这句话的三个分句**都有出处**，可直接对外。

---

## §8 里程碑

| ID | 内容 | 估时 | 依赖 |
|---|---|---|---|
| **HP0** | 五端 PiP 实测（含 Android/iOS 语义分裂验证、鸿蒙后台约束、Web Document PiP） | 1.5 人周 | — |
| **HP1** | L2 语义层定义（enter/exit/autoEnter/restore/state 五件事） | 1 人周 | HP0 |
| **HP2** | `<pip>` 五端实现（Web/Android/iOS/鸿蒙/小程序） | 2.5 人周 | HP1 |
| **HP3** | 硬约束静态检查（用户手势 / 强引用 / 音频会话 / restore / 宽高比区间） | 1 人周 | HP1 |
| **HP4** | `@support` 矩阵接入 VC1-d + L1 编译期校验 | 1 人周 | VC1-d |
| **HP5** | P0 其余四个组件（扫码/定位/生物识别/安全区） | 2.5 人周 | HP1 |
| **HP6** | 允许差异清单登记（§6.4 四条） | 0.5 人周 | HP0 |
| **HP7** | 对外对照表（uni-app / Flutter / 三方 SDK 三栏） | 0.5 人周 | HP2 |

**合计约 10.5 人周**（P0 批次）

### 8.1 顺序要求

- **HP0 必须先做**，且不可压缩——它是 §1.2 语义分裂的唯一实证来源
- **HP3 与 HP2 可并行**，但 HP3 的 iOS 强引用检查必须在 HP2 完成前落地
- **HP5 排在鸿蒙宿主主线 HM0–HM2 之后**（鸿蒙地基不稳则组件无法验证）

---

## §9 待核实项

| # | 内容 | 影响 |
|---|---|---|
| 1 | 鸿蒙 C-API 是否有 PiPWindow 对应接口（还是必须走 ArkTS） | 决定鸿蒙端能否进 C-API 指令流 |
| 2 | 小程序 Skyline 下 PiP 支持情况（官方仅描述 WebView 渲染） | 决定小程序端形态 |
| 3 | 鸿蒙 OS 下小程序 video 的 PiP 事件缺失范围（官方仅说"暂不支持"部分事件） | 影响鸿蒙小程序降级策略 |
| 4 | Android ROM 定制是否会禁用 `FEATURE_PICTURE_IN_PICTURE` | 影响真机矩阵设计 |
| 5 | iOS 26 下 `AVPictureInPictureController` 行为是否变更 | 已在 iOS 26 实测过一次，需专项验证 |

---

## §10 执行指令（分发给 LLM 实现时）

1. **先做 HP0**，不得跳过。§1.2 的语义分裂必须有真机实证，不得基于文档推断。
2. `<pip>` 的 L2 层必须显式处理 Android/iOS 语义分裂，**不得向上泄漏**。
3. iOS 强引用、音频会话、restore 三项**必须写单测**——它们全是静默失败。
4. **禁止暴露"程序化立即进入 PiP"的裸调用**（Apple 审核红线）。
5. 鸿蒙端**后台不得调 `startPiP`**，必须用 `setAutoStartEnabled(true)`。
6. Android 端**不得在 `onPause` 暂停播放**。
7. 宽高比参数**编译期校验区间**（普通与 expanded 是互补区间，不能写反）。
8. Action 数量超过上限**给警告**，不得静默截断。
9. 每个组件产出 `@support` 矩阵，写入 VC1-d，**必须含"是否需打原生基座"列**。
10. `unsupported` 编译期报错，禁止静默空白。
11. 组件**不得引入运行时查表**。
12. §6.4 四条差异登记进 VC5-d，**不得当 bug 修**。
13. **不得为了让 Android 与 iOS 行为一致而自绘悬浮窗**（撞 SAW 禁令）。
14. 对外材料禁用 §7.2 四条禁语。
15. 所有第三方 API 能力声明**以官方文档为准**，不得凭常识推断。

---

## §11 命名说明

**Hephaestus**：希腊火神与工匠之神，为众神锻造器物——对应"为开发者锻造开箱即用的原生能力组件"。

**备选 Talos**：青铜自动机，自动执行守护任务——对应"自动化处理各端差异"。

两者均需做正式商标与包名检索（`@proteus-vue/hephaestus` 等）。
