# Proteus App 端高性能渲染落地方案

> 适用版本：Proteus v2.47+（Vue 3.4 / Vite 5 / TS 5.4）
> 目标端：Android（优先）、iOS、HarmonyOS NEXT
> 交付形态：新增 App 自研渲染后端，与既有 Web / Skyline 后端并行，由 `proteus.config.ts` 切换

---

## 0. 目标与非目标

### 0.1 目标

在 Android / iOS / 鸿蒙 App 端实现**替换 UI 框架层、复用系统渲染管线**的高性能渲染路径：

- 业务代码仍为一份标准 Vue 源码，经编译器产出语义 IR
- IR 在**编译期**收敛出静态结构与动态绑定清单
- App 端由**自研排版核心（C++，跨端共享）** + **平台绘制层**完成渲染
- 不引入 JS 引擎作为渲染链路的一环（逻辑层可保留 JS，与渲染解耦）

### 0.2 非目标（明确排除）

| 排除项 | 原因 |
|---|---|
| **自绘路线**（新开 Surface / TextureView / XComponent） | 两条渲染管线并存会额外消耗硬件资源；地图、WebView、广告 SDK 等原生组件与自绘方案融合时，滚动同步、层级合成、资源消耗均成长期债务 |
| **自研编译型语言**（替代 TS/JS 写业务） | 语言层工程量大、AI 友好度差、生态成本高；且已验证逻辑层并非瓶颈 |
| **Web / 小程序端改造** | Web 端排版由浏览器提供，小程序端排版由 Skyline 提供，本方案不适用于这两端 |
| **一次性重写全部组件** | 复杂组件（map / webview / 广告 / 第三方 SDK）继续映射原生组件 |

### 0.3 核心取舍

**换 UI 框架，不换渲染管线。**

```
渲染栈分层                        本方案的做法
─────────────────────────────────────────────
UI 框架层（组件 + 排版）          ❌ 弃用系统组件，自研
指令记录层（DisplayList / CALayer）✅ 复用
渲染引擎层（Skia / Render Server）✅ 复用
缓冲合成层（SurfaceFlinger / HWC）✅ 复用
```

---

## 1. 架构分层

```
┌──────────────────────────────────────────────────────────┐
│ L0  编译器（Node / Rust 双后端，proteus-cc-rust）           │
│     Vue SFC → 语义 IR → 静态结构 + 动态绑定表 → C++ codegen │
└──────────────────────────────────────────────────────────┘
                          ↓ 产物：LayoutTemplate + PatchTable
┌──────────────────────────────────────────────────────────┐
│ L1  排版布局核心（C++，三端共享）                           │
│     节点树 / Flexbox 布局 / 文本度量 / 拍平 / 复用池         │
└──────────────────────────────────────────────────────────┘
                          ↓ 产出：绘制指令流（无平台依赖）
┌──────────────────────────────────────────────────────────┐
│ L2  平台绘制层（三端各一份）                                │
│     Android: Canvas → DisplayList → RenderThread → Skia   │
│     iOS:     CALayer 树 → Render Server (IPC) → GPU        │
│     鸿蒙:    ArkUI 绘制指令 / NativeNode                    │
└──────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────┐
│ L3  原生组件混用层（必须预留）                              │
│     map / webview / 广告 / 第三方 SDK 以原生 View 嵌入       │
└──────────────────────────────────────────────────────────┘
```

---

## 2. 五条核心设计决策

### D1. 编译期确定结构，运行时只更新动态属性

这是本方案相对 Jetpack Compose / SwiftUI 的根本优势，也是 Proteus "编译期优先" 主张的直接落地。

| 范式 | 代表 | 运行时负担 | 本方案 |
|---|---|---|---|
| 运行时重组 | Compose / SwiftUI | 主线程重新执行函数，靠 `@Immutable`/`ImmutableList` 证明参数稳定才能跳过 | ❌ 不采用 |
| 编译期生成更新指令 | 蒸汽模式 / Svelte | 仅更新编译期标记的动态槽位 | ✅ 采用 |

**Compose 的教训**：它拥有 LayoutNode 树、Slot Table、Constraints 盒约束协议，节点表达层无可挑剔，但在 4050 元素测试中仍慢于 View 体系。瓶颈不在 IR，而在运行时重组策略。

**具体做法**：IR 编译完成时即产生两张表（见 §4），运行时**不存在 diff 过程**，只有"按槽位写值"。

### D2. 排版核心用 C++，三端共享

- 布局算法、节点树、文本度量、拍平判定、复用池——这些逻辑与平台无关，写一遍
- 只有最终的"把指令交给系统"那一步是平台代码
- 与既有 `RustBackend`（`proteus-cc-rust` CLI → 同一份 CompilerIR JSON）天然契合，codegen 到 C++ 是现有能力的延伸

### D3. 布局引擎：**Taffy 0.14**（Rust），抽象接口保证可替换（★2026-09-29 定案）

| 阶段 | 方案 | 理由 |
|---|---|---|
| M1–M2 | **Taffy 0.14**（Rust，Flexbox + Grid） | 与 `proteus-cc-rust` 同栈零 FFI；支持 Grid；**扩展开放**（`compute_child_layout` 是开放 dispatch，见 §5.0.7）；上游活跃。**必须锁 0.14**（0.13 有 measure 指数退化，见 §5.0.1） |
| M3+ | 按需评估自研 | 需先回答"在哪一点上做得比现有引擎好"（见 §5.0.6）；扩展路线见 §5.0.7 ⑤ |

> **原为「Yoga 起步」**：spike 实测后改为 Taffy（Yoga 无 Grid、处维护模式，但 measure 表现更优——
> 详见 §5.0.1 的三条硬证据与 [DCP-1 决策文档](./proteus-performance-plan/11-dcp1-layout-engine.md)）。
> ★**2026-09-28 补充维度**：新增 §5.0.7「Taffy 扩展能力评估」⇒ 确认 Taffy 的扩展开放度
> **进一步支持**本定案（Yoga 无官方扩展点；Taffy 的 `compute_child_layout` 可加 match arm 接入自研算法）。

**详见 §5.0 布局引擎选型与 §5.6 决策检查点。**

**布局协议约束（必须遵守）**：约束自顶向下、尺寸自底向上、**严格单次测量**，禁止 View 体系那种"父子多轮 measure"。这点是 Compose 相对 View 体系做对的地方，直接抄。

**抽象边界约束**：`LayoutEngine` 接口必须在 M1 落地，引擎原生 API 不得泄漏到 `layout/` 模块之外（§5.1）。

### D4. 拍平（Flatten）在 IR 层判定，不在运行时判定

拍平 = 子节点不创建独立节点，直接绘制在父节点上，降低视图树深度与遍历成本。

- 判定条件（编译期）：节点为 view/text/image、无事件绑定、无 transform、非动画目标、非自定义组件根
- **拍平不是"跳过排版测量的自绘"**——仍然要走完整排版、测量、绘制流程，省的是节点管理开销
- 拍平节点不支持事件与截图 API，需在 IR 层校验并报错

### D5. 复杂组件自研、原子组件映射原生

直接采用 Kuikly 验证过的取舍：

- **自研**（保证多端一致性）：`list`（复用池）、`rich-text`、`swiper`、`slider`、`picker`
- **映射原生**（保证兼容与生态）：`text`、`image`、`input`、`scroll-view` 的底层原子绘制由平台绘制层承担；`map`、`webview`、广告 SDK 直接嵌入原生 View

---

## 3. 语义 IR 扩展规格

### 3.1 节点结构（在既有 IR 上扩展，不破坏原结构）

```ts
interface PNode {
  kind: 'view' | 'text' | 'image' | 'list' | 'rich-text' | 'native-host' | ...
  id: number                    // 编译期分配的稳定整数 ID，非字符串
  props: PProps                 // 归一化后的属性（见 3.2）
  children: PNode[]
  flags: PFlags
}

interface PFlags {
  isStatic: boolean             // 整棵子树无动态绑定 → 可提升为静态模板
  flattenEligible: boolean      // 可拍平（编译期判定，见 D4）
  isLayoutBoundary: boolean     // 布局边界：自身尺寸变化不影响父级，可跳过向上传递重排
  hasEvent: boolean
  isNativeHost: boolean         // 原生组件宿主节点
}
```

