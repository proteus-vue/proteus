# Proteus Host ABI 宿主抽象层设计方案

> 定位：**把「Proteus 内核」与「宿主壳」解耦**，使换宿主不必重写内核，并支持嵌入客户既有 App
> 适用：Proteus v2.47+（Vue 3.4 / Vite 5 / TS 5.4 / 微信基础库 2.29.2+）
> 依赖：《App 端高性能渲染落地方案》M2、《Playground 设计方案》§4、《App 端路由与动画系统设计方案》
> 设计参照：Flutter Embedder / Add-to-App 的成熟分层模型


> ⚠ **实施状态：HA0 / HA0.5 / HA1 已落地（2026-09-30 更新）**
>
> | 里程碑 | 状态 | 证据 |
> |---|---|---|
> | **HA0**（八接口 C ABI + 版本协商 + `proteus_submit_frame`） | ✅ **已落地** | `packages/host-abi/`（crate + `include/proteus_host_abi.h`）；Rust 单测 7 条；**纯 C headless 宿主**真编译真链接真跑 **27 条判据全过** |
> | **HA0.5**（`hosts/`→`platform/` 拆分 + CI 静态检查） | ✅ **已落地（iOS）** | `platform/ios/ProteusPlatform/ProteusTextAdapter.swift`（319 行抽取）；门禁 `check:platform-layering` 三条判据（引用方向 / 禁 ABI / 实质内容）+ 破坏性验证；Android 侧**待抽**（见下"诚实边界"） |
> | **HA1**（现有 App 宿主改造） | ✅ **已落地（iOS 宿主）** | 真机 **N 组 7/7 全过**；★核心判据 = **双路几何逐字节一致**（同树走直连 FFI 与 Host ABI，1836B / 同 hash） |
> | HA2（能力注入重构） | ✅ **主体已落地** | ① 度量经 vtable 注入**已通**（真机 N3：缺度量表时引擎回调宿主 26 次）；② ★**内核已零平台分支**（`check:platform-layering` D 组守住）：JNI 层迁出内核 → `platform/android/proteus-jni/`（独立 crate，产 `libproteus_jni.so`），内核 `crate-type` 去掉 `cdylib`；真机复验内核驱动动画 6 条判据照常全过。★图像解码 trait 已在 ABI 契约层声明，但内核侧**无消费点**（内核不处理图像——如实记录） |
> | HA3（能力插件） | ✅ **已落地** | ① 注册/查询/调用已通（真机 N6）；② ★**与 Playground §4.2 能力清单打通**（2026-09-30）：`proteus_set_shell_capabilities`（**接受 CLI `capability-manifest.json` 的同形**）+ `proteus_check_capabilities`（端上校验：所需 ⊆ 提供）；缺失 ⇒ 明确错误码 + **可操作报告**（点名缺失项 / 列出已提供 / 指向「扩展壳」）；
> | | | ③ `proteus_load_tree` 集成：产物带 `requiredCapabilities` ⇒ **加载前**校验，不满足即拒绝（启动时暴露，不是跑到一半崩），且**不破坏已加载的旧树**；
> | | | ④ ★**跨语言 golden**（`tests/golden/capability-manifest.json`，由 TS 侧 `scanCapabilities` 真实产出冻结）+ 新鲜度门禁 `check:capability-golden`（TS 侧一改形状就红）。C 宿主一致性测试 **36 条判据**全过 |
> | HA4（原生组件宿主） | ✅ **主体已落地** | ⑦ 号接口从"契约联通"升级为**引擎驱动的生命周期**：`load_tree` 建树即创建（带内核算出的几何）/ `submit_frame` 后几何真变了才 update / 节点消失·换 kind·销毁引擎即销毁；`proteus_sync_native_views` 供**滚动/动画后**手动同步。★两种失败都明确：宿主未实现回调 ⇒ 报错 + last_error 点名；宿主拒绝 kind ⇒ 记账 + 可读原因。**C 宿主 46 条判据**（含 kind 变更重建）全过 |
> | | | ★**诚实边界**：z-order 与滚动同步**仍属宿主**（原生 View 与自绘内容的层序由平台决定——iOS 子视图天然在上、Android 需显式处理）；内核只给几何。这是平台成本，不抽象。 |
> | HA5（存量 App 嵌入） | ✅ **已落地** | ① **AAR 产出**（`platform/android/build-aar.sh`，四条内容断言：manifest / classes.jar / jni .so / R.txt + **符号齐备**（内核 ABI 24 · Host ABI 15 · JNI_OnLoad））；
> | | | ② **Java SDK 门面**（`dev.proteus.sdk.ProteusEngine` + `ProteusHost`，**零 Android 依赖**）；
> | | | ③ ★**C→Java 回调穿梭**（vtable 是 C 函数指针、宿主是 Java 对象 ⇒ 蹦床 + `JNI_OnLoad` 抓 VM + `GlobalRef`）；
> | | | ④ ★★**嵌入 demo**（`hosts/android/embed-demo/`，**独立包名**的第三方 App，**只依赖 AAR**）真机 **6 条判据全过**：建引擎 / 度量回调被调 / 能力校验两侧 / 批处理红线 / 几何+帧更新 / 输入命中；
> | | | ⑤ **预热**：`prewarm()` + `warm(host)`（真预热 = 装空树，把首次解析成本挪出首屏）；
> | | | ⑥ **接入文档** `docs/proteus-host-abi-integration.md`（含 30 秒开始 / 排查表 / 边界）。 |
> | HA6 | ❌ 未做 | 依赖 Playground 本身（**规划态·零实现**） |
>
> **★HA1 落地时的一个关键方法论（值得记）**：等价性判据（"两条路产出同一个东西"）**必须喂同一份输入**——
>   首版探针直接拿适配器产物比，而适配器**不含** `textMeasures`（生产里由宿主在 mount 时补）
>   ⇒ 直连路用 `NullTextMeasurer`（文本零尺寸）、ABI 路回调宿主度量 ⇒ 几何差 195 字节。
>   **那是探针喂了两份不同输入，不是抽象的缺陷**。修正：等价性用"含度量表的同一棵树"，
>   而"注入能力"另设独立子项（用缺度量表的树验回调发生）。
>   ★这条与"判据要落在结果上"同源，但更具体：**对照实验的输入必须先对齐**。

