# Proteus 官网重构（Website v3）

> 配套：`PROTEUS-METHODOLOGY`（原则 #0，五支柱）+ `proteus-positioning.md` v4 + G-27/28/29/30/31/32。
> 本文件是**官网重构的总纲**——它要解决的不是"页面怎么排"，而是"官网的信息架构必须与方法论同构"。
> 口径对齐日期：2026-09-02，对应规划体系 v2（49 份 plan + 1 哲学 + 1 规约）。

---

## 0. 核心判断：这不是换皮，是信息架构翻转

### 0.1 传统跨端框架官网的隐含假设

uni-app / Taro / 小程序官网，底层是**同一套信息架构**：

```
① 组件文档（view / text / button 逐个列属性）
② API 文档（wx.xxx / uni.xxx 逐个列参数 + 回调）
③ "一套代码多端运行"的营销卖点
④ 示例 / Demo（通常是静态截图或视频）
```

**这套结构不是随意的——它是"平台 API 映射"思维的必然产物。** 因为框架的核心是"把小程序 API 翻译到各端"，所以官网就是"API 参考 + 映射表 + 兼容性标注"。开发者来官网是为了**查某个 wx API 在某个端怎么写**。

### 0.2 Proteus 的官网必须是另一种结构

Proteus 的核心已经不是"API 映射"，而是（G-31/G-32 + 四层 SPI）：

```
开发者写语义原语（p-stack / p-grid / useFetch / useNative）
        ↓ 编译期
统一的 IR（Component IR / Compiler IR / Render IR / Capability IR）
        ↓ 四层 Backend SPI
编译后端（Node/Rust/WASM） × 渲染后端（VueDom/Native/Flutter/Skia）
    × 能力后端（iOS/Android/Harmony/Mock） × 端后端（任意 Tier 1-4）
        ↓ 每个 Backend 跑 conformance test
任意端
```

**所以官网必须翻转：**

| 维度 | 传统（uni-app/Taro/小程序） | **Proteus Website v3** |
|------|----------------------------|------------------------|
| 起点 | "我们有哪些组件/API"（平台清单思维） | **"语义模型是什么"（方法论思维）** |
| 文档单元 | 单个组件/API 的属性表 | **语义原语 + 它的多后端实现剖面** |
| 对标方式 | 兼容性矩阵（某 API 在某端是否支持） | **conformance 报告（某 Backend 是否通过 IR 契约）** |
| Demo | 静态截图/视频 | **可交互 Playground，改语义原语实时看多后端** |
| 可信度 | "我们测过能用" | **"我们的官网自己跑在自己的框架上"（dogfooding）** |

### 0.3 一句话定义

> **Proteus 官网不是一个"文档站"，而是一个"语义模型的可体验证明场"——每一个杀手特性都要能被玩到，而不是被读到；每一个后端都要能被切换到，而不是被列在表格里。**

---

## 1. 设计原则（直接来自方法论五支柱）

官网自身的设计也必须遵守 Proteus 方法论——这不是装饰，是 dogfooding 的硬要求。

### 原则 W-1：官网是 Proteus 的第一个 Showcase App

> **`proteus.dev` 本身必须是一个标准的 Proteus App，跑在 Web 端的 `VueDomBackend` 上。**

这意味着：
- 官网布局用 `<p-grid>` `<p-stack>` `<p-adaptive>` 等语义原语（G-31），**禁止手写 `<view class="flex-col">` 式的 div + CSS 模拟**
- 主题切换用语义 token（G-16），暗色模式走 `useColorScheme()`
- 动效用 worklet（原生流畅，对齐原生端体验）
- 官网源码放在 `proteus/website` monorepo，与框架同仓库，**CI 跑同一套 conformance test**

**这是最强的对外证据**：开发者审查官网源码 = 看到真实 Proteus 代码，且这代码正在渲染他眼前的页面。任何"框架能不能真的跑"的质疑，官网本身就是答案。

### 原则 W-2：文档单元 = 语义原语，不是平台 API

