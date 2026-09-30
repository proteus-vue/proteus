# Proteus 声明式动画引擎方案

> 定位：**框架层内置的高性能动画引擎**——开发者开箱即用，不必写复杂动画算法
> 适用：Proteus v2.47+（Vue 3.4 / Vite 5 / TS 5.4）
> 依赖：《路由与动画系统设计方案》《Vapor IR 设计方案》《App 端高性能渲染落地方案》
> 结论前置：**做「声明式 + 编译期收敛 + 预设驱动」的动画引擎，不做「通用动画库」**

---

## 0. 结论摘要

| 问题 | 结论 |
|---|---|
| 该不该做 | ✅ **该做**——只开放 API 会让开发者必踩打断/协调/生命周期/调参四个坑 |
| 照 Reanimated 做？ | ❌ **不要**——它为"逃离 JS 线程"而生，你的动机不同 |
| 你的真正理由 | **把"编译期收敛"这套方法论应用到动画领域** |
| **转场为什么能极快** | **平台白送**（Android RenderThread / iOS CoreAnimation render server）——Flutter 自绘，才被迫自建 raster thread |
| **转场快的前提** | 只动**合成属性**（transform / opacity）；动了布局属性则红利**完全失效** |
| 最大超能力 | **布局动画（FLIP）**——几何本就在 Rust 侧，零跨边界查询 |
| 最大陷阱 | **节点复用 × 动画**：动画必须绑 Slot 身份，不能绑 Node 身份 |
| 关键边界 | 动画是收敛模型**第一次正面撞上"连续运行时"**，必须先定边界 |

---

## 1. 命名

### 1.1 命名逻辑

框架名 **Proteus** 取希腊海神"能化作狮子、蛇、野猪、流水与大树"之意，
英语 `protean`（千变万化）即源于此——**"形态变换"正是框架的核心隐喻**。

动画引擎的命名应在这个体系内延续，语义指向**形态变化**或**时间/运动**。

### 1.2 候选与查重结论

| 候选 | 语义 | 查重结果 | 评估 |
|---|---|---|---|
| 🥇 **Morpheus** | 希腊梦神；词根 **morph-** = 形态变化（动画里 "morph" 本就是形变术语） | ⚠️ 有占用但**均不在同领域**：Ender 的老动画框架、Morpheus 2D game engine（NDS/GBA）、SVG-Morpheus、Morpheus Data（云管理公司） | **推荐**。语义最贴（morph ↔ protean），发音好、短、易记。风险是 Matrix 的文化联想 |
| 🥈 **Thetis** | 海洋女神，**变形传说与 Proteus 高度平行**（被擒时不断变换形态） | ✅ 未发现同领域占用 | **最干净的备选**。同属海神体系，与 Proteus 的隐喻几乎成对 |
| 🥉 **Kairos** | 时机之神，意为"恰当的时机"；动画的本质就是 **timing** | ✅ 未发现同领域占用 | 雅致备选。语义偏抽象，不如前两者直观 |

### 1.3 ⚠️ 两个必须排除的名字（查重已确认占用）

| 名字 | 占用情况 | 为什么必须排除 |
|---|---|---|
| ~~**Iris**~~ | **iris-engine**（Rust crate）——Rust + **Vue 3** 前端运行时，**内置 AnimationEngine**；另有 Iris C++ 游戏引擎 | **领域高度重合**（Rust + Vue3 + 动画引擎），混淆风险极大 |
| ~~**Kinesis**~~ | Kinesis.js（`@aminerman/kinesis`，交互动画库）+ `@timwickstrom/kinesis`（easing tokens） | 前端动画领域已两次占用 |
| ~~**Triton**~~ | NVIDIA Triton（深度学习编译器/推理服务器） | 跨领域强占用 |
| ~~**Hermes**~~ | Hermes JS 引擎 | 与本文档讨论的 JS 引擎重名 |

### 1.4 建议

**主推 `Morpheus`，备选 `Thetis`。**

下文统一以 **Morpheus** 指代本引擎；如最终定名不同，全文替换即可。

> 定名前建议在 npm / crates.io / GitHub 再做一次商标与包名检索——本文档查重基于公开检索，不构成商标意见。

---

## 2. 为什么该做：开发者必踩的四个坑

只开放动画 API，开发者会踩这四件事——**一个引擎只要把前三条做对就值回票价**：

| # | 坑 | 表现 |
|---|---|---|
| 1 | **打断** | 手势中途介入，动画直接跳变，而不是保留速度平滑接管 |
| 2 | **协调** | 两个动画改同一属性；手势与动画抢同一个值 |
| 3 | **生命周期** | 组件卸载了动画还在跑，往已死节点写值 |
| 4 | **调参** | spring 的 damping / stiffness / mass 全靠手调 |

**第 4 条靠预设解决，不靠暴露参数**（见 §6）。

---

## 3. ★ 你的理由必须换掉

Reanimated / Skyline 做 worklet 的动机是 **逃离 JS 线程**——
双线程架构下事件要跨线程往返，做拖拽会有可见延迟。

**这个动机在你这里不成立**：

```
排版 0.08ms · 槽位 O(1) · 复用率 0.997（无 GC）
→ JS 线程能造成的阻塞本来就极有限
```

**如果你照 Reanimated 的形状做，是在为一个不存在的问题建方案。**

### 3.1 你真正的理由

> **把"编译期收敛"这套方法论，应用到动画领域。**

```
动画声明进封闭集
   → 编译期校验
   → conformance 覆盖
   → AI 可写且可验证
```

这与 CSS Profile、187 原语是**同一套打法**——这才是它配得上你架构的原因。

否则它就只是个库，而 Reanimated 在这个赛道已跑了好几年，**正面对撞不划算**。

---

## 4. 🔴 必须先承认的边界：连续量问题

这是最该警惕的一点。