> ⚠ **原状态记录（2026-09-28 逐项核实，保留作历史）**：规划态 · 零实现
>
> 本文档**尚无生产代码**。核实结论（证据见括号）：
> · ❌ **HA0**（八接口 C ABI / 版本协商 / `proteus_submit_frame`）—— 全仓 `submit_frame`/`host_abi` 仅命中本方案自身
> · ❌ **HA0.5**（`hosts/`→`platform/` 拆分 + CI 静态检查）—— 无 `platform/` 目录
> · ◐ **HA2**（度量 trait 注入）—— **TextMeasurer trait 已存在**（`layout-core-rust/src/engine.rs:48`，iOS CoreText / Android StaticLayout 均已注入）；但**无图像解码 trait**，且内核仍有 `target_os` 分支（`jni.rs`/`lib.rs`/`ffi.rs`）
> · ◐ **HA3**（能力插件）—— `packages/capabilities/src/` + `capabilities:check` + `check:degradation` 已有；**宿主能力注册插件式装载与「未注册能力」运行时报错未见**
> · ◐ **HA4**（原生组件宿主）—— **仅 Android**（`hosts/android/README.md` M3 WebView 宿主 + `native-host-verify.py` + `scroll-sync-verify.py`，z-order 实测 native-on-top）
> · ❌ **HA5**（AAR + 嵌入 demo + 预热）/ **HA6**（Playground 统一走 ABI）—— 均无
> · ❌ **批处理红线**「跨边界调用 = 帧数」**未达标**：实测 `callsPer1000Items=6100`（每项 6 次，非每帧 1 次）
>
> ⇒ 本方案的**相邻基座已就绪**（排版 FFI / TextMeasurer / capabilities / Android 原生宿主），
> 缺的是「把内核与宿主彻底解耦」这一层（`platform/` 拆分 + C ABI）。

---

## 0. 决策与前提

### 0.1 先把两件事分开（否则会抽象错对象）

用户提出的"换宿主原生壳就要重新实现一遍"，实际包含两种不同的痛：

| 场景 | 实质 | 现状 | 能否抽象掉 |
|---|---|---|---|
| Android → iOS → 鸿蒙 | **平台适配层**差异 | 已有设计（每端一份绘制层） | ❌ 绕不开，本来就该各写一份 |
| Proteus App → Playground 壳 → 客户既有 App | **宿主集成层**差异 | ❌ **缺这层** | ✅ 这就是本方案的目标 |

**第一个是必要的平台成本**，不要试图用抽象消灭它——每端绘制层各写一份是正确设计。
**第二个才是真问题**，而且它的价值目前被低估了。

### 0.2 默认选择（可调）

| # | 决策项 | 本文默认 | 理由 |
|---|---|---|---|
| ① | 第一个非 Proteus 宿主 | **Android** | 既有实测全在 Android（4050 / 长列表 / 内存 0.328）；Playground 方案 PG2 已定「Android 优先，iOS 次之」 |
| ② | 接口形态 | **内核侧 C ABI + 宿主侧各语言薄封装** | 跨语言稳定；Rust 侧可 `extern "C"` 导出 |
| ③ | 能力 API | **不进内核，走插件机制** | 每个宿主能力集天然不同 |

若 ① 与你的排期不符，请指出，我调整平台适配层的实现顺序。

### 0.3 设计参照：Flutter 是怎么解决同一问题的

Flutter 能嵌进任何宿主（Android Activity、iOS UIViewController、甚至 Wayland / 车载），靠的是 **Embedder API**。

Flutter 官方对分层的定义 [citation:10]：

