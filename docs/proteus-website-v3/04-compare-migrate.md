# 对标页与迁移中心（Compare & Migrate）

> `proteus-website-v3/` 附属文档 3/6 · 配套：G-30（任意端/代际差）+ G-32（语义原语 + 迁移策略）
> 本文把「方法论的对外说服力」落成两个高频转化频道：`/compare`（为什么换）+ `/migrate`（怎么换）。

---

## 0. 定位

| 频道 | 对象 | 目标 | 核心手法 |
|------|------|------|---------|
| `/compare` | 技术决策者、架构师 | **承认差异 → 认可代际领先** | 每条论点**点得进去看证据** |
| `/migrate` | 正在用 uni-app/Taro/小程序的开发者 | **降低迁移恐惧 → 开始试用** | 三步工具化 + 成本可视化 |

两者关系：Compare 回答「**为什么该换**」，Migrate 回答「**换了怎么活**」。缺一则说服力断裂。

---

## 1. `/compare` 对标页

### 1.1 核心论证：不是「更好」，是「不同世界观」

页面开头必须先讲清世界观分野（对应 G-30 主文档 + PROTEUS-METHODOLOGY）：

> **uni-app / Taro / Lynx 的世界观 =「翻译」**：把小程序 API 翻译成各端等价调用。
> **Proteus 的世界观 =「语义收敛」**：定义与平台无关的语义 IR，各端 Backend 实现它。
>
> 翻译永远有损（新端 = 重写映射表）；语义收敛一次定义、任意端实现 SPI 即可。

**世界观对比图（页面首屏，静态图 + 可交互切换）**：

```
翻译派（uni-app/Taro/Lynx）：
  业务 ──小程序API──→ [ 翻译层 ] ──→ 各端 API
                       ↑ 每新一端 = 重写映射

语义派（Proteus）：
  业务 ──语义IR──→ [ Backend SPI ] ──→ 任意端实现
                  ↑ 一次定义，多端复用
```

### 1.2 主对标表（每条都可点证据）

| 维度 | uni-app (WebView) | uni-app x (UTS) | Taro | Lynx | Flutter | **Proteus** | 证据 |
|------|---|---|---|---|---|---|---|
| 世界观 | 翻译（小程序 API） | 翻译 + 蒸汽编译 | 翻译（React） | 高性能渲染引擎 | 自绘 | **语义收敛（IR+SPI）** | → /methodology |
| 组件来源 | 小程序标签原样 | 同左 | React 组件 + 小程序 | 类小程序 + Skyline | Widget | **128 语义原语** | → /primitives |
| 组件形状 | `<view>` `<scroll-view>` `<swiper>` | 同左 | `<View>` `<ScrollView>` | `<view>` + PAPI | `<GridView>` | **`<p-grid>` `<p-stack>`（消灭 swiper 等）** | → /primitives/layout |
| API 风格 | 回调 + 全局对象 | 同左 | 类 React | 模块 + PAPI | 面向对象 | **Hook + Promise + 全类型** | → /primitives/capability |
| 标准归属 | **微信** | **微信** | **微信**（可插拔有限） | **Lynx 引擎** | Flutter/Dart | **框架自己的 IR** | → /architecture |
| 渲染后端 | WebView | 原生（UTS） | Web/小程序为主 | 原生（Element PAPI） | 自绘（Skia） | **VueDom/Native/Flutter/Skia 可插拔** | → /backends/render |
| 编译器 | Webpack/Vite | UTS 编译器 | Webpack | PrimJS + Lynx | Dart compiler | **Node/Rust/WASM 可插拔** | → /backends/compiler |
| 新端成本 | 重写映射表 | 重写映射 + UTS | 重写映射 | 接 Lynx 渲染宿主 | 自绘无需映射 | **实现 SPI（~15 方法 + conformance）** | → /backends/conformance |
| 能力缺失 | 运行时崩溃 / mock | 同左 | 同左 | 引擎约束 | 需引擎跟进 | **编译期 capabilities 报错** | → Playground |
| 端覆盖 | Web/小程序/App | App 为主 | Web/小程序/App | iOS/Android/Web | 全（自绘） | **任意端（Tier 1-4，R+C+J 三元组）** | → /backends/platform |
| 降级 | 无 / 手动 ifdef | 手动 | 手动 | 引擎内 | 自绘天然一致 | **@conditional + Tier 降级（编译期）** | → /primitives/degradation |
| 生态锁定 | 小程序生态 | DCloud | 微信/支付宝等 | 字节 | Dart pub | **Backend 生态（可组合，可退回）** | → /backends |
| AI 友好 | 低（API 碎片化） | 中 | 中 | 中 | 中 | **IR 是 Agent 操作对象** | → /docs/guide/ai |
| 独立 DSL | ❌ | **`.uvue`/`.nvue`（被迫）** | ❌ | ❌ | ❌ | **❌ 明确不要** | → /methodology |