### 3.2 样式归一化（编译期完成，运行时零解析）

**禁止**在运行时解析 CSS 字符串。编译期将样式归一化：

```ts
interface PProps {
  layout: LayoutProps      // flex-direction / justify / align / width / height / margin / padding
  paint: PaintProps        // backgroundColor / borderRadius / border / shadow / opacity
  text?: TextProps         // fontSize / fontWeight / lineHeight / color / overflow / maxLines
}
```

- 单位在编译期折叠为 **逻辑像素（dp/pt）**，运行时不做单位换算
- `rpx` / `%` / `vw` 等在编译期确定换算规则，运行时只留比例系数

### 3.3 动态绑定表（核心新增）

```ts
interface DynamicBinding {
  slotId: number           // 编译期分配的槽位索引
  nodeId: number
  propKey: string
  exprId: string           // 指向编译期生成的更新表达式
  updateKind: 'attr' | 'style' | 'text-content' | 'list-data' | 'visibility'
}
```

编译期产出 `bindings: DynamicBinding[]`，运行时更新 = 遍历 bindings 写值 + 标记脏区域。**不存在 VNode diff。**

---

## 4. 编译期产物规格

每个页面/组件产出两份数据，序列化为 FlatBuffers 或紧凑二进制（非 JSON，避免运行时解析开销）：

### 4.1 LayoutTemplate（静态结构）

- 节点树的扁平化数组（父指针 + 兄弟链，避免指针追逐）
- 每个节点的静态属性值
- 已应用拍平后的最终树形（拍平在编译期完成）
- 供 C++ 直接构造，无解析步骤

### 4.2 PatchTable（动态槽位表）

- `bindings` 数组（见 3.3）
- 每个槽位的类型信息（供 C++ 生成特化的写值函数，避免运行时类型判断）

### 4.3 与既有编译器能力的衔接

- 复用 69 条转换规则注册表，新增规则需自带 AI 说明书（与既有约定一致）
- `proteus explain` 需能 trace 拍平判定、静态提升判定
- **Node/Rust 双后端语义等价 Golden 门禁必须继续通过**（既有 81 用例 + 新增用例）

---

## 5. 排版核心规格（`@proteus-vue/layout-core`）

### 5.0 布局引擎选型

#### 5.0.1 结论（★2026-09-29 已定案）

> **DCP-1 已决：Rust + Taffy 0.14**（M1–M2 使用；M3 再评估自研或替换）。
> 决策文档：[`proteus-performance-plan/11-dcp1-layout-engine.md`](./proteus-performance-plan/11-dcp1-layout-engine.md)，
> spike 可复跑：`spike/dcp1-layout-engine/run.sh`。

**定案理由（三条硬证据，均为实测）**：

| # | 理由 | 证据 |
|---|---|---|
| 1 | **Grid 能力** | Yoga 3.2.1 的 `YGDisplay` 枚举 = `{Flex, None, Contents}`——**编译期就没有 Grid**；Taffy 实测 3×2 Grid 正确（DCP-2 已定案开放 L2） |
| 2 | **与 `proteus-cc-rust` 同栈** | 编译器后端已是 Rust；同栈 ⇒ codegen 到布局核心**零 FFI**、共享构建链 |
| 3 | **上游活跃** | Taffy 在 Bevy / Dioxus / Zellij 生产使用；Yoga 处**维护模式**且演进绑 RN 需求 |
| 4 | ★**扩展开放度**（2026-09-28 新增维度） | Taffy 的 `LayoutPartialTree::compute_child_layout` 是**开放 dispatch**（可加 match arm 接自研算法）；Yoga **无官方扩展点**。详见 **§5.0.7** |

**★★关键约束：必须锁 `taffy = "0.14"`，禁止降级到 0.13。**
0.13 在「深链 + auto 尺寸容器」下 measure 次数呈 **`3×2^d−2` 指数爆炸**（深度 12 达 12286 次），
0.14 为**有界常数 13**。此退化**无法靠工程手段绕过**（`flex_basis` 仍指数、`min_size` 无效），
详见决策文档 §2。**这与 §5.4.1 记载的 RN 事故（无约束嵌套容器）是同一类形状。**

**两引擎的语义正确性均已实测**：Yoga 13/13、Taffy 13/13 与 M1 的浏览器对拍基线一致——
即「引擎本身都正确」，M1 阶段发现的 6 个语义缺陷是**本仓 Node 参考实现**的，与引擎无关。

#### 5.0.2 Yoga 现状（纠正常见误解）

Yoga 并非停止维护。2026 年仍在持续提交：

| 时间 | 变更 |
|---|---|
| 2026-02 | **移除 CocoaPods 支持**（iOS 接入改走 SwiftPM / CMake） |
| 2026-03 | Android 构建升级至 Gradle 9 / AGP 8.12 / SDK 36 |
| 2026-06 | 新增符合规范的 CSS Flexbox §4.5 `auto-min-size` opt-in |
| 2026-08 | 修复 shrink-factor 除法的浮点近零问题 |

编译器要求已提升至 **C++20**。

但需注意：Yoga 处于**维护模式**，演进绑定在 React Native 的需求上——**不会为 Proteus 的需求新增能力**（如 Grid）。

#### 5.0.3 Yoga 的经典缺点：对 Proteus 大部分不成立

| 常见批评 | 对 Proteus 是否成立 | 原因 |
|---|---|---|
| 不解析 CSS，需手动设置属性 | ❌ **不成立** | 编译期折叠（CSS Profile §4）已产出 `ComputedStyle`，本就不会给布局引擎传 CSS 字符串 |
| 不处理文本，measure 由宿主提供 | ❌ **不成立** | `text_measure` 本就是平台注入（StaticLayout / CoreText），见 §5.2 |
| 仅支持 Flexbox，无 Grid | ⚠️ 部分成立 | 取决于 Profile 是否开放 Grid（目前 L2 待定） |

**结论**：Yoga 被诟病最多的两点，恰是 Proteus 架构已解决的两点。它在链路中就是一个纯粹的「约束输入 → 坐标输出」黑盒，这正是其设计定位。

#### 5.0.4 替代方案对比

| 方案 | 语言 | 布局能力 | 维护状态 | 适配度 |
|---|---|---|---|---|
| **Yoga** | C++ | Flexbox（无 Grid） | 活跃但偏维护模式，绑 RN | 若核心定 C++ 则零 FFI 直连 |
| **Taffy** | Rust | **Flexbox + Grid** | 活跃开发（Bevy / Dioxus / Zellij 在用） | 若核心定 Rust 则同栈 |
| Stretch | Rust | Flexbox，更严格遵循 Web 标准 | 需核实当前状态 | 绑定生态较薄 |
| 自研 | — | 按需 | 完全可控 | 数千项工程优化量级，Compose 前车之鉴 |

#### 5.0.5 排版核心语言的二选一（关键决策）

| | C++ 排版核心 + Yoga | Rust 排版核心 + Taffy |
|---|---|---|
| 与 `proteus-cc-rust` 同栈 | ❌ | ✅ |
| 布局能力 | Flexbox | Flexbox + **Grid** |
| 接入平台层 | JNI / ObjC++ / NAPI | 同（均需跨到平台） |
| 生态成熟度 | Yoga 十余年生产验证 | Taffy 较新 |
| 已知成本 | — | iOS 侧 ObjC++ 桥接略复杂 |

**此项必须在 M1 前定案**：排版核心语言一旦选定，后期更换成本极高。

