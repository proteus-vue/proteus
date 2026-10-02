# Proteus 鸿蒙宿主落地与方舟引擎能力开放方案

> 目标：① 鸿蒙宿主以**超高性能**落地 ② 把方舟引擎能力发挥到极致并**开放给开发者一键使用**，作为框架招牌
> 依赖：《Host ABI 宿主抽象层设计方案》§0.4、《架构收敛模型说明》、《原生能力接入方案》、《指令与 Vapor 能力缺口调研》
> 结论前置：**鸿蒙渲染架构与 Proteus 指令流天然同构——这是所有端里最顺的一个**
> **术语约定（SSOT = 《Proteus_多端一致性标准方案.md》§1）**：「不自绘」= **复用系统渲染管线**（不是"不自己实现 UI 框架"）；「自建 UI 框架」= 绕开原生控件树（L-A 层）；「一致性目标」= 可验证的一致性（非逐像素一致）。

---

## 0. 结论摘要

| 问题 | 结论 |
|---|---|
| 难度 | ✅ **比想象中低**——鸿蒙与 iOS CoreAnimation 同构，指令流天然匹配 |
| 推荐路径 | **RenderNode（API 20+）**：绕过 measure/layout 直接绘制 |
| 不推荐路径 | XComponent + NativeWindow 自绘——**违反不自绘原则** |
| 最大陷阱 | 🔴 **方舟 AOT 是 ArkTS 独有，JS 走 JIT**——但这对 Proteus 影响很小（见 §4） |
| 招牌能力怎么做 | **做成「鸿蒙特有原语」，不是开放原生 API**（见 §6） |
| 天然对接点 | NodeAdapter 系统级复用池 ↔ 你的复用率 0.997 |

---

## 1. ★ 最关键的发现：鸿蒙渲染架构与你的指令流同构

### 1.1 鸿蒙的渲染链路

```
ArkTS 代码（@State 变化）
  → 组件树变更
  → 帧节点树构建（FrameNode tree）
  → 布局计算（Measure / Layout）
  → 渲染树生成（坐标 / 颜色 / 动画状态）
  → 渲染指令树（RS 命令）
  → 轻量级 IPC 提交给 RenderService 进程
  → RS 的 RenderThread 在 VSync 下绘制
```

关键函数：`RSUIDirector::SendMessages` 把攒了一帧的 RS 命令
经 `FlushImplicitTransaction` 打包发往 render_service 进程。

> **一句话：应用只生产绘制指令，画不画、怎么合成，都是 RS 的事。**

### 1.2 这与 Apple Core Animation 高度同构

| | 应用侧职责 | 系统侧 |
|---|---|---|
| iOS | 提交 CALayer / 渲染指令 | CoreAnimation render server（独立进程） |
| 鸿蒙 | 提交 RS 命令 | RenderService / Rosen（独立进程） |
| Android | 录制 DisplayList | RenderThread + SurfaceFlinger |

**而你之前已经验证过 iOS 那条路走得通**（800 片瓦片编舞，iPhone 12 + iOS 26）。
鸿蒙是同一条路——**经验可直接迁移**。

### 1.3 对你的直接意义

你的 RenderCmd 是**平台无关的线性指令流**（带绝对坐标、拍平节点不产生独立指令）。

鸿蒙端本就要提交 RS 命令——**你的指令流与 RS 命令几乎是同一抽象层级**。

对比其他端：

| 端 | 指令流的落地形态 |
|---|---|
| Android | DisplayList / Canvas 绘制调用 |
| iOS | CALayer 层级 + 绘制 |
| 鸿蒙 | **RS 命令树（概念上最接近你的指令流）** |

---

## 2. 三条落地路径的比较（决策点 DCP-H1）

### 2.1 路径 A：ArkUI Native Node API（原生组件树）

```c
ArkUI_NativeNodeAPI_1* api = nullptr;
OH_ArkUI_GetModuleInterface(ARKUI_NATIVE_NODE,
                            ArkUI_NativeNodeAPI_1, api);
auto node = api->createNode(ARKUI_NODE_STACK);
api->addChild(parent, node);
api->setAttribute(node, NODE_WIDTH, &item);
```

ArkTS 侧用 `ContentSlot` + `NodeContent` 占位挂载。