> **每一个文档页面对应一个"语义原语 + 它的多后端实现剖面"，而不是一个平台 API。**

传统页面：
```
/component/view       →  view 组件的 20 个属性
/api/request          →  wx.request 的参数 + success/fail 回调
```

Proteus 页面：
```
/primitives/layout/grid        →  <p-grid> 的语义 + 5 个 Backend 如何渲染它
/primitives/capability/fetch   →  useFetch() 的语义 + 网络后端如何实现它
/backends/render/vuedom        →  VueDomBackend 如何实现所有布局原语
```

**页面里当然有"小程序对照"**——但它是附录，不是主体。主体是"语义是什么、各后端如何实现、如何在 IR 层校验"。

### 原则 W-3：可切换性必须可视化（核心转化点）

> **凡是框架宣称"可插拔"的东西，官网都要提供一个"一键切换"的交互。**

| 框架宣称 | 官网交互 |
|---------|---------|
| 渲染后端可插拔（G-27） | Playground 里下拉切换 VueDom / Native / Flutter / Skia，同一份 SFC 实时看四端 |
| 原生能力可插拔（G-28） | 能力演示页切换 iOS / Android / Harmony，看同一 `useNative().scanQR()` 调起不同原生 UI |
| 编译器可插拔（G-29） | "编译产物"页切换 Node / Rust，实时显示 IR 输出差异 + 编译耗时对比 |
| 任意端（G-30） | 设备选择器：手机 / 平板 / PC / 车机 / TV / 手表，布局自动适配（p-fluid + Tier 降级） |
| 语义原语（G-31/32） | 原语目录：点 `<p-stack>`，右侧并排显示"Web 渲染"和"原生渲染"的双剖面 |

**这是官网与所有竞品官网的本质差异**：竞品官网是"看图"，Proteus 官网是"动手切"。

### 原则 W-4：证明先于宣称（Proof before Claim）

> **每一个杀手特性页，都必须包含一个"可复现的最小证明"，而不是一句口号。**

对标矩阵里写的每一个 ✅，都要能点进去看到一个：
- 可运行代码片段（Playground 内联）
- 或 conformance 测试报告（该 Backend 如何证明自己合规）
- 或 真机录屏（六端实机）

**不允许出现"宣称了但点不进去"的特性。** 这是方法论支柱③"验证先于运行"在营销层的兑现。

### 原则 W-5：迁移路径显式化（诚实优于包装）

> **官网必须有"从 uni-app / Taro / 小程序迁移"的完整路径，且不隐藏成本。**

这是 G-32 migration 的自然延伸。官网要明说：
- 装 `@proteus/compat-miniprogram` 即可跑现有小程序代码
- codemod 自动转 70-90%
- 剩下的"语义还原"部分（如 `wx.request` → `useFetch`）用 AI Agent（G-23）辅助

**显式标注成本比“无缝迁移”的口号更可信**——开发者信的是“我知道要改什么”，不是“官方说不用改”。

### 原则 W-6：柔性框架优先（Fluid-First）★ #374 新增

> **官网的响应式必须用 Proteus 自己的柔性框架（G-22 `@proteus-vue/fluid`）实现，禁止手写 `@media` 断点。**

这是 W-1（dogfooding）在布局层的落地——**官网自己用 `@media` 写响应式，柔性布局的说服力归零**：

- **排版/间距**：`v-p-fluid` 指令（`font-size(28, 56)` / `padding(24, 64)`）→ 编译为 `clamp()` 流式插值，**零断点、零跳变**
- **网格列数**：柔性网格语义（`repeat(auto-fill, minmax(min-col-width, 1fr))`——p-grid `min-col-width` 的 CSS 等价形态），**列数随容器宽度自动伸缩**，不写 820px/1024px 魔法数
- **禁止**：手写 `@media (max-width: …)` 断点分支、JS 宽度判断（`window.innerWidth`）、rpx 等比缩放——这三者正是 G-22 要淘汰的“单位换算/断点跳变”范式（FLD001/002/008 同源）
- **校验**：`verify-llm.js` **C8**（手写 `@media` = error）；存量 v3 静态 demo 页 legacy 白名单豁免，B4 迁移后移除

