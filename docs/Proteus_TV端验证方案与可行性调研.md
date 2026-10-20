# TV 端可行性调研：用电视盒子验证框架原语

> 日期：2026-10-20 · 触发：用户提出「用框架做个电视盒子软件，验证原语是否真能跑，且 TV 是与其他跨端框架的最大差异点」
> 取证范围：`packages/fluid`（形态画像/焦点）、`packages/components/p-formfactor`、`packages/cli/templates-host`（三端宿主）、`hosts/android`（runtime AAR）
> 原则：只写仓库里能查到的事实；跨框架对照标注来源。

---

## 0. 结论

**值得做，但定位要改：不是「做个电视盒子软件」，而是「打通一条 TV 焦点链的 spike」。**

三句话：

1. **TV 确实是本仓最有辨识度的验证场**——不是因为它「能跑」，而是因为它把**输入模型**换掉了
   （touch → remote）。手机端 demo 证明不了「一套语义适配不同形态」，因为所有框架都能跑手机；
   TV 才能证伪「形态驱动」是不是真的。
2. **但「其他框架没有 TV 方案」这个判断要修正**：react-native-tvos 是 Amazon 在推的成熟 fork
   （Android TV + tvOS，Hermes，TV 专有 focus/remote 组件），Flutter 能跑 Android TV 且有 Focus 系统，
   Web 系还有 Lightning / Enact 这类 TV 专用框架。**真正的差异点不是「支持 TV」，而是「焦点是框架原语、
   由形态画像推导」**——RN 的 TV 能力是 fork 里的平台专有组件，Flutter 的 Focus 与布局/滚动解耦要手工接，
   Web TV 框架只覆盖 Web。这一点我们已经有半成品（见 §2），值得押。
3. **TV 不能验证昨天讨论的「线程引擎」**（TV 不会多给一个线程），但它是**「执行原语（时间片/取消）」的最佳压力场景**：
   遥控长按重复 10+ 次/秒、无触摸反馈掩盖卡顿、盒子只有 1.5–2GB 内存。

**建议的最小验证范围（S1）**：四个方向键 → 焦点移动 → 焦点环 → 确认键触发 → 焦点行横向滚动跟随。
一条链打通即可判定「TV 原语成立」，不做播放器/DRM/EPG。

---

## 1. 先修正前提：跨框架的 TV 现状

| 方案 | TV 支持形态 | 焦点/遥控怎么做 | 局限 |
|---|---|---|---|
| **react-native-tvos**（Amazon 推） | RN 全量 fork，Android TV + tvOS | `TVFocusGuideView` / `useTVRemoteHandler` / `TVEventHandler`，TV 专有组件 | 必须整体替换 `react-native`（不能与官方包共存）；TV 能力是 fork 的平台专有面，不是「形态推导」 |
| **Flutter** | 可跑 Android TV（普通 APK + leanback 入口） | 框架内置 `Focus`/`FocusTraversal`，但滚动跟随/焦点环要自己接；社区反馈焦点管理不如 RN TV 成熟 | 无 tvOS；电视端依赖社区经验 |
| **Compose for TV**（`androidx.tv`） | Android TV 官方 | 官方 focus/leanback 组件 | 只管 Android，不是跨端 |
| **Lightning / Enact（Web TV）** | Tizen/webOS/Android TV 浏览器 | TV 组件库自带焦点环/走马灯 | 只覆盖 Web 运行时，非原生 |
| **uni-app / Taro** | 无官方 TV 形态 | 需自写 key 处理 | 无形态模型 |

> 来源：Fora Soft《Smart TV App Development in 2026》（默认选型 RN TV；Flutter TV focus 较不成熟）、
> react-native-tvos 项目说明（fork 边界 / Android API 24 / Hermes）、Amazon Fire TV 开发路径（Android / HTML5 / RN）。

**所以「完美方案」不存在，但「成熟方案」存在**。我们要抢的不是「支持 TV」，而是：
**同一份 Vue 语义 → 形态画像推出 remote 输入 + focus 模型 + 10ft 度量 → 三端（Android TV / tvOS / Harmony TV / Web）同一套焦点语义**。
这件事目前没有框架在做（RN 是平台专有组件，Flutter 是通用 Focus 不认形态）。

---

## 2. 本仓现状：声明面已经很完整，执行面在 App 端为零