你的护城河建立在**编译期封闭**上。但动画是**时间连续的运行时行为**：

| 部分 | 能否收敛 |
|---|---|
| 动什么属性、什么曲线、时长、链式编排 | ✅ **可编译** |
| t=0.37s 时的具体值 | ❌ 运行时算 |
| **手指位置驱动的值** | ❌❌ 完全运行时，且必须零延迟 |

**这是封闭集第一次正面撞上"开放运行时"。**

它与 IME、Capability Hook 属于同一类问题——**必须设计边界，不能假装不存在。**

### 4.1 Morpheus 的双层结构

```
┌─ 编译层（可收敛）─────────────────────────┐
│ 动画声明：目标属性 / 曲线 / 时长 / 编排    │
│          / 协调关系 / 打断策略            │
│              ↓ 编译为 IR 指令             │
└──────────────────────────────────────────┘
┌─ 运行时层（不可收敛）─────────────────────┐
│ 每帧求值：spring 物理 / 手势输入 / 打断接管 │
└──────────────────────────────────────────┘
```

**这个边界要先定——它决定后面所有东西的形状。**

### 4.2 逃生口设计

编译层覆盖不了的（自定义缓动、复杂编排），必须走**显式逃生口**，
且逃生口要**可统计**（与 UC0 的"漏点统计"同构）：

- 记为 `degraded`（行为可能不一致）——**最高危险度**
- 不得与其他类别混在报告里，必须单列

---

## 5. ★ 你的超能力：布局动画（FLIP）

这是 Morpheus 最值得单独拎出来的能力。

### 5.1 传统 FLIP 的代价

```
变更前读一次几何 → 变更后读一次 → 反算 transform 补间
              ↑ 两次跨边界查询几何，VDOM 框架里很贵
```

### 5.2 你的架构里它几乎白送

**几何本来就在 Rust 排版核心里**：

```
变更前几何 ┐
           ├─ 都在 Rust 侧，零跨边界
变更后几何 ┘
        ↓
   直接生成补间指令
```

配合 **0.08ms 全量重排**——
「列表项增删时其他项平滑让位」这种效果，你几乎免费。

而在 Flutter（AnimatedContainer / ReorderableList 需额外工作）
与 RN（LayoutAnimation 支持面窄）里，这都是痛点。

### 5.3 建议

**把这个做成 Morpheus 的招牌能力。**
它是"架构带来的差异化"，不是"又一个动画库功能"——这个区分很重要。

---

## 5-bis. ★ 转场动画：RenderThread 零参与路径（平台红利）

### 5-bis.0 先纠正一个说法

准确表述不是"我们做 Flutter 的方案"，而是——
**平台已经把这个东西白送给我们了，Flutter 才是被迫自建的那个。**

| | 逻辑线程 | 渲染线程 |
|---|---|---|
| **Flutter** | Dart build + layout + paint 录制 → LayerTree | **自建 raster thread** 做光栅化 |
| **Android 原生** | measure / layout / draw 录制 DisplayList | **系统 RenderThread**（Android 5.0 起）转 GPU 指令 |
| **iOS** | 主线程提交 transaction | **CoreAnimation render server**（独立进程） |

关键事实：**Flutter 不使用 Android RenderThread**——它自绘，所以必须自己建一套。

而我们不自绘 → **直接用系统的**，零成本，且它比 Flutter 自建的更成熟（操作系统级组件）。

Android 官方文档对 RenderThread 的定义：
> "A new system-managed processing thread called RenderThread keeps animations smooth
> even when there are delays in the main UI thread."

### 5-bis.1 🔴 分水岭：只有「合成属性」享受这个红利

这是转场能不能真的快起来的唯一关键：

| 动的属性 | 走哪条路 |
|---|---|
| `translation / scale / alpha / rotation` | ✅ **RenderThread 直接更新 RenderNode，主线程无需参与每帧** |
| `width / height / margin / LayoutParams` | ❌ 触发 `requestLayout` → measure+layout+draw，**异步优势完全失效** |

iOS 同理：动 `transform` 是 GPU 加速，动 `frame` 触发布局重算。

**所以转场能快，是因为它天然只需要动 transform / opacity。**

> ⚠️ 工程陷阱：若在动画回调里改 `LayoutParams` 或调用 `invalidate()`，
> 会强制触发主线程 `requestLayout()` 全链路，**RenderThread 的异步优势完全失效**。

### 5-bis.2 ★ 关键机制：合成属性集合在编译期判定

这一点是 Morpheus 相对 Flutter / RN 的结构性优势：

```
编译期分析动画声明
  → 属性集 ⊆ { transform, opacity } ？
      ├─ 是 → 走「提交一次 + RenderThread 自主插值」路径
      │        主线程在整个动画期间零参与（MA-RT 路径）
      └─ 否 → 编译期报错 / 显式降级标记（degraded）
```

**它把"会不会掉帧"从运行时问题变成了编译期问题。**

对照：Flutter 里开发者不小心在动画回调改了布局属性，只能靠运行时 profile 发现；
**我们能在编译期拦住。**

### 5-bis.3 两类动画的分野（互补，不冲突）

| 类型 | 能否走 RenderThread | 靠什么 |
|---|---|---|
| **页面转场** | ✅ 只动合成属性，主线程零参与 | **平台白送**（§5-bis） |
| **布局动画**（列表项让位） | ❌ 必须改布局 | **0.08ms 全量重排**（§5） |

**两者合起来才是完整能力，而别人往往只有一半。**
这也是 Morpheus 相对 Reanimated / Flutter 动画库的结构性覆盖优势。

### 5-bis.4 两条实现约束

**① 共享元素转场是另一回事**
它需要跨页面几何传递 + 原生视图层级提升（把元素盖在两个页面之上），
三平台实现不同，**须在 `platform/` 层各写一份**。
好消息：**几何本来在 Rust 侧**，这步我们比别人省事。