---

## 2. 新信息架构（IA）总览

```
/                              ★ 首页（方法论翻转的核心表达）
/docs                          文档中心（重构后的结构）
  /guide                       教程（按"理解语义模型"排序，非按 API）
    01-why-proteus              → 从"平台 API 映射"到"语义收敛"（本文档 §0）
    02-semantic-model           → 原则 #0 + 五支柱 + IR 层
    03-primitives               → 语义原语入门（p-stack/p-grid/useFetch）
    04-backends                 → 四层 SPI 概念
    05-compiler                 → G-29 编译后端
    06-renderer                 → G-27 渲染后端
    07-capabilities             → G-28 能力后端
    08-platforms                → G-30 任意端
    09-migration                → 从 uni-app/Taro/小程序迁移
    10-deploy                   → 构建部署
  /primitives                   ★ 语义原语目录（G-32，128 原语）
     /layout                    → 12 布局原语（含 swiper 被消灭的说明）
     /ui                        → 18 UI 原语
     /shell                     → 10 Shell 原语
     /gesture                   → 10 手势原语
     /capability                → 50 能力原语（每个 = useXxx Hook）
     /engineering               → 28 工程原语
     /miniprogram-mapping       → ★ 小程序全量对照（42 组件 + ~120 API）
  /backends                     ★ 后端矩阵（四层，可切换）
     /compiler                  → Node / Rust / WASM
     /render                    → VueDom / Native / Flutter / Skia
     /capability                → iOS / Android / Harmony / Mock
     /platform                  → Tier 1/2/3/4 端清单
     /conformance               → ★ 每个 Backend 的 conformance 报告
  /architecture                 → 原则 + 铁律 + IR schema + SPI 定义
/playground                     ★ 核心转化点（多后端实时切换）
/showcase                       → 案例（含官网自身的 dogfooding 案例）
/methodology                    → ★ 方法论页（五支柱 + 与小程序的代际差）
/compare                        → ★ 对标页（uni-app/Taro/RN/Lynx/Flutter + 逐条证据）
/migrate                        → ★ 迁移中心（小程序/uni-app/Taro，codemod 工具）
/changelog                      → 版本记录
/community                      → GitHub / Discord / 贡献指南
```

### 2.1 与传统官网的结构差异（重点）

**删除/降级：**
- ❌ 传统的"组件文档"独立频道 → 合并进 `/primitives`（按语义分类，不是按平台标签）
- ❌ 传统的"API 文档"独立频道 → 合并进 `/primitives/capability`（Hook 化后无"API"概念）
- ❌ "兼容性表格"作为主内容 → 降级为 `/backends/conformance` 的自动生成报告

**新增（Proteus 独有）：**
- ✅ `/primitives` — 语义原语目录（G-32，竞品官网没有这个概念）
- ✅ `/backends` — 四层后端矩阵（**可切换**，竞品官网只有"支持平台"列表）
- ✅ `/backends/conformance` — conformance 报告（竞品官网没有"实现验证"概念）
- ✅ `/playground` — 多后端实时切换（竞品官网只有静态 Demo）
- ✅ `/methodology` — 方法论页（竞品官网只有"快速开始"）
- ✅ `/compare` — 对标页（竞品官网只有自家特性罗列）
- ✅ `/migrate` — 迁移中心（竞品官网弱化或回避）

---

## 3. 核心页面设计

### 3.1 首页 `/` — 翻转的起点

**Hero 区（与竞品官网立刻区分）：**

```
主标题：One semantic model. Any engine — at every layer.
        （一个语义模型，每一层都可换引擎）

副标题：Define once in semantic primitives.
        Render on VueDom, Native, Flutter, or Skia.
        Compile with Node, Rust, or WASM.
        Deploy to any device that implements a Backend.

CTA：Get Started · Try the Playground · View on GitHub
```

**★ 核心交互（首页必须有，这是翻转的具象化）：**

首页不是放一堆特性卡片，**而是直接内嵌一个"可切换的最小 Playground"**：