**证据链接规则**（原则 W-4 证明先于宣称）：
- 每条 `→ /xxx` 都指向**可交互内容**（Playground / 原语页 / conformance 报告），不是锚点
- 「消灭 swiper」→ 跳到 `<p-stack>` 页面的「小程序对照」区块，看到还原过程
- 「编译期 capabilities 报错」→ 跳到 Playground，演示切到缺失端时的降级提示

### 1.3 「与 Lynx 的具体区别」专区（回应字节系质疑）

> 源自对话中「我们的 `__CreateElement/__AddClass` 和他们有区别吗」——这条必须正面回答，且用技术证据。

**对比图**：

```
Lynx 层级：
  ReactLynx/Vue ──→ __CreateElement / __SetAttribute / __AddClass
                     ↑ 这是 Element PAPI，偏向 Lynx 原生视图树
                     ↑ 服务于双线程 / IFR / MTS / CSS 布局引擎

Proteus 层级：
  <p-stack> / useFetch  ──→ Component IR (C-IR)
                              ↓
                        统一 RenderIR / 优化校验
                              ↓
                        ProteusRenderBackend SPI
                              ↓
  ┌──────────────────────────────────────────┐
  │ 可以是 Lynx backend：                      │
  │   翻译为 __CreateElement / __AddClass ...  │
  │   也可以是 iOS UIKit / Android / Web ...   │
  └──────────────────────────────────────────┘
```

**结论框**：

> `__CreateElement` / `__AddClass`（user_image 1）是 **Lynx 渲染驱动接口**，
> 可以作为 **Proteus 某一个 RenderBackend（Lynx）的输出**；
> 它不是 Proteus 的语义入口。
>
> `Lynx PAPI ⊂ ProteusRenderBackend(Lynx)` ✅
> `Lynx PAPI ≡ Proteus 语义模型` ❌

**链接到 Playground**：在 IR 面板里可视化这条链路（SFC → C-IR → RenderIR → Backend 调用链），让开发者亲眼看到 `__CreateElement` 只是「最后一层」。

### 1.4 「小程序能力 100% 覆盖」证明（回应最硬的质疑）

> 源自对话「我们能实现小程序现在内置组件和 API 的那些能力吗」——把那轮论证做成可查表。

页面锚点 `#miniprogram-coverage`，内容直接引用 G-32 `miniprogram-mapping.md`：

```
小程序内置组件 42 个 → Proteus 覆盖：100%
  · 直接表达：36 个（view/text/button/scroll-view/swiper/movable-view ...）
  · 下沉 L2 Backend：6 个（map/canvas/web-view/广告/开放数据/微信小店）
  · 语义层消灭：swiper / scroll-view / movable-view（还原为布局属性）

小程序 wx.* API ~120 类 → Proteus 覆盖：100%
  · 50 个能力原语（Hook 化，对接 G-28 NativeBackend SPI）
  · 私有能力收敛：useMiniProgram()（微信支付 / open-data / 公众号 ...）
    → 显式标记「仅微信端」，非微信端 Err('miniprogram.only')
```

**「Coverage 100%」旁必须有可视化**：环形图 + 「Run coverage audit →」按钮，跳到 G-32 的 `audit:coverage` 报告（CI 自动生成，单一事实源）。

### 1.5 诚实边界（刻意展示，增强可信度）

> 对应 PROTEUS-METHODOLOGY「诚实边界」节——**主动说出不能做的事，比包装更可信**。

```
✅ 可被纳入 Tier 1（一等公民）：
   · 同时具备渲染宿主 + 能力宿主 + JS 运行时

🔶 Tier 2-3（受限 / 需降级）：
   · 仅渲染宿主（Flutter/Skia/VR）→ 无原生能力，能力调用降级
   · 仅 JS 运行时（SSR/Agent）→ Headless，只产 IR

❌ 明确不覆盖（G-30 边界）：
   · 纯后端服务（不是「端」）
   · 无 JS 且无渲染的裸 MCU
   · 强实时 / 强安全隔离（航空、医疗）
   · 封闭生态不允许嵌入 JS（部分 IoT）
```

---

## 2. `/migrate` 迁移中心

### 2.1 三个入口（对应三类用户）

```
/migrate/miniprogram     微信/支付宝/抖音小程序 → Proteus
/migrate/uni-app         uni-app / uni-app x → Proteus
/migrate/taro            Taro → Proteus
```

### 2.2 统一页面结构（以 `/migrate/miniprogram` 为例）

#### Step 0 · 可行性自测（可视化）

**「能力扫描器」**：开发者粘贴 `app.json` 或上传项目，工具扫描用到的小程序组件/API，输出：