- **Engine** 通过 **Embedder API** 与特定平台集成
- **Embedder** 负责：协调底层 OS 获取渲染 surface、accessibility、input；**管理事件循环**；暴露平台特定 API 以将 Embedder 集成进 app
- **Runner** 把 Embedder 暴露的平台 API 组装成可在目标平台运行的 app 包

三条对 Proteus 直接有用的经验：

1. **Engine 不创建也不管理自己的线程**，这是 Embedder 的责任——Embedder 向 Engine 提供 task runners（Platform / UI / Raster / IO 四个）[citation:10]
2. **Engine 期望线程配置在整个生命周期保持稳定**：一旦决定某个 task runner 跑在哪条线程，就该只在那条线程执行其任务 [citation:10]
3. **与 Engine 的所有交互必须在 platform thread 上进行**，在其他线程交互不是线程安全的 [citation:10]

第 1 条尤其值得抄：**调度权交给宿主，内核不自建线程**——这正好对应本方案 §2.4 的「调度注入」。

---

## 0.4 · 现有 `hosts/` 目录迁移指南（★ 优先执行）

> 背景：项目现有目录结构为 `hosts/android` / `hosts/ios`（鸿蒙待加），**没有抽象层**。
> 换原生壳时这些实现要重写一遍——这正是 Host ABI 要解决的问题。
> 本节是动手前的**第一步**，优先级高于 HA0。

### 0.4.1 核心问题：hosts/ 里混了两类本该分开的代码

```
hosts/android/   ← 当前是混合状态
   ├─ 宿主集成代码（换壳要重写，✅ 该抽进 ABI）
   └─ 平台适配代码（各端各写，❌ 不该抽）
```

**混在一起的后果**：感觉上"换壳要重新实现一遍"，实际重复了两份成本——

- **宿主集成成本**（可抽象，本方案解决）
- **平台适配成本**（同平台内本可复用，被一起重写了）

### 0.4.2 拆分清单

**❌ 留在平台适配层（各端独立，不要抽进 ABI）**

| 项 | Android | iOS | 鸿蒙 |
|---|---|---|---|
| 文本度量 | StaticLayout | CoreText | 鸿蒙文本引擎 |
| 图片解码 | 平台解码器 | 平台解码器 | 平台解码器 |
| 绘制指令执行 | Canvas / DisplayList | CALayer | 鸿蒙绘制 |
| 系统能力原生实现 | 网络、存储实际调用 | 同 | 同 |
| 原生组件挂载 | map / video / webview | 同 | 同 |

**✅ 抽进 Host ABI（换壳要重写的部分）**

| 项 | Android | iOS | 鸿蒙 |
|---|---|---|---|
| UI 容器骨架 | Activity / Fragment | UIViewController | Ability |
| Surface 生命周期 | Surface 创建与尺寸变更 | CALayer 挂载 | 对应载体 |
| 生命周期转发 | onResume / onPause / onDestroy | viewWillAppear 等 | Ability 生命周期 |
| 输入采集与转发 | **必须带时间戳** | 同 | 同 |
| 帧调度驱动 | Choreographer | CADisplayLink | vsync |
| 能力插件注册 | — | — | — |
| 路由栈挂钩 | 嵌入宿主导航栈 | 同 | 同 |

### 0.4.3 拆分后的收益

| 场景 | 拆分前 | 拆分后 |
|---|---|---|
| **同平台换壳**（Android App A → 客户 Android App B） | 全部重写 | **平台适配层全复用，只写宿主集成层** |
| **跨平台新增**（→ 鸿蒙） | 全部重写 | 平台适配层新写（不可避免）+ 宿主集成层按 ABI 实现 |

**同平台换壳才是真正的痛点**，而它收益最大——平台适配层一行不用动。

### 0.4.4 拆分后的目录结构（建议）

```
platform/                    ← 平台适配层（各端独立，内核通过 trait 注入）
├── android/                 文本度量 / 图片解码 / 绘制 / 系统能力
├── ios/
└── harmony/

hosts/                       ← 宿主集成层（Host ABI 宿主侧实现）
├── android/
│   ├── proteus-app/         现有 Proteus App
│   └── standalone/          独立壳（后续：客户嵌入形态）
├── ios/
└── harmony/
```

### 0.4.5 依赖方向约束（硬性，需静态检查）

```
hosts/*  ──→  platform/*      ✅ 允许（宿主调用平台能力）
platform/*  ──→  hosts/*      ❌ 禁止
platform/*  ──→  Host ABI     ❌ 禁止（平台层不感知宿主契约）
```

**强制规则**：`platform/` 层的任何文件**不得 import / include** `hosts/` 层的任何符号。
需在 CI 中加入静态检查，违反即阻断。

### 0.4.6 鸿蒙的特殊性

鸿蒙对本项目是**第三个平台 + 第三个宿主**，两个成本叠加。

但这也正好触发 **Rule of Three**：两个宿主时抽象略早、三个时已偏晚。**现在时机刚好**
——再往后拖，三份宿主代码各自漂移，迁移成本会陡增。

