# G-31：内置组件与 API 的语义化重新设计

> **Status**: Draft（待评审）
> **Layer**: L1 方法论层（与 G-22 / G-27 / G-28 / G-29 / G-30 同级，方法论向"开发者入口"的延伸）
> **Depends on**: PROTEUS-METHODOLOGY（原则 #0 + 五支柱）、G-22（柔性布局原语）、G-24（语义原语全景）、G-27（渲染 SPI）、G-28（原生能力 SPI）、G-30（Tier / capabilities）
> **Prerequisite**: 原则 #0（统一语义收敛）——本 plan 是方法论在"开发者书写面"的投影

---

## 0. 一句话定义

> **Proteus 的内置组件与 API 不由任何既有平台的组件集"翻译"而来，而是由 Proteus 自己的语义 IR 直接定义：组件表达"意图"，API 表达"能力"，二者在 IR 层被约束、被校验、被分发给各端 Backend。**

> **关键词：这不是"小程序组件换皮"，而是"组件与 API 的源头从平台 API 迁移到框架语义层"。**

---

## 1. 为什么必须重新设计（问题陈述）

### 1.1 现状：所有跨端框架的组件集都继承自微信小程序

| 框架 | 组件风格 | 来源 |
|------|---------|------|
| uni-app | `<view> <text> <button>` | 小程序标签原样 |
| Taro | `<View> <Text> <Button>` | 小程序标签首字母大写 |
| Rax / Remax | 近似 React + 小程序 | 小程序能力映射 |

**这是"API 标准映射"世界观的必然结果**（见 G-30 §8 对标）：既然标准 = 小程序 API，那组件集自然 = 小程序组件集的超集或别名。

### 1.2 小程序组件集的设计局限（2017 年决策的遗产）

| 局限 | 具体表现 | 对"语义收敛"的伤害 |
|------|---------|-------------------|
| **无语义的万能容器** | `view` 一个标签包揽 div / section / article / 布局块 | 无法精确映射到原生 `UICollectionView` / `GridView`——因为 IR 里没有"网格"语义 |
| **一个组件包揽一类场景** | `scroll-view` 横竖分页瀑布流全塞一个组件 | 各端实现差异巨大 → 行为不一致 → 只能 ifdef |
| **独立组件表达布局结果** | `swiper` 轮播、`movable-view` 拖动 | "轮播 = 分页滚动的一种"本应由布局系统表达，却被固化成组件 |
| **属性即平台 API 透传** | `scroll-x`、`enable-flex`、`enhanced` | 属性名暴露了某个端的实现细节 |
| **API 全是回调 + 全局对象** | `wx.xxx` / `uni.xxx` | 无类型、无组合性、无管道 |

### 1.3 核心矛盾

> **如果 Proteus 的渲染后端、能力后端都已可插拔（G-27/G-28/G-30），但开发者书写面仍沿用小程序组件集，等于"后端自由了，入口还锁在别人的设计里"——方法论自相矛盾。**

形式化表达：

```
G-27/G-28/G-30：Backend 消费 IR  →  后端可插拔 ✓
组件/API 层：  源码 → ？ → IR
                 ↑
            如果这里仍是小程序组件集，
            就等于把小程序语义写死进 IR 源头
```

**结论：IR 的源头（组件 + API）也必须由 Proteus 自己定义，才能与方法论闭环。**

---

## 2. 设计原则（方法论五支柱的具体化）

### 支柱 ① 语义优先：组件表达"意图"，不表达"实现"

```
❌ 小程序思维：  <view class="grid">      →  无语义容器 + CSS 模拟
✅ Proteus：    <p-grid>                  →  组件 = "网格"语义
```

- 组件名 = 语义名词，不是 HTML 标签别名
- 属性名 = 约束描述，不是平台 API 参数名

### 支柱 ② 接口与实现解耦：属性是"约束"，不是"样式指令"

```
❌ <scroll-view scroll-x>             → 属性直接映射某端滚动方向 API
✅ <p-stack direction="horizontal">   → "水平排列"语义，Backend 自选 scroll/flow/flex
```

