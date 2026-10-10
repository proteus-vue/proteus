# 输入与桥延迟：目标「打穿所有跨端框架」的延迟工程方案

> 状态：**设计已定稿，待度量基线**
> 版本：v1 · 2026-10-10
> 定位：`proteus-performance-plan/` 的**输入延迟专项**——`00-baseline-and-roadmap.md` 攻的是「启动 + 批处理 + 拍平」（P0-a/P0-b **已兑现**，见 §1.1），本篇攻**触摸 → 视觉反馈这条链路**。
> 关联：`07-benchmark-baseline.md`（JSI P99 < 0.5ms 口径）· `docs/Proteus_Benchmark案例规格.md`（输入延迟 P95 ≤ 1 帧）· `docs/对标Benchmark执行Checklist.md`（量法口径）· `packages/host-abi`（批处理红线）· `docs/Proteus_JS引擎选型与可插拔方案.md`
> 相关决策：**#767**（立项）· #768（S1 输入旁路）· #769（S2 零拷贝）…（逐腿登记）
> 批次：**C 批（`11`–`14`）· 编号 14 · 当前主攻**（`README.md` 索引已登记）

---

## 0. 结论先行

1. **帧已经不是问题，输入才是问题。** 三端渲染成本已全面优于原生基线（Android ratio **0.36**、iOS **0.111**、Harmony **0.106**，见 `hosts/results/cross-end-4050.json`）。但 Android 同批实测出现 `Janky frames 1 (0.08%)` 与 `Number High input latency: 2431` 并存（`hosts/android/results/gfxinfo.txt`）——**画面不丢帧，但手指到反馈的延迟高**。这正是"打所有跨端框架"的缺口所在。
2. **根因是结构性的，不是调优不够**：三端都把「JS 逻辑 + 命中 + 布局 + 绘制录制」串在**同一个线程**上，且跨边界一律走 **JSON 文本 + 双 UTF-8 编解码**。输入事件的代价 = 排队等 JS 让出主线程 + 文本往返。
3. **六条腿方案**（按 ROI 排序）：S1 输入旁路 → S2 零拷贝通道 → S3 编译期交互下沉 → S4 线程解耦 → S5 Harmony 专项；**S6 度量门禁为前置**（没有度量的性能项等于没做，会静默回退——本仓既有纪律）。
4. **差异化主张**（别人做不到的三件事）：
   - **「输入不过桥」**：按压态/手势反馈**零次 JS 跨界**（RN/Flutter 都要过逻辑层）；
   - **「三端同一内核 + 同一交互语义」**：命中、布局、动画求值已是同一份 Rust（RN/Lynx 各端各实现，官方自己警告语义漂移）；
   - **「编译期下沉」**：交互折叠成内核 IR，不依赖运行时 JIT/解释器优化（QuickJS 无 JIT、JSC 在 iOS 无 JIT、Hermes/PrimJS 靠 VM 优化）。

---

## 1. 现状实测：帧没问题，输入有问题

### 1.1 渲染侧已经赢了（这一节是"不必再优化渲染"的证据）

| 指标 | 数值 | 出处 |
|---|---|---|
| L1 提交级 ratio（vs 原生） | Android **0.36** · iOS **0.111** · Harmony **0.100**（同一份 `cross-end-4050.json`） | `hosts/results/cross-end-4050.json` |
| L2 光栅级 ratio | Android **0.349** · iOS **0.148** · Harmony `null`（未采） | 同上 |
| 4050 节点布局 | 中位 **2.047ms** | `hosts/android/results/layout-bench.json` |
| 单次补丁 apply | **0.0087ms**（relayout 2 次） | `hosts/android/results/layout-apply-ops.json` |
| Vapor 单 op 载荷 | **48B**（棘轮上限 256B） | `check:vapor-perf` |
| 动画求值（内核） | N=1000 条 **2.38µs/帧** | `packages/layout-core-rust/src/anim.rs:6` |
| 拍平收益（已兑现） | 4050 元素 → 50 绘制对象；内存 **186.7 → 17.7MB（−91%）**；耗时 **190.5 → 129.9ms（−32%）** | `experiments/results/summary.json` exp8 |

**结论**：`00-baseline-and-roadmap.md` 的 P0-a（批处理：6001 次跨界 → 批量，`selfdraw-batch.ts:12` 的判据 `hostCalls() === commit 次数` 已机器化）与 P0-b（拍平）**均已落地**。渲染与批处理不再是短板——**继续在渲染上抠收益的边际回报已经很低**。

### 1.2 输入侧的自证（同一个 `gfxinfo` 文件里）

```
hosts/android/results/gfxinfo.txt
  Total frames rendered: 1233
  Janky frames: 1 (0.08%)            ← 帧几乎不丢
  50th/90th/95th/99th percentile: 5ms ← 帧耗时健康
  Number High input latency: 2431     ← ★但高输入延迟事件计数是帧数的 2 倍
```

> 这张表是本方案的起点：**如果只看帧率，会得出"性能很好"的错误结论**；官方 `gfxinfo` 把两个指标并排打印，恰好证明瓶颈在输入路径——事件要等主线程（JS + 布局 + 录制）让出才会被处理。

### 1.3 三端输入链路的现状（代码证据）

**iOS**（`hosts/ios/`，主线程 JSC + CALayer 自绘）