```
你的项目能力清单：
  ✅ 42 个组件全部在 G-32 覆盖范围内
  ✅ 118 个 wx.* API → 50 个 useXxx Hook + 属性还原
  🔶 2 个微信私有能力 → useMiniProgram()（仅微信端，需标注）
  ⚠️ 3 处平台特定代码（wx.getSystemInfoSync 旧版）→ codemod 自动更新

结论：100% 可迁移，预估 X 人天，代码量 -Y%
[ Run codemod → ]
```

**这是把 G-32 migration 直接产品化**——迁移决策从「靠经验判断」变成「工具出报告」。

#### Step 1 · 装兼容层，原项目直接跑

```bash
npm i @proteus/compat-miniprogram
```

`compat-miniprogram` 做什么（对应用户关心的「是不是不兼容小程序」）：
- 把 `<view>` `<text>` `<wx-xxx>` 在**编译期**映射到 Proteus C-IR
- 把 `wx.*` 映射到 `useNative()` / `useFetch()` 等语义接口
- **旧项目无需改一行代码即可在 Proteus 上运行**——这是渐进迁移的基石

#### Step 2 · codemod 自动转换（70-90%）

```bash
npx proteus-codemod miniprogram ./src
```

转换规则（链接到 G-32 `migration-examples.md` 完整对照）：

| 小程序写法 | Proteus 语义还原 | 方式 |
|-----------|-----------------|------|
| `<view class="grid">` | `<p-grid>` | 语义还原 |
| `<scroll-view scroll-x>` | `<p-scroll axis="x">` | 属性还原 |
| `<swiper indicator-dots autoplay>` | `<p-stack snap="mandatory" loop>` | **组合还原（消灭 swiper）** |
| `<movable-view direction="all">` | `<p-draggable :axis="'both'">` | 属性还原 |
| `wx.request({ url, success, fail })` | `const { data } = await useFetch(url)` | **Hook 化** |
| `wx.navigateTo({ url })` | `router.push({ name })` | 语义路由 |
| `wx.login()` | `await useAuth().login()` | Hook 化 |
| `wx.scanCode()` | `await useNative().scanQR()` | 能力后端 |

**转换报告**：
```
转换统计：
  ✅ 自动转换：1,247 处（82%）
  🔶 需人工确认：218 处（语义还原，AI Agent 辅助）
  ❌ 无法自动转换：0 处
[ View diff ]  [ Download report ]
```

#### Step 3 · 语义还原（AI Agent G-23 辅助）

剩余 18% 是「组合还原」类——`swiper → p-stack + snap + loop` 这类**需要理解意图**的转换。这正是 G-23 AI Agent 的场景：

- Agent 读取 C-IR + 上下文，自动提出还原方案
- 开发者审阅确认（**不静默改写**，安全边界）
- 例：`swiper` 含 `indicator-dots` → Agent 补 `<p-pagination>` 配对

**显式标注成本**（原则 W-5 诚实优于包装）：
> 不是「零成本无缝迁移」——是「**工具承担 82%，你审 18%，总计比手写快一个数量级**」。
> 且迁移完成后，代码不再依赖小程序 API，获得四层可插拔的全部收益。

#### Step 4 · 验证（conformance 兜底）

```bash
proteus conformance --backend all
```

跑全部 Backend 的 conformance test，输出：
```
VueDom      48/48 ✓
Native(iOS) 48/48 ✓
Native(Android) 47/48 ⚠️
Harmony     46/48 🔶
Flutter     46/48 🔶 beta
```
**迁移完成的定义 = conformance 全绿**——这是「验证先于运行」在迁移流程的兑现，开发者有明确的可达目标。

### 2.3 真实案例区块

每个案例 = 一个完整 story：
```
案例：XX 电商小程序 → Proteus
  · 迁移人天：3 人 × 5 天
  · 代码量：12,400 → 9,100 行（-27%，消灭大量 ifdef + 重复样式）
  · 新增能力：顺滑接入 HarmonyOS、车机端（Tier 2）
  · 痛点解决：原 wx API 回调地狱 → useFetch 组合
  · [查看迁移 PR →] [Playground 试跑 →]
```

---

## 3. 内容治理（避免文档漂移）

- Compare / Migrate 的**数据全部自动生成**：
  - 对标表 → 读 `proteus-positioning.md` 对标矩阵 + G-32 mapping（CI 校验一致性）
  - 覆盖率 → 读 G-32 `audit:coverage` 输出
  - codemod 规则 → 读 `proteus-codemod` 仓库规则集
- **禁止手写百分比 / 数字**——单一事实源在 plan 与 CI
- 每次 G-x 更新，CI 自动重建 `/compare` `/migrate`（watch 模式）

---

*本文是 `01-website-rearchitecture.md` 的附属规范，对标论证与迁移流程对齐 G-30/G-32 / PROTEUS-METHODOLOGY。*
*Architecture: `@proteus/architecture` · Plans: G-30/32 · Status: v2 (2026-09-02)*