- 开发者写"要什么排列"，Backend 决定"怎么排"
- 同一份 `<p-stack>` 在 iOS → `UIStackView`，Web → Flexbox，Flutter → `Row`

### 支柱 ③ 验证先于运行：属性在 IR 层被约束

```vue
<p-grid min-col-width="160" max-cols="4">
```

Compiler 在 IR 层校验：
- `min-col-width` 与 `max-cols` 是否逻辑冲突（如 max-cols=2 但 min-col-width 导致永远放不下）
- 当前目标 Backend 的 `capabilities.layout.grid` 是否为 `supported`
- 不支持 → **编译期报错**，不是运行时降级崩溃

### 支柱 ④ 渐进式覆盖：极少原语 + 组合出一切

```
框架内置（极少，极稳定，L1）：
  p-box / p-stack / p-grid / p-fluid / p-adaptive
  p-text / p-button / p-image / p-input / p-list

生态提供（L2/L3）：
  日历 / 富文本 / 图表 / 地图 / 视频播放器
  → 各自是独立 Backend 包，不是框架内置
```

**不是"内置 50 个组件"，而是"内置 ~12 个语义原语，其余由组合产生"。**

### 支柱 ⑤ 方法论可泛化：组件 API 的 shape 也走 SPI

```
<p-scan-qr>  ← 不是"组件"，是"能力入口"
  内部调用 ProteusNativeBackend.scanQR()
  不同 Backend 弹出不同扫码 UI
  开发者不感知 AVCapture / CameraX
```

**组件 = 语义 + 能力调用的封装**，与 G-28 原生能力 SPI 是同一件事。

---

## 3. 内置组件清单（语义原语层）

### 3.1 布局原语（G-22 四原语的组件化）

| 组件 | 语义 | 关键属性（约束，非样式） | 映射后端 |
|------|------|------------------------|---------|
| `<p-box>` | 原子容器 / 语义块 | `as: 'section'\|'article'\|'card'` | UIView / div / `Container` |
| `<p-stack>` | 一维线性排列 | `direction: 'horizontal'\|'vertical'`, `gap`, `wrap` | UIStackView / Flex / `Flex` |
| `<p-grid>` | 二维网格 | `min-col-width`, `max-cols`, `gap` | UICollectionView / GridLayout / `GridView` |
| `<p-fluid>` | 流式自适应 | `breakpoints`, `cols` | AutoLayout / CSS Grid / `Wrap` |
| `<p-adaptive>` | 容器宽度语义 | `sheet\|dialog\|popover\|drawer` | UISheet / `<dialog>` / `showModal` |
| `<p-fit>` | 内容自适应尺寸 | `mode: 'content'\|'intrinsic'` | intrinsicContentSize / fit-content |

**没有 `scroll-view`、没有 `swiper`、没有 `movable-view`**——这些是布局原语 + 滚动/分页语义的组合结果，不是独立组件。

> 例：`swiper` = `<p-stack direction="horizontal" snap="mandatory" loop>` ——轮播被表达为"强制吸附的水平排列"，是布局属性，不是组件类型。

### 3.2 基础 UI 原语

| 组件 | 语义 | 关键属性 |
|------|------|---------|
| `<p-text>` | 文本（语义化，非行内标签） | `variant`, `truncate`, `selectable` |
| `<p-button>` | 按钮 | `variant`, `size`, `loading`, `disabled` |
| `<p-image>` | 图片 | `fit`, `placeholder`, `lazy` |
| `<p-input>` | 输入 | `type`, `validation`, `mask` |
| `<p-list>` | 虚拟化列表 | `item-size`, `strategy: 'vitual'\|'window'`，**内置虚拟化** |
| `<p-nav>` | 导航容器 | 与 G-17 路由声明式映射 |

### 3.3 能力入口组件（G-28 的组件化封装）

| 组件 | 对应能力 | 说明 |
|------|---------|------|
| `<p-scan-qr>` | `scanQR()` | 扫码 UI，Backend 决定弹窗/全屏 |
| `<p-pick-photo>` | `pickPhoto()` | 选图，属性描述约束 |
| `<p-location>` | `getLocation()` | 定位（含权限 reason） |