| 环节 | 现状 | 证据 |
|---|---|---|
| 触摸入口 | `touchesBegan/Ended` → 自研手势分类器（tap/longpress/swipe 按位移+时长+速度） | `runtime/selfdraw-scene.swift:2571,2579,2595-2631` |
| 每次手势的固定动作 | 先 `clearHighlight()`，再一次 FFI 命中，再同步调 JS | `:5169`（clearHighlight）、`:5170`（`proteus_layout_hit_test`）、`:5191`（`onDispatchToJS`） |
| 原生 → JS | `ctx.objectForKeyedSubscript("__proteus_dispatch").call(...)` —— **同步、主线程** | `shell/selfdraw-app.swift:162-164` |
| 渲染提交 | 整树 JSON → 解析 → 内核布局 → **`clearLayers()` + `buildLayers()` 全量重建 CALayer 树** | `:7515-7519`、`:4574-4576`（mount 恒 `force:true`） |
| 全量重建的代价 | 宿主总耗时的一半以上：93 节点 `build_layers 49.10/54.12ms`；707 节点 `54.9/81.8ms` | `results/selfdraw-report.json`、`results/bench-filtered-V16.json` |
| 批量指针 ABI | **未接**（`proteus_dispatch_pointers` 仅 Android 调用） | `platform/android/proteus-jni/src/host.rs:584`；iOS 侧仅 `abiProbe` 试跑 |
| 跨边界载荷 | 整树 JSON 字符串 / `number[]`；注释明说"JSExport 对 ArrayBuffer 支持不稳" | `:270-276` |

**Android**（`hosts/android/`，主线程 QuickJS + JNI + 单 ViewGroup Canvas）

| 环节 | 现状 | 证据 |
|---|---|---|
| 触摸入口 | `onTouchEvent` → 抛滑 → `dispatchHit` → 平台 `GestureDetector`（**识别器复用平台**），全同步 | `runtime/ProteusHostView.java:2322-2340`、`:2246-2304` |
| 命中 | JNI + **`new org.json.JSONObject(json)` 解析**（每次 DOWN） | `:2350-2382` |
| 原生 → JS | `QuickJsEngine.dispatchGesture` → JNI → `JS_Call`，**必须主线程**（QuickJS 非线程安全） | `QuickJsEngine.java:122-138`、`js-engine/quickjs_jni.c:838-887` |
| 指令传输 | `applyOps` 收 **`number[]` JSON**，逐元素转 `byte[]`（JNI 本身接受 `jbyteArray`） | `runtime/VaporRenderHost.java:568-570` |
| 该路径的成本 | 代码注释自述"JSON 补丁每帧要文本解析（**实测占布局耗时 95%+**）" | `VaporRenderHost.java:33-34` |
| 显示列表 | 任意 `setCmds` → **整条重建 Picture**（增量只在 Cmd 层） | `ProteusHostView.java:1856-1866`、`:3743-3759` |
| 零拷贝 | **无**（`ByteBuffer.wrap` 是堆内包装，非 direct；无 `ashmem`/`mmap`） | `:1065,1208` |
| 输入低延迟 API | **未使用** `requestUnbufferedDispatch`（Android 官方降输入延迟的标准手段） | 全仓 grep 无命中 |

**Harmony**（`hosts/harmony/`，ArkTS + NAPI + Rust RenderNode 直绘）

| 环节 | 现状 | 证据 |
|---|---|---|
| **JS 运行时形态** | ★**每次交互重建一次性 JSVM + eval 整包** | `entry-superapp.ts:425`「一次性 VM 每次 boot 要 eval 整包 ⇒ 卡顿/"不灵敏"」 |
| 为何不复用 VM | 跨 napi 调用复用同一 JSVM ⇒ V8 微任务排空导致 HandleScope 溢出 / SIGSEGV | `host_app_runtime_impl.h:19-21`（决策 #540 实测） |
| 异步续体排空 | **固定轮数有界泵**（boot 400 轮 / drive 4096 轮），非事件驱动 | `host_app_runtime_impl.h:248,334` |
| 命中 | 每次触摸一次 ArkTS→NAPI→Rust | `proteus_host.cpp:289` |
| 惯性滚动 | **JS `setInterval(16ms)` 驱动**（非 VSync、非原生） | `Superapp.ets:501-513` |
| 动画 | 每帧跨语言往返（ArkUI `postFrameCallback` → C++ `animTick`），无平台自主插值 | `proteus_render.cpp:95-103` |

### 1.4 跨端共同的结构性瓶颈（B1–B4）