**② 这个红利依赖「不自绘」**
桌面端 Linux 若走"统一后端"那个例外，此红利消失——
那时就得自建 raster thread。
**此条应作为《桌面端可行性评估方案》中"倾向系统管线"的又一个决策依据。**

---

## 6. "开箱即用" = 预设，不是参数

开发者的真实需求不是"能配 spring 参数"，是：

> "这个列表项飞到详情页" —— 一句话能写出来

### 6.1 预设库清单（按优先级）

| 预设 | 说明 | 现状 |
|---|---|---|
| 路由转场 | halfScreen / slideUp / scaleDown | ✅ **已有，是现成地基** |
| **共享元素** | B1 benchmark 案例的核心环节 | ✅ **已落地并真机验证**（内核几何原语 + 宿主层级提升；`fromNodeId`/`fromRect` 两种源） |
| **列表项增删让位** | §5 的超能力 | ✅ **预设已落地**（`presets.list.shift()`；内核 FLIP + `staggerMs`，真机 215 节点通过） |
| 滚动联动 | 吸顶 / 视差 / 渐显 | ✅ **已落地并真机验证**（`presets.scroll.*`，MA5；驱动在宿主滚动通路，零 JS 参与） |

**先做预设，引擎够用就行。**

### 6.2 与微信预设对齐

仓库已支持 `routeType: 'wx://bottom-sheet'`。
微信小程序内置一批 routeType：`wx://bottom-sheet`、`wx://upwards`、`wx://zoom`、
`wx://cupertino-modal`、`wx://cupertino-modal-inside`、`wx://modal-navigation`、`wx://modal`。

**建议 Morpheus 的预设语义与之对齐**——降低开发者认知负担，且便于双端一致。

---

## 7. ★ 你的架构特有陷阱：节点复用 × 动画

这条必须现在写死，否则后面一定会踩。

### 7.1 问题描述

你的列表复用率是 **0.997**——**节点会被回收给不同数据项用**。

> 一个飞入动画若绑定在**节点**上，节点被回收给第 2001 行的数据
> → **你会看到错误的那一项在做飞入动画。**

### 7.2 为什么这个坑很隐蔽

- **VDOM 框架没这问题**（节点随数据重建）
- 你有——**因为复用正是你的核心优势**
- 小规模测试完全看不出来
- 只有长列表快速滚动时偶发，**到那时已极难归因**

### 7.3 强制约束

> **动画必须绑定到 Slot 身份，不是 Node 身份。**
> **节点回收时，动画状态必须一并解绑。**

这条应写成**架构不变量**，并配专门的回归测试。

---

## 8. 与 RT0 的解耦时序

之前路由动画方案把 **RT0**（IR 指令路径 vs JS 路径的 spike）设为硬门禁。
这里要修正：**Morpheus 不该整体被它拦住**。

| 步骤 | 内容 | 是否受 RT0 阻塞 |
|---|---|---|
| **第一步** | 定义编译层 / 运行时层边界 | ❌ 立刻做，便宜，解锁一切 |
| **第二步** | 声明式表面 + 预设库 | ❌ 与 RT0 结论无关，可直接做 |
| **第三步** | 运行时核心（先用 JS 兜底） | ❌ 边做边等 |
| **第四步** | RT0 出结论 → 决定是否换成 Rust 指令求值 | ✅ |
| **第五步** | 手势系统 | ❌ 深水区，单独 |

**因为边界先定好了，第四步换运行时是"换实现"不是"重做"。**

---

## 9. 三个"不要"

| ❌ 不要 | 原因 |
|---|---|
| **照抄 Reanimated 的 API 形状** | 它为"逃离 JS 线程"而生，你的问题不同（§3） |
| **开放任意 JS 动画函数** | 与"不开放任意原生调用"同理——会毁掉 conformance 与 AI 可校验 |
| **把手势并进动画引擎** | Android NestedScrolling 与 iOS UIScrollView 竞争机制不同，是另一场仗 |

---

## 10. 里程碑

### MA0 · 边界定义 —— ◐ **四项中三项已落地并机器化（2026-09-30）**

- [x] **编译层 / 运行时层边界（§4.1）**—— 以下跌落到**代码**（不是散文）：
      · 编译层：`AnimDecl` 封闭集（5 属性 / 5 曲线 / 单段时间轴）+ 编译期校验（7 类）在 `@proteus-vue/animation`；
      · 运行时层：曲线求值 / 物理积分 / 窗口换算 / 几何原语**只在**内核（`layout-core-rust/src/anim.rs`）；
      · **"t=0.37s 时的具体值"永不跨边界**：宿主只报"滚到哪/手势到哪"，宿主与 JS 零曲线数学（纪律 #22）
- [x] **Slot 身份绑定约束（§7.3）**—— 机制**已落地并真机验证**（`stop_nodes` 含清值 +
      宿主 `onRowDematerialized` 自动解绑 + 真机 D 组两条判据）；
      ★**如实边界**：绑的是 **node id**（§7.3 的第二句"回收即解绑"），
      `VirtualRow.key` 存了但**尚未消费**、`setupVirtual` 只在挂载时调用（无"行数据重键"路径）
      ⇒ "同 id 换数据、动画应失效"这一形态当前**不可达**（见说明书 `boundary/slot-identity-binding`）
- [x] **逃生口分类与统计口径（§4.2）**—— ✅ **已落地（2026-09-30）**：
      `EscapeRegistry`（`packages/animation/src/escape.ts`）——**显式通道** + 三要素必填
      （做什么/为什么/行为风险，缺任一当场抛错）+ **degraded 单列报告** + 率对照 5% 目标 +
      `compileAnimations(..., { escapes })` 可选注入（不注入 ⇒ 零副作用，纯函数性质不变）
      · 类别封闭集 6 类（custom-easing / external-driver / layout-property /
        cross-property-timeline / platform-mixing / other），**类别汇总恒输出**（零值也列 ⇒ 无"未归类"黑洞）
      · ★校验失败时报错**指向逃生口通道**（不是只说"不支持"）
      · 与 UC0 漏点计数器（C4 `GapCounter`）**同构但方向相反**：那个编译期自动发现，
        这个需开发者主动登记（框架无法自动发现"你在框架外自己写 rAF"）