### 0.4.7 执行顺序（HA0.5 必须排在 HA0 之前）

```
HA0.5 · 拆分 hosts/（新增，≈1 人周）
   ├─ hosts/android → platform/android + hosts/android
   ├─ hosts/ios     → platform/ios     + hosts/ios
   └─ 静态检查：platform 层不得引用 host 层

HA0 · 接口定义与骨架（原方案）
HA1 · 现有宿主改造
```

**为什么要先拆**：直接对着混合代码抽象，很容易把「Choreographer 驱动」和
「Canvas 绘制」一起卷进 ABI——前者该抽，后者不该抽。**拆开之后边界是自明的。**

### 0.4.8 一个必须避免的陷阱

**别把平台适配层也塞进 Host ABI。**

平台适配层各端各写是**正确设计**，不是缺陷。Surface 创建、文本度量、绘制执行这些，
强行统一接口只会换来一层无谓的间接调用——**而性能优势恰恰来自"少一层"**。

**判断标准**：这段代码换到同平台的另一个 App 里，需要改吗？

- 需要改 → 宿主集成，抽进 ABI
- 不用改 → 平台适配，留在各端

---

## 1. 架构分层

```
┌──────────────────────────────────────────────────────┐
│ 宿主壳（Host）                                        │
│   Proteus App / Playground 公共壳 / 扩展壳 / 客户 App  │
│   ├─ 实现 Host ABI 的宿主侧                            │
│   ├─ 提供 Surface、生命周期、输入、调度               │
│   └─ 注册能力插件                                      │
└──────────────────────────────────────────────────────┘
                    ↕  Host ABI（稳定契约，版本化）
┌──────────────────────────────────────────────────────┐
│ Proteus 内核（平台无关）                               │
│   ├─ 节点树（扁平数组）                                │
│   ├─ Rust 排版核心                                     │
│   ├─ 指令消费（OpBuffer / AnimOp）                     │
│   ├─ 路由状态机                                        │
│   └─ 槽位运行时                                        │
└──────────────────────────────────────────────────────┘
                    ↕  平台能力注入（trait，非分支）
┌──────────────────────────────────────────────────────┐
│ 平台适配层（Android / iOS / 鸿蒙 各一份薄实现）        │
│   文本度量 / 图片解码 / 绘制                           │
└──────────────────────────────────────────────────────┘
```

**关键**：换宿主壳 = 重新实现 Host ABI 的**宿主侧**，内核一行不改。

---

## 2. Host ABI 接口定义（八个）

### 2.1 接口总览

| # | 接口 | 方向 | 说明 |
|---|---|---|---|
| 1 | **Surface** | 宿主 → 内核 | 提供可绘制区域 |
| 2 | **生命周期** | 宿主 → 内核 | 启动 / 前后台 / 销毁 |
| 3 | **输入事件** | 宿主 → 内核 | 触摸、键盘、手势原始数据 |
| 4 | **调度** | 宿主 → 内核 | vsync / Choreographer 驱动 |
| 5 | **文本度量** | 宿主 → 内核（注入） | StaticLayout / CoreText |
| 6 | **图片解码** | 宿主 → 内核（注入） | 平台解码器 |
| 7 | **原生组件宿主** | 双向 | map / video / webview 挂载点 |
| 8 | **能力 API** | 双向（插件化） | 网络、存储、定位等 |

### 2.2 ① Surface

```c
// 宿主提供给内核的绘制区域
typedef struct {
  void*  native_surface;   // Android: Surface / iOS: CALayer / 鸿蒙: XComponent
  int32_t width;           // 逻辑像素
  int32_t height;
  float   density;         // 像素密度
  float   content_scale;   // 实际缩放（2x / 3x）
} ProteusSurface;

// 尺寸变化（旋转、分屏、折叠屏）时宿主主动通知
void proteus_surface_changed(ProteusEngine*, const ProteusSurface*);
```

**约束**：
- 内核**不得**持有 Surface 的平台类型，只持有不透明指针
- 尺寸变化必须由宿主主动通知，内核不轮询

### 2.3 ② 生命周期

```c
typedef enum {
  PROTEUS_LIFECYCLE_CREATED,
  PROTEUS_LIFECYCLE_RESUMED,    // 前台
  PROTEUS_LIFECYCLE_PAUSED,     // 后台
  PROTEUS_LIFECYCLE_DESTROYED
} ProteusLifecycleState;

void proteus_lifecycle(ProteusEngine*, ProteusLifecycleState);
```

**补充**：宿主还需转发系统级事件（内存压力、低电量模式），内核据此调整缓存策略。

### 2.4 ③ 输入事件

```c
typedef struct {
  uint32_t type;        // down / move / up / cancel
  float x, y;
  uint32_t pointer_id;
  int64_t  timestamp_ns;  // ★ 必须带系统时间戳
} ProteusPointerEvent;

// 批处理：一帧内所有指针事件一次性提交
void proteus_dispatch_pointers(ProteusEngine*, const ProteusPointerEvent*, size_t count);
```