> ### ✅ **DCP-1 已决（2026-09-29）：Rust 排版核心 + Taffy 0.14**
>
> 上表为**决策时的原始对比**，实际 spike 又测出两项表中未列的关键事实（见 §5.0.1）：
> ① **Taffy 的 measure 表现不如 Yoga**（恒 13 次 vs 恒 1 次；但**都与深度无关**，均合格）
> ② **Taffy 0.13 有 measure 指数退化**，必须用 0.14
> ③ **Taffy 的 4050 节点性能反而更快**（0.056ms vs Yoga 2.73ms）
>
> ★**2026-09-28 追加**：§5.0.7「Taffy 扩展能力评估」补上**第四个维度（扩展开放度）**——
> 结论**强化**了本定案（Taffy 有官方扩展点，Yoga 无）。

#### 5.0.6 不要因「Yoga 老」而自研

反直觉但重要的证据：某纯 TypeScript 布局引擎通过两项**算法**优化（主轴位置由累积和改为线性递推；默认值字段在构建期折叠为常量），使 hot-structural 场景从 **450µs 降至 70µs**，最终在 9 个场景中全部快过 WASM Yoga。作者结论：

> Yoga 的优势不在算术速度——其 C++ kernel 又快又调优得好，但**在该负载下算术速度根本不是瓶颈**。

**双向启示**：
1. 「Yoga 是 C++ 所以快」不构成不自研的理由——瓶颈在 dirty 传播、边界跨越、默认值处理等架构层面
2. 「Yoga 是老设计」也不构成必须自研的理由——老内核经十余年生产打磨，正确性远高于快速重写版本

**自研前必须能回答**：我要在哪一点上做得比 Yoga 好？否则即为重复劳动。

#### 5.0.7 Taffy 扩展能力评估（★ 新增决策维度）

> 背景：DCP-1（排版核心语言）原纠结于「要不要 Grid」。调研发现还有一个
> 更重要的维度——**引擎的扩展开放度**。若预期后续会自研布局特性（如为列表做特调），
> 这是实打实的加分项，**可能改变 M0.5 spike 的结论**。

##### ① 核心机制：算法调度权在宿主手里

`LayoutPartialTree::compute_child_layout` 是**必须由实现方提供的 required method**。
Taffy 官方 `custom_tree_owned_unsafe` 示例中的形态：

```rust
fn compute_child_layout(&mut self, node_id, inputs) -> LayoutOutput {
    compute_cached_layout(self, node_id, inputs, |tree, node_id, inputs| {
        match node.kind {
            NodeKind::Flexbox => compute_flexbox_layout(tree, node_id, inputs),
            NodeKind::Grid    => compute_grid_layout(tree, node_id, inputs),
            NodeKind::Text    => compute_leaf_layout(/* ... */ text_measure_function),
            NodeKind::Image   => compute_leaf_layout(/* ... */ image_measure_function),
            // ← 可自行添加 arm（自研算法）
        }
    })
}
```

**flexbox / grid / block 是三个可选项，不是封闭集合。** 新增第四种布局算法 =
加一个 match arm，属第一等公民，非 hack。

##### ② 四类扩展的能力边界（天差地别）

| 类型 | 举例 | Taffy 支持度 |
|---|---|---|
| **A. 新增布局算法** | 自研瀑布流、绝对定位增强、自研 grid | ✅ **完全支持**（加 match arm） |
| **B. 叶子节点外部测量** | 文本（CoreText / StaticLayout）、图片固有尺寸 | ✅ **官方一等公民**（measure function + `NodeContext` 泛型） |
| **C. 外围包装层降级/近似** | `display:contents`、table、`position:fixed` | ✅ **官方设计意图**（见 ③） |
| **D. 给 `Style` 加新 CSS 属性** | 新增布局属性 | ❌ **不行**——`Style` 为固定 struct，无扩展点 |

**D 是唯一硬边界**，但可用 ③ 的模式绕开。

> 注：B 类对本项目的 `text_measure` 平台注入设计（§5.2）是天然契合——
> Taffy 的 `NodeContext` 泛型正是为"测量时携带每节点应用数据"而设。

##### ③ ★ 最值得抄的模式：Blitz 的外围包装层

Dioxus Blitz（Stylo + Taffy 的浏览器引擎）面对同样问题，其解法可直接复用：

| CSS 特性 | Blitz 的处理 |
|---|---|
| `display: contents` | ❌ Taffy 不支持 → **在自有树构建层做 children 提升**，不进 Taffy |
| table 布局 | ⚠️ **用 CSS Grid 算法 + `TableTreeWrapper` 近似** |
| `max-content` / `min-content` / `fit-content` | 全部**映射为 Auto** |
| `position: fixed` / `sticky` / `static` | **近似映射**为 Absolute / Relative |
| subgrid / masonry | ❌ 返回空 |
| anchor positioning | ❌ 不支持 |

**核心思路**：`stylo_taffy` 是**纯转换层、零布局逻辑**——不支持的特性在
**进入 Taffy 之前**就被降级、近似或提升掉。

**与 Proteus 天生契合**：项目本就有语义 IR + 编译期折叠 + `LayoutEngine` 抽象层
（§5.1 / §5.2 / CSS Profile §4）。**把不支持的特性在 IR 层解决掉**，
正是既有设计已在做的事，无需为 Taffy 改架构。

##### ④ Taffy 官方明确不支持的特性（供 CSS Profile 参考）

来自 Servo 接入 Taffy 后跑 WPT 的结果：

- safe/unsafe alignment
- `flex-basis: content` / `fit-content`
- `writing-mode`（及依赖它的 direction）
- 非 fallback baseline 对齐
- 百分比对不确定交叉轴高度的解析（存在 bug）
- 替换元素（img）尺寸计算的若干 bug
- **Grid 侧**：subgrid、masonry 不支持

**客观数据**：接入 Taffy 后 Servo 的 WPT 通过率——
css-flexbox **58.5% → 71.7%**，css-grid **0% → 40.5%**。

**结论**：Grid 是「能处理常见网格」，**不是完整 CSS Grid 替代品**。

##### ⑤ 三条扩展路线（按顺序尝试）

| 路线 | 做法 | 成本 |
|---|---|---|
| **① 外围包装**（先做） | 不支持的特性在 IR / 转换层降级或近似 | 低 |
| **② dispatch 混用** | 在 `compute_child_layout` 加 arm，自研算法与 Taffy 共存 | 中 |
| **③ fork** | 改 Taffy 源码 | 高，但**有先例** |

**dispatch 混用比想象中宽**：可只自研某一类布局（如列表瀑布流），其余仍交 Taffy。

**关于 fork——生态已有现成案例**：

| fork | 扩展内容 |
|---|---|
| `genet-taffy` | CSS float、flex order、positioned-grid |
| `mentore` | Telemaco 维护；block / grid / float / content sizing；**API 与 Taffy 完全一致，Cargo.toml 一行替换** |

fork 是社区常见做法，且可做到**接口兼容、替换成本极低**。需要时 fork，
上游更新时跟进合并，接口不变。

##### ⑥ 一个需要计入稳定性的约束

`LayoutPartialTree` 是**所有下游消费方**（Bevy、Servo、Zed GPUI、Blitz、Slint、Floem）
共同的扩展点——**改这个 trait 会波及全部下游**。

**双向含义**：
- 有利：Taffy 团队改 trait 会极谨慎 → 本项目的实现稳定性高
- 不利：若走 fork 路线，trait 变更时需跟进合并 → 成本须计入

另外两条对项目有利的性质：Taffy 默认 `#![no_std]`、`#![deny(unsafe_code)]`，
与内核要求不冲突。

##### ⑦ 对 §5.0.5 决策的修正

| 维度 | C++ + Yoga | Rust + Taffy |
|---|---|---|
| 与 `proteus-cc-rust` 同栈 | ❌ | ✅ |
| Grid | ❌ | ✅ |
| **扩展开放度**（新增） | ❌ 无官方扩展点 | ✅ **`compute_child_layout` 为开放 dispatch** |
| **叶子外部测量**（新增） | 需自建 | ✅ 官方一等公民 |
| 生态成熟度 | 十余年生产验证 | 较新 |