| # | 瓶颈 | 三端证据 | 后果 |
|---|---|---|---|
| **B1** | **JS + 命中 + 布局 + 绘制录制同线程、且同步阻塞** | iOS：`fn.call` 在主线程（`selfdraw-app.swift:162`）；Android：`onDraw` 与 `applyOps` 同主线程（`ProteusHostView.java:2435`、`QuickJsEngine.java:122-123`）；Harmony：napi 同步 + 一次性 VM | 一次 JS 长任务（Vue render / 业务逻辑）⇒ 输入事件直接排队，**延迟 = JS 任务剩余时长** |
| **B2** | **跨边界是 JSON 文本 + 双 UTF-8 编解码** | Android `new JSONArray(opsJson)` 逐元素（`VaporRenderHost.java:568-570`，占布局 95%+）；`JS_ToCString`↔`NewStringUTF`（`quickjs_jni.c:152,162`）；iOS 整树 JSON（`:7246`）、`number[]`（`:6909-6920`） | 每帧都在做「对象 → 字符串 → 解析 → 反序列化」的往返，**纯浪费** |
| **B3** | **交互反馈必须过 JS**；无"原生即时反馈"旁路 | iOS 每次手势先 `clearHighlight()` 再派发（`:5169`）；三端按下态（`:active`）都要 JS 算完回写 | 按下 → 视觉反馈 ≥ 1 个 JS 往返 + 1 帧；**这是与 Flutter/RN 拉开差距的关键点，也是现状最薄弱处** |
| **B4** | **无 UI 线程内联脚本能力（App 三端）** | `packages/worklet/src/runtime.ts:27-29`：仅小程序 Skyline 真，其余端全降级 JS rAF | 高频交互（拖拽跟手、滚动联动）只能逐帧回 JS，无法像 RN worklet / Lynx MTS 那样下沉 |

---

## 2. 延迟的物理链路（本文的核心模型）

**从手指到像素，一共 9 段**。任何优化必须能指认"削掉了哪一段的多少 ms"，否则是玄学。

```
① 采样   触摸硬件采样（60/120/240Hz 屏 → 4.17–16.7ms 一个采样点）
② 分发   系统 InputReader → 应用（Android）/ HID event → UIApplication（iOS）
③ 命中   屏幕点 → 内容坐标 → 节点链（已在 Rust 内核：hit.rs，三端同一份）
④ 识别   原始触点 → 语义手势（tap/longpress/pan/fling/scroll）
⑤ 逻辑   JS 业务逻辑（状态更新 / Vue render）
⑥ 布局   内核 layout（全量 or 增量）
⑦ 录制   生成绘制指令 + 平台对象（CALayer / DisplayList / RenderNode）
⑧ 提交   交给合成器（RenderThread / RenderServer / RS 进程）
⑨ 上屏   vsync 扫描输出（1 帧，物理下限）
```

| 段 | 现状（三端最差口径） | 目标 | 归属 | 削除手段 |
|---|---|---|---|---|
| ① 采样 | 4.17–16.7ms（硬件，不可改） | 不变 | 平台 | 用 `getHistoricalX/Y`(Android) / `predictedTouches`(iOS) **补偿**而非缩短 |
| ② 分发 | 含在"高输入延迟"里（`gfxinfo` 计数 2431） | ≤ 1 采样周期 | 平台 | **Android `requestUnbufferedDispatch`**（绕过输入批处理）；iOS 无需 |
| ③ 命中 | iOS 每次手势 1 次 FFI + 每次 DOWN 解析 JSON（Android） | **≤ 30µs，且只在 DOWN 一次** | S1 | 命中缓存（DOWN 定 target/chain，MOVE/UP 复用）+ 批量指针 ABI |
| ④ 识别 | iOS 自研分类器；Android 平台识别器（**已优于 iOS**） | 三端统一"平台识别器 → 语义" | S1 | iOS 补 `UITap/UILongPress/UIPanGestureRecognizer`；`delaysTouchesBegan=false` |
| ⑤ 逻辑 | **几乎 100% 交互都进 JS**（最贵的一段） | 长列表交互进 JS 比例 **< 10%** | **S3** | 交互折叠成内核 IR；按压态/hover/滚动联动**零 JS** |
| ⑥ 布局 | 4050 节点中位 2.047ms（已很好） | 保持 | — | 已由 Vapor 兑现 |
| ⑦ 录制 | iOS `build_layers` 占宿主 50%+（**全量重建**） | 增量为主 + 移出主线程 | S4 | 增量层更新（已有雏形）+ 屏外延后（已有 `pendingOffscreen`）+ 录制移渲染线程 |
| ⑧ 提交 | iOS `CATransaction` 同线程；Android 交给 RenderThread（好） | 保持 | — | Android 模型是正确参照 |
| ⑨ 上屏 | 1 帧（物理下限） | 不变 | 平台 | — |

> **目标总预算**：`②+③+④+⑦+⑧ ≤ 4ms`，`⑤+⑥ ≤ 4ms`（大部分交互应为 0），`①+⑨` 物理 8.3–12ms ⇒ **触摸到像素 P95 ≤ 1 帧（8.3ms@120Hz）**，对齐 `docs/Proteus_Benchmark案例规格.md` 已声明的「输入延迟 P95 ≤ 1 帧 / ≤ 8ms」。

---

## 3. 对标：六家框架的输入延迟机制拆解

### 3.1 横向对照