**★ 必须携带系统时间戳**——Benchmark 规格 §2.5 的「输入延迟」指标（触摸到达 → 提交帧）依赖它。没有这个字段，手势延迟测不准。

**批处理是硬要求**，不要逐事件调用。

### 2.5 ④ 调度（★ 最关键的设计）

```c
// 宿主在每帧回调中驱动内核
// 内核在此回调内完成：消费指令 → 排版 → 产出绘制指令
void proteus_frame(ProteusEngine*, int64_t frame_time_ns);

// 内核告知宿主：本帧有内容需要提交
typedef void (*ProteusRequestFrameFn)(void* user_data);
```

**设计要点（直接抄 Flutter 的经验）**：

| 规则 | 说明 |
|---|---|
| **内核不自建线程** | 线程创建与管理归宿主，宿主把「帧回调」注入内核 [citation:10] |
| **所有内核调用在同一线程** | 沿用 Flutter 的约束：与引擎交互必须在 platform thread，其他线程不安全 [citation:10] |
| **线程绑定稳定** | 一旦选定线程，整个内核生命周期内不变 [citation:10] |

**为什么重要**：你的既有设计已经是「每帧一次 flush」，调度注入与之完全同构。若内核自建线程，会引入锁与跨线程同步，直接吃掉 0.08ms 重排带来的优势。

### 2.6 ⑤⑥ 文本度量 / 图片解码（注入式 trait）

```c
// 文本度量：平台注入实现
typedef void (*ProteusMeasureTextFn)(
  const ProteusTextInput* in,
  ProteusTextMetrics* out,
  void* user_data
);

// 图片解码：平台注入实现，异步
typedef void (*ProteusDecodeImageFn)(
  const ProteusImageRequest* req,
  void (*callback)(ProteusImageResult*, void*),
  void* user_data
);
```

**★ 硬性约束：内核中不得出现平台分支。**

既有方案 §5.2 的 `text_measure` 由平台注入（Android StaticLayout / iOS CoreText）这个设计是对的，**把它推广到全部平台相关能力**。

禁止这种写法：
```rust
// ❌ 禁止
if cfg!(target_os = "android") { ... } else if cfg!(target_os = "ios") { ... }
```

### 2.7 ⑦ 原生组件宿主

双向接口，用于挂载 map / video / webview / 广告 等无法自研的原生组件（CSS Profile §L3、兼容方案 §3.1 B 档）。

```c
// 内核请求宿主创建一个原生组件并挂载到指定位置
// 宿主返回句柄，内核只持句柄
typedef void* ProteusNativeViewHandle;

ProteusNativeViewHandle proteus_host_create_native_view(
  void* user_data,
  const char* kind,          // "map" / "video" / "web-view"
  const ProteusRect* frame
);

void proteus_host_update_native_view_frame(
  void* user_data, ProteusNativeViewHandle, const ProteusRect*);
```

**约束**：
- 内核只持有不透明句柄，不访问平台类型
- 层级与滚动同步由宿主负责（这正是自研渲染保留的「可融合原生组件生态」优势，不要破坏）

### 2.8 ⑧ 能力 API（插件化）

```c
// 宿主向内核注册能力
void proteus_register_capability(
  ProteusEngine*,
  const char* name,             // "network.request" / "storage.set" ...
  ProteusCapabilityFn fn,
  void* user_data
);

// 内核（经 JSI）调用能力
```

**★ 能力 API 不进内核**——每个宿主能力集天然不同（Playground 公共壳只有基础能力）。直接复用 Playground 方案 §4.2 的**能力清单校验**机制，不要另起一套。

---

## 3. 批处理协议（★ 性能红线）

### 3.1 规则

**所有跨边界调用必须是批处理的。**

```
❌ 禁止：一个节点更新 → 一次跨边界调用
✅ 要求：一帧内所有指令累积 → 一次跨边界提交
```

这直接沿用 Vapor IR 方案 §2.4 的 `OpBuffer` 与「每帧一次 flush」设计，**不要破坏它**。

### 3.2 为什么是红线

跨边界调用有固定成本（JNI / FFI / 线程切换）。若接口粒度细到"每次属性变更调一次"，**乘法效应会吃光全部性能优势**——你的 0.08ms 重排会被调用开销淹没。

### 3.3 批处理接口形态

```c
// 一次提交一帧的全部指令
// ops 为紧凑数组，无字符串解析
void proteus_submit_frame(
  ProteusEngine*,
  const uint8_t* op_buffer,
  size_t byte_len
);
```

**验证方式**：运行时 profile 确认跨边界调用次数 = 帧数，而非节点变更数。

---

## 4. 能力插件机制

### 4.1 与 Playground 方案的关系

Playground 方案 §4.2 已定义：
- 壳的**能力清单（manifest）**
- 产物声明**所需能力**
- 端上校验，不满足则明确报错 + 提示需要「扩展壳」