**DCP-1 新增评估问题**：项目后续是否预期自研布局特性（如列表特调）？
若是，**Taffy 的扩展开放度是实打实的加分项**。

**执行要求**：M0.5 spike 必须把「扩展开放度」纳入评估项，不能只看 Grid 与性能。

### 5.1 模块划分

```
layout-core/
├── node/          节点树（扁平数组 + 父/兄弟索引）
├── layout/        LayoutEngine 接口 + 实现（Yoga / Taffy / 自研，可切换）
├── text/          文本度量抽象（平台实现注入）
├── flatten/       拍平规则（编译期判定的运行时执行）
├── materialize/   节点 → 平台 layer 的懒创建与回收（见 §12.5）
├── paint-hint/    绘制提示（见 §12.4）
├── recycle/       列表复用池 + 生命周期状态机（见 §12.6）
├── dirty/         脏区域标记与最小重排传播
└── render/        绘制指令流生成（平台无关）
```

**强制约束**：`layout/` 模块的**实现 API（Yoga / Taffy 的原生 API）不得出现在该模块之外**。上层只能依赖 `LayoutEngine` 抽象接口，以保证后续可替换。

### 5.2 关键接口

```cpp
// 构造：从 LayoutTemplate 二进制直接构造，无解析
LayoutTree* tree_build(const uint8_t* template_bytes, size_t len);

// 更新：只写槽位，无 diff
void tree_patch(LayoutTree*, const PatchOp* ops, size_t count);

// 布局：单次测量，严格单向约束传播
void tree_layout(LayoutTree*, float width, float height);

// 产出：平台无关绘制指令流
void tree_emit(LayoutTree*, RenderCmdList* out);

// 文本度量：平台注入（Android StaticLayout / iOS CoreText / 鸿蒙）
void text_measure(const TextInput*, TextMetrics* out, PlatformTextCtx*);
```

**布局引擎抽象（可替换边界，必须实现）**：

```cpp
class LayoutEngine {
public:
  virtual ~LayoutEngine();
  // 全量布局
  virtual void layout(Node* root, float w, float h) = 0;
  // 增量布局：从 dirty 节点出发，遇布局边界即停止向上传播
  virtual void layoutIncremental(Node* dirtyRoot) = 0;
  // 文本度量回调由宿主注册
};
// 内置实现：YogaEngine / TaffyEngine / ProteusEngine（后续）
```

### 5.3 性能硬约束

| 约束 | 说明 |
|---|---|
| 单次测量 | 禁止父子多轮 measure；布局边界（`isLayoutBoundary`）阻断向上传播 |
| 无运行时字符串解析 | 样式键在编译期转为枚举 |
| 节点分配池化 | 列表复用由 `recycle/` 统一管理，滚动时不触发堆分配 |
| 文本度量可缓存 | 度量结果按 (文本 hash, 字体, 宽度约束) 缓存，支持后台线程预热 |

### 5.4 防退化：dirty 冒泡压力测试（M1 必做）

#### 5.4.1 风险来源

React Native 生产实测：350 个活跃布局节点，因**无约束嵌套 Flexbox 容器**导致 dirty 标记向上级联至根节点，C++ 布局计算耗时从 **1.2ms 飙升至 28.4ms**（60 FPS 预算仅 16.67ms，120Hz ProMotion 仅 8.33ms），造成严重布局抖动。

**归因**：这不是 Yoga 慢，而是上层**缺少布局边界**。若不做 `isLayoutBoundary`，换成任何引擎（含自研）都会踩同一个坑。

#### 5.4.2 强制测试项

| 用例 | 场景 | 合格线 |
|---|---|---|
| T1 深层脏更新 | 350+ 节点树，在深度 12 处修改布局属性 | 单次布局 **≤ 3ms** |
| T2 无边界对照 | 关闭 `isLayoutBoundary` 跑同一用例 | 必须**显著劣于** T1（证明边界生效） |
| T3 无约束容器 | `flexGrow: 1` / 未定义高度的容器嵌套 | 不得触发根节点全量重算 |
| T4 高频更新 | 快速滚动中连续 patch | P95 ≤ 3ms |

**T2 是关键**：若关闭边界与开启边界性能无差异，说明 `isLayoutBoundary` 未真正生效，不得进入 M2。

### 5.5 跨端精度一致性策略（M1 定案，不可延后）

#### 5.5.1 风险来源

| 平台 | 精度 |
|---|---|
| Yoga / 多数引擎 | 支持小数像素（如 40.5） |
| 鸿蒙 ArkUI | **强制整数像素**（四舍五入） |

真实案例：鸿蒙端用 `flex: 1/3` 实现三列布局，ArkUI 将 0.333 舍入为 0.33，累计误差导致第三列错位。

**此问题 Yoga 与自研引擎均无法解决**——它属于 Profile 与舍入策略层，必须在 Proteus 侧定死。

#### 5.5.2 强制规则

1. **统一舍入策略**：在 Profile 中定义唯一的像素舍入规则（建议：布局计算保留浮点，仅在最终写入平台层时做一次舍入），三端一致
2. **禁止依赖分数 flex 的多列等分布局**，lint 层提供改写建议（如 `width: 33.33%`）
3. **折叠屏 / 窗口尺寸变化**需主动监听并触发重排（鸿蒙侧窗口变更处理需专门验证）
4. **大字体回归测试**：特大字体下的 flex 溢出问题必须提前暴露

### 5.6 决策检查点

| 编号 | 决策项 | 时点 | 说明 |
|---|---|---|---|
| DCP-1 | 排版核心语言（C++ / Rust） | **M1 之前** | 需半天 spike 对比 Yoga vs Taffy，逾期变更成本极高 |
| DCP-1a | **是否预期后续自研布局特性**（★ 新增） | **M1 之前** | 若是，Taffy 的扩展开放度（§5.0.7）为决定性加分项，直接影响 DCP-1 |
| DCP-2 | Profile 是否开放 Grid | M1 | 直接影响 DCP-1（Yoga 无 Grid） |
| DCP-3 | 是否自研布局引擎 | M3 | 需先回答 §5.0.6 的问题；优先级为 ①外围包装 → ②dispatch 混用 → ③fork |

**M0.5 spike 强制评估项**（缺一不可）：
1. Grid 是否需要（DCP-2）
2. **扩展开放度是否满足预期**（DCP-1a）
3. 性能与精度（§5.4 / §5.5）

### 5.7 可用工具：以浏览器作为布局真值基准

Yoga 的测试方式值得直接复用：

> 写 HTML 片段描述节点结构 → 在 Chrome 中渲染 → Chrome 按 CSS Flexbox 规范算出期望布局 → 该结果作为测试用例预期值 → 引擎自算一遍做对比

Proteus 的 **Web 端本身就是浏览器**，因此 conformance 门禁可直接**读取浏览器的 `getComputedStyle` 与 `getBoundingClientRect` 作为基准真值**，与 App 端排版结果逐节点比对。这比手写期望值覆盖面广、且天然与浏览器行为对齐。

---

## 6. 三端绘制层规格

### 6.1 Android

| 项 | 规格 |
|---|---|
| 宿主 | 一个宿主 `View`（角色等同 Compose 的 `AndroidComposeView`），接收 ViewRootImpl 的 measure/layout/draw 回调 |
| 绘制 | 通过宿主 `Canvas` 下发指令 → DisplayList → RenderThread → Skia → GPU。**不开 Surface/TextureView** |
| 文本 | `StaticLayout`（预计算行宽高与截断）+ 后台线程缓存预热 |
| 布局 | 使用 C++ 排版核心，不走 ViewGroup 递归 |
| 与原生混用 | 原生 View 作为子节点嵌入宿主，走 View 体系正常合成 |

**关键优化参考**：文本排版是最大单点。生产案例显示长文本测量占用主线程 30–50ms，采用 `StaticLayout` 替换 `DynamicLayout` + 后台线程预热 TextLayoutCache 后，绘制耗时降至约 2ms，掉帧减少 60%。