| 维度 | Flutter | RN 新架构 | Lynx | uni-app x | NativeScript-Vue | **Proteus 现状 → 目标** |
|---|---|---|---|---|---|---|
| **语言与执行** | Dart **AOT 机器码** | Hermes **字节码**（无 JIT） | PrimJS（QuickJS 优化，主线程受限子集）+ 后台 JSC | **UTS 编译为原生**（Kotlin/Swift） | JSC 运行时反射调用 | QuickJS（Android，无 JIT/无字节码）/ 系统 JSC（iOS，无 JIT）/ JSVM-V8（Harmony）→ **+ 内核 IR 求值** |
| **输入处理线程** | Dart UI 线程（**与渲染同线程，无跨界**） | **UI 线程**（Mount 阶段）；手势可走 Gesture Handler（原生识别器，可绕过 JS） | **主线程脚本** + 原生手势 | 原生控件原生处理 | 原生 View 原生处理 | **主线程 JS**（三端）→ **原生识别器 + 内核 IR** |
| **交互逻辑能不能不过逻辑层** | ❌ 必须过 Dart | ⚠️ worklet 可（Reanimated，UI 线程 JS VM） | ⚠️ MTS 可（静态切分到主线程） | ✅（原生） | ✅（原生） | ❌ → **✅ 编译期折叠（S3）** |
| **跨语言数据通道** | `dart:ffi`（**无序列化**）/ Platform Channel（二进制） | **JSI：直持 C++ 对象，零序列化、同步** | 引擎内部交互（二进制） | N/A | wrapper 保引用同一性（**无 JSON**） | **JSON 文本 + 双 UTF-8** → **共享内存零拷贝（S2）** |
| **布局** | 单遍 O(n)（Dart） | Yoga（C++，后台异步） | C++ 布局 | 原生 | 原生 | **Rust 内核（三端同一份）** ✅ 已领先 |
| **按压态反馈** | 过 Dart（`InkWell`） | 过 JS/原生混合 | 原生 | 原生 | 原生 | 过 JS → **0 次跨界（S1）** |
| **包体代价** | 大（自绘引擎） | 中 | 中 | 中 | 小 | **小（复用系统控件/引擎）** ✅ |

### 3.2 关键结论（这张表撑起"打穿所有框架"）

1. **输入延迟的胜负手是同一件事：事件要不要"跨到逻辑线程再跨回来"。**
   - Flutter 因为 UI 与逻辑同线程而天然 1 帧，代价是自绘引擎的体积与"控件非原生"；
   - **原生方案（uni-app x / NativeScript）零跨界**，代价是生态弱、跨端一致性差、抖动大；
   - RN 新架构用 worklet 把交互挪到 UI 线程 JS VM——**但仍是"再跑一遍解释器"**；
   - Proteus 的机会：**用编译期把交互折叠成内核指令**，既零跨界、又不放弃 JS 生态与跨端一致性——这是唯一能同时拿到"原生延迟 + JS 生态 + 三端一致"的位置。

2. **我们的渲染与布局已经在前排**（Rust 内核 + 同一 hit test + ratio 0.36/0.111/0.106），短板单点在**输入链路**。

3. **RN/Lynx 各端各自实现渲染与手势**（官方自己警告语义漂移）；Proteus 三端共用 `hit.rs` / `anim.rs` / `ffi.rs`，**交互语义天然一致**——这是可对外宣称的结构性优势。

---

## 4. 方案：六条腿

### S1 · 输入旁路（Input Bypass）—— **最高 ROI，独有点**

> 原则：**能在内核/原生层决定的，绝不进 JS。**

| 编号 | 做法 | 关键实现 | 判据 |
|---|---|---|---|
| **S1.1** | **按压态内联**：`:active` / `pressStyle` / `hover` 编译进内核样式表，DOWN 时由原生立即改该节点绘制属性，UP 时还原 | 内核 style 表扩 `pressStyle` 字段；三端宿主在 `touchesBegan`/`ACTION_DOWN` 里直接改绘制属性（不经 JS）。样式已在内核，**零新增通路** | `press_feedback_latency ≤ 1 帧`；`bridge_calls_per_tap == 1` |
| **S1.2** | **命中缓存**：DOWN 命中一次，MOVE/UP 复用 `target`/`chain` | iOS 补缓存（Android 已有 `gestureTarget`/`gestureChain`，`ProteusHostView.java:2330-2333`） | `hit_test_calls_per_gesture == 1` |
| **S1.3** | **手势识别下沉到平台识别器** | iOS 补 `UITapGestureRecognizer` / `UILongPressGestureRecognizer` / `UIPanGestureRecognizer`（`delaysTouchesBegan=false`，`cancelsTouchesInView` 精确控制）；**保留自研分类器仅作兜底** | 三端 `check:scroll-fling` 式结构门禁 |
| **S1.4** | **iOS 接批量指针 ABI** | `proteus_dispatch_pointers`（`hosts/ios/.../selfdraw-scene.swift:177-224` 已有 vtable 声明；`host.rs:527-593` 是 Android 参照）——一帧 N 点一次 FFI | `ffi_calls_per_frame ≤ 1` |
| **S1.5** | **Android `requestUnbufferedDispatch`** | 在 `ProteusHostView` 拿到 `ACTION_DOWN` 时调用，绕过输入批处理（Android 官方降输入延迟手段） | `gfxinfo` 的 High input latency 计数下降 |
| **S1.6** | **触摸预测补偿**（可选） | Android `MotionEvent.getHistoricalX/Y` 历史采样点 + `androidx.input.motionprediction`（beta）；iOS `predictedTouches(for:)` | 跟手场景体感（人工验收项） |

**风险**：S1.1 改变了"样式只由 JS 决定"的语义 → 必须定义清楚**优先级**（内核 pressStyle 与 JS 写回的同一属性冲突时，以"按下期间内核优先"为准，UP 后 JS 权威恢复），并在 IR 层给出编译期报错（对齐"宁可少合并，不可错合并"的既有纪律）。

---

### S2 · 零拷贝传输通道（Zero-Copy Wire）—— **最确定的收益**