- [x] **合成属性集合的编译期判定规则**（§5-bis.2）—— ✅ **内核侧已落地**：
      `AnimKind::is_composited()` + `plan_animations()`（判定在内核，唯一实现）；
      返回 `plan.composited` + `nonCompositedKinds` 供上层报错

**出口**：边界文档（本节 + 说明书 24 条） + 回归测试用例（TS 63 条 + Rust 156 条 + 真机 51 条） + 合成属性判定表。

**★补记（2026-09-30）：原记"未做"的「跨属性共享时间轴」经取证后已落地**——
   内核 `tick` 单次调用内对**所有**动画施加同一个 `dt` ⇒ 只要总时长相同即为**结构性同拍**
   （Rust 两条判据钉住）；缺的只是**声明面入口**（手写凑时长极易算错且不报错）⇒
   `compileTimeline({kinds, stops})`：停靠点共享、总时长由构造保证一致、段曲线取自上一停靠点；
   与手写 `keyframes` 编译结果**逐字节等价**（证明不是第二条实现）。

### MA0-RT · RenderThread 零参与路径 —— ◐ **iOS 侧已落地并真机验证（2026-09-30）**

- [x] **合成属性判定**（transform / opacity 子集检查）：`AnimKind::is_composited()` +
      `plan_animations()` —— 判定在**内核**（唯一实现），随提交规格一起返回
- [x] **提交一次 + 平台自主插值**（iOS）：`proteus_layout_anim_commit_spec`（Rust 生成**节点级采样**）
      → `CAKeyframeAnimation` 提交给 **CoreAnimation render server**（独立进程）⇒ 主线程此后零参与
      · 真机：`committed=1`（1 节点 2 属性合并为一条动画）· `hasPresentation=true`（平台确实在插值）
- [x] **非合成属性的明确报错与降级标记**：`plan.composited=false` ⇒ 宿主返回错误 + 违规属性列表
      （**不静默降级**）· 真机判据 G4
- [ ] 三端 `platform/` 层实现（共享元素跨页面几何传递 + 视图层级提升）—— 独立工程量
- [x] **Android RenderThread 侧（容器级）**：`ProteusHostView.animatePageComposited`
      （`ViewPropertyAnimator` → `RenderNodeAnimator` → 渲染线程）
      · 真机：**`onDrawCount` delta = 0**（动画全程主线程零绘制）·
        tx 逐帧插值 **50.37 → 88.91 → 109.42 → 118.36 → 120**（easeOutCubic 减速形态）·
        终态精确（tx=120 / alpha=0.5）· 曲线贝塞尔来自内核（`PathInterpolator`）
      ★**诚实边界：Android 的落点是"容器级"，与 iOS 的"逐层"不同**——见下条

**★★两端形态差异（本轮实测的架构事实，必须写下来）**：
| | iOS | Android |
|---|---|---|
| 生产绘制 | **CALayer 树**（每节点一层） | **单 ViewGroup + Canvas 指令直下发**（真拍平，**无 per-node 平台对象**） |
| 平台零参与落点 | **逐层**（每节点一条 `CAKeyframeAnimation`） | **容器级**（`ViewPropertyAnimator` 动宿主 View 的 transform/alpha） |
| 覆盖场景 | 转场 + 任意节点的合成动画 | **整页转场**（最主流的合成动画场景） |
| 逐节点平台动画 | ✅ 已落地 | ✅ **已落地（载体 View 路径）** —— 见下 |

**★★Android 两条路径都已就位（2026-09-30 末轮补齐内核路径）**

| 路径 | 覆盖 | 实现 |
|---|---|---|
| **平台**（零参与） | 整页转场 / 节点级合成动画 | 容器级 `ViewPropertyAnimator` · 载体 View（见下） |
| **内核**（逐帧求值） | **序列编排 / 滚动联动 / 共享元素**（平台路径表达不了） | JNI 转发内核 + 宿主逐节点 `Canvas` 变换 + Choreographer 帧循环 |

★**为什么必须补内核路径**：本端此前只有平台路径 ⇒ `keyframes` / `scroll` / `sharedElement`
在 Android 上**根本无法运行**。补齐后 M1–M7 真机全过（曲线求值形态 / 终值精确 / 序列段边界 /
滚动窗口映射 / 共享元素几何 / 真帧循环 57 帧 · p50 0.098ms · 稳态零布局）。
判据：`hosts/android/check-kernel-anim.py`（6 条破坏用例全红）。

**★★Android 逐节点：为什么是"载体 View"而不是 per-node `RenderNode`（2026-09-30 取证结论）**

据**本机 `android.jar`（API 34）实测**（`javap`，非记忆）：
- `android.graphics.RenderNode` 与 `Canvas.drawRenderNode` **是公开 API**（`setTranslationX/Y`、
  `setScaleX/Y`、`setRotationZ`、`setAlpha`、`setPivot`、`beginRecording` 均可调用）；
- 但 **`android.view.RenderNodeAnimator` 不在公开 API 里** ⇒ 裸 `RenderNode` 的属性只能被
  **主线程逐帧"设置"**，**无法在 RenderThread 上动画**；
- 能被平台动画的只有 **View**（`ViewPropertyAnimator` → 内部的 RenderNodeAnimator）。