### 6.2 iOS

**采用 CALayer 半自研路线（不重写 UIView 层，也不自绘）**：

| 项 | 规格 |
|---|---|
| 宿主 | 一个宿主 `UIView`，内部直接管理 `CALayer` 树 |
| 节点 | **跳过 `UIView`**，直接用 `CALayer` / `CATextLayer`（UIView 额外承担事件处理、布局管理、Responder Chain，是纯开销） |
| 布局 | 使用 C++ 排版核心，**绕开 AutoLayout**（其 CPU 消耗随视图数量指数级上升） |
| 文本 | `CoreText` 异步排版，度量对象可缓存复用；复杂富文本场景用 `CATextLayer`（GPU 加速） |
| 提交 | CALayer 树 → Render Server（backboard 进程，IPC）→ GPU |

**两条 iOS 特有硬约束**：

1. **commit 阶段是递归的**——每帧打包 layer tree 并通过 IPC 提交，复杂度与 layer tree 深度直接相关。必须配合 D4 的拍平，保持 layer tree 扁平。
2. **离屏渲染**：`cornerRadius` + `masksToBounds` + `shadow` 同时作用于同一 layer 会强制每帧离屏光栅化。需在绘制层拆分图层处理。

### 6.3 HarmonyOS NEXT

| 项 | 规格 |
|---|---|
| 宿主 | XComponent 不作为渲染画布使用；使用 ArkUI 节点挂载 |
| 绘制 | 走 ArkUI 绘制指令 / NativeNode，复用 C++ 排版核心 |
| 文本 | 鸿蒙侧文本排版能力较强，优先复用系统能力，性能不足时再自研 |

---

## 7. 工程结构与包划分（接入既有 monorepo）

```
packages/
├── @proteus-vue/layout-core/        【新增】C++ 排版核心（含 JNI / ObjC++ / NAPI 绑定）
├── @proteus-vue/codegen-cpp/        【新增】Rust crate，IR → C++ codegen
├── @proteus-vue/render-backend/     【改造】新增 NativeVaporBackend，与既有五后端并列
├── @proteus-vue/compiler/           【改造】IR 扩展（flags / bindings / 样式归一化）
└── scripts/check-vapor-perf.mjs     ★性能棘轮门禁（**实际形态**；原稿写的
                                     `@proteus-vue/perf-ratchet` 包**从未存在**——2026-09-28 核实）
```

`proteus.config.ts` 切换：

```ts
export default defineConfig({
  render: {
    backend: 'native-vapor',   // 新增选项，与 'vue-dom' | 'skyline' | 'native' 并列
    flatten: true,
    layoutEngine: 'yoga',      // 后续可切 'proteus'
  },
  compiler: { backend: 'rust' },
})
```

---

## 8. 分阶段里程碑

### M0 · IR 扩展与编译期分析（≈2 人周）—— ✅ **已完成**（勾选于 2026-09-28 逐项核实）

- [x] 扩展 `PNode` / `PFlags` / `DynamicBinding` —— `packages/component-ir/src/pnode.ts`
- [x] 实现静态子树识别与提升 —— `pnode-analyze.ts` 填 `staticSubtree`；`layout-core/src/render-cmd.ts` 消费
- [x] 实现拍平判定 + 违规报错 —— `pnode-analyze.ts:117` 报 `css.flatten-violation`
- [x] 样式归一化 + 单位折叠 —— `component-ir/src/pnode-style.ts`（`normalizeStyleString` / `resolveLength`）
- [x] Golden 门禁：Node/Rust 双端对齐 —— `tests/golden.test.ts` + `packages/layout-core-rust/tests/golden/`（`conformance.rs` 逐节点比对）

**出口条件**：`proteus explain` 能输出拍平/静态提升的完整决策 trace —— ✅ `packages/cli/src/explain.ts` + `component-ir/src/pnode-trace.ts`

### M0.5 · 排版核心语言 Spike（≈0.5 人周）★ 决策前置 —— ✅ **已完成并决案**（2026-09-29）

- [x] Yoga vs Taffy 对比 spike（接入成本、Grid 支持、性能）—— `docs/proteus-performance-plan/11-dcp1-layout-engine.md` + `spike/dcp1-layout-engine/`
- [x] 决定排版核心语言：C++ 还是 Rust（DCP-1）—— **决：Rust + Taffy 0.14**（三条硬证据：Grid 能力 / 与 `proteus-cc-rust` 同栈 / 上游活跃）
- [x] 决定 Profile 是否开放 Grid（DCP-2）—— **决：有条件可用**（Skyline 端实测退化为 block ⇒ 非无条件）

**出口条件**：DCP-1 / DCP-2 有书面结论 —— ✅ 见上（★**必须锁 taffy 0.14**：0.13 有 measure 指数退化，详见决策文档 §2）

### M1 · 排版核心骨架 —— ✅ **已用 Node 参考实现完成**（2026-09-29）

> **落地路径调整（用户已确认）**：先做 **Node 侧参考实现**（`packages/layout-core`）而非直接 C++。
> 理由：布局正确性未达标时谈性能无意义；Node 侧反馈环最快（单测毫秒级），且能直接与浏览器对拍。
> C++ 移植（M2+）以本实现为**语义基准**，避免「边写 C++ 边猜语义」。

- [x] 节点树（扁平数组语义 + 稳定整数 id + 父指针）
- [x] **自研 flex 求解器**（未接 Yoga——先证明语义；DCP-1 的引擎选择见 M0.5）
- [x] **单次测量布局**（`measureCalls == nodeCount` 由测试精确锁定）
- [x] `LayoutEngine` 接口边界（`ConstraintFor` 是百分比语义的唯一落点，见 §5.1）
- [x] **脏区域标记与最小重排**（`isLayoutBoundary` 生效 + 度量缓存复用）
- [ ] 跨端舍入策略定案（§5.5）——待 M2 真机数据
- [x] 平台无关绘制指令流（`RenderCmd`：背景/文本/图片/边框 + 裁剪，含拍平并入清单）
- [x] **dirty 冒泡压力测试 T1–T4（§5.4）**

**出口条件（均已达成）**：
1. ✅ 指令流正确：`tests/layout-core-render-cmd.test.ts`（绝对坐标 / 拍平不新建位图 / 裁剪边界）
2. ✅ **布局与真实浏览器逐像素一致**：`tests/e2e-layout-core-pixel.test.ts`——
   17 用例 / 67 个有盒节点，**x/y/w/h 全部 ≤ 0.5dp**（Chromium 为基准真值）
3. ✅ **T2 对照证明 `isLayoutBoundary` 真实生效**：开边界重排 4 节点/0.59ms（作用域=边界子树），
   关边界退化为整树根/15 节点/1.55ms——**结构量与墙钟双双显著劣化**

**实测数字**（356 节点 / 深度 12；`npx vitest run tests/layout-core-*` 可复跑）：
| 指标 | 实测 |
|---|---|
| 单次测量 | `measureCalls == nodeCount`（10501 节点树实测） |
| 增量布局（单点变更） | 访问 **4.8%** 节点、文本 shaping **1 次**（全量 8000 次）、提速 **4.0×** |
| T1 深层脏更新（356 节点 / 深度 12） | **0.59ms**（预算 3ms） |
| T2 无边界对照 | **1.55ms** + 重排范围扩到整树根（15 节点） |
| T4 高频更新 60 连击 | P50 **0.15ms** / P95 **0.63ms** / max 1.18ms |