> 现状：每帧 `对象 → JSON 字符串 → UTF-8 编码 → 跨边界 → UTF-8 解码 → 解析 → 逐元素转字节`。
> 目标：`共享内存写字节 → 原子交换 → 对端直接读`。

**设计**：**SPSC 无锁环形缓冲 + 双缓冲帧交换**

```
[生产者]                              [消费者]
 写帧缓冲 A                           读帧缓冲 B
 写完 → release store(seqA)           校验 seqA → 直接读字节
                                      读完 → release store(ackB)
```

| 端 | 技术点 | 关键 API |
|---|---|---|
| **Android** | JNI 侧 `GetDirectBufferAddress` 拿裸指针；或 `AHardwareBuffer`/`ashmem` 跨进程；**避免 `number[] → byte[]` 逐元素** | `ByteBuffer.allocateDirect` · `env->GetDirectBufferAddress` · `GetPrimitiveArrayCritical` |
| **iOS** | ★**走 JSC C API 而非 JSExport**：`JSObjectMakeArrayBufferWithBytesNoCopy`（外部内存零拷贝包装）+ `JSObjectGetArrayBufferBytesPtr`（直读指针）——这正是 `@_silgen_name` 已在用的路径（`dev/layout-core-bench.swift:41-42`）。**注意必须 pin 住内存生命周期**（见风险） | `JSObjectMakeArrayBufferWithBytesNoCopy` · `JSObjectGetArrayBufferBytesPtr` · `mmap` |
| **Harmony** | `napi_create_external_arraybuffer`（外部内存零拷贝）/ `OH_JSVM_CreateArraybuffer` | `napi_create_external_arraybuffer` · `napi_get_arraybuffer_info` |

**顺带修掉三处已知浪费**：
1. Android `applyOps` 的 `number[]` JSON → 直接传 `jbyteArray`（JNI 签名 `([B)Ljava/lang/String;` 已经支持，`platform/android/proteus-jni/src/lib.rs:438-443`）；
2. Android 动画 tick 的 `to_vec()` 拷贝（`lib.rs:626`）→ direct buffer；
3. **iOS `build_layers` 全量重建**（占宿主 50%+）：`mount` 恒 `force:true`（`:4574-4576`）→ 首帧后必须走增量；`updateLayersIncremental` 遇缺层退回全量（`:2460`）→ 改为"补齐缺失层"而非整树重建。

**判据**：`bridge_wire_bytes == 0`（不再有文本通道）· `bridge_copy_count == 0` · `wire_serialize_us ≤ 5µs/帧`。

**风险（必须处理）**：
- **GC 与悬挂指针**：`BytesNoCopy` 包装的外部内存在 GC 后不可再被 VM 引用 → 用**外部内存池 + 引用计数**（JS 侧持 `ArrayBuffer` 期间 pin 住），并在 `finalize` 回调归还池。
- **端序与对齐**：指令流已是定长记录（`ANIM_RECORD_BYTES = 236`、动画 tick 记录 **32B**，见 `check:anim-record-bytes`）→ 沿用既有定长记录纪律，`ByteBuffer.order(LITTLE_ENDIAN)`。
- **契约版本**：`host-abi` 的 `ABI_VERSION`/`OPS_WIRE_VERSION` 必须随线格式升级（`proteus_host_abi.h:43`、`host-abi/src/lib.rs:44`）。

---

### S3 · 编译期交互下沉（Compiled Interaction）—— **差异化护城河**

> 这是 Proteus「一份源码，编译器化作千端形态」在**交互**上的正确延伸：把手势驱动的逻辑**折叠成内核可执行指令**，而不是运行时跑 JS。

**三级下沉模型**：

| 级别 | 交互类型 | 执行位置 | 是否进 JS |
|---|---|---|---|
| **Tier 1** | 按压态 / hover / `:active` / CSS transition / CSS animation / 滚动联动 / 共享元素过渡 | **内核 IR**（`anim.rs` 已有曲线求值 + Timeline） | **0 次** |
| **Tier 2** | 拖拽跟手 / swipe-to-delete / 下拉刷新 / 滚动吸附 | **内核 IR + worklet 片段**（渲染线程） | 0（不占 JS 线程） |
| **Tier 3** | 请求 / 路由 / 校验 / 跨节点副作用 | JS（照常），但**不得阻塞输入**（异步、可打断） | 1 次（异步） |

**实现路径（保守，对齐既有编译期纪律）**：

1. 新增 compiler pass `interaction-folding`：分析 `@click`/`@pointerdown`/`v-model` 绑定的 handler。
2. **可折叠判据**（必须全部满足，否则保持回 JS）：
   - handler 体是**纯表达式**（无 `await`、无网络/存储调用、无跨组件写）；
   - 影响面**限于本节点或受控子树**的样式/变换；
   - 不读取非确定值（时间戳、随机数、外部状态）。
3. 折叠产物 = 内核 IR（复用 `packages/animation` 的声明式语法 + `anim.rs` 求值），**与 worklet 共用同一 IR**。
4. **把 worklet 从「仅 Skyline」提升为「三端统一的内核指令」**（现状 `packages/worklet/src/runtime.ts:27-29` 只有 Skyline 真，其余端降级 JS rAF）——这既是性能项，也是"一份能力多端同形"的架构收口。
5. 编译期**如实报告**折叠率（哪些交互下沉了、哪些没下沉及原因），纳入 `check:*` 门禁（对齐"缺失已登记"的诚实传统）。