⇒ 落点：把被动画的节点**提升**为一个只含它那几条指令的**载体 View**（`ProteusHostView.attachAnimCarrier`），
   由平台动画驱动其 transform/alpha ⇒ 内容不重绘、主线程不参与。
   · **不是"改回 View 体系"**：载体只承载被动画的节点（通常 1–3 个），其余仍走 `onDraw` 指令流；
   · 播放期间该节点的指令从指令流**跳过**（否则重影）；动画结束载体即拆除并恢复。
   · `Cmd` 保持纯净（不含 node id）——"哪些指令属于哪个节点"是由**适配器/簿记**提供的外部信息
     （判据侧由探针直接给下标），不需要把协议改脏。

**真机判据（`hosts/android/check-platform-anim.py`，容器级 + 逐节点，7 条判据 + 7 条破坏用例）**
| 判据 | 读数 |
|---|---|
| B2 **动画期三个"零"** | draw / measure / layout 增量都为 0，且 4 个采样点计数恒定 (2,3,3) |
| B3 终态精确 | tx=120 / ty=300 / scale=0.6 / alpha=0.5 |
| B3b 逐帧推进 | 4 个不同读数 54.84 → 91.58 → 110.76 → 118.75（easeOut 减速形态） |
| B4 拆除后恢复 | carriers=0 · 指令流重新绘制 · 像素非空 |
| A2/A4（容器级） | 逐帧推进 + draw_delta=0（**本轮补齐的机器判据**——此前只有手工读数） |

★**判据口径（一处易错，真机读数纠偏换来的）**：B2 量的是**动画窗口内**增量（基线在动画中途取）——
`addView` 接入载体的**一次性**布局/绘制成本不该算作"主线程参与了动画"（报告里如实记录该值）。

**★两条实现纪律（本轮确立，各有判据守住）**：
1. **曲线求值只在 Rust**（唯一实现）⇒ 提交规格由内核**采样**（17 点/节点），宿主只做
   "翻译成平台 API"，**Swift 侧零曲线数学**（否则是"第 N 份手写副本"）；
2. **弹簧必须离线采样、不能用平台的 spring**——iOS `CASpringAnimation` / Android
   `SpringAnimation` 的参数语义与本引擎（stiffness/damping/mass 半隐式欧拉）**不一致**，
   直接交给它们会让"提交路径"与"tick 路径"观感分叉 ⇒ 用同一套积分采样
   （单测 `commit_spec_spring_uses_same_integration_as_tick` 守住）；
   ★且**采样窗口必须用"自然静止时间"**（不是名义 `dur_ms`）——否则被端点钉死**截断**
   （单测 `spring_commit_window_covers_natural_settle` 守住）。

**验收（iOS 侧已达）**：提交后主线程不再写值 ⇒ 由 render server 自主插值。
★**2026-09-30 补：主线程零唤醒已实测**（改用 **OS 级 CPU 会计**——见下）。

**★★为什么不用 Instruments / xctrace（取证链条，如实记录）**：本机 Xcode 26.5 的 `xctrace` **无法录制本设备**——
它是分层可用的：`ioreg` 显示 iPhone 在 USB 上 ✓ · `xcdevice list` 报 available ✓ · Mac 本地录音正常（产出 trace）✓ ·
设备侧 `devicectl` 报 booted / DDI available / dev mode enabled / unlocked ✓ —— 唯独 `xctrace record --device` 卡在
`Waiting for device to boot` 超时。→ **DeviceSupport 设备支持包只有 26.3，而设备已升 26.7**
（补它要下 GB 级支持包，属环境准备而非代码问题）。

⇒ 改用 **OS 级 CPU 会计**（`thread_info(THREAD_BASIC_INFO)` 两次采样之差 = 窗口内主线程真实 CPU），
这正是"零唤醒"要证的东西，且**可机器判定**（比人看波形更可回归）。**配阳性对照**是关键：

| 判据 | 读数（iPhone 12 · 600ms 窗口） |
|---|---|
| L0 前置：平台动画已提交 | committed=1（否则"零 CPU"是"什么都没发生"） |
| L1 阳性对照：tick 路径必须有显著开销 | **17.4ms**（< 5ms 即判"探针没测到"，不得判绿） |
| L2 比值：平台路径显著更低 | **1.0ms** vs 17.4ms ⇒ **比 0.06 ≤ 0.25** ✓ |

★L2 的 1.0ms 是**提交本身**与首帧开销——提交一次后主线程确实不再逐帧参与
（对照 tick 路径 17.4ms = 600ms 里每帧写层）。

### MA1 · 声明式表面 + 预设 —— ◐ **主体已落地并真机验证（2026-09-30）**

> 新建包 `@proteus-vue/animation`（43→44 包，零运行时依赖）：**声明 → 校验 → 编译成引擎指令**的纯函数层，
> 不含任何曲线数学（那是内核唯一实现）。真机判据 H 组 6/6 全过（`hosts/ios/check-anim-rt2.py`）。

- [x] **声明式 API**：`AnimKind`（5 属性封闭集）+ `Curve`（5 曲线封闭集）+ `AnimDecl`
      （from/to/duration/delay/curve/spring/takeover）——所有取值都是**跨语言契约编号**
      （`ANIM_KIND_ID`/`CURVE_ID`，两侧测试钉住）
- [x] **编译期校验 + 报错**：7 类判据（参数非法 / 同属性重复 / 非合成属性 / 目标缺失 / 未知 kind/curve）
      —— `validateAnimations` + `formatIssues`（附修复提示）· 真机 H5 验证「同属性重复被拦」
      ★真机测试自己踩出来的判据：内核对同 (节点,属性) 是**替换**语义 ⇒ 同批次重复会静默替换 ⇒ 编译期拦截
- [x] **预设库：路由转场 4 个**（`bottomSheet`/`slideUp`/`zoom`/`cupertinoModal`，语义对齐微信
      `wx://bottom-sheet` 等 routeType）· **元素预设 3 个**（fadeIn/pressRelease/sharedElementFlyIn）
      · **手感预设 2 个**（`easing.snappy/smooth`，与内核 `SpringParams` **同值**，两侧测试钉住）
      · 真机 H4：`bottomSheet` 预设驱动端上动画（mid ty=150.4 → end ty=0）