**★对拍暴露并修掉的真实语义缺陷**（都是浏览器基准真值抓出来的，不是自测发现的）：
1. 主轴 auto 的 flex base size 应为 **max-content**（不是「填满可用」）——嵌套 row→column 差 112dp
2. 主轴尺寸被 grow/shrink 改变后，**子树必须按最终尺寸重排**（精化测量；靠文本度量记忆化控制成本）
3. 交叉轴对齐的参照系是**容器内容盒**，不是「可用空间」（视口 667 下居中 16dp 文本，y 差 323.5dp）
4. `left/top` 从**父 padding 盒**起算，不叠加父 padding（父 padding-left 30 时差 30dp）
5. min/max 夹取需**冻结—再分配**（CSS §9.7），否则被夹住的空间不会转给兄弟（差 35dp）
6. `display:none` 在 CSS 中**无盒**（不产生 rects，也不产生绘制指令）

### M2 · Android 端最小闭环（≈3 人周）★ 关键验证点 —— ✅ **已通过**（勾选于 2026-09-28 逐项核实）

- [x] 仅实现三个组件：`view` / `text` / `image` —— `hosts/android/app/src/main/java/dev/proteus/layoutcore/{RustLayout,MainActivity}.java`
- [x] 宿主 View + Canvas 下发 —— 同上
- [x] Java/Kotlin ↔ C++ 绑定 —— **实际走 Rust**：`packages/layout-core-rust/src/jni.rs`（JNI 入口）
- [x] **跑 4050 元素测试与原生 View 体系对打** —— `hosts/android/ACCEPTANCE.md`：**三项全部达标**
      （布局 **0.063×** · 绘制 **0.667×** · 内存 **0.331×**，即均**优于**原生）+ 10+ 次运行记录在 `hosts/android/results/acceptance/`

**出口条件**：见 §9.2 —— ✅ **本关已过**（路线无需重估）；★决定后端语言为 Rust（M0.5 DCP-1）

### M3 · Android 端补全（≈6 人周）—— ◐ **部分完成**（核实于 2026-09-28）

- [x] `list` 复用池 —— ✅ `packages/layout-core-rust/src/recycle.rs`（Lifecycle/方向敏感预载/RecyclePool）+ `hosts/android/results/layout-recycle.json`（4000 行 **reuse_ratio 0.9947**）+ ★**iOS 自绘宿主已接线（2026-09-28）**：`proteus_recycle_{create,update,stats,destroy}` FFI（**核心只给决策、平台只执行动作**）+ `mountVirtual`/`scrollRows`（虚拟化：3002 节点只物化 **14 行/44 层** · 建层 **74** / 复用 **1554** · 层数恒定 · **真机 `V12_scroll_recycle` PASS**；见 `docs/proteus-vapor-honest-boundaries.md` #26）
- [x] `rich-text` —— ⚠️ **仅 IR 声明**（`component-ir/src/primitives.ts` 标 `status:'implemented'`），**无宿主渲染证据**
- [ ] 与原生组件混用（map / webview）—— ◐ **仅 Android**：`hosts/android/README.md` M3（WebView 宿主）+ `native-host-verify.py` + `scroll-sync-verify.py`（z-order 实测 native-on-top）
- [x] 事件系统、手势 —— ✅ `packages/gesture/src/`（tap/longpress/pan）+ `hosts/android/results/{gesture,hit/layout-hit}.json`
- [ ] 调试工具链（节点树 inspect、帧耗时打点）—— ◐ `packages/devtools/` 有；**帧耗时打点未见证据**

### M4 · iOS 端 CALayer 路线（≈4 人周）—— ◐ **大部分完成**（核实于 2026-09-28）

- [x] 复用 C++ 排版核心 —— ✅ **实际复用 Rust 核**：`hosts/ios/experiments/device/layout-core-device.swift` + `results/layout-core-bench-ios.json`
- [x] CALayer 树 + CoreText 异步排版 —— ✅ `hosts/ios/README-CALAYER.md`（**12/12 通过**）+ CoreText 度量（`selfdraw-scene.swift` 的 `measureText`，含内容寻址缓存）
- [x] 拍平 + 离屏渲染规避 —— ✅ `hosts/ios/README-BENCH.md` + `docs/proteus-performance-plan/10-ios-memory.md`（**真/假拍平辨析**：50 块位图 vs 4000 块）
- [ ] 与 Android 端一致性 conformance 门禁 —— ◐ `hosts/cross-device-hit.py` 已有跨端命中测试，**但无 CI script 挂载**

### M5 · 鸿蒙端 + 收尾（≈4 人周）—— ❌ **未做**（核实于 2026-09-28）

- [ ] 鸿蒙绘制层接入 —— ❌ 无代码（全仓仅 `.md`）
- [ ] 无障碍 / Semantics 语义树（合规必需，见 §10）—— ❌ 无证据（`component-ir` 无 semantics 字段）
- [ ] 性能棘轮门禁常态化 —— ◐ **门禁已存在**（`scripts/check-vapor-perf.mjs`，两层判据：性能上限 + **优化路径生效证明**），**但未接入 `pnpm verify` 链** ⇒ 待接线

> ⚠ **§9.4 的一处不实**：文中称新增包 `@proteus-vue/perf-ratchet` —— **该包不存在**；
> 实际落地形式是 `scripts/check-vapor-perf.mjs` + `package.json` 的 `check:vapor-perf`。
> （本仓纪律：文档提到的产物必须可 grep 到；此类"声称有包但无包"会导致后续会话白找。）

---

## 9. 验收标准

### 9.1 conformance 门禁（每阶段必过）

同一份语义 IR 在 Headless / VueDom / NativeVapor 三后端输出**布局结果一致**（允许亚像素级误差），纳入既有 conformance 门禁。

### 9.2 M2 性能验收：4050 元素测试

**测试定义**（严格复刻，否则数据不可比）：

- 点击按钮后在屏幕创建 **2000 个 view**，每个 view 设背景色，每个 view 内嵌 1 个 text
- 2000 个 view 分 **50 行 × 40 个**，每行外层再套 1 个 view
- 合计 **4050 个元素**（2050 view + 2000 text）
- **view 不设宽高**，尺寸由内部文字撑开 —— 必须完整走排版、测量、绘制
- 计时：起点 = click 事件触发；终点 = 主线程渲染指令全部送达 OS 渲染进程

**对照组**：Android 原生 View 体系实现同一测试（线性布局）

**合格线（建议）**：

| 指标 | 合格 | 目标 |
|---|---|---|
| 4050 渲染耗时 vs 原生 View | ≤ 原生耗时 | ≤ 原生 × 0.6 |
| 不拍平时的耗时 | 仍 ≤ 原生 | 同上 |
| 增量内存 | ≤ 原生 | ≤ 原生 × 0.8 |

**测试环境要求（Android，极易产生错误数据）**：

- 必须 release 包（真机 debug 模式数据无效）
- 每次测试前杀进程重进；重复 5 次取均值
- 用 Perfetto 确认数据跑在普大核（被调度到超大核则数据作废）
- 监控设备温度，避免降频
- 使用普通包名，不预载、不预触发 JIT
- 区分"初次安装"与"闲时优化"两组数据

### 9.3 长列表验收（M3）

死亡长列表定义：4000 行数据、7.4M JSON、每行 40+ 元素、嵌套 10+ 层、共渲染约 2 万元素、含阴影/圆角/边框。回滚到顶部的过程中统计帧率。

**★当前实测状态（2026-09-28，分两步，均真机 iPhone 12）**：

| 步骤 | 形态 | 实测 |
|---|---|---|
| ① 纯逻辑跑批 | `recycle.rs` 4000 行 / 400 帧（含回滚） | `reuse_ratio` **0.9947** · `max_live` 22 · `demoted` 4788（Android 侧报告 + 本机单测） |
| ② **端上虚拟化** | `V12_scroll_recycle`：1000 行 SFC 产物 → 模板实例化 → `mountVirtual` → 60 帧滚动（下 30 + 回 30） | 3002 节点 → **只物化 14 行/44 层** · 每帧 acquire/release **≤15** · **建层 74 / 复用 1554**（95.5%）· 层数恒定 **74** · **PASS** |