**Host ABI 的能力机制直接复用它**，不另起一套。Host ABI 只是把这套校验的**接口层**标准化。

### 4.2 三档能力

| 档 | 内容 | 说明 |
|---|---|---|
| **核心** | 无能力依赖即可运行 | 纯渲染，任何宿主都能跑 |
| **基础** | 网络、存储、设备信息 | Playground 公共壳应内置 |
| **扩展** | 定位、相机、推送、支付、地图 | 需扩展壳或客户宿主自行注册 |

### 4.3 未注册能力的行为

**编译期或启动时明确报错，禁止静默失败。** 这与兼容方案 §9「未实现 API 必须编译期报错」是同一条原则——静默失败是最恶劣的失效模式。

---

## 5. 线程与调度模型

### 5.1 原则：调度权归宿主

```
宿主线程（platform thread）
   ├─ 驱动 proteus_frame()
   ├─ 提交输入事件
   └─ 所有 Host ABI 调用均在此线程
```

**内核不创建线程、不管理线程、不做跨线程同步。**

### 5.2 三条硬约束（抄自 Flutter 的成熟经验 [citation:10]）

1. 所有与内核的交互必须在同一线程（platform thread）
2. 线程绑定在整个内核生命周期保持稳定
3. 内核不得假设宿主的线程模型（单线程 / 多线程由宿主决定）

### 5.3 一个例外：异步解码

图片解码、网络请求这类**必须异步**的能力，允许在宿主侧其他线程执行，但**回调必须回到 platform thread**再调入内核。

---

## 6. 版本协商

### 6.1 直接复用现成机制

Playground 方案 §4.4 已定义版本协商，Host ABI 沿用，不重新设计：

```c
typedef struct {
  uint32_t abi_version;      // Host ABI 版本
  uint32_t ir_version;       // IR 版本
  uint32_t min_shell_version;// 最低宿主版本
} ProteusVersionInfo;
```

**强制要求**：
1. 版本号语义化，**禁止用 commit hash 等不可比标识**
2. 校验不通过 → 明确提示升级，**不得静默崩溃**（Playground 方案 §4.4 已有此约束）
3. 能力清单版本也纳入协商

### 6.2 ABI 稳定性承诺

| 变更类型 | 处理 |
|---|---|
| 新增接口 | minor 版本递增，向后兼容 |
| 接口语义变更 | major 版本递增 |
| 移除接口 | major 版本递增 |

**建议**：v1.0 之前不承诺稳定，v1.0 之后严格语义化。

---

## 7. 原生组件混用（与 PlatformView 的类比）

### 7.1 反向集成

Flutter 的 Add-to-App 是"Flutter 嵌入原生"；**PlatformView 是反向**——把原生 view 嵌入 Flutter 层级 [citation:7]。

Proteus 的 ⑦ 号接口就是这件事。

### 7.2 一个值得注意的取舍

Flutter 3.0 起 Android 用 **Hybrid Composition**：把 native view 直接放进平台 view 层级（而非渲染到纹理）[citation:6][citation:7]。

- **优点**：原生手势、文本选择、键盘焦点处理更可靠
- **代价**：需要由系统 Window Manager 合成 native 与 Flutter 两层，**计算上更贵**

**对 Proteus 的启示**：你的架构本来就是「原生渲染管线 + 可融合原生组件生态」，**没有 Flutter 那种"两层合成"问题**——这是选原生渲染路线（而非自绘）换来的结构性优势，应在文档中明确记录。

---

## 8. 存量 App 嵌入流程（本方案的核心收益）

### 8.1 它打开的能力

有了 Host ABI，Proteus 不再是"必须用 Proteus 重建整个 App"，而是**可以作为 SDK 嵌进客户已有的原生 App**——某个页面、某个模块用 Proteus，其余保持原生。

这是 Flutter 与 RN 都支持的混合开发模式 [citation:11]，也是**推广路径上最关键的一步**：让客户不用推翻现有 App 就能试用。

**与 Playground 的关系**：Playground 已让"扫码即玩"归零试用门槛；Host ABI 让"**嵌入你的 App 试一个页面**"成为可能——门槛进一步归零。

### 8.2 两种集成模式（对标 Flutter Add-to-App [citation:13]）

| 模式 | 做法 | 适用 |
|---|---|---|
| **源码集成** | 客户工程直接引用 Proteus 内核源码/子工程 | 同一团队维护两端；迭代快 |
| **二进制集成** | 内核打成 AAR / XCFramework，客户按版本引用 | 独立团队、独立发布节奏；客户无需装 Proteus 工具链 |

**建议 v1 先做二进制集成**——客户接入成本最低（不需要装整套工具链），且隔离构建流水线。

### 8.3 两种嵌入形态（对标 Flutter Add-to-App 的两种用例 [citation:11]）

