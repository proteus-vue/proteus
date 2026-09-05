---
title: 语义模型
order: 3
group: 语义模型
---

# 语义模型

语义模型回答一个问题：**业务代码怎么写，才能对渲染后端零感知？** 答案是——业务代码只声明「要什么」，框架把它编译为与平台无关的中间表示（IR），后端按 IR 上的**语义字段**实现「怎么做」。

> **业务代码 → 语义 IR → 任意后端。后端消费语义，不消费标签字符串。**

## 两份契约：CompilerIR 与语义树

编译器对一份 SFC 的完整理解固化为 `CompilerIR`（真实契约节选，定义于 `@proteus-vue/compiler-backend`）：

```ts
interface CompilerIR {
  version: 1            // IR 契约版本（后端版本协商）
  render: RenderIR      // 渲染树：RenderBackend 的 nodeOps 消费
  semantic: SemanticIR  // 语义树：Component IR（C-IR）
  bindings: BindingIR   // 能力入口 / v-model / 事件绑定
  layout?: LayoutConstraintIR
}
```

- `render`：渲染树节点带可选 `semantic` 字段——有语义的节点走语义映射，没有的（view / text 等平台标签）属 Layer 1 兼容层，按原样处理
- `semantic`：**语义树**，只由 p-* 语义组件构成。`<p-grid :min-col-width="160" :max-cols="4">` 编译后：

```ts
{ tag: 'p-grid', semantic: 'layout.grid',
  props: { minColWidth: { expr: '160' }, maxCols: { expr: '4' } },
  children: [/* ... */] }
```

- `bindings`：能力入口（如 `p-scan-qr` → `capability.*`）、v-model 与事件处理器的汇总，供能力系统消费

渲染树与语义树**同源不漂移**：conformance 交叉核对「渲染树中带 semantic 的节点数 == 语义树节点数」。

## 一次语义 → 多端渲染

### 编译期：源码变成 IR

以一份页面为例，小程序端管线（`@proteus-vue/compiler`，纯函数实现）：

```
page.vue
├── <template> ── transformTemplateToWxml ──► .wxml   标签 / 指令映射
├── <script>   ── transformScriptToPage ────► .js     Page() 构造器
├── <style>    ── transformStyleToWxss ─────► .wxss   px→rpx + 选择器重写
└── <route>    ── gen-routes ───────────────► .json   app.json / page.json
```

- **Web 端不走此管线**：标准 Vite + `@vitejs/plugin-vue` 零转换直跑
- IR 层做**编译期校验**：p-* 标签必须语义命名（G-31.1）、属性必须声明降级行为（CMP006）、布局约束逻辑冲突当场报错
- Node 与 Rust 两个编译后端对同一份 SFC 必须产出**语义等价**的 CompilerIR（IR Golden 门禁强制）

### 运行期：IR 变成界面

- **Web 端**：VueDom 后端直出 DOM，`ref` 是真实 Vue 响应式
- **小程序端**：`Page()` 构造器 + setData 桥——ref 写入被重写为 `this.setData({ ... })`，16ms 窗口批量合并 + 按组件粒度收集脏路径；逻辑层与视图层只经 setData 序列化通道通信（小程序双线程模型）
- **分发铁律**：Backend 必须基于 `semantic` 字段分发渲染，禁止基于标签名字符串（G-37.1）；能力声明必须诚实，未声明 = 不支持（G-37.3）；降级必须可见，不得静默（G-37.6）

## 语义组件与原生标签的关系

Proteus 的组件与 API **不由任何既有平台的组件集翻译而来**，由框架自己的语义 IR 直接定义（G-31）。两层分工：

| 层 | 你写的 | 编译去向 | 状态 |
|---|---|---|---|
| Layer 0 语义组件 | `<p-grid>` / `<p-stack>` / `<p-switch>` … | 组件 → C-IR 语义类型 → 各端原生控件映射 | ✅ 59 个 p-* 组件双端落地 |
| Layer 1 标准标签 | 标准 HTML 标签 + 标准 Vue SFC | TAG_MAP 映射（div→view、img→image…）+ 指令 / 事件映射 | ✅ 兼容层 |

标准标签是**通用兜底**，语义组件是**精确表达**：

```vue
<!-- Layer 1：标准标签，按 TAG_MAP 映射，布局靠 CSS -->
<div class="grid">...</div>

<!-- Layer 0：语义组件，后端按 layout.grid 语义映射 -->
<p-grid :min-col-width="160" :max-cols="4">...</p-grid>
```

后端映射的是语义而不是标签：`layout.grid` 在 iOS 上是 `UICollectionView`，Flutter 是 `GridView`，Vue DOM 是 `div.proteus-grid`。`view` / `scroll-view` / `swiper` 这类小程序组件名属于兼容层，被明确禁止上升为框架标准（铁律 G-31.1）。实际页面中两层自然混用（摘自 examples 真实页面）：

```vue
<p-heading :level="2">基础控件</p-heading>
<p-switch v-model="switchOn" />
<p-slider v-model="sliderVal" :min="0" :max="100" :step="5" />
```

## 语义树如何被验证

「验证先于运行」——语义树不是注释，是可机检的契约：

- **结构校验**：`validateComponentTree` 递归检查语义树——非法标签（CIR_INVALID_TAG）、非法语义（CIR_INVALID_SEMANTIC）、能力属性缺降级声明（CMP006）
- **约束校验**：`validateGridConstraints` 在 IR 层发现逻辑冲突（GRID_CONFLICT）——例如 `min-col-width: 200` × `max-cols: 4` 在 375px 容器上永不满足，编译期报错而非运行时降级崩溃
- **渲染一致性**：`checkComponentSnapshot` 对每个后端做控件 readback 与参考表比对；`checkSemanticCoverage` 强制每个 implemented 语义 ≥3 端有真实映射（G-31.4）
- **编译等价性**：同一份 SFC 经 Node / Rust 后端产出的 IR 必须语义等价（G-29.1），任一后端 conformance FAIL 即阻断合并

完整验证体系见[一致性验证](/docs/framework/29-conformance)。

## 下一步

- [渲染后端](/docs/framework/23-render-backend)：RenderBackend SPI、五官方后端与混合渲染
- [编译管线](/docs/framework/26-compiler-pipeline)：规则注册表、决策 trace 与产物自校验
- [一致性验证](/docs/framework/29-conformance)：conformance 套件与 CI 门禁