### 2.1 已经有的（比我预期多）

| 资产 | 位置 | 状态 |
|---|---|---|
| **TV 作为一等形态** | `packages/fluid/src/formfactor.ts:491-511` | `form:'tv'`、`input:'remote'`、`topology:'hero-focus-row'`、`nav:'focus-row'`、`safe:{side:96,bottom:54}`（overscan）、`distance:'10ft'`、暗色视觉、`focus:'ring'`、`baseFont:18`、caps `dpad/focusRows/multiCol` |
| **几何焦点算法** | `packages/fluid/src/focus-nav.ts:50` `navigateFocus()` + `clampOrWrap()` | 纯函数：只吃矩形 + 方向 → 下一个焦点；同行/同列优先、交叉轴加权、首焦点定位 |
| **组件层真的接上了** | `packages/components/p-formfactor/index.vue:301-448` | `keydown` → 方向映射 → `navigateFocus` → `focus()`；`has-dpad` 热区放大；`:focus-visible` 焦点环；`hero-focus-row` 拓扑 CSS；`--pf-safe-side/bottom` 消费 overscan；`--pf-focus-ring` 消费 `visual.focus` |
| **形态容器进 IR** | `packages/component-ir/src/primitives.ts:59`（L26 `layout.formfactor`，`status:'implemented'`） | Web 侧可用 |

这说明：**「TV 焦点」不是从零设计，而是把已有的三块（画像 / 算法 / 容器）从 DOM 层抬到渲染无关层。**

### 2.2 缺的（App 端整条链为零）

| 缺口 | 证据 | 影响 |
|---|---|---|
| **宿主没有任何按键入口** | 全仓 `onKeyDown` / `dispatchKeyEvent` / `KEYCODE_DPAD` **零命中**（仅小程序 spec 与 `mp-spec-coverage` 提及 `onKeyDown` 映射）；Android 输入只有 `dispatchTouchEvent`（`VaporRenderHost.java:1147+`） | 遥控器按下去，App 收不到 |
| **App CSS 无 `:focus-visible`** | `docs/generated/css-capability-sources/app-profile-features.json` 只有 `selector-pseudo-state-active`；无 `focus` | 焦点环不能靠 CSS，要渲染器画 |
| **App CSS 无 `@container`** | 同上（能力清单无 container-query）；`p-formfactor` 用了 `@container (max-width: 559px)`（`index.vue:1093`） | TV 拓扑的窄帧收紧要降级 |
| **布局内核无焦点概念** | `packages/layout-core-rust/src` 无 `formfactor`/`focus` | 焦点必须靠「内核 rect + 纯函数」在上层算（可行，见 §4） |
| **清单不是 TV 应用** | `packages/cli/templates-host/android/AndroidManifest.xml` 只有 `CATEGORY_LAUNCHER`，无 `LEANBACK_LAUNCHER` / `banner` / `touchscreen required=false` | 电视桌面**不显示**图标（`adb` 可启动；上架需补） |
| **只有 arm64** | `hosts/android/build-runtime-aar.sh:36-49` 仅 `aarch64-linux-android` | 32 位廉价盒子装不了 |
| **`useVideo` 在 App 未实现** | `primitives.ts:236` C61 `status:'planned'`；`capability.ts:862` 只有 wx/web 桥 | TV 演示不能用视频，只能用图片/首帧 |

---

## 3. TV 到底能验证哪些原语（矩阵）

| 原语 | 验证强度 | 理由 |
|---|---|---|
| **布局内核 + 10ft 度量** | ★★★ | 1920×1080、overscan 96/54、baseFont 18 → 直接压 Rust layout 的 px/pt 语义与安全区 |
| **原生自绘渲染** | ★★★ | 盒子没有 WebView 兜底，渲染后端必须真跑 |
| **焦点导航** | ★★★（唯一强场景） | 触摸端可以「假装」焦点不存在；TV 没有焦点就完全不可用 |
| **遥控输入（key 事件）** | ★★★（唯一强场景） | 全仓零实现的空白区，正好验证 Host ABI 的事件通道是否通用 |
| **执行原语 / 时间片** | ★★★ | 长按重复 10+ 次/秒 + 低端 CPU + 无触摸反馈掩盖卡顿；昨天讨论的 `postTask/yield/cancel` 在这里立刻见真章 |
| **内存治理（G-43）** | ★★★ | 1.5–2GB 盒子 + 常驻前台，泄漏最容易暴露 |
| **生命周期（G-39）** | ★★ | TV 的 Home/待机/恢复与手机不同（Back 不能杀进程、Home 要 2s 内退出并存状态） |
| **能力诚实降级** | ★★ | 无相机/无定位/无触摸 → `capabilities` 是否如实上报 |
| **触摸手势 / 多指 / 惯性** | ✗ | TV 不适用 |
| **表单 / 软键盘** | ✗（弱） | TV 输入走扫码/语音，软键盘是反模式 |
| **线程 / 多线程** | ✗ | TV 不多给线程；**不能**用它验证「线程引擎」 |

