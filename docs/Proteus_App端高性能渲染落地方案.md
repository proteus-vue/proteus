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

### D3. 布局引擎：Yoga 起步，自研替换

| 阶段 | 方案 | 理由 |
|---|---|---|
| M0–M2 | **Yoga**（Flexbox 成熟实现） | 快速验证全链路，避免布局正确性成为瓶颈 |
| M3+ | 自研布局引擎 | Yoga 为通用性牺牲了部分性能；蒸汽模式的性能收益部分来自自研排版 |

**布局协议约束（必须遵守）**：约束自顶向下、尺寸自底向上、**严格单次测量**，禁止 View 体系那种"父子多轮 measure"。这点是 Compose 相对 View 体系做对的地方，直接抄。

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

## 5. C++ 排版核心规格（`@proteus-vue/layout-core`）

### 5.1 模块划分

```
layout-core/
├── node/          节点树（扁平数组 + 父/兄弟索引）
├── layout/        Flexbox 布局（Yoga 起步，预留自研接口 LayoutEngine）
├── text/          文本度量抽象（平台实现注入）
├── flatten/       拍平规则（编译期判定的运行时执行）
├── recycle/       列表复用池
├── dirty/         脏区域标记与最小重排传播
└── render/        绘制指令流生成（平台无关）
```

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

### 5.3 性能硬约束

| 约束 | 说明 |
|---|---|
| 单次测量 | 禁止父子多轮 measure；布局边界（`isLayoutBoundary`）阻断向上传播 |
| 无运行时字符串解析 | 样式键在编译期转为枚举 |
| 节点分配池化 | 列表复用由 `recycle/` 统一管理，滚动时不触发堆分配 |
| 文本度量可缓存 | 度量结果按 (文本 hash, 字体, 宽度约束) 缓存，支持后台线程预热 |

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
└── @proteus-vue/perf-ratchet/       【新增】性能棘轮门禁（见 §9）
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

### M0 · IR 扩展与编译期分析（≈2 人周）

- [ ] 扩展 `PNode` / `PFlags` / `DynamicBinding`
- [ ] 实现静态子树识别与提升
- [ ] 实现拍平判定 + 违规报错
- [ ] 样式归一化 + 单位折叠
- [ ] Golden 门禁：Node/Rust 双端对齐

**出口条件**：`proteus explain` 能输出拍平/静态提升的完整决策 trace。

### M1 · C++ 排版核心骨架（≈3 人周）

- [ ] 节点树（扁平数组）
- [ ] 接入 Yoga，实现单次测量布局
- [ ] 脏区域标记与最小重排
- [ ] 平台无关绘制指令流

**出口条件**：Headless 后端能输出正确的指令流，与 VueDom 后端布局结果逐像素比对通过。

### M2 · Android 端最小闭环（≈3 人周）★ 关键验证点

- [ ] 仅实现三个组件：`view` / `text` / `image`
- [ ] 宿主 View + Canvas 下发
- [ ] Java/Kotlin ↔ C++ 绑定
- [ ] **跑 4050 元素测试与原生 View 体系对打**

**出口条件**：见 §9.2。这一关过不了，整条路线应重新评估。

### M3 · Android 端补全（≈6 人周）

- [ ] `list` 复用池 + `rich-text`
- [ ] 与原生组件混用（map / webview）
- [ ] 事件系统、手势
- [ ] 调试工具链（节点树 inspect、帧耗时打点）

### M4 · iOS 端 CALayer 路线（≈4 人周）

- [ ] 复用 C++ 排版核心
- [ ] CALayer 树 + CoreText 异步排版
- [ ] 拍平 + 离屏渲染规避
- [ ] 与 Android 端一致性 conformance 门禁

### M5 · 鸿蒙端 + 收尾（≈4 人周）

- [ ] 鸿蒙绘制层接入
- [ ] 无障碍 / Semantics 语义树（合规必需，见 §10）
- [ ] 性能棘轮门禁常态化

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

### 9.4 性能棘轮门禁

新增 `@proteus-vue/perf-ratchet`：上述 benchmark 纳入 CI，性能回退超过阈值即阻断合并。与既有性能棘轮机制保持一致。

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
| 9 | **不要提前优化** | 先接 Yoga 跑通全链路，再考虑自研布局。布局正确性不达标时谈性能无意义 |
| 10 | **工程量的量级** | 业界同类方案自述为"数千项工程优化"。Compose 走同一路线但比 View 体系更慢，说明方向正确不等于结果正确 |

---

## 11. 给实现 LLM 的执行指令

1. **严格按 M0 → M5 顺序推进**，禁止跳阶段。M2 是唯一的生死关，未通过 §9.2 验收前不得开始 M3。
2. **每个阶段结束必须通过对应门禁**（conformance / Golden / perf-ratchet），再进入下一阶段。
3. **IR 扩展不得破坏既有五后端**：Headless / VueDom / Skyline 后端的既有测试必须全绿。
4. **新增转换规则必须自带 AI 说明书**，与既有 69 条规则的约定一致。
5. **`proteus explain` 必须能 trace 每一项编译期决策**（静态提升、拍平、布局边界判定），否则无法定位问题。
6. **不实现自绘**：任何引入 Surface / TextureView / XComponent 作为渲染画布的实现都视为违反架构约束，应被拒绝。
7. **遇到 §10 的坑位时**，优先选择"映射原生组件"而非"自研"，除非该组件已在 §9 验收中确认为瓶颈。

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