| 项 | 评价 |
|---|---|
| 组件生态 | ✅ 完整 ArkUI 组件 |
| 布局 | ❌ **仍走 ArkUI 的 Measure/Layout**——你的 Rust 排版白做了 |
| 性能 | 🟡 中等 |

**评价**：能跑，但**绕不开 ArkUI 布局**，浪费你 0.08ms 重排的优势。**不推荐作为主路径**，可作为兜底（见 §2.4）。

### 2.2 ★ 路径 B：RenderNode（API 20+）——推荐

官方描述：

> "Since API version 20, the ArkUI development framework provides NDK APIs for
> **directly building rendering nodes**... you can **bypass the measurement and
> layout processes** associated with registerNodeCustomEvent, **directly draw
> nodes, and adjust their sizes and positions**."

关键 API：

```c
auto renderRoot = OH_ArkUI_RenderNodeUtils_CreateNode();
OH_ArkUI_RenderNodeUtils_AddRenderNode(customNode, renderRoot);
OH_ArkUI_RenderNodeUtils_AddChild(renderRoot, child);
OH_ArkUI_RenderNodeUtils_SetSize(renderRoot, 500, 500);
OH_ArkUI_RenderNodeUtils_SetContentModifierOnDraw(...);   // 自定义绘制
OH_ArkUI_RenderNodeUtils_SetFloatPropertyValue(...);      // 动态改绘制内容
```

| 项 | 评价 |
|---|---|
| 绕过 measure/layout | ✅ **正是你要的**——排版已在 Rust 侧完成 |
| 直接设尺寸位置 | ✅ 与你的**绝对坐标指令流**天然匹配 |
| 自定义绘制 | ✅ `SetContentModifierOnDraw` |
| 约束 | ⚠️ 只能挂载到 `ARKUI_NODE_CUSTOM` 叶子节点；**每个 custom 节点只能挂一个 RenderNode** |

**评价**：**推荐主路径。** 它让"Rust 排版 → 直接绘制"这条链路在鸿蒙上完整成立。

### 2.3 路径 C：XComponent + NativeWindow 自绘——❌ 不推荐

```
XComponent(type='surface') → OH_NativeWindow_* → EGL/OpenGL/Vulkan → 自绘
```

这是游戏引擎（Cocos、Unity）走的路。

| 项 | 评价 |
|---|---|
| 性能上限 | ✅ 最高（像素级控制） |
| **不自绘原则** | ❌ **违反**——桌面端方案里已经把"自绘"标为有边界的例外 |
| 原生生态融合 | ❌ 破坏（自绘的固有代价） |

**这条路径的诱惑很大，但代价是你整套架构叙事的一致性。**

> 强制约束：主路径**不得**采用 XComponent 自绘。
> 仅在"确有方舟引擎能力必须自绘承载"时（如 3D 场景）作为**局部例外**，
> 且必须显式登记、限定范围。

### 2.4 建议：B 主 + A 兜底

```
主路径：RenderNode（绕过布局，直接绘制）
兜底：  ArkUI Native Node API（RenderNode 能力不足的组件）
例外：  XComponent（仅 3D，需显式登记）
```

---

## 3. 三个必须记住的 API 版本门槛

| API 版本 | 能力 | 对你的价值 |
|---|---|---|
| **20** | **RenderNode 直接构建渲染节点** | 🏆 主路径的地基 |
| **21** | `OH_ArkUI_NativeModule_InvalidateAttributes`——**在当前帧内更新属性，防闪烁** | 动画/高频更新的关键 |
| **22** | **多线程 NDK**：`ARKUI_MULTI_THREAD_NATIVE_NODE` + `OH_ArkUI_PostAsyncUITask` | 并发创建组件，榨多核 |

### 3.1 API 21 那条对你特别重要

官方描述：用于"**update node attributes within the current frame, preventing
flickering during component switching**"。

这正好对应 Morpheus 里那个需求：**动画属性更新必须落在当前帧**，否则会闪烁。

> 实现指令：**MA0-RT 的鸿蒙端必须用 API 21+ 的 InvalidateAttributes**，
> 不得退化为"下一帧才生效"。

### 3.2 API 22 多线程：可用但要谨慎

官方描述：组件创建与属性设置可多线程并发，"fully utilizing the device's
multi-core CPU"。

但注意 **Host ABI §5.3 的硬约束**：**与内核的交互必须在 platform thread 上**。

所以：