```
┌──────────────────────────────────────────────────┐
│  <p-grid :min-col-width="160">                    │
│    <p-card v-for="item in items"/>                │
│  </p-grid>                                        │
│                                                   │
│  [Render: VueDom ▼]  [Compiler: Rust ▼]           │
│  [Device: Phone ▼]    [Backend: All green ✓]     │
│                                                   │
│  → 用户改 <p-grid min-col-width>  → 实时看:       │
│    • Web 端：CSS Grid auto-fit 变化               │
│    • 原生端截图/视频同步更新                       │
│    • 编译产物（IR）实时显示                       │
└──────────────────────────────────────────────────┘
```

**这就是首页的全部说服力**：用户还没进文档，就已经"玩到"了 G-27/G-29/G-30。竞品官网做不到这个——因为它们没有"可切换的 Backend"这个概念。

**特性区（七条 → 重新组织为"方法论叙事"，不是罗列）：**

不是平铺七张卡片，而是按"开发者旅程"串成一条线：

```
① Write semantic primitives    →  G-31/32（你写的不是 div，是语义）
        ↓
② Compile to IR                →  G-29（一处定义，多后端产出）
        ↓
③ Render anywhere              →  G-27（同一 IR，四渲染后端）
        ↓
④ Native capabilities, zero glue → G-28（99% 不写原生）
        ↓
⑤ Deploy to any device         →  G-30（Tier 1-4 任意端）
        ↓
⑥ AI-assisted                   →  G-23（Agent 操作 IR）
        ↓
⑦ Verified by conformance       →  所有层可验证
```

每一站 = 一张卡片 + **一个内联可交互 Demo**（原则 W-4）。

### 3.2 语义原语目录 `/primitives` — G-32 的可视化

**这是 Proteus 官网区别于所有竞品的核心频道。**

**布局原语页 `/primitives/layout/grid` 的设计（典型页面范式）：**

```
┌────────────────────────────────────────────────────────┐
│  <p-grid>                                              │
│  语义：二维网格布局，按 min-col-width 自动分列           │
│  属性：min-col-width / max-cols / gap / auto-rows       │
│  IR 约束：min-col-width > 0；max-cols ≥ 1；...          │
├────────────────────────────────────────────────────────┤
│  ★ 多后端实现剖面（这是竞品没有的）                     │
│                                                        │
│  VueDomBackend     → CSS Grid: grid-template-columns:   │
│                       repeat(auto-fit, minmax(160px,1fr))│
│  NativeBackend(iOS) → UICollectionViewCompositionalLayout│
│  Native(Android)   → GridLayoutManager / LazyLayout     │
│  FlutterBackend    → GridView.builder                    │
│  SkiaBackend       → 几何计算 + SkCanvas::drawRect       │
│                                                        │
│  ★ 降级（Tier 2/3 端不支持 grid 时）：                  │
│  → @conditional: 自动降级为 p-stack 单列                  │
├────────────────────────────────────────────────────────┤
│  ★ 小程序对照（附录，不是主体）                         │
│  swiper/scroll-view 的能力被还原为 p-stack 属性          │
│  → 迁移：codemod --from miniprogram                    │
├────────────────────────────────────────────────────────┤
│  Live Demo + Playground 内联                           │
│  Conformance: 5/5 backends passing ✓                   │
└────────────────────────────────────────────────────────┘
```

**每个原语页面都强制包含 5 个区块**（原则 W-2 + W-4）：
1. **语义定义**（属性 + IR 约束）
2. **多后端实现剖面**（这是"可插拔"的可视化证据）
3. **降级行为**（Tier 降级，对齐 G-30）
4. **小程序/uni-app 对照**（诚实标注来源，不是主体）
5. **可运行 Demo + conformance 状态**

**原语目录页 `/primitives` 总览**：6 大类 128 原语的搜索 + 筛选（按层/按端/按 Tier/按是否 L1）。

### 3.3 后端矩阵 `/backends` — 可切换的可信度

**不是静态表格，是交互式矩阵：**