| 形态 | 说明 |
|---|---|
| **混合导航栈** | App 多个页面，部分由 Proteus 渲染，部分原生，可自由跳转 |
| **局部视图** | 一个页面内部分区域由 Proteus 渲染，其余原生 |

### 8.4 接入流程（Android 为例，默认选择①）

```
1. 客户 App 引入 proteus-core AAR
2. 在目标 Activity/Fragment 中创建 ProteusEngine
   - 提供 Surface（Android 原生 Surface）
   - 注册调度回调（Choreographer）
   - 转发生命周期与输入事件
   - 注册所需能力插件
3. 加载 IR 产物（本地或 CDN）
4. 渲染
```

### 8.5 ★ 引擎预热（一个容易漏但很关键的体验点）

Flutter Add-to-App 的已知问题：初始化 FlutterEngine 约需 100–200ms，若只在用户点击时才初始化，会出现**白屏闪烁**。官方解法是**预热**——在 App 启动阶段（Android `Application.onCreate` / iOS `didFinishLaunchingWithOptions`）就初始化引擎 [citation:7]。

**Proteus 应照做**：
- 提供 `proteus_prewarm()` 接口 —— ✅ **已落地**（C ABI + Java `ProteusEngine.prewarm()`）；
  另提供 `warm(host)`（**真预热** = 建引擎 → 装空树 → 销毁，把首次解析成本挪出首屏）
- 文档建议客户在 App 启动时调用 —— ✅（见 `docs/proteus-host-abi-integration.md` §4）
- 内核初始化成本需实测并记录 —— ◐ **部分**：本仓有"4051 节点 create = 75.84ms（95% 是 JSON 解析）"
  的真机读数（`packages/layout-core-rust/src/ffi.rs` 的 `create_blob` 注释），
  但**空树预热成本**未单独测（诚实边界）；与 Flutter 的常驻内存对比亦未做

---

## 9. 里程碑

### HA0.5 · 拆分现有 hosts/ 目录（≈1 人周）★ 必须最先执行

- [ ] `hosts/android` → `platform/android` + `hosts/android`
- [ ] `hosts/ios` → `platform/ios` + `hosts/ios`
- [ ] CI 加入静态检查：**platform 层不得 import hosts 层**
- [ ] 确认拆分后性能零回退（复用项目既有 `benchmarks/`）

**出口**：目录拆分完成，依赖方向检查通过。**未拆分不得开始 HA0。**

### HA0 · 接口定义与骨架（≈1 人周）

- [ ] 八个接口的 C ABI 头文件
- [ ] 版本协商结构
- [ ] 内核侧骨架（接口注册与分发）
- [ ] 批处理接口 `proteus_submit_frame`

### HA1 · 现有 App 宿主改造（≈2 人周）

- [ ] **把现有 Proteus App 改为 Host ABI 的第一个宿主实现**
- [ ] 验证：改造后性能不回退（4050 / 长列表 / 内存三项复测）
- [ ] 这是抽象是否正确的唯一检验

### HA2 · 平台能力注入重构（≈1.5 人周）

- [ ] 文本度量、图片解码改为 trait 注入
- [ ] **清除内核中的平台分支**（静态检查：内核 crate 不得出现 `target_os` 条件编译）

### HA3 · 能力插件机制（≈1.5 人周）

- [ ] 能力注册与调用
- [ ] 与 Playground 能力清单校验打通
- [ ] 未注册能力明确报错

### HA4 · 原生组件宿主（≈2 人周）

- [ ] map / video / web-view 挂载
- [ ] 层级与滚动同步

### HA5 · 存量 App 嵌入示例（≈2 人周，默认 Android）

- [ ] 二进制产物打包（AAR）
- [ ] 一个完整的"客户 App 嵌入单页面"demo
- [ ] 引擎预热接口与文档
- [ ] 接入文档

### HA6 · Playground 壳改造（≈1 人周）

- [ ] 公共壳与扩展壳统一走 Host ABI
- [ ] 验证扩展壳机制与 Host ABI 一致

---

## 10. 验收标准

| 指标 | 合格线 | 目标 |
|---|---|---|
| **改造后性能不回退** | 4050 / 长列表 / 内存三项与改造前一致 | 零回退 |
| 跨边界调用次数 | = 帧数（非节点变更数） | = 帧数 |
| 内核中的平台分支数 | **0** | 0 |
| 内核自建线程数 | **0** | 0 |
| 换宿主需改动的代码 | 仅宿主侧，内核 0 行 | 内核 0 行 |
| 版本不兼容 | 明确提示，不崩溃 | 明确提示 |
| 引擎初始化耗时 | 需实测记录 | 显著优于 Flutter（每个 engine 15–30MB 常驻 + 100–200ms 初始化） |
| 未注册能力 | 明确报错，零静默失败 | 同 |

---

## 11. 坑位清单