**判据**：`js_involved_gestures_ratio`（长列表交互 < 10%）· 新增门禁 `check:interaction-folding`（折叠率棘轮只增不减）。

---

### S4 · 线程解耦（Thread Decoupling）

> 现状：`JS + 命中 + 布局 + 录制` 同线程（B1）。目标拓扑：

```
[UI/输入线程]  触摸 → 内核 hit test → 原生即时反馈(S1) → 产出语义事件
                            │ SPSC ring（无锁）
                            ▼
[JS 线程]      业务逻辑 → 产出二进制补丁指令
                            │ 双缓冲 + 原子交换（S2）
                            ▼
[渲染线程]     内核 layout + anim tick → 录制 DisplayList → 交给合成器
```

**为何必须放后期**：**JS 引擎的线程限制是硬约束**——
- Android：QuickJS **单运行时、非线程安全**（`QuickJsEngine.java:122-123`）→ 需要第二 `JSRuntime`/`JSContext` 才能有独立 JS 线程；或短期只把**布局 + 动画 tick** 移出（内核无平台分支，`check-platform-layering.mjs` 的 D 组保证内核不得出现 `target_os` ⇒ 可安全移线程）。
- iOS：JSC 支持多 VM（`JSVirtualMachine`/`JSContextGroup`），可给渲染线程独立 VM；但跨 VM 对象不可直接传递 → 只能传字节（正好是 S2 的通道）。
- Harmony：**已实测**跨 napi 调用复用 VM 会 SIGSEGV（`host_app_runtime_impl.h:19-21`，决策 #540）→ 线程模型必须与 VM 生命周期一起设计。

**分阶段**：
- **S4.1（低风险）**：先把「录制」移出主线程——Android 已有 `RenderNode` 路径雏形（`buildUnflattened` `ProteusHostView.java:4120-4135`），改为 RenderThread 录制 + 主线程原子提交。iOS 的 `buildLayers` 同理可移到独立 `CADisplayLink` 线程（注意 CALayer 必须在主线程提交 → 只移"构建"不移"提交"）。
- **S4.2（中风险）**：内核（layout/anim）移入渲染线程 —— 内核是纯计算，天然可移。
- **S4.3（高风险）**：JS 独立线程 —— 需要第二 VM + 严格的消息契约（只能传字节）。

**判据**：`main_thread_block_ms`（单帧主线程阻塞 P95）· `js_block_main_ms`。

---

### S5 · HarmonyOS 专项（最大黑洞，也最大跃升空间）

Harmony 的渲染 ratio（0.106）看着最好，但那是"提交级/光栅级"口径——**交互链路是全端最差**（每次交互 eval 整包）。

| 编号 | 现状 | 做法 |
|---|---|---|
| **S5.1** | 每次交互重建一次性 JSVM + eval 整包（`entry-superapp.ts:425`） | 改走**持久壳 VM**（`proteus_host.cpp:26` 的 `g_shellVm` 已存在且不销毁，目前只服务 hostRuntime 探针）——把交互路径接到它上面 |
| **S5.2** | 微任务用固定轮数泵（400/4096） | 改**事件驱动**：在真实事件回调里调 microtask checkpoint，`check` 排空即止（不再固定轮数） |
| **S5.3** | 惯性滚动用 JS `setInterval(16ms)`（`Superapp.ets:501-513`） | 改 **VSync 帧回调**（ArkTS `postFrameCallback` 已有，`Index.ets:127`） |
| **S5.4** | 无 per-node 平台自插值 | 用 `OH_ArkUI_RenderNodeUtils_*` 的 transform 属性 + 帧回调做逐节点自插值（对齐 Android 的 RenderThread 模型） |
| **S5.5** | 能力族未接线（`host-invoke-contract.ts:56` 覆盖率 0） | 补齐能力桥，使三端交互能力同形（否则"三端一致"的主张在 Harmony 上不成立） |

**判据**：`interaction_boot_ms`（一次交互的 VM 建立 + eval 耗时，目标 ≈ 0）· Harmony 侧新增 `input-latency.json`。

---

### S6 · 度量与门禁（**前置，不可省**）

> 本仓纪律：**性能项没有门禁等于没做**（`00-baseline-and-roadmap.md:160`）；**先取证再断言**（AGENTS.md §先取证再断言）；**禁止盲等**（AGENTS.md 红线）。

| 编号 | 内容 |
|---|---|
| **S6.1** | 新增 `hosts/shared/input-latency.py`：三端**共同判据**（对齐 `check-cross-end-geometry.py` / `check-host-runtime.py` 的"三端同一判据"范式） |
| **S6.2** | 新增门禁 `check:input-latency`：棘轮，读写 `hosts/*/results/input-latency.json`（基线只减不增，对齐 `check:profile-baseline` / `check:no-blind-wait` 的棘轮纪律） |
| **S6.3** | **口径**：沿用 `docs/对标Benchmark执行Checklist.md` —— **触摸时间戳 → 提交时间戳**；4050 四组 × 每组 5 次；禁止跨设备比绝对值 |
| **S6.4** | **外部取证（禁止自证）**：Android `gfxinfo`（High input latency 计数）+ Perfetto（`InputReader` / `Choreographer#doFrame`）；iOS Instruments（Animation Hitches / Time Profiler）；Harmony DevEco Profiler |
| **S6.5** | 指标全集（命名对齐既有风格）：`input_latency_p50/p95/p99` · `press_feedback_ms` · `hit_test_us` · `bridge_calls_per_gesture` · `bridge_wire_bytes` · `bridge_copy_count` · `js_block_main_ms` · `main_thread_frame_work_ms` |
| **S6.6** | 新增门禁 `check:no-json-wire`（S2 的机器化）：断言生产路径不出现 `JSON.parse/stringify` 于逐帧通道（白名单：配置/一次性装载） |
| **S6.7** | 新增门禁 `check:interaction-folding`（S3 的机器化）：折叠率 + 未折叠原因台账（只减不增的"未折叠数"棘轮） |