```
Backend 类型      Name         Status    Conformance    Coverage    Docs
─────────────────────────────────────────────────────────────────────
编译后端 ★        Node         stable    48/48 ✓        100%       →
                 Rust(SWC)    beta      46/48 ⚠️       95.8%      →
                 WASM         alpha     40/48 🔶       83.3%      →
─────────────────────────────────────────────────────────────────────
渲染后端 ★        VueDom       stable    全部 ✓          100%       →
                 Native        stable    全部 ✓          100%       →
                 Flutter       beta      ...            ...        →
                 Skia          alpha     ...            ...        →
─────────────────────────────────────────────────────────────────────
能力后端 ★        iOS          stable    ...            ...        →
                 Android       stable    ...            ...        →
                 Harmony       beta      ...            ...        →
─────────────────────────────────────────────────────────────────────
端 ★             Phone/Tablet PC  Tier 1 全部 ✓        100%       →
                 Car/TV/Watch  Tier 2-4 部分            ...        →
```

**每个 Backend 点进去 = conformance 报告**（原则 W-4）：
- 跑了哪些 IR 契约测试
- 哪些原语不支持（及降级策略）
- 性能基准（对齐原生 / 对齐 Lynx 档位）
- 版本 + 维护者

**这比竞品的"支持平台"列表强一个代际**：开发者看到的不是"我们支持 iOS"，而是"iOS Backend 通过了 48/48 项 IR 契约测试，以下 3 个原语在该端自动降级为 p-stack"。

### 3.4 对标页 `/compare` — 降维打击话术的可视化

**直接用 G-30/G-32 的代际差论证，且每条都点得进去看证据：**

| 维度 | uni-app/Taro | Lynx | **Proteus** | 证据 |
|------|-------------|------|-------------|------|
| 世界观 | 翻译（小程序 API → 各端） | 高性能原生渲染引擎 | **语义收敛（IR + SPI）** | → /methodology |
| 组件来源 | 小程序标签原样 | 类小程序 + Skyline | **128 语义原语（消灭 swiper 等）** | → /primitives |
| API 风格 | 回调 + 全局对象 | PAPI / 模块 | **Hook + Promise + 全类型** | → /primitives/capability |
| 新端成本 | 重写映射表 | 接 Lynx 渲染宿主 | **实现 SPI（~15 方法 + test）** | → /backends/conformance |
| 能力缺失 | 运行时崩溃 | 引擎约束 | **编译期 capabilities 报错** | → Playground |
| 标准归属 | 微信 | Lynx 引擎 | **框架自己的 IR** | → /architecture |

**关键**：每一行的"证据"链接都指向可交互内容，不是文档锚点。这是"证明先于宣称"（W-4）的兑现。

### 3.5 迁移中心 `/migrate` — 诚实的转化漏斗

**三个入口，对应三类用户：**

```
/migrate/miniprogram    小程序项目 → Proteus
/migrate/uni-app        uni-app → Proteus
/migrate/taro           Taro → Proteus
```

**每个迁移页的结构（以小程序为例）：**

```
① 可行性自测
   → 你的项目用了哪些小程序能力？（勾选 42 组件 + 120 API）
   → 系统自动生成："你的项目 100% 可迁移，其中 X 个需语义还原"

② 三步迁移
   Step 1: npm i @proteus/compat-miniprogram  → 原项目直接跑
   Step 2: npx proteus-codemod miniprogram     → 自动转 70-90%
   Step 3: 剩余语义还原                         → AI Agent (G-23) 辅助

③ 逐能力对照（链接到 /primitives 对应页）
   wx.request      → useFetch()
   swiper          → <p-stack snap="mandatory" loop>
   scroll-view     → <p-scroll axis="x">
   wx.login        → useAuth().login()

④ 真实案例
   → 某小程序迁移耗时 X 人天，代码量减少 Y%
```

**这是把 G-32 migration 直接产品化**——迁移不是文档，是工具 + 可视化流程。

---

## 4. Playground — 整个官网的心脏

> **Playground 是"可切换性可视化"（W-3）的最高形态，也是方法论的最佳广告。**