> **规则**：能力入口组件**不允许在业务层直接调用平台 SDK**，一律走 `useNative()`（G-28.1）。

---

## 4. API 设计（Composition API / Hook 风格）

### 4.1 设计准则

- **Hook / Composition API 风格**（非全局对象 + 回调）
- **Promise / async-await**（非回调地狱）
- **全链路类型安全**（TS 推导）
- **Backend 无关**（调用语义接口，非某平台 API）

### 4.2 对照表

| 能力 | 小程序（回调 / 全局） | **Proteus（Hook / Promise）** |
|------|---------------------|------------------------------|
| 网络 | `wx.request({...})` | `const { data } = await useFetch(url)` |
| 路由 | `wx.navigateTo({url})` | `router.push({ name, params })`（G-17） |
| 存储 | `wx.setStorage(key, val)` | `const store = useStorage()`（响应式） |
| 登录 | `login→getUserInfo→request` | `const { user } = await auth.login()` |
| 扫码 | `wx.scanCode({success})` | `const { text } = await native.scanQR()` |
| 权限 | 散落在 API 里 | `usePermission('camera')`（G-24） |
| 分享 | `wx.shareAppMessage` | `await native.share(payload)` |

### 4.3 三大入口对象（全部 SPI 化）

```ts
// 渲染：组合式 API（Vue 原生，无需新造）
import { ref, computed, onMounted } from 'vue'

// 能力：G-28 语义接口
const native = useNative()           // ProteusNativeBackend
const { text } = await native.scanQR()

// 路由：G-17 声明式
const router = useRouter()
router.push({ name: 'detail', params: { id } })
```

**没有任何 `wx.xxx` / `uni.xxx` 式的全局命名空间。** 这是与方法论"接口与实现解耦"的一致：入口对象是接口，Backend 是实现。

---

## 5. 组件 IR（C-IR）：连接源码与 Backend 的中间表示

> 这是 G-31 的关键工程产物——组件在编译期被标准化为 **Component IR**，Backend 消费 C-IR 而非模板字符串。

```ts
interface ComponentIR {
  tag: string                    // 'p-grid'
  semantic: 'layout.grid'        // 语义类型（非标签）
  props: Record<string, unknown> // 已校验的约束
  children: ComponentIR[]
  capabilities: CapabilityRef[]  // 引用的原生能力（G-28）
}
```

**关键**：Backend 实现的是"语义类型 → 原生控件"的映射，不是"标签名 → 标签名"的翻译。

```
模板：   <p-grid min-col-width="160">
            ↓ Compiler（G-29）
C-IR：   { semantic: 'layout.grid', props: { minColWidth: 160 } }
            ↓ ProteusRenderBackend.createElement(ir)
后端：   iOS → UICollectionView
         Web → <div style="grid"> + CSS Grid
         Flutter → GridView
```

**这就是"语义优先"的工程落地**：Backend 不知道 `<p-grid>` 这个字符串，它只知道 `layout.grid` 这个语义。

---

## 6. 分层：Proteus 原生层 vs 兼容层

```
Layer 0：Proteus 原生语义组件（p-grid / p-stack / useNative）
    ↓ 编译期
Layer 1：@proteus/compat-miniprogram（兼容层，独立包）
    小程序组件/API → C-IR → 各端 Backend
```

**兼容层是一个 Backend 包，不是框架核心。**

| 场景 | 选择 |
|------|------|
| 新项目 | 直接用原生语义组件（Layer 0） |
| 迁移旧小程序 | 装 `@proteus/compat-miniprogram`（Layer 1） |

类比：
- TypeScript 有 `allowJs` 兼容 JS，但 TS 本身不是 JS
- Swift 有 Obj-C 桥接，但 Swift 本身不是 OC

---

## 7. 严格规则（进铁律总表）

详见 `rules.md`：G-31.1 ~ G-31.4、CMP005 ~ CMP008。