---

## 5. 「打穿所有框架」的对外判据

| 指标 | Proteus 现状 | **Proteus 目标** | Flutter | RN 新架构 | Lynx | uni-app x |
|---|---|---|---|---|---|---|
| 输入延迟 P95（触摸→像素） | 待测（Android 高延迟计数 2431） | **≤ 1 帧（8.3ms@120Hz）** | ~1 帧 | 1–2 帧（worklet 后 ≤1） | 主线程脚本，未公开 | 原生（低） |
| 按压反馈跨界次数 | ≥ 1（过 JS） | **0** | ≥1（过 Dart） | ≥1（过 JS/JS VM） | 0（原生） | 0（原生） |
| 交互进 JS 比例（长列表） | ~100% | **< 10%** | 0（但 Dart） | worklet 可 0 | MTS 部分 | 0 |
| 跨边界序列化 | JSON 文本 + 双 UTF-8 | **0（共享内存）** | 0（FFI） | 0（JSI） | 0（引擎内） | N/A |
| 渲染成本 ratio（vs 原生） | **0.36 / 0.111 / 0.106** | 保持 | — | — | — | 拍平 229.2ms |
| 三端交互语义一致性 | **同一 Rust 内核** | 保持并扩到交互 | 单端自绘 | 各端各实现 | 各端各实现 | 各端各实现 |
| 包体 | 小（复用系统控件） | 保持 | 大 | 中 | 中 | 中 |
| JS 生态（Vue） | **完整** | 保持 | 无（Dart） | React | 自研 | Vue→UTS 有损 |

**唯一同时满足**「原生级输入延迟 + 完整 JS 生态 + 三端同一语义 + 小包体」的方案——这是本方案的对外主张，**但在真机复测并出具 §6.4 的外部取证前不得对外宣称数字**（对齐 `00-baseline-and-roadmap.md:135` 的诚实边界纪律）。

---

## 6. 分期路线

| 期 | 内容 | 验收（可证伪） |
|---|---|---|
| **P0 · 度量** | S6.1–S6.5：三端输入延迟报告 + `check:input-latency` 门禁 + 外部取证口径 | 三端各产出一份 `input-latency.json`；Android `gfxinfo` 高延迟计数**有基线**；门禁进 CI |
| **P1 · 输入旁路** | S1.1–S1.5 | `press_feedback_ms ≤ 1 帧`；`bridge_calls_per_tap == 1`；`hit_test_calls_per_gesture == 1`；Android 高延迟计数下降 |
| **P2 · 零拷贝** | S2（含三处已知浪费的修复）+ S6.6 | `bridge_wire_bytes == 0`；`bridge_copy_count == 0`；iOS `build_layers` 增量后耗时下降 ≥ 5× |
| **P3 · 编译期交互** | S3 + S6.7 | `js_involved_gestures_ratio < 10%`（长列表）；worklet 三端同形（不再只有 Skyline） |
| **P4 · 线程解耦** | S4.1 → S4.2 → S4.3 | `main_thread_block_ms` P95 下降；S4.3 需独立决策与 VM 生命周期设计 |
| **P5 · Harmony 专项** | S5.1–S5.5 | `interaction_boot_ms ≈ 0`；Harmony 惯性走 VSync；能力覆盖率 > 0 |

> 每期**必须带 benchmark 与门禁**（本仓纪律）；每期结束跑一次 §6.4 的外部取证，更新基线。

---

## 7. 风险与反例

| # | 风险 | 处置 |
|---|---|---|
| R1 | **ArrayBuffer 零拷贝的生命周期**（GC 后悬挂指针 → 崩溃） | 外部内存池 + pin/refcount；JS 持 `ArrayBuffer` 期间不可回收；`finalize` 归还池；先做**大载荷**（>4KB，对齐 `G-40.4` 铁律）不做小载荷 |
| R2 | **JS 引擎线程限制**（QuickJS 单运行时；Harmony VM 复用 SIGSEGV） | S4 分阶段；S4.3 必须在**第二 VM + 字节通道**前提下做；Harmony 沿用已有结论（决策 #540） |
| R3 | **按压态内联与 JS 权威冲突** | 定义优先级（按下期间内核优先，UP 后 JS 权威）；IR 层编译期报错；`check:*` 守住 |
| R4 | **交互折叠误判**（把有副作用的 handler 当纯函数折叠 → 行为变化） | 判据保守（全部满足才折叠，对齐"宁可少合并不错合并"）；编译期如实报告折叠率与原因；测试含反例 |
| R5 | **门禁棘轮误伤**（延迟受机器负载影响） | 基线取"多轮中位数"（对齐 `check:lights` / `check:kernel-anim` 的口径）；区分"回归阻断"与"机器抖动"；CI 上标注机器型号 |
| R6 | **批量/延迟批处理引入一帧延迟** | 交互反馈走**立即 flush 旁路**（`00-baseline-and-roadmap.md:116` 已声明该取舍）——S1 的按压态必须是"立即路径" |
| R7 | **两套宿主 ABI 并存**（`proteus_layout_*` vs `proteus_engine_*`）导致改动面翻倍 | S2 期间**统一到 Host ABI v1 的批处理红线**（`proteus_host_abi.h:13`「一帧的全部指令走一次」）；iOS 接 ABI（S1.4）是该统一的入口 |