- [x] **编排（sequence）**—— ✅ **已落地并真机验证（2026-09-30，MA6）**：
      内核对同属性是替换语义 ⇒ 多段收敛到**一条动画**里（内核 `AnimMode::Keyframes`）；
      声明侧 `AnimDecl.keyframes` + 预设 `element.press()`（下压+回弹）/ `element.shake()`（抖动三段）；
      求值入口收敛为唯一 `value_at_progress`（tick/seek/滚动三处同源——避免"seek 对、滚动错"）；
      **平台路径仍是一条** `CAKeyframeAnimation`（采样整段，不增提交次数）
      · 真机 J 组 4/4：一条动画三段 · 50ms→0.800 / 100ms→0.600（边界精确）/ 200ms→0.900 ·
      终值 1.0000 · 平台提交一条且采样经过各段（0.600..1.200）
- [x] **共享元素**—— ✅ **已落地并真机验证（2026-09-30）**：内核**几何原语**
      `start_shared_element`（源矩形 → 目标节点 ⇒ `dx/dy/scale`；中心差 + **宽度比**）；
      声明侧 `presets.element.sharedElement({fromNodeId | fromRect})`（两种源覆盖两场景：
      同树节点 / 跨稳态系统坐标）；宿主负责**层级提升**（`zPosition`，飞行中浮在最上、结束复位）；
      · 真机 K 组 5 条：内核几何 · 首帧在源矩形（无跳变）· 层级提升与复位 · 终态精确归位 · 错误冒泡
      · ★诚实边界：内核只有**等比** scale ⇒ 以宽度比为准（源/目标宽高比不一致时高度按目标比例推出）；
        跨页面**稳态几何的回传**（导航栈参数 / 状态恢复通道）仍需页面栈层配合，本轮覆盖"同视图树"形态
- [x] **AI 说明书**—— ✅ **已落地（2026-09-30）**：`packages/animation/src/rules.ts` 的 `ANIM_RULES`
      （**22 条**：预设 12 / 原语 4 / 约束 4 / 边界 2），与 111 条编译规则**同构**
      （id/kind/title/description/why/when/example/verify/status/source/decision）
      · 渲染器 `formatAnimRule` / `formatAnimCatalog`（AI 可独立消费一条）
      · **conformance 对账**（`conformance.ts`）：预设真实存在于导出面 / 跨语言契约值一致 /
        `verify` 可追溯（不许"大概测过"）——**对不上就不生成文档**
      · 生成物 `docs/generated/anim-manual.md` + `pnpm check:anim-manual`（接 CI，漂移即红）
      ★本轮实测价值：对账立刻抓出**包 README 的曲线名漂移**（写成 `snappy/customBezier`，
        实现是 `easeIn/springApprox`）——"自描述没人对账 = 迟早骗人"。

### MA2 · 运行时核心 —— ◐ **主体已落地并真机验证（2026-09-30）**

> ★**与 RT2 合流**：Morpheus 的运行时核心与 RT2「动画指令」是同一件事（指令驱动、曲线求值在内核）；
> 本轮一次做完，真机 26/26 判据全过（`hosts/ios/check-anim-rt2.py`）。
> ★**未走"先 JS 兜底"**（原计划）——因为 RT0 已证明 Rust 侧可行且快得多（N=1000 每帧 2.38µs），
> 直接落在内核反而**省掉一次迁移**。

- [x] **spring 物理**：`AnimMode::Spring{stiffness,damping,mass}`（Flutter `SpringDescription` 同参数化）
      —— 半隐式欧拉 + 4ms 子步（大 dt 稳定）+ 静止判据 + 端点钉死；真机：静止后**精确**落到目标
- [x] **打断接管**：默认从**当前位置 + 当前速度**接管 —— 真机：`50.10 → 50.10`（位置无跳变）+ 落到新目标 60
- [x] **生命周期管理**：`stop_nodes`（§7.3 节点复用解绑）+ 宿主 `dematerializeRow` 自动调用
- [x] **协调机制**：同 `(node,kind)` **替换语义**（接管）/ `takeover:false` 硬重启
- [x] **手势与动画**：`seek`（Progress 驱动）+ `seek_velocity`（把手指速度交给弹簧接力）
- [x] **编排**：`delay_ms`（交错启动；延迟期钉在起点）
- [x] **属性面**：translateX/Y · scale · rotate · opacity（真机四项全验）
- [x] **FLIP 布局动画**（MA3 的招牌能力，一并落地）：`flip_capture`/`flip_start`
      —— 真机 **215 节点补间 · 最大位移 40px · 起点无跳变 · 终值归零**

### MA3 · 布局动画 —— ◐ **FLIP 已落地并真机验证**（2026-09-30）

- [x] **FLIP 实现**：`flip_capture`（快照绝对矩形，全在内核，**零跨边界查询**）+ `flip_start`
      （对比 → 生成 `Δ → 0` 补间；`stagger_ms` 支持自上而下级联）
      · 真机：**215 节点 · 最大位移 40px · 起点 ty=-40（无跳变）· 终值归零**
- [x] **性能实测**：与帧率测席同批（59.3 FPS · 帧耗时 p95 0.713ms）
- [x] 列表项增删让位**预设**（`presets.list.shift()`——把 FLIP 包成开箱即用形态，
      参数即内核 `flip_start` 的三个入参；MA1 一并落地）

### MA4 · RT0 结论应用（时机取决于 RT0）

- [ ] 若指令路径可行 → 换运行时求值层
- [ ] 若不可行 → 保持 JS 兜底

### MA5 · 滚动联动预设 —— ✅ **已落地并真机验证（2026-09-30）**