| # | 坑 | 应对 |
|---|---|---|
| 1 | **把平台适配层与宿主集成层混为一谈** | 见 §0.1，两者抽象目标不同 |
| 2 | **内核出现平台分支** | 静态检查禁止 `target_os` 条件编译 |
| 3 | **内核自建线程** | 调度权归宿主，见 §5 |
| 4 | **细粒度跨边界调用** | 批处理是红线，见 §3 |
| 5 | **能力 API 硬编码进内核** | 走插件机制，见 §2.8 |
| 6 | **输入事件不带时间戳** | 手势延迟指标依赖它，见 §2.4 |
| 7 | **版本用 commit hash** | 必须语义化，见 §6.1 |
| 8 | **未注册能力静默失败** | 明确报错，见 §4.3 |
| 9 | **忘记引擎预热** | 客户嵌入会有白屏，见 §8.5 |
| 10 | **HA1 性能复测被跳过** | 这是抽象是否正确的唯一检验，不可省 |
| 11 | **另起一套能力清单机制** | 复用 Playground §4.2 |
| 12 | **把 AAR 产物当成 IR 产物** | 客户 App 加载的仍是 IR 产物，AAR 只是内核载体 |
| 13 | **未拆分 hosts/ 就抽象** | 会把不该抽的平台适配层一起卷进 ABI，见 §0.4.7 |
| 14 | **platform 层反向依赖 hosts 层** | 依赖方向约束需 CI 静态检查，见 §0.4.5 |
| 15 | **把平台适配层塞进 Host ABI** | 各端各写是正确设计，强行统一会多一层间接调用，见 §0.4.8 |

---

## 12. 给实现 LLM 的执行指令

0. **HA0.5（拆分 hosts/）必须最先执行**。未拆分就开始定义 ABI，会把平台适配层一起卷进抽象，见 §0.4。
1. **先做 HA1（现有宿主改造）再做新宿主**。把现有 App 改造成第一个 Host ABI 实现，是检验抽象是否正确的唯一方式； abstractions 未经验证就写新宿主，会两头返工。
2. **内核中禁止出现平台条件编译**（`target_os` / `cfg!` 平台分支）。平台相关能力一律 trait 注入。
3. **内核禁止自建线程**。线程与调度由宿主提供。
4. **所有跨边界调用必须批处理**。运行时 profile 确认调用次数 = 帧数。
5. **输入事件必须携带系统时间戳**。
6. **能力 API 走插件机制**，不得硬编码进内核；未注册能力必须明确报错，禁止静默失败。
7. **版本协商复用 Playground 方案 §4.4**，不得重新设计；版本号语义化。
8. **HA1 完成后必须复测三项性能**（4050 / 长列表 / 内存），零回退才算通过。
9. **Surface / 原生组件句柄一律为不透明指针**，内核不得访问平台类型。
10. **引擎预热接口必须提供**，并在客户接入文档中明确建议启动时调用。

---

## 附：关键事实依据

- Flutter 分层：Engine 通过 **Embedder API** 与特定平台集成；Embedder 负责协调底层 OS 获取渲染 surface、accessibility、input，**管理事件循环**，并暴露平台特定 API 以将 Embedder 集成进 app；Runner 将其组装为可运行 app 包 [citation:10]
- Embedder 核心职责：渲染 Surface 创建与管理、管理消息循环、与原生平台服务通信、线程管理、创建和管理原生窗口 [citation:14]
- **Flutter Engine 不创建或管理自己的线程**，由 Embedder 提供 task runners（Platform / UI / Raster / IO）[citation:10]
- Engine 期望线程配置在整个生命周期保持稳定；**所有与 Engine 的交互必须在 platform thread 上进行**，其他线程不安全 [citation:10]
- Add-to-App：Flutter 可作为 module 嵌入既有 App，渲染部分 UI，其余用既有技术；Android 用 FlutterActivity / FlutterFragment，iOS 用 FlutterViewController [citation:11][citation:15]
- FlutterEngine API 可在不 attach Activity / ViewController 的情况下启动并持久化环境（用于预热）[citation:15]
- Add-to-App 两种最常见用例：**混合导航栈**（部分页面由 Flutter 渲染）与**局部屏幕视图**（页面内部分区域）[citation:11]
- 集成模式：Gradle 子工程 / CocoaPods 源码集成 vs 预构建 AAR / XCFramework 二进制集成；后者隔离构建流水线，客户端无需安装 Flutter 工具链 [citation:13]
- 混合开发已知成本：引擎初始化约 100–200ms，不预热会白屏；每个 FlutterEngine 增加约 15–30MB 常驻内存；二进制体积增加约 25–50MB [citation:7][citation:13]
- PlatformView 为反向集成（原生 view 嵌入 Flutter 层级）；Flutter 3.0 起 Android 用 **Hybrid Composition**，把 native view 直接放入平台 view 层级，交互更可靠但需系统 Window Manager 合成两层，计算更贵 [citation:6][citation:7]
- Add-to-App 限制：mobile 不支持 multi-view（仅 multi-engine）；不支持打包多个 Flutter library；部分插件在 add-to-app 下有意外行为；Android 仅支持 AndroidX [citation:11]