### 4.1 核心交互：四维度自由切换

```
┌─ 左侧：编辑器 ─────────────┬─ 右侧：多后端实时预览 ─────────┐
│                            │                                │
│ <template>                 │  [Render: Native ▼]             │
│   <p-grid                  │  [Compiler: Rust ▼]            │
│     :min-col-width="160">  │  [Device: Car ▼]               │
│     <p-card v-for/>        │  [Capability: iOS ▼]           │
│   </p-grid>                │                                │
│ </template>                │  ┌──────────────────────┐      │
│                            │  │                      │      │
│ <script setup>             │  │  实时渲染结果         │      │
│ const native = useNative() │  │  (四端分屏)           │      │
│ </script>                  │  │                      │      │
│                            │  └──────────────────────┘      │
│                            │                                │
│                            │  ★ IR 面板（可折叠）            │
│                            │  CompilerIR → RenderIR         │
│                            │  → Backend 调用链              │
└────────────────────────────┴────────────────────────────────┘
```

**四个下拉 = 四层 SPI 的实时切换**（G-27/G-28/G-29/G-30 全部可视化）：
- 切 Render → 同一份 SFC 在 VueDom/Native/Flutter/Skia 间切换
- 切 Compiler → 看同一份 SFC 的 Node vs Rust 编译产物差异 + 耗时
- 切 Device → 手机/平板/PC/车机/TV/手表，布局自动适配（p-fluid + Tier 降级）
- 切 Capability → `useNative().scanQR()` 在不同端调起不同原生 UI

### 4.2 内置示例（每个 = 一个方法论论点）

| # | 示例 | 证明的方法论论点 |
|---|------|-----------------|
| 1 | `<p-grid>` 拖宽度变列数 | G-22 柔性布局 + 后端自适应 |
| 2 | `<p-modal p-adaptive>` 切设备变 Sheet/Dialog/Popover | G-22.5 自适应容器 |
| 3 | `useNative().scanQR()` 切 iOS/Android/Harmony | G-28 能力后端可插拔 |
| 4 | 页面 A Native / 页面 B Flutter | G-27 同 App 混合渲染 |
| 5 | 切 Compiler Node → Rust，看编译耗时 + IR 差异 | G-29 编译器可插拔 |
| 6 | 车机端自动降级（Tier 2） | G-30 任意端 + 降级 |
| 7 | `wx.request` → `useFetch()` 的 codemod 实时演示 | G-32 迁移 |

### 4.3 技术实现

| 层 | 方案 | 理由 |
|----|------|------|
| Web 端渲染 | **VueDomBackend**（官网自身就是证明） | dogfooding（W-1） |
| 原生端预览 | 真机云测截图/视频 + 描述 | 浏览器无法跑原生，诚实标注 |
| Flutter/Skia | 截图 + 原理说明 | 同上 |
| Compiler 切换 | WebContainers（Node）+ Rust→WASM 编译 | G-29 WASM Backend 天然支持浏览器内编译 |
| IR 可视化 | 编译产物实时展示 | 编译透明（原则 #10） |

**★ 最巧妙的一点**：G-29 的 WASM Backend 让"浏览器内切换编译器"成为现实——这是 Lynx/uni-app 做不到的，因为他们的编译器是 Node-only。Proteus 的编译器本身可插拔到 WASM，所以 Playground 能真的跑 Rust 编译。

### 4.4 Playground = 自传播资产

> **"改一行 `<p-grid>`，实时看它如何在 iOS 的 UICollectionView、Android 的 LazyLayout、Flutter 的 GridView、Web 的 CSS Grid 上渲染"——这条 Demo 的传播力超过任何技术博客。**

这是把 M1/M2 的"可演示产物"变成**持续增长的自传播资产**。

---

## 5. 技术选型（dogfooding 优先）

