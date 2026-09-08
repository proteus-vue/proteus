# SVG → Skyline 对齐专项（Proteus SVG-Canvas 桥）

> **2026-09-08 立项（用户登记，后续攻克）**。目标：开发者写标准 `<svg><path :d="d" :fill="color">` 不改代码，Skyline 下跑出**视觉等价 + 属性响应式 + 基础事件**的版本。

## 0. 结论先行

Vue 的 SVG 不是「搬」到 Skyline，而是：**编译期把 SVG 树翻译成 canvas 绘制 IR、运行时用 Canvas 2D 重画一遍矢量，CSS 级联编译期折叠、DOM API 自己近似实现**。静态图标可 100% 视觉对齐；动态复杂 SVG 做到「够用不等价」。不可能 100% 语义等价（Skyline 没有 SVG DOM、没有 getBBox、CSS 不能作用于 SVG 节点、Canvas 2D 是受限子集），但可以做到**开发侧写法 95% 兼容 + 运行时矢量行为可驱动**。

## 1. 边界界定（"完全"的含义）

Web 端 Vue 写 SVG 能用的东西：

- `<svg viewBox><path :d="d" :fill="color">` 响应式改属性
- CSS 选择器改 fill/stroke
- currentColor、clip-path、mask、gradient、transform 矩阵
- 事件委托在 `<path>` 上
- getBBox/getTotalLength 等 DOM API

Skyline 原生**全部没有**。所以"完全搬运" = **框架侧把这些能力重新实现一遍**，不是透传。

## 2. 编译期：`<svg>` 子树 lowering 成 `<canvas>` 组件

1. compilerOptions.isCustomElement 把 `svg/circle/path/g/linearGradient` 等登记为自定义元素（不让 Vue 当普通 HTML 解析），挂平台 backend：`skyline-svg`。
2. Template 编译阶段（基于 @vue/compiler-core 写 transform）遍历 AST 遇 svg 节点：
   - `<svg>` 替换为框架内置组件 `<mp-svg>`（WXML = 一个 `canvas type="2d"` + view 容器）
   - 子节点 `<path :d="d">` **不生成 WXML 节点**，收进 `mp-svg` 的 `props.shapes` 数组（静态属性编译期提出；动态绑定 v-bind/v-if/v-for 转 shapes computed 的 push/update）
   - `:viewBox :width :fill` 变 mp-svg props
   - `@click` 在 path 上 → 编译成 bindtap + 命中测试回调

```
<svg viewBox="0 0 100 100" @click="onSvg">
  <path :d="d" :fill="color" @click.stop="onPath" />
</svg>

↓ 编译成（伪 WXML）
<mp-svg view-box="0 0 100 100" shapes="{{shapes}}" bind:tap="__svgTap" data-svg="xxx" />

shapes = computed(() => [{ tag:'path', d: d.value, fill: color.value, handlers:['onPath'] }])
```

3. Script 侧：框架提供 `mp-svg` 运行时组件（写一次全项目复用）——onMounted 经 selectQuery 拿 canvas 2d node + ctx；watch shapes/viewBox/width/height 脏时重绘；Vue reactive ↔ canvas draw 桥接（shapes 是 reactive 数组，isReactive 照常可用）。

## 3. 运行时：SVG 语义 → Canvas 2D 指令映射

| SVG 概念 | Skyline 落地 |
|---|---|
| `<path d="M..C..">` | 解析 d 字符串 → ctx.moveTo/bezierCurveTo（自写 mini parser 或 svg-path-to-canvas） |
| fill / stroke | ctx.fillStyle/strokeStyle；url(#id) 查 gradients 表 |
| viewBox 缩放 | scale = canvasW/viewBoxW，ctx.scale 后绘制 |
| transform="translate() rotate()" | ctx.transform 矩阵乘 |
| `<linearGradient>` | 编译期收 defs 表，运行时 ctx.createLinearGradient 填 stops |
| clip-path | 先画 path 再 ctx.clip() |
| currentColor | 编译期替换成 color prop 或父 text color |
| opacity | ctx.globalAlpha |
| 事件命中 | 每 path 记录 bbox（解析 d 自算包围盒/采样点），tap 时 canvas 坐标反查命中 shape → 派发 handler |
| :d 响应式 | shapes 变更 → watch → 重绘（requestAnimationFrame 合批，别每次 setData 全量重画） |

注意：Skyline Canvas 2D **没有 Path2D 构造函数、没有 getBBox**（path 长度/包围盒要自己解析 d 算）；新 `type="2d"` 在 Skyline 支持，旧 `wx.createCanvasContext` 才返回 null。

## 4. CSS 作用于 SVG 的处理

Web 里 `.icon path { fill: red }` 在 Skyline 无解（canvas 无 CSS 级联）。框架侧：

- 编译期扫 `<style>`，把 `svg path { fill: x }` 选择器提取 → 转默认 shape 属性注入 shapes 生成逻辑（CSS 值编译期折进 JS 对象）
- scoped 样式同理按 data attr 匹配后折进 props
- 动态 `:class` 切 fill → 编译成 shapes 里 fill 字段依赖 class 的 computed

开发者 CSS 习惯保留，本质是编译期折叠进 canvas draw 参数。

## 5. 分期（别一步到位）

| 期 | 范围 | 手段 | 覆盖 |
|---|---|---|---|
| **P0** | 静态图标 `<svg><path d fill>` 无交互 | image 解码或 canvas 一次性绘制 | 80% 图标场景 |
| **P1** | 响应式矢量：`:d :fill`、v-if 控制 path、viewBox 缩放、linearGradient、tap 命中单 path | canvas 自绘 | 图表/动画场景 |
| **P2** | mask/clip-path 嵌套、transform 矩阵链、stroke-dasharray 动画（worklet 驱动重绘）、getTotalLength 近似 | 部分放弃浏览器语义改「近似视觉」 | 高级场景 |

## 6. 与编译链的接缝

在「Rust 解析 SFC + TS 写平台 backend」架构里：

- **Rust 侧（compiler-core）**：识别 svg 子树 → 生成 `MPSvgIR`（shapes 数组 + defs 表 + viewBox + 事件表）
- **TS 侧 platform-skyline backend**：MPSvgIR → 发射 mp-svg WXML + setup 里 shapes computed 代码
- **运行时包 `@proteus-vue/skyline-svg`**：mp-svg 组件实现（canvas 绘制 + 命中测试），各项目统一依赖
- **WebView backend 直接透传 `<svg>`**（WebView 认）——同一份 SFC，两个 backend 出不同代码

## 7. 与既有资产的汇合

- **p-svg 组件**（模板写 `<svg>` 的 Web-first 组件，当前 MP 产物「原样输出不渲染」+ svg-no-peer 警告降级）→ 本专项落地后改走 mp-svg canvas 桥
- **template/svg-no-peer 警告规则**保留（未被 lowering 覆盖的 SVG 标签仍警告）

## 8. 起步件（第一个可跑示例）

1. `MPSvgIR` 的 TS 类型定义（shapes/defs/viewBox/事件表）
2. `mp-svg` 运行时组件最小骨架：canvas 拿节点（createSelectorQuery node）→ watch shapes → path d 解析 → tap 命中测试
3. 跑通第一个 `<path :d="d" :fill="color">` 例子

## 关联

- `docs/compiler-platform-alignment.md`（glass-easel 平台语义对齐——同源方法论：不自造语义）
- `template/svg-no-peer` 规则（G2 反黑盒警告——未覆盖标签仍警告）
- `src/components/p-svg/index.vue`（汇合点）
- PROJECT_MEMORY 本会话条目（2026-09-08 ⑨）