**关键判断**：TV 是「焦点 + 输入 + 时间片」的试金石，不是「线程」的试金石。如果目标是验证昨天那套调度原语，
TV 场景反而更能说明「为什么要先做执行原语」——因为 TV 上没有任何触摸反馈可以掩盖一次 80ms 的主线程阻塞。

---

## 4. 技术路径：焦点原语怎么抬到渲染无关层（这是差异化的核心）

现有 `navigateFocus` 的输入是**矩形**，不依赖 DOM——这决定了它可以跨端：

```
内核布局（Rust）──rects──▶ 焦点引擎（纯函数）──focusId──▶ 渲染器（画焦点环）
      ▲                         ▲
      │                         │
   key 事件（宿主）──────────────┘
```

三步：

1. **输入归一**：宿主把 `KEYCODE_DPAD_UP/DOWN/LEFT/RIGHT/CENTER/BACK`（19/20/21/22/23/4）归一成
   `{ type:'key', key:'up'|'down'|'left'|'right'|'confirm'|'back', repeat:boolean }`，走已有的 capability 事件通道；
2. **焦点引擎**：复用 `navigateFocus`，候选矩形来自内核（Android 已有 `readRects`/`element_rect`，
   iOS/鸿蒙同契约），**不依赖 CSS 选择器与 DOM**；
3. **视觉**：App 无 `:focus-visible`，焦点环由渲染器按 `focusId` 画（内核加一个 focus overlay 节点，
   或 renderer 在绘制时对目标节点描边）——这也是「焦点是一等原语」的物理证据。

**滚动跟随（ensureVisible）**是这条链的第三块，必须一起做，否则「焦点跑到屏幕外」比没有焦点更糟。
内核已有 `setScroll`/`getScroll`，缺的是「焦点矩形 → 目标滚动偏移」的语义。

---

## 5. 建议的分阶段验证（每阶段都有机器判据）

### S1 · 一条链（最小可判定，优先做）

**范围**：宿主 key 通道 + `useKey`/remote 事件 + 焦点移动 + 焦点环 + 确认触发 + 焦点行滚动跟随。
不做：播放器、DRM、EPG、leanback 上架、多语言。

**判据（全部可机测，adb 注入，不靠肉眼）**：

| # | 判据 | 量具 |
|---|---|---|
| 1 | `adb shell input keyevent 22` ×N 后，焦点节点 id 按几何顺序变化 | JS 侧 focus 日志 + `element_rect` |
| 2 | 焦点环截图位置与 `element_rect` 一致（±2px） | 截图 + rect 对比脚本（沿用 css-conformance 的做法） |
| 3 | 连按 60 次后焦点仍在可视区（滚动跟随生效） | 焦点 rect vs 容器 rect |
| 4 | 长按重复 10 次/秒时帧间隔 P95 <20ms，最长任务 <50ms | Choreographer 帧统计 + 长任务采样 |
| 5 | 冷启动到首屏、Back/Home 行为符合 TV 约定（Back 不直接杀进程） | 启动日志 + 生命周期日志 |
| 6 | 1GB 级盒子连续操作 10 分钟后 JS 堆回落 | `nativeMemoryUsage` + GC |

### S2 · 焦点原语化（差异化的真正落点）

把焦点从 `p-formfactor`（Vue/DOM）下沉为渲染无关原语，Web 与 App 共用同一实现与同一几何指纹：

- 输入：`(rects, currentId, direction, opts)`；
- 输出：`nextId`；
- 判据：同一 SFC、同一组 rects，Web 与 TV 两端**焦点序列完全一致**（指纹比对，可 CI）。

### S3 · TV 应用壳（可选，按商业价值再定）