| 用途 | 多线程 NDK 可用吗 |
|---|---|
| 组件**创建**（建树阶段） | ✅ 可用——此时不碰内核 |
| 每帧**属性更新** | ❌ **不可用**——必须回 platform thread |

> 强制约束：**多线程仅用于建树，不得用于每帧更新路径。**

---

## 4. 🔴 最大陷阱：方舟 AOT 是 ArkTS 独有，JS 走 JIT

### 4.1 事实

方舟编译器 **AOT 模式为 ArkTS 独有**，JIT 模式 ArkTS 和 JS 都用。

方舟的收益很实在（华为官方及第三方数据，需标注口径）：

| 指标 | 声称收益 |
|---|---|
| 冷启动 | 850ms → 420ms（约 -50%） |
| 1% Low 帧率 | 41fps → 57fps |
| 峰值内存 | 180MB → 95MB（约 -47%） |
| GC 停顿 | 3–8 次/分 → **0 次** |
| 内存占用 | 平均 -18% |
| 列表帧率稳定性 | +22% |

> ⚠️ 上述数字来自华为官方博客与二手整理，**测试条件与设备未统一标注**，
> 对外引用前必须核实原始口径，不得直接转述。

**而你的逻辑层是 JS/Vue → 在鸿蒙上只能走 JIT，拿不到 AOT 红利。**

### 4.2 ★ 但这恰恰是你可以讲的最好故事

AOT 的代价是**失去动态化**：

> "AOT 模式下编译产物固定，运行中不触发 JIT 编译"——
> 意味着**代码不能动态下发**。

这跟 UTS / Kuikly 的取舍**完全同构**：编译到原生即失去动态化。

**所以对照表是这样的：**

| | ArkTS 原生 | Proteus on 鸿蒙 |
|---|---|---|
| 逻辑层执行 | ✅ AOT 机器码 | 🟡 JIT |
| **动态化** | ❌ **失去** | ✅ **保留** |
| 渲染 | 系统管线 | 系统管线（**同样的 RenderService**） |

### 4.3 ★ 为什么 JIT 对你影响很小

这是论证的关键，必须说清楚：

**AOT vs JIT 的差距主要体现在「JS/TS 代码执行」上。而你的 JS 每帧几乎不干活。**

```
Vapor 之前：JS 每帧跑 VNode 重建 + diff（70ms）  → 引擎快慢很关键
Vapor 之后：VNode 与 diff 消失，只剩业务逻辑      → 引擎每帧几乎空闲
```

而且你已经实证过了：**iPhone 12 + iOS 26（很可能无 JIT）+ 800 片瓦片编舞，
58.4 FPS、p95 2.37ms、0% 逃生口**——"Rust 内核求值"，JS 不在热路径上。

**这个实证在鸿蒙上同样成立。**

> 建议：把这个论证做成对外材料的一页——
> "我们用 JIT 跑出了接近 AOT 的效果，因为热路径根本不在 JS 里"。
> 这比单纯比帧率有说服力得多。

### 4.4 🆕 外部实证：方舟引擎不支持热更新

华为官方文档（权威性极高）在 Cocos 鸿蒙构建中给出 JS 引擎三选一：

| 引擎 | JIT | 热更新 | 建议 |
|---|---|---|---|
| **方舟引擎** | **暂不支持** | **暂不支持** | 无需热更新场景 |
| V8 | 不支持 | 支持 | 轻量热更新 |
| **JSVM** | ✅ | ✅ | **推荐（全场景）** |

**这从第三方角度印证了 §4.2 的判断**：ArkTS 走 AOT / 方舟引擎就失去动态化，
而 **Proteus 的 JS 逻辑层天然保留动态化**。

> 对外可讲：**"在鸿蒙上，我们保留了 ArkTS AOT 放弃的动态化能力。"**
> 相关细节见《三方游戏引擎兼容层方案》§2.7。

---

## 5. 方舟引擎能力清单与可开放性分级

方舟引擎（HDC 2023 发布）是一套**系统级优化套件**，不是单个组件：