| 层 | 方案 | 理由 |
|----|------|------|
| **框架** | **Proteus 自身**（`proteus/website` monorepo） | **W-1：最高级的可信度证明** |
| 文档 | VitePress + 自定义主题 | 快、可扩展、Vue 生态；主题用 p-* 原语 |
| Playground | Monaco + WebContainers + Sandpack | 在线编辑 + 实时运行 + Rust→WASM 编译 |
| 搜索 | Algolia DocSearch | 即时搜索（128 原语需强搜索） |
| conformance 展示 | 自动从 CI 报告生成静态 JSON | 单一事实源，避免手动维护 |
| 部署 | Vercel/Netlify（静态） | 低成本、快 |
| i18n | 中英双语（架构层已定义语义，翻译成本降低） | G-32 语义层天然利于 i18n |

### 5.1 目录结构

```
proteus/
├── website/                ← 官网本身是一个 Proteus App
│   ├── app.config.ts       ← 声明式配置（G-32）
│   ├── src/
│   │   ├── pages/          ← 用 <p-grid> <p-stack> 等构建
│   │   ├── primitives/     ← /primitives 内容（MD + 交互组件）
│   │   ├── backends/       ← /backends 内容（自动生成）
│   │   └── playground/     ← /playground
│   ├── composables/        ← useFetch / useColorScheme 等
│   └── backend.config.ts   ← 官网用 VueDomBackend（dogfooding）
├── packages/
│   └── (框架包)
└── (其他 plan)
```

**官网源码即示例**：`/docs/guide` 的教程可以直接 `import` 官网源码片段作为示例——因为官网就是用 Proteus 写的。

---

## 6. 内容优先级（落地顺序）

| 优先级 | 内容 | 理由 | 对应 plan |
|--------|------|------|-----------|
| **P0** | 首页（含内嵌 Playground）+ 快速开始 | 转化核心 | G-31/32 |
| **P0** | Playground（四维度切换） | 方法论的最佳广告 | G-27/28/29/30 |
| **P0** | 语义模型 + 四层 Backend 文档 | 架构理解 | methodology/G-27/28/29/30 |
| **P1** | 语义原语目录（128 原语，含多后端剖面） | 日常开发核心 | G-32 |
| **P1** | 对标页 + 迁移中心 | 转化竞品用户 | G-32 |
| **P1** | Showcase（含官网 dogfooding 案例） | 信任建立 | blueprint |
| **P2** | conformance 报告自动化 | 长期可信度 | 全部 Backend |
| **P2** | 博客（ADR）+ 社区 + i18n | 长期运营 | — |

---

## 7. 验收标准

| # | 标准 | 对应原则 |
|---|------|---------|
| 1 | 首页加载 < 2s（性能自证，dogfooding） | W-1 |
| 2 | 首页内嵌 Playground 可实时切换 ≥ 3 个维度（Render/Device/Compiler） | W-3 |
| 3 | 每一个杀手特性页都有内联可交互 Demo | W-4 |
| 4 | 每一个语义原语页都有"多后端实现剖面"区块 | W-2 |
| 5 | conformance 报告从 CI 自动生成，人工不可篡改 | W-4 |
| 6 | 官网源码 100% 使用 p-* 语义原语，零 `<view class>` 残留 | W-1 |
| 7 | `/migrate` 三步流程可完整跑通一个小程序项目 | W-5 |
| 8 | 对标页每一行都有可点击的证据链接 | W-4 |
| 9 | 文档搜索可用（Algolia），覆盖 128 原语 | — |
| 10 | i18n 中英双语 | — |

---

## 8. 一句话总结

> **传统官网是"我们支持哪些组件/API"的清单站；Proteus 官网是"语义模型如何在这四层 SPI 上运行"的可体验证明场。前者在列能力，后者在证明能力——而证明本身，就是 Proteus 官网用 Proteus 自己建的。**

这是方法论支柱③"验证先于运行"在营销层的最终兑现：**我们不宣称"可插拔"，我们让你亲手切换它。**

---

*本文档是 Website v3 重构总纲，配套方法论见 `PROTEUS-METHODOLOGY.md`，语义原语定义见 G-32。*
*Architecture: `@proteus/architecture` · Plans: 49 · Status: v2 (2026-09-02)*