leanback 入口 + banner + 媒体播放（需先补 App 的 `useVideo`）+ D-pad 长按与菜单键 + 首屏海报数据。

---

## 6. 硬件与工程约束（先定，否则白做）

- **盒子必须 arm64 + Android 9+**：当前 native 只编 `aarch64`；32 位盒子直接装不上。
- **建议 1.5–2GB 内存的盒子做压力机**（不是旗舰），这样时间片/内存判据才有意义。
- **`adb connect` 走网络**：TV 盒子一般开 5555 调试端口，注入按键/截图/日志都能脚本化，
  比手机触摸测试**更确定**（`input keyevent` 是离散事件，无抖动）——这对本仓「判据文化」是加分项。
- **上架才需要的**：`CATEGORY_LEANBACK_LAUNCHER`、`android:banner`、`uses-feature touchscreen required=false`；
  S1 不做，`adb install` + `am start` 就够。
- **16KB 对齐**：已有 `hosts/android/check-16kb-align.sh`，新盒子若是 Android 14+ 要跑一遍。

---

## 7. 风险

1. **范围膨胀**：一旦叫「电视盒子软件」，就会被期待 EPG/播放器/DRM/会员支付——那是产品，不是原语验证。
   **必须锁死 S1 的范围与判据**，否则会在无关处烧掉几周。
2. **焦点与滚动的耦合**：`ensureVisible` 没做，焦点链看起来「通了」但实际不可用；必须在 S1 内一起验。
3. **遥控器碎片**：OK 键可能是 `DPAD_CENTER(23)` 或 `ENTER(66)`；长按重复率各厂商不同；
   菜单/返回键语义不一致。宿主侧要做键值归一表，不能假设。
4. **TV 拓扑在 App 的降级**：`p-formfactor` 依赖 `@container`（App 不支持）与 `:focus-visible`（App 不支持），
   S1 需要一条 App 专用降级路径（固定拓扑 + 渲染器焦点环），不能假装 CSS 生效。
5. **`useVideo` 缺口**：没有视频的 TV demo 说服力有限，但补播放器是独立课题（ExoPlayer/AVPlayer 能力 + 生命周期），
   不要混进 S1。
6. **命名**：若新增焦点原语模块，按《Proteus_万神殿命名规范》先定名再落代码（N-1/N-2/N-3）。

---

## 8. 需要你拍板的三件事

1. **先做哪一端**：Android TV 盒子（成本最低、宿主已有、adb 可测）——建议；
   还是先 tvOS（差异更大，但要新宿主 + Apple TV 设备 + 签名）。
2. **S1 的「一条链」是否就是我列的六条判据**（尤其第 4 条时间片是否纳入；
   纳入就等于把昨天讨论的执行原语一起验了）。
3. **盒子型号/预算**：我需要知道 ABI（arm64？）、Android 版本、内存，才能把 S1 的判据阈值定死。

---

## 附：本次取证索引

| 事实 | 文件:行 |
|---|---|
| TV 形态画像（remote/hero-focus-row/overscan/10ft/focus ring） | `packages/fluid/src/formfactor.ts:491-511` |
| 几何焦点算法（纯函数） | `packages/fluid/src/focus-nav.ts:50` |
| 组件层 keydown → 焦点引擎 → 焦点环 | `packages/components/p-formfactor/index.vue:301-448,1280-1365` |
| `hero-focus-row` 拓扑 CSS / `@container` 降级点 | `packages/components/p-formfactor/index.vue:1015-1113` |
| 形态容器进 IR（L26，implemented） | `packages/component-ir/src/primitives.ts:59` |
| App CSS 无 focus 伪类 / 无 container query | `docs/generated/css-capability-sources/app-profile-features.json` |
| 宿主无任何按键入口 | 全仓 `onKeyDown`/`dispatchKeyEvent`/`KEYCODE_DPAD` 零命中（仅小程序 spec） |
| Android 输入只有触摸 | `hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/VaporRenderHost.java:1147+` |
| 清单无 leanback/banner | `packages/cli/templates-host/android/AndroidManifest.xml` |
| 仅 arm64 | `hosts/android/build-runtime-aar.sh:36-49` |
| `useVideo` 在 App 未实现 | `packages/component-ir/src/primitives.ts:236`；`packages/api/src/capability.ts:862` |