| 子引擎 | 领域 | 对 Proteus 的可开放性 |
|---|---|---|
| **ArkGraphics**（图形） | 渲染管线、物理动效 | 🟡 部分——见下 |
| **Ark Multimedia** | 音视频编解码、低延迟通路 | ✅ 可封装为能力原语 |
| **Ark Storage / IO** | 智能预读、碎片整理 | ⚠️ **系统自动生效，无需也不能开放** |
| **Ark 内存引擎** | 压缩、保活 | ⚠️ **系统自动生效** |
| **Ark 调度引擎** | CPU/GPU/NPU 资源调度 | ⚠️ **系统自动生效** |
| **Ark 低功耗引擎** | 功耗策略 | ⚠️ **系统自动生效** |

### 5.1 🔴 一个必须澄清的误区

**"把方舟引擎能力开放给开发者"这句话，有一半是不成立的。**

存储、内存、调度、低功耗这四个是**系统级自动优化**——
应用只要跑在鸿蒙上就享受，**开发者不需要也做不到"一键使用"**。

**对外不能宣称"我们开放了方舟六大引擎"——那会被懂行的人当场拆穿。**

### 5.2 真正可开放的是这块

只有 **ArkGraphics（2D/3D）与 Ark Multimedia** 是**可编程**的：

| 能力 | 可编程接口 |
|---|---|
| ArkGraphics 2D | Drawing / Canvas（含硬件加速后端，底层 Skia） |
| ArkGraphics 3D | OpenGL / Vulkan 后端 |
| Ark Multimedia | 硬解码、低延迟音频通路 |
| RenderNode | 自定义绘制 + 属性动态修改 |

---

## 6. ★ "开放给开发者一键使用"的正确形态

### 6.1 ❌ 不要开放原生 API

这条与《原生能力接入方案》是同一个原则：

| 开放原生 API 的后果 | |
|---|---|
| 跨端一致性 | ❌ 鸿蒙的 API 其他端没有 |
| conformance | ❌ 无法校验 |
| **AI 可校验** | ❌ 毁掉 |
| 编译期报错 | ❌ 变运行时崩溃 |

**开放任意原生调用 = 在第一王炸上开一个大口子，且是静默发生的。**

### 6.2 ✅ 正确形态：鸿蒙特有原语（Ark-Exclusive Primitive）

```
把方舟可编程能力做成「扩展语义原语」
  → 纳入原语目录（SSOT）
  → 编译期校验
  → 鸿蒙端走方舟原生实现
  → 其他端显式降级或标记不可用
  → AI 可写、可验证
```

**关键设计：跨端行为必须编译期可见。**

开发者写下一个鸿蒙专属能力时，编译器必须明确告知：

- 该能力在鸿蒙上：✅ 走方舟引擎原生实现
- 该能力在 Web / iOS / Android：降级方式是什么（或不可用）

**这不是限制，是确定性**——而这正是你整套架构的价值主张。

### 6.3 建议的开放清单（按优先级）

| 优先级 | 能力 | 形态 |
|---|---|---|
| P0 | **RenderNode 自定义绘制** | 指令流落地（内部，不对开发者暴露） |
| P0 | **NodeAdapter 长列表复用池** | 列表原语（内部优化，开发者无感） |
| P1 | ArkGraphics 2D 绘图能力 | 绘图原语（Canvas 子集） |
| P1 | 方舟多媒体（硬解码 / 低延迟音频） | 媒体类 Capability Hook |
| P2 | ArkGraphics 3D | 局部 XComponent 例外（需显式登记） |
| P2 | 分布式能力（跨设备流转） | 鸿蒙专属 Capability Hook |
| — | 存储 / 内存 / 调度 / 低功耗 | ❌ **不开放——系统自动生效** |

### 6.4 一个招牌级别的候选：分布式能力

鸿蒙的**分布式架构**（跨设备无缝协同）是别端**根本没有**的能力。

如果把它做成 Capability Hook（如"跨设备流转"），
开发者一句话调用，且**编译期明确告知仅鸿蒙可用**——
这是真正的"别的框架给不了"。

> 建议评估：这比"开放图形 API"更有招牌价值。

---

## 7. ★ 天然对接点：NodeAdapter ↔ 你的复用率 0.997

鸿蒙 NDK 提供 **NodeAdapter** 作为长列表优化核心：

- 维护**系统级列表项复用池**
- 滑出屏幕自动回收
- 滑入优先从复用池取，**只更新数据不重建节点**
- 所有节点操作在 Native 侧，JS 线程零感知

**这与你的复用率 0.997 是同一个机制，而且是系统级实现。**