②相对①补上的是**平台侧执行**：核心只给「本帧 acquire/release 哪几行 + 方向」的**决策**，
宿主执行「取/还 CALayer」的**动作**（层的同类型复用 + 完全重配 + 按行号序插入）。
⇒ 「滚动时不触发堆分配」这条现在有**端上证据**（建层总数 74，与滚动距离无关），不只是纯逻辑推演。

★**尚未覆盖**（诚实边界，见 `proteus-vapor-honest-boundaries.md` #26）：
文档原定义的「4000 行 / 每行 40+ 元素 / 2 万元素」规模未在端上跑；
虚拟化下 `splice`（行数变化需重新 `mountVirtual`）；帧率（fps）未采集——本档量的是层与复用读数。

### 9.4 性能棘轮门禁

**性能棘轮门禁**（★**实际形态**，2026-09-28 核实）：`scripts/check-vapor-perf.mjs`
（`pnpm check:vapor-perf`，两层判据 = 性能上限 + **优化路径生效证明**）+ `hosts/ios/bench.mjs`
（`check:ios-perf`）+ `scripts/check-ios-experiment-docs.mjs`（文档数字↔实测报告对账）。
**已接入 `pnpm verify` 链**（2026-09-28）。
⚠ **原稿所称的 `@proteus-vue/perf-ratchet` 包不存在**——本仓纪律：文档提到的产物必须可 grep 到。

---

## 10. 坑位清单（实现前必读）

| # | 坑 | 应对 |
|---|---|---|
| 1 | **文本排版** | 断词、连字、BiDi、emoji、字体回退、富文本混排。优先复用平台能力（StaticLayout / CoreText），只在其成为瓶颈时自研 |
| 2 | **无障碍合规** | 不用系统组件 = 系统遍历不到节点树。需自建 **Semantics 语义树**适配无障碍、AutoFill、ContentCapture。某些市场有合规要求 |
| 3 | **输入框** | 光标、选区、输入法交互、自动填充。`input` 建议直接映射原生组件，不自研 |
| 4 | **与原生组件混用** | 地图、WebView、广告 SDK 必须原生嵌入，层级与滚动同步需专门设计（这也是不自绘的核心理由） |
| 5 | **离屏渲染（iOS）** | cornerRadius + shadow 同层触发每帧离屏光栅化，需拆分图层 |
| 6 | **AutoLayout（iOS）** | 必须绕开，CPU 消耗随视图数指数级上升 |
| 7 | **commit 递归（iOS）** | layer tree 深度直接决定 commit 成本，拍平是刚需而非优化 |
| 8 | **一致性 vs 兼容性** | 复杂组件自研保证一致，原子组件与原生组件映射保证兼容（见 D5） |
| 9 | **不要提前优化** | 先接成熟引擎跑通全链路，再考虑自研布局。布局正确性不达标时谈性能无意义 |
| 10 | **工程量的量级** | 业界同类方案自述为"数千项工程优化"。Compose 走同一路线但比 View 体系更慢，说明方向正确不等于结果正确 |
| 11 | **dirty 冒泡** | 无约束嵌套容器会让 dirty 级联到根，实测 350 节点可从 1.2ms 恶化到 28.4ms。必须做 `isLayoutBoundary` 并跑 §5.4 的 T2 对照 |
| 12 | **跨端像素精度** | 鸿蒙强制整数像素，Yoga 支持小数。分数 flex 多列布局会产生累计误差错位，必须在 Profile 层定死舍入策略（§5.5） |
| 13 | **引擎 API 泄漏** | Yoga / Taffy 的原生 API 若泄漏到 `layout/` 之外，后续替换成本极高。M1 必须锁死抽象边界 |

---

## 11. 给实现 LLM 的执行指令

1. **严格按 M0 → M0.5 → M1 → M5 顺序推进**，禁止跳阶段。M2 是唯一的生死关，未通过 §9.2 验收前不得开始 M3。
2. **每个阶段结束必须通过对应门禁**（conformance / Golden / perf-ratchet），再进入下一阶段。
3. **IR 扩展不得破坏既有五后端**：Headless / VueDom / Skyline 后端的既有测试必须全绿。
4. **新增转换规则必须自带 AI 说明书**，与既有 69 条规则的约定一致。
5. **`proteus explain` 必须能 trace 每一项编译期决策**（静态提升、拍平、布局边界判定），否则无法定位问题。
6. **不实现自绘**：任何引入 Surface / TextureView / XComponent 作为渲染画布的实现都视为违反架构约束，应被拒绝。
7. **遇到 §10 的坑位时**，优先选择"映射原生组件"而非"自研"，除非该组件已在 §9 验收中确认为瓶颈。
8. **M0.5 的排版核心语言决策不得跳过或延后**。C++ / Rust 一旦选定，后期更换成本极高。
9. **布局引擎原生 API 不得出现在 `layout/` 模块之外**。任何直接调用 Yoga / Taffy API 的上层代码视为违反架构约束，应被拒绝。
10. **不得因"Yoga 是老设计"而自研布局引擎**。自研前必须先书面回答 §5.0.6 的问题。

---

## 12. iOS 端内存专项（M4 阶段必读）

> 背景：CALayer + 手算 frame 方案实测渲染性能超过原生，但**内存占用高出原生 78%**。
> 本节为专项诊断与优化规格，M4 阶段必须完成，且纳入 §9.4 性能棘轮门禁。

### 12.1 首要假设：backing store 色彩空间未优化

**首要怀疑对象，优先验证。**

系统 `UILabel` 对**单色** string 做了优化处理，**可节省约 75% 的 Backing Store**，并能自动更新 backing store 尺寸以适配富文本或 emoji。实测的 78% 与该数字高度吻合，应作为第一排查目标。

机制：

- CALayer 需要绘制内容时分配 backing store，尺寸 = `bounds × contentsScale²`，每像素 4 字节（RGBA）。iPhone 6 尺寸全屏一块约 **3.4 MB**
- iOS 12 起系统会**根据实际色彩空间动态调整** backing store 大小；此前用 sRGB 格式而实际只画单通道内容时，尺寸偏大，产生不必要开销
- 若自绘路径默认走 sRGB 全通道，则**每个文本 layer 比系统 UILabel 多消耗约 4 倍内存**

### 12.2 P0 优化项（预计可消除大部分差距）

| # | 措施 | 说明 |
|---|---|---|
| P0-1 | **显式设置 `contentsFormat`** | 纯色文本、纯色块等单通道内容设为紧凑格式，禁止默认 RGBA |
| P0-2 | **纯色背景绝不进绘制流程** | `backgroundColor` 直接画到 frameBuffer，不需要 backing store。若背景色也走自绘，则每个背景节点都在白分配位图 |
| P0-3 | **用 `contents` 替代 `drawRect`** | 将 image 设为 `contents` 可**阻止图层为 backing store 申请内存**，图层直接以该 image 作为 backing store；多个 layer 使用同一 image 时**共享内存**而非各自开辟 |
| P0-4 | **消灭离屏渲染** | 阴影必须设 `shadowPath`；避免 `cornerRadius` + `masksToBounds` 同时开启；避免 `mask` |

**关于 `shouldRasterize` 的硬性约束**：
- 启用后**至少触发一次离屏渲染**，并消耗额外内存
- 缓存有空间上限（不超过屏幕总像素的 **2.5 倍**），超限失效
- 缓存约 **100ms** 未被使用即自动丢弃
- 内容频繁变动（resize、动画）时缓存失效，反而回到每帧离屏渲染
- **结论**：仅在"结构复杂且内容静态"的节点上启用，且必须设 `rasterizationScale = UIScreen.main.scale`。**默认关闭。**

### 12.3 ⚠️ 拍平与内存的反直觉陷阱（必须写进判定规则）

拍平有两种实现，**只有一种是优化**：

| 实现 | layer 数 | 内存 | 结论 |
|---|---|---|---|
| **真拍平**：不创建 layer，直接绘制到**父 layer 已有的** backing store | ↓ | ↓ | ✅ 采用 |
| **假拍平**：把多个节点合并绘制到**一张新建位图** | ↓ | **↑↑ 暴涨** | ❌ 禁止 |