---

## 8. 诚实边界

- 本篇的**现状数字**来自仓库既有产物（`hosts/*/results/*`、`experiments/results/summary.json`），**其中 iOS 部分多为 macOS/模拟器口径**（`00-baseline-and-roadmap.md:135` 已声明）；真机复测前，所有对外性能宣称一律标"待真机验证"。
- Harmony 的 `ratio 0.106` 是**提交级/光栅级**口径，**不代表交互链路**（交互链路是全端最差，见 §1.3）。
- S2 的 `JSObjectMakeArrayBufferWithBytesNoCopy` 路径**需先做可行性验证**（仓库现有注释记录"JSExport 对 ArrayBuffer 支持不稳"，`:270-276`）——本方案的判断是"走 C API 而非 JSExport 可解"，但**必须先跑通一个 4KB+ 载荷的零拷贝探针**再进入 P2。
- Android 的 `High input latency` 计数受设备/系统版本影响，**跨设备不可比**（对齐 `对标Benchmark执行Checklist.md` 的"三禁止项"）。

---

## 9. 与既有计划的关系（避免重复立项）

| 既有项 | 关系 |
|---|---|
| `00-baseline-and-roadmap.md` P0-a（批处理） | **已兑现**（`selfdraw-batch.ts:12` 判据已机器化）；本篇不重复 |
| `00-baseline-and-roadmap.md` P0-b（拍平） | **已兑现**（内存 −91%）；本篇不重复 |
| `host-abi` 的「批处理红线」 | **S2 的统一目标**（一帧一次调用 + 二进制线格式） |
| `packages/worklet` | **S3 的吸收对象**——从"仅 Skyline"提升为三端内核指令 |
| `docs/Proteus_App端高性能渲染落地方案.md` | 覆盖**渲染**侧 T1/T2/T4；本篇覆盖**输入**侧，二者正交互补 |
| `docs/Proteus_声明式动画引擎Morpheus方案.md` | `anim.rs` 是 S3 Tier 1 的执行底座 |
| `docs/对标Benchmark执行Checklist.md` | **S6.3 直接沿用**其量法口径 |
| `proteus-performance-plan/05-worklet.md`（30–45fps → ≥58fps） | 与本篇 S3 同一目标，本篇给出**App 三端**的落地路径（该篇偏 Skyline） |
| CDP/DevTools 逐帧耗时（决策 #676/#677） | S6.4 的**补充**取证源（但不得替代外部 profiler） |

---

## 附录 A · 三端零拷贝 API 对照

| 能力 | Android | iOS | Harmony |
|---|---|---|---|
| 外部内存 → JS 数组 | `env->NewDirectByteBuffer` + `GetDirectBufferAddress`（JNI 侧）；QuickJS：`JS_NewArrayBuffer` + `JS_GetArrayBuffer` | **`JSObjectMakeArrayBufferWithBytesNoCopy`** + `JSObjectGetArrayBufferBytesPtr` | `napi_create_external_arraybuffer` |
| 共享内存 | `AHardwareBuffer` / `ashmem` | `mmap(MAP_ANON|MAP_SHARED)` | `OH_IPC` / 匿名共享内存 |
| 输入低延迟 | **`View.requestUnbufferedDispatch`** + `getHistoricalX/Y` | `predictedTouches(for:)` | 无对应（依赖帧回调） |
| 帧驱动 | `Choreographer.postFrameCallback` | `CADisplayLink` | `UIContext.postFrameCallback` |
| 批处理指针入口 | **已有**（`nativeDispatchPointers`，`host.rs:527-593`） | **待接**（vtable 已声明） | 待建 |
| 定长记录线格式 | 已有（`ANIM_RECORD_BYTES=236`、tick 记录 32B） | 已有（`animUpdateRecordBytes`） | 已有 |

## 附录 B · 新增门禁与指标清单（供实现时对齐）

**新增门禁**：`check:input-latency`（棘轮，三端同一判据）· `check:no-json-wire`（逐帧通道禁 JSON）· `check:interaction-folding`（折叠率棘轮）

**新增指标**：`input_latency_p50/p95/p99` · `press_feedback_ms` · `hit_test_us` · `bridge_calls_per_gesture` · `bridge_wire_bytes` · `bridge_copy_count` · `js_block_main_ms` · `main_thread_frame_work_ms` · `js_involved_gestures_ratio` · `interaction_boot_ms`（Harmony）

**沿用既有口径**：帧预算 16.67ms(60Hz)/8.33ms(120Hz) · `FRAME_WORK_BUDGET_MS=8.0`（`check:lights`）· 输入延迟 P95 ≤ 1 帧（`Proteus_Benchmark案例规格.md`）· JSI P99 < 0.5ms（`07-benchmark-baseline.md`）· `payload.maxSingleOpBytes ≤ 256B`（`check:vapor-perf`）