| 维度 | 纯 ArkTS 列表 | NodeAdapter Native |
|---|---|---|
| 节点创建 | JS 线程 + 桥接 | Native 直接创建 |
| 复用 | LazyForEach 基础复用 | **系统级复用池** |
| 线程 | 占用 JS 主线程 | **不阻塞 JS** |
| GC | 受 JS GC 影响 | Native 手动管理 |

> 实现指令：**鸿蒙端长列表必须走 NodeAdapter**，
> 且复用策略要与内核的 Slot 身份绑定机制对齐（见 §8.2）。

---

## 8. 必须继承的既有约束

### 8.1 舍入必须在内核完成

鸿蒙**强制整数像素**（Host ABI §5.5 已记：`flex:1/3` 三列，
ArkUI 把 0.333 舍成 0.33，累计误差导致第三列错位）。

**RenderNode 路径下这个坑可以规避**——因为 `SetSize` 用的是
内核产出的绝对坐标，**绕过了 ArkUI 的布局计算**。

> 强制约束：**舍入在 Rust 内核产出指令时完成，鸿蒙 platform 层不得二次舍入。**

### 8.2 Slot 身份绑定

《Morpheus 方案》§7 的陷阱在鸿蒙上同样成立，且更危险——
**NodeAdapter 的复用池会主动回收节点**。

> 强制约束：**动画与状态必须绑定 Slot 身份，节点回收即解绑。**
> 鸿蒙端必须有专项回归测试。

### 8.3 批处理红线

RenderService 是**独立进程**，应用通过 **IPC** 提交渲染指令。

这意味着**跨进程开销真实存在**——所以 Host ABI 的批处理红线在鸿蒙上
比任何端都重要：

> **一帧一次 FlushImplicitTransaction，不得逐节点提交。**

---

## 9. 性能目标与验收

### 9.1 目标（对标已有端）

| 指标 | iOS（iPhone 12 / 60Hz） | 安卓（Redmi / 120Hz） | **鸿蒙目标** |
|---|---|---|---|
| 布局 | — | 0.063ms | **≤ 同档** |
| 绘制 | — | 0.583ms（荣耀 10） | **≤ 同档** |
| 800 片编舞 | 58.4 FPS / p95 2.37ms | — | **≥ 同档** |
| 内存增量 | — | 0.328× | **≤ 同档** |
| 一致性 | 0.375dp | 0.375dp | **0.375dp** |

### 9.2 验收清单

- [ ] 4050 元素场景达标（对标 uni-app x 基准口径）
- [ ] 长列表 2 万元素达标
- [ ] **5 分钟长跑无衰减**（两个月项目最典型的延后爆发点）
- [ ] 内存增量达标
- [ ] 三端一致性 0.375dp
- [ ] 鸿蒙特有原语的降级行为**编译期可见**
- [ ] NodeAdapter 复用池 + Slot 身份绑定专项回归通过

---

## 10. 里程碑

### HM0 · 路径验证 spike（≈1 人周）★ 一票否决

- [ ] RenderNode 能否承载完整指令流（绕过 measure/layout）
- [ ] `SetContentModifierOnDraw` 的绘制能力边界
- [ ] 每个 custom 节点只能挂一个 RenderNode 的**规避方案**
- [ ] API 版本门槛确认（20/21/22）与目标设备覆盖率

**出口判据**：RenderNode 跑不通 → 回退路径 A，并重新评估性能目标。

### HM1 · platform 层实现（≈3 人周）

- [ ] 指令解释器（RenderCmd → RS 命令）
- [ ] 文本度量（鸿蒙文本引擎）
- [ ] 图片解码
- [ ] **舍入在内核完成**（§8.1）
- [ ] 原生组件挂载

### HM2 · hosts 层实现（≈2 人周）

- [ ] Ability 容器骨架
- [ ] 生命周期转发
- [ ] 输入采集（**带时间戳**）
- [ ] VSync 帧调度驱动
- [ ] 能力插件注册
- [ ] 路由栈挂钩

### HM3 · 长列表与复用（≈1.5 人周）

- [ ] NodeAdapter 接入
- [ ] 与内核 Slot 身份绑定对齐
- [ ] 复用率与内存实测

### HM4 · Morpheus 鸿蒙端（≈1.5 人周）

- [ ] 合成属性判定 → RenderNode 属性路径
- [ ] **API 21+ InvalidateAttributes**（当前帧生效）
- [ ] 布局动画（几何在 Rust 侧）