- [x] **吸顶 / 视差 / 渐显三预设**：`presets.scroll.sticky/parallax/fadeIn`
- [x] **驱动通路（滚动过程零 JS）**：宿主滚动回调 → `anim_seek_scroll(scroll位置)` → 内核
      **一次算完所有窗口动画**（视差层 + 吸顶头 + 渐显项）→ `updates` 当帧刷层；
      **窗口换算（`(off-from)/span` + 钳制 + 曲线）在内核唯一实现**——宿主只报"滚到哪了"，
      它不需要知道任何动画窗口的存在（否则三端滚动手感各写一份 ⇒ 分叉）
- [x] **生产形态真机验证**：`scrollAnimSync`（滚动 + 驱动 + 刷层在宿主内一次完成，JS 不在链路）
      · 真机：滚 100px → 视差 `ty=-40.00`（窗户 0..400 × factor 0.4，精确）
      · 视差映射全窗口：0 → 0.00 · 200 → -80.00 · 400 → -160.00
- [x] **编译期拦截**：退化窗口（from/to 写反）/ 滚动+弹簧并存（弹簧是按时间的物理，滚动进度下无意义）
- [x] **驱动源互斥**：滚动批次**不得**走平台零参与路径（那条路径的语义是"按时间自主插值"，
      混用会把"跟手"变成"到点自动播放"）——编译期预判 + 内核 `anim_commit_spec` 双重拒绝
- [x] **★滚动驱动不接管**（真机前发现的设计陷阱）：接管语义会把 `from` 覆盖成上一条动画的当前值
      ⇒ 窗口映射静默偏移；`start_scroll` 显式 `takeover=false`（回归测试
      `start_scroll_does_not_inherit_previous_value_into_range` 守住）

**真机判据**：I 组 5 条（`check-anim-rt2.py`，全 40 条判据绿）。

**★诚实边界**：本轮滚动输入走**宿主滚动通路**（`applyContentOffset`——与既有 `scrollBy` 同一条路径，
即"真实产品的滚动回调"形态）；真机手势（手指拖动 UIScrollView）未接——滚动联动的**驱动接口**
已与输入源解耦（回调里报位置即可），接真手势属后续接线，不影响本里程碑结论。

---

## 11. 验收标准

| 指标 | 合格线 | 目标 |
|---|---|---|
| 打断 | 手势介入**保留速度接管**，无跳变 | 视觉无感 |
| 协调 | 同属性多动画、手势与动画**不打架** | 可预测 |
| 生命周期 | 组件卸载**立即停止**，无写死节点 | 零崩溃 |
| 节点复用 | 长列表快速滚动**无错误项动画** | 专项回归通过 |
| 布局动画 | 列表增删让位 | 60Hz **不掉帧** | ◐ 真机 215 节点补间通过（帧耗时 p95 0.7ms） |
| **转场（合成属性）** | **主线程零参与**（Systrace / Instruments 实测） | 提交一次 | ◐ iOS 已落地：`CAKeyframeAnimation` 提交 + presentation 探针；★Instruments 级实测**未做** |
| **转场（路由接线）** | 命令流 → 执行器 → Morpheus 批次 | 端上可跑 | ✅ **2026-09-30**：`routeTransitionBatches`（含 pop 反向的**镜像对**）+ `createScreenExecutor`（M5 命令流消费者）+ 真机 ⑦ 组 5 条全绿（`check-app-stack.py`）|
| **转场（误改布局属性）** | **编译期拦截**，不得静默降级 | 零静默失败 | ✅ 内核判定 + 宿主**明确拒绝**（真机 G4） |
| 声明式覆盖 | 常见动画**无需逃生口** | 逃生口率 < 5% ← **口径已机器化**：`escapes.format()` 报率（常量 `ESCAPE_RATIO_TARGET`），超阈值给出提示（当前无业务用点，故如实为「装置就绪、待采数」） |
| 性能 | 与 B1 benchmark 同口径实测 | 不掉帧 + 输入延迟达标 |

---

## 12. 坑位清单

| # | 坑 | 应对 |
|---|---|---|
| 1 | **照 Reanimated 做** | 动机不同；照抄会为不存在的问题建方案（§3） |
| 2 | **动画绑 Node 而非 Slot** | 复用率 0.997 下会"错误的项在做动画"（§7） |
| 3 | **以为动画能完全编译** | 连续量不可收敛，必须先定边界（§4） |
| 4 | **开放任意 JS 动画函数** | 毁掉 conformance 与 AI 可校验（§9） |
| 5 | **手势并进引擎** | 两平台手势竞争机制不同，单独做（§9） |
| 6 | **被 RT0 整体卡死** | 边界先定，换运行时是"换实现"（§8） |
| 7 | **调参靠暴露参数** | 预设解决，不靠暴露（§6） |
| 8 | **逃生口静默扩大** | 必须可统计，`degraded` 单列高亮（§4.2） |
| 9 | **命名与既有项目冲突** | 已排除 Iris / Kinesis / Triton / Hermes（§1.3） |
| 10 | **布局动画没做成招牌** | 它是架构差异化，不是普通功能（§5.3） |
| 11 | **转场动画里改了布局属性** | 触发 `requestLayout` 全链路，**RenderThread 红利完全失效**；须编译期拦截（§5-bis.1） |
| 12 | **误以为转场要自建渲染线程** | 不自绘即可**直接用系统组件**；自建是自绘的代价，不是先进（§5-bis.0） |
| 13 | **共享元素转场当成普通动画做** | 需跨页面几何传递 + 视图层级提升，须 `platform/` 层各端实现（§5-bis.4①） |
| 14 | **桌面端例外吃掉平台红利** | 若 Linux 走"统一后端"（自绘），此红利消失——需重新评估（§5-bis.4②） |

---

## 13. 给实现 LLM 的执行指令