业内真实教训：曾有实现尝试将三张小图绘制到一张大图上再展示，结果**内存炸掉**，最终改回多视图实现。

原因：合并位图尺寸为子节点并集，且任一子节点变化都要重绘整块；列表场景下是灾难。

**强制规则**：`flattenEligible` 判定（§3.1）必须追加条件——
1. 子树必须**完全静态**（无任何动态绑定）
2. 拍平目标是**复用父级 backing store**，不得新建合成位图
3. 拍平节点不支持事件与截图 API，需在 IR 层校验报错

### 12.4 IR 层新增：`paint-hint` 绘制提示

**必须在编译期从归一化样式推导，不得在运行时判断。**

```ts
interface PaintHint {
  isMonochrome: boolean       // 纯色内容 → 紧凑 contentsFormat
  isPureBackground: boolean   // 纯色背景 → 走 backgroundColor，不分配 backing store
  shareableContent?: string   // 可共享图形的资源 hash → 走 contents 共享内存
  staticSubtree: boolean      // 完全静态 → 允许拍平 / 允许光栅化
}
```

### 12.5 C++ 核心新增模块

```
layout-core/
├── materialize/    【新增】节点 → 平台 layer 的懒创建与回收
│                    - 仅 Display / Visible 状态的节点 materialize 成 CALayer
│                    - 退出 Display 范围即回收 layer，释放 backing store
└── paint-hint/     【新增】绘制提示生成（编译期推导入参，运行时供平台层查询）
```

**懒创建（materialize）机制**——借鉴 Texture：
> `ASDisplayNode` 创建时不会立即新建 UIView / CALayer，直到主线程第一次访问时才生成对应对象。

Proteus 的 C++ 节点树本就与 CALayer 解耦，**天然支持该优化**：只有真正进入显示范围的节点才 materialize。

### 12.6 生命周期状态机（移植到 `recycle/` 模块）

借鉴 Texture 的 `ASRangeController` 三档状态：

| 状态 | 行为 | 内存策略 |
|---|---|---|
| Preload | 异步加载数据（API / 本地） | 缓存显示数据 |
| Display | 开始渲染（文本光栅化、图片解码） | 保持渲染缓存 |
| Visible | 维持高质量资源 | 保持高质量缓存 |
| 退出可见 | 逐步降级 | **释放非必要资源 / 回收 layer** |

关键细节：用户**改变滚动方向时动态交换**前后预加载区域——滚动方向（leading）区域远大于离开方向（following）区域。这是纯为内存服务的设计，必须实现。

### 12.7 P1 / P2 优化项

| 优先级 | 措施 | 说明 |
|---|---|---|
| P1 | **layer 复用池** | 列表滚动复用 layer 对象，不反复创建销毁 |
| P1 | **图片按显示尺寸 downsample** | 几十像素的头像不得持有几千像素解码位图；异步解码 + 缓存位图 |
| P2 | **整数尺寸** | layer 宽高设整数，简化 backing store 管理，减少抗锯齿开销 |
| P2 | **适配的 `contentsScale`** | 非文本内容不必强上 3x，与显示匹配即可 |

### 12.8 诊断流程（实现前必做）

在动手优化前，先用 Instruments 定位。目标：确认 layer 总数、backing store 总占用、离屏缓冲区占用三个数。

| 工具/开关 | 用途 |
|---|---|
| Allocations → Dirty Size | 实际内存占用构成 |
| Color Offscreen-Rendered Yellow | 黄色 = 离屏渲染区域，每处都有额外缓冲区 |
| Color Blended Layers | 红色 = 混合区域，说明存在不必要透明层 |
| Color Misaligned Images | 非像素对齐，额外消耗 |
| Color Hits Green / Misses Red | 光栅化缓存命中；红色说明 `shouldRasterize` 用错 |
| Time Profiler | 主线程耗时函数 |

**诊断顺序**：
1. 先测 P0-1（contentsFormat）与 P0-2（背景色是否误走绘制）——这两项可能半天内砍掉大半差距
2. 再测离屏渲染占比
3. 最后才考虑结构性改造（复用池、状态机）

### 12.9 验收标准（纳入 M4 与 perf-ratchet）

| 指标 | 合格线 | 目标 |
|---|---|---|
| iOS 端内存增量 vs 原生 | **≤ 原生 × 1.15** | ≤ 原生 × 1.0 |
| layer 总数（4050 场景，拍平后） | 显著低于节点数 | — |
| 离屏渲染 layer 数 | 0 | 0 |
| 滚动后内存增长 | 收敛，不持续增长 | 完全持平 |

**注意**：§9.2 的渲染性能验收与本节的内存验收必须**同时满足**。只允许用"牺牲内存换渲染性能"的方式通过 M2，不得延续到 M4。

---

## 附：关键事实依据

- 采用"替换 UI 框架层、复用系统渲染管线"路线的方案，在 4050 元素渲染测试中：鸿蒙端 ArkUI 797.6ms vs 该方案 243.2ms；iOS 端 UIKit 328.75ms vs 160.6ms
- 同路线方案明确排除自绘，理由为两条渲染管线并存导致滚动同步、层级合成、资源消耗问题
- 采用"运行时重组"路线的 Compose，在同类测试中慢于 View 体系，瓶颈在组合阶段而非布局阶段
- Android 端文本排版优化生产案例：主线程 30–50ms → 约 2ms，掉帧减少 60%
- iOS 端 `CALayer` 较 `UIView` 轻量（后者额外承担事件处理、布局管理、Responder Chain）；`UILabel + NSAttributedString` 长列表约 30 FPS，`CATextLayer` 约 58 FPS
- iOS commit 阶段基于 layer tree 递归执行，官方建议保持 layer tree 扁平；AutoLayout 的 CPU 消耗随视图数量指数级上升
- 系统 `UILabel` 对单色 string 的优化可节省约 75% 的 Backing Store；backing store 尺寸为 `bounds × contentsScale²` × 4 字节，iPhone 6 全屏约 3.4 MB；iOS 12 起系统会按实际色彩空间动态调整
- 将 image 设为 CALayer 的 `contents` 可阻止图层为 backing store 申请内存，多个 layer 使用同一 image 时共享内存
- 离屏渲染缓存上限为屏幕总像素的 2.5 倍，约 100ms 未使用即丢弃；`shouldRasterize` 至少触发一次离屏渲染
- Texture（原 AsyncDisplayKit）的 `ASDisplayNode` 懒创建 layer、图层预合成、Preload/Display/Visible 三档状态机与滚动方向动态交换预加载区域
- Yoga 2026 年仍在维护提交（2026-02 移除 CocoaPods 支持、2026-03 Gradle 9/AGP 8.12、2026-06 Flexbox §4.5 auto-min-size、2026-08 shrink-factor 浮点修复），编译器要求已升至 C++20；但处于维护模式，演进绑定 React Native 需求
- React Native 生产实测：350 节点树因无约束嵌套容器导致 dirty 级联到根，C++ 布局耗时从 1.2ms 恶化至 28.4ms（60 FPS 预算 16.67ms，120Hz 为 8.33ms）
- 鸿蒙 ArkUI 强制整数像素，Yoga 支持小数像素；`flex: 1/3` 三列布局因 0.333 舍入为 0.33 产生累计误差导致第三列错位
- 纯 TypeScript 布局引擎通过算法优化（主轴位置累积和改为线性递推、默认值字段构建期折叠）使 hot-structural 场景从 450µs 降至 70µs，结论为"算术速度不是瓶颈"
- 布局引擎对比：Yoga（C++，Flexbox，绑 RN）、Taffy（Rust，Flexbox + Grid，Bevy/Dioxus/Zellij 在用）、Stretch（Rust，更严格遵循 Web 标准）
- Yoga 测试方法：写 HTML 片段在 Chrome 渲染，以浏览器按 CSS Flexbox 规范算出的布局作为测试预期值