### HM5 · 方舟能力原语化（≈2 人周）

- [ ] ArkGraphics 2D 绘图原语
- [ ] 方舟多媒体 Capability Hook
- [ ] 分布式能力评估（§6.4）
- [ ] 跨端降级声明机制

### HM6 · 对标实测（≈1 人周）

- [ ] 按 §9 全部验收项
- [ ] 5 分钟长跑

---

## 11. 坑位清单

| # | 坑 | 应对 |
|---|---|---|
| 1 | **被 XComponent 自绘诱惑** | 违反不自绘原则；仅 3D 可作局部例外（§2.3） |
| 2 | **仍走 ArkUI 布局** | 浪费 0.08ms 重排；必须 RenderNode 绕过（§2.2） |
| 3 | **误以为能拿到 AOT** | AOT 是 ArkTS 独有，JS 走 JIT（§4）——但影响很小 |
| 4 | **宣称"开放六大引擎"** | 存储/内存/调度/低功耗是系统自动生效，无法开放（§5.1） |
| 5 | **开放任意原生 API** | 毁掉 conformance 与 AI 可校验（§6.1） |
| 6 | **平台层二次舍入** | 复用鸿蒙整数像素坑；舍入必须在内核完成（§8.1） |
| 7 | **动画绑 Node 而非 Slot** | NodeAdapter 主动回收节点，风险高于其他端（§8.2） |
| 8 | **逐节点提交指令** | RenderService 是独立进程，IPC 开销真实（§8.3） |
| 9 | **每帧用多线程 NDK** | 与 platform thread 约束冲突；仅建树可用（§3.2） |
| 10 | **动画属性下一帧才生效** | 必须用 API 21+ InvalidateAttributes（§3.1） |
| 11 | **未做 5 分钟长跑** | 两个月项目最典型的延后爆发点 |

---

## 12. 给实现 LLM 的执行指令

1. **HM0（RenderNode 路径验证）未完成前，不得开始 HM1。** 这是唯一可能一票否决的项。
2. **主路径必须是 RenderNode（绕过 measure/layout）**，不得默认走 ArkUI 组件树。
3. **不得采用 XComponent 自绘作为主路径**——它违反不自绘原则。
   ArkGraphics 3D 如需自绘，必须显式登记为局部例外并限定范围。
4. **舍入在 Rust 内核完成时完成**，鸿蒙 platform 层不得二次舍入。
5. **一帧一次提交**（对应 `FlushImplicitTransaction`），不得逐节点提交。
6. **动画与状态绑定 Slot 身份**，NodeAdapter 回收节点时必须解绑；需专项回归测试。
7. **不开放任意原生 API**——方舟可编程能力必须做成扩展原语，纳入原语目录。
8. **鸿蒙特有原语的跨端降级行为必须编译期可见**，不得静默失效。
9. **不得宣称"开放方舟六大引擎"**——存储 / 内存 / 调度 / 低功耗是系统自动生效，
   不可开放也无需开放。
10. **多线程 NDK 仅用于建树**，每帧更新路径必须在 platform thread。
11. **动画属性更新必须走 API 21+ InvalidateAttributes**，确保当前帧生效。
12. 长列表**必须走 NodeAdapter**，复用策略与内核 Slot 机制对齐。
13. 所有性能数字**按 §9 口径采集**，含 5 分钟长跑；对外引用方舟官方数字前必须核实原始口径。

---

## 13. 为什么鸿蒙值得做成招牌

| 维度 | 说明 |
|---|---|
| **架构同构** | 与 iOS CoreAnimation 同一模型，指令流落地最顺 |
| **绕过布局** | RenderNode 让"Rust 排版 → 直接绘制"完整成立 |
| **系统级复用池** | NodeAdapter 与你的 0.997 复用率天然对接 |
| **动态化对照** | ArkTS 选 AOT 失去动态化，你保留动态化且性能靠架构补 |
| **独有能力** | 分布式跨设备流转——别端根本没有，可做成 Capability Hook |
| **叙事价值** | "JIT 跑出接近 AOT 的效果，因为热路径不在 JS 里" |

> **最后一句提醒**：鸿蒙端最容易翻车的不是技术，是**表述**。
> "开放方舟引擎"这个说法有半数是错的（§5.1），
> 对外必须精确为"**可编程能力原语化 + 系统级优化自动享受**"。