1. **MA0（边界定义）未完成前，不得开始 MA1。** 边界决定一切后续形状。
2. **动画必须绑定 Slot 身份，不得绑定 Node 身份**——节点回收时必须解绑。需专项回归测试。
3. **不开放任意 JS 动画函数**——任何"让开发者写任意动画逻辑"的实现应被拒绝。
4. **编译层覆盖不了的走显式逃生口，且必须可统计**；`degraded` 类单独高亮。
5. **布局动画是招牌能力**，实现时必须利用"几何在 Rust 侧"这个事实，不得退化成跨边界查询。
6. **转场动画必须走平台渲染线程**（Android RenderThread / iOS CoreAnimation render server），
   **禁止自建渲染线程**——不自绘即可直接用系统组件，自建是自绘的代价不是先进。
7. **合成属性集合必须在编译期判定**：属性集 ⊆ {transform, opacity} 才走零参与路径；
   动了布局属性（width/height/margin）必须**编译期报错或显式降级**，不得静默。
8. **预设优先于参数**——先做预设库，引擎够用就行。
9. **不要把手势系统并进 Morpheus**，它是独立任务。
10. **MA1–MA3 不等 RT0**；MA4 才应用 RT0 结论。
11. 每个预设与声明项**必须配 conformance 断言 + AI 说明书**，与既有 111 条规则同构。
    —— ✅ **已落地**（22 条 `ANIM_RULES` + `runConformance` + `pnpm check:anim-manual`，见 MA1 节）。
12. 定名前**再做一次包名与商标检索**（§1.4）。
13. ★**曲线求值与物理积分只在 Rust**：提交规格由内核**采样**下发，宿主只做"翻译成平台 API"，
    **宿主侧零曲线数学**（否则是"第 N 份手写副本"——本仓纪律 #22）。

---

## 13-bis. ★★官网专栏：Morpheus 从"内部引擎"到"产品"（2026-09-30）

用户判断：「**这个也是我们框架的招牌，肯定要打造成正式产品文档的**，这个最好做得专业产品的介绍，
非常吸睛的、炫酷的那种」。⇒ 本轮做成**两层产品面**：

| 层 | 落点 | 形态 |
|---|---|---|
| **旗舰产品页** | `website/src/pages/Animation.vue`（路由 `/animation`，顶栏"动画引擎"） | Hero（一句话定位）· 三个杀手锏卡 · **两个真跑演示** · 13 预设目录（live 读 `ANIM_RULES`）· **真机证据表**（8 项读数逐条标判据）· 诚实边界 · 代码示例 |
| **正式文档分区** | `website/animation/`（第 9 分区 `/docs/animation/*`，5 页 + EN 镜像） | 总览 / 架构与边界 / 声明面 / 路由转场 / 证据与诚实边界 |

**★两条"零伪造"纪律（本仓铁律在**展示层**的延伸）**：
1. **演示是真跑**——转场播放器直接播放 `routeTransitionBatches()`（引擎给执行器的同一份指令），
   曲线求值走 `@proteus-vue/slot-runtime` 的 `animValue`（与 Rust 内核 golden 对拍过的 TS 镜像，
   容差 1e-5）⇒ 页面上没有第二套曲线数学；
2. **数字可追溯**——真机证据表每一项都标判据脚本（`check-anim-rt2.py` / `check-platform-anim.py` /
   `rt0-anim-spike.md` / `check-app-stack.py`），且 `check:stats` 门禁守着全站数字与源码一致。

**验证**：`check-en-drift`（9 分区 298 对）· `check-doc-components`（597 md）· `check:stats` ·
`check:fluid-wording` · D-2 审计（零 error · 新页 4 处 v-p-fluid、零 @media/零裸平台 API）·
website 构建通过 · **浏览器真跑验收**（三处交互确认：预设切换 / 方向切换 / 曲线滑杆；
halfScreen forward `400→0` ↔ back `0→400` 镜像对在页面上可见）。

## 14. 为什么它是杀手锏

| 维度 | 说明 |
|---|---|
| **架构差异化（布局）** | 布局动画靠"几何在 Rust 侧"，别人做不到这么便宜 |
| **架构差异化（转场）** | 不自绘 → 直接用系统 RenderThread / CoreAnimation；**Flutter 自绘，才被迫自建 raster thread** |
| **与王炸同构** | 编译期收敛 → conformance → **AI 可写且可验证**；**合成属性判定把"会不会掉帧"变成编译期问题** |
| **开箱即用** | 预设驱动，开发者一句话写出复杂转场 |
| **覆盖完整** | 转场（平台线程）+ 布局动画（0.08ms 重排）**两类互补**，别人往往只有一半 |
| **复用已有资产** | 三个转场预设已落地；B1 benchmark 即是展示场 |

> **效率提示**：B1 benchmark 案例（万级列表 → 共享元素飞入 → 手势返回）
> **就是 Morpheus 的展示场**。引擎做出来，benchmark 案例也就有了；
> 案例实测数据反过来就是引擎的验收标准。**比分开做省一半。**

---

## 附：命名查重依据

| 名字 | 占用情况 |
|---|---|
| Morpheus | Ender 动画框架（历史项目）；Morpheus 2D game engine（NDS/GBA）；SVG-Morpheus；Morpheus Data（云管理平台）。**均不在跨端 UI 动画领域** |
| Thetis | 未发现同领域占用 |
| Kairos | 未发现同领域占用 |
| **Iris** | **iris-engine（Rust crate，Rust + Vue 3 运行时，含 AnimationEngine）**；Iris C++ 游戏引擎 —— **排除** |
| **Kinesis** | Kinesis.js（@aminerman/kinesis）；@timwickstrom/kinesis（easing tokens）—— **排除** |
| **Triton** | NVIDIA Triton —— **排除** |
| **Hermes** | Hermes JS 引擎 —— **排除** |

> 命名检索基于公开来源，**不构成商标意见**；定名前建议做正式商标与包名检索。