核心四条：
- **G-31.1**：内置组件必须以 `p-` 前缀 + 语义命名；禁止引入与小程序组件同名的无语义组件
- **G-31.2**：组件属性必须可降级声明（对齐 G-30.4 / `@conditional`）
- **G-31.3**：所有 API 必须 Promise/Hook 化，禁止回调式全局 API 进入 Layer 0
- **G-31.4**：新组件进入 L1 须有 ≥3 端真实 Backend 实现验证（对齐 G-28.3）

---

## 8. 分批落地（B1-B5）

| 批次 | 内容 | 依赖 | 交付 |
|------|------|------|------|
| **B1** | C-IR schema + 属性约束校验（纯逻辑可单测） | G-27 SPI | `component-ir.spec.ts` |
| **B2** | 布局原语 6 个（p-box/stack/grid/fluid/adaptive/fit）+ VueDom Backend | B1 | 跑通 Web |
| **C1**（G-28 侧） | 能力入口组件对接 `useNative()` | G-28 | `<p-scan-qr>` 可用 |
| **B3** | Native Backend 映射（UIKit / Android View） | B2 | iOS/Android 跑通 |
| **B4** | 基础 UI 原语（text/button/image/input/list/nav）+ Fluid 扩展语义 | B2 | 完整 L1 组件集 |
| **B5** | conformance：三端组件渲染快照一致（B3 后已落地——IR 级快照 diff + 覆盖门禁） | B3 | CI 门禁 |
| **B7** | API Hook 化 + CMP007 lint（✅ 骨架：`@proteus-vue/api/capability.ts` 10 useXxx + `proteus api-check`） | B1 | Layer 0 API 完整 |
| **B6** | compat-miniprogram 兼容层 | B3 | ✅ `@proteus-vue/compat-miniprogram`（createWxCompat 桥 + migrateMpSource 幂等 codemod + useStorage 目标 + CLI `proteus migrate mp`） |

详见 `batches.md`。

---

## 9. 与全体系协同

```
PROTEUS-METHODOLOGY（原则 #0）── 五支柱 ──┐
G-22 柔性布局  ── 布局原语语义来源 ───────┤
G-24 语义原语  ── 组件语义全景 ───────────┤── G-31 开发者入口语义化
G-27 渲染 SPI  ── C-IR 的消费端 ─────────┤
G-28 能力 SPI  ── 能力入口组件底层 ───────┤
G-29 编译 SPI  ── 源码 → C-IR 的生产端 ──┤
G-30 Tier/cap ── 组件降级（@conditional）─┘
```

**至此方法论完成"最后一公里"**：编译（G-29）→ 组件/API（G-31）→ IR → 渲染（G-27）→ 能力（G-28）→ 任意端（G-30），全链路语义收敛，无任何环节泄漏平台 API。

---

## 10. 边界声明（诚实优于口号）

| 不做 | 原因 |
|------|------|
| 100% 兼容小程序组件名 | 会污染语义层，违背支柱 ①；交给 compat 层 |
| 内置大量业务组件 | 违背支柱 ④，交给生态 L2/L3 |
| 为每个端定制组件 API | 违背支柱 ②，Backend 内部分流 |
| 一次性重写全部 API | 渐进迁移（compat 层兜底），见 `migration.md` |

---

## 11. 对外话术（可直接引用）

1. **"uni-app 的 `<view>` 还是 2017 年的小程序容器；Proteus 的 `<p-grid>` 表达的是布局语义，不是 div 别名。"**
2. **"竞品的组件集是微信 API 的超集；Proteus 的组件集是框架自己语义 IR 的直接投影——后端可插拔，入口也可插拔。"**
3. **"`wx.request` 是回调式的平台 API；`useFetch()` 是类型安全的语义能力——差别不是语法糖，是世界观。"**
4. **"Proteus 不翻译组件，Proteus 定义组件。各端 Backend 来适配 `<p-grid>`，不是我们去适配小程序。"**

---

## 12. 版本记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1 | 2026-09-02 | 首次落地：五支柱具体化 + 组件清单 + API 设计 + C-IR + 分层 + 规则 + 分批 |
