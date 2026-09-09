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

## 9. ★地基 spike 实测（2026-09-09，真机 Skyline 模拟器）

**结论：方案第 2/3 节的核心前提「运行时用 Canvas 2D 重画」目前被阻塞——`canvas node` 拿不到。**

验证页 `examples/pages/svg-spike.vue`（`<canvas id="spike-canvas" type="2d" width="240" height="120">`），
在 Skyline（`isSupported: true`，SDK 3.16.2，IDE 36.6.0）+ wechatide skill-CLI 下实测：

| 通道 | 结果 |
|---|---|
| `page.createSelectorQuery().select('#id').boundingClientRect(cb)` | ✅ 正常回调（返回 249.6×124.8） |
| `page.createSelectorQuery().select('#id').node(cb)` | ❌ **不回调**（6s 超时，无报错） |
| `.fields({ node: true, size: true }, cb)` | ❌ 不回调 |
| `wx.createSelectorQuery().in(page)` 各形态 | ❌ 返回 null（与 p-popover 记录一致） |
| `wx.createCanvasContext('id')`（旧 API） | ⚠️ 返回对象但带 `isFallbackLegacy`——`draw()` 后截图无可见产出（Skyline 不认旧 API） |
| `p.selectComponent('#spike-canvas')` | ❌ null |

**推论**：Skyline 下 canvas 组件存在且布局可测（boundingClientRect 有值），但**`SelectorQuery.node()` 取 canvas node 不工作**。

### ★★2026-09-09 修正（版本记录纠错 + 通道重测）

**纠错**：此前记录「IDE 36.6.0 非 Nightly」是**读错版本号**——`CFBundleShortVersionString` 读到的 36.6.0 是
**Electron 版本**；实际 IDE 是 **2.02.2609072 Nightly darwin-arm64**（用户截图确认）。因此「等 Nightly」的结论不成立。

**通道重测（`svg-spike.vue` v2 多通道并行探测，每通道 4s 独立超时自证）**：

| 通道 | 结果 |
|---|---|
| A `page.createSelectorQuery().select('#id').node(cb)` | ❌ TIMEOUT（回调不触发） |
| B `.fields({node:true})` | ❌ TIMEOUT |
| C `wx.createSelectorQuery().select('#id').node(cb)` | ❌ TIMEOUT |
| D `boundingClientRect`（对照） | ✅ rect=249.6px |
| **E `wx.createOffscreenCanvas({type:'2d'})`** | ✅ **`ctx=OK(fillRect:function)`** |
| **F 离屏绘制 → `toDataURL()` → `<image>`** | ✅ **完美显示**（截图实证：紫底黄折线） |

**修正后的结论**：canvas 路线**并非被阻塞**——只是「查询 DOM 拿 canvas node」这条通道不工作；
**离屏 canvas（`wx.createOffscreenCanvas`）完全可用**，带 `getContext('2d')` + `toDataURL()` + `createImage` + `createPath2D`，
且绘制结果可经 data-URI 进 `<image>` 显示。这为 P2 未覆盖的能力（SVG 内部事件命中、`use`/`text` 等）留了可行路线。

**对方案的影响与下一步**：

- 方案 2/3 节（canvas lowering + 运行时重画）**暂不可行**，直到 node 通道确认可用；
- **P0（静态图标）建议改走 `<image>` 方案**：编译期把静态 `<svg>` 渲染成 data-URI SVG/PNG 进 `image` src
  （不依赖 canvas node，Skyline 原生支持 image）——可覆盖 80% 图标场景，与方案 §5 P0 目标一致；
- **P1/P2（响应式矢量/动画）依赖 canvas node**：需先在 **Nightly IDE** 或真机上复验 `node()` 通道；
  若真机可用而 IDE 不可用，则「真机验收」必须前置（专项 06-mp-true-device-acceptance 同源纪律）。
- **复验清单**：① Nightly IDE 重跑本 spike；② 真机（非模拟器）复验；③ 若两者都失败，向微信反馈 + 评估 Skyline 的
  `canvas type="2d"` 替代方案（如 `wx.createOffscreenCanvas` 离屏 + image 回填）。

## 9b. ★P0 已落地（2026-09-09）——静态 SVG → `<image>` data-URI

**地基再验证**（`examples/pages/image-spike.vue` 真机截图）：Skyline `<image src="data:image/svg+xml;base64,…">`
**完整渲染** SVG（circle/path/stroke 均正确；base64 与 URL-encoded 两形态均可用）——P0 路线成立。

**实现**：
- `packages/compiler/src/svg-lower.ts`：静态 SVG 子树序列化（标签/属性/嵌套/文本；驼峰属性恢复 viewBox/stop-color 等）
  → 自动补 `xmlns` → base64 data-URI。含 v-bind/v-if/v-for/插值/事件 → 返回 null（P1）。
- `template.ts`：`<svg>` 节点优先 lowering 为 `<image class="proteus-svg-<scope>" style="width/height" src mode="aspectFit">`
  （尺寸继承 svg 的 width/height，否则用 viewBox）；规则 `template/svg-to-image`（可 disabled 回退）。
- `gen-routes.ts`：SVG 标签加入跳过集（lowering 后产物无这些标签，否则误报「未找到组件 <svg>」并写入 usingComponents）。
- 规则登记 + 参考文档再生成（规则总数 99→100）。

**验证**：`tests/svg-to-image.test.ts` 11 用例（静态 lowering / data-URI 解码校验 / 尺寸继承 / 嵌套 defs·linearGradient /
动态不 lowering + 警告 / 规则可禁用 / 独立子标签仍警告）；`tests/compiler-ir-svg.test.ts` 契约更新；
真机端到端（image-spike 页 lowering 产物渲染出紫圆+黄线，零改代码）。全量 2684/2684 · 门禁 92/92 · build:mp/web ✓。

**边界（诚实）**：仅静态子树。动态 SVG（`:d`/`:fill` 响应式、v-if 控制、事件）属 P1——见 §9c。

## 9c. ★P1 已落地（2026-09-09）——动态 SVG → computed 重生成（绕开 canvas 阻塞）

**路线切换**：P1 原方案（canvas 2D 重画）被 §9 的 `node()` 通道阻塞。地基探测找到**替代路线**并真机实证：

| 探测项 | 结果 |
|---|---|
| `btoa` | ❌ 微信逻辑层**不存在**（动态 SVG 不能走 base64） |
| `encodeURIComponent` | ✅ 可用 → 走 **URL-encoded** data-URI |
| 运行时拼 SVG → computed → setData | ✅ Skyline 实时重渲染 + 响应式有效（`image-spike.vue` 截图：颜色/路径同步变更） |

**实现**：动态 `<svg>` 子树 → 结构化片段树（`SvgPart`：lit/expr/if）→ script 侧拼模板字面量 → 一条 computed
（`'data:image/svg+xml,' + encodeURIComponent(\`…\`)`）+ `<image src="{{proteusSvgN}}">`。
复用既有 computed 链路（依赖追踪 → init setData → 任一依赖写入时补丁重算），**零新增运行时机制**。

**关键设计（避免误伤）**：表达式改写只作用于片段树的 `expr`/`if` 节点——标签名/属性名/文本永不参与标识符替换
（首版用正则改 `${}` 内标识符，在 p-svg 的嵌套 `v-if` 场景把 `<path` 改成 `<this.data.path` 致语法错；
片段树方案根治）。

**验证**：`tests/svg-to-image.test.ts` 13 用例（含 P1：computed 重生成 / 标签名不误伤 / v-for 边界）；
真机端到端（image-spike 页 `:fill`/`:d` 零改代码渲染 + 点击响应式变色变路径）；p-svg 组件由警告转为对齐。
全量 2686/2686 · 门禁 92/92 · build:mp/web ✓。

**边界（诚实）**：`v-for` 的 SVG 暂不支持（列表展开 + key 管理复杂度高）——保持 `svg-no-peer` 警告；
SVG 内部元素**事件命中**不支持（`<image>` 无内部元素，canvas 路线才能做）；`:style`/`:class` 在外层 `<image>` 处理。

## 9d. ★P2 已落地（2026-09-09）——实测特性支持表 + 不支持项诚实警告

**原假设被真机推翻**：方案 §5 的 P2 原本假设 mask/clip-path/transform 需要 canvas 近似绘制（"部分放弃浏览器语义改近似视觉"）。
真机 spike（`examples/pages/svg-p2-spike.vue`，10 项逐格对照）显示 **Skyline 的 `<image>` SVG 渲染能力远超预期**：

| 特性 | 实测 | 特性 | 实测 |
|---|---|---|---|
| linearGradient | ✅ 完美 | transform 矩阵（translate/rotate/scale） | ✅ 完美 |
| radialGradient | ✅ 完美 | stroke-dasharray | ✅ 完美 |
| clipPath | ✅ 完美 | opacity / 嵌套 g | ✅ 完美 |
| mask | ✅ 完美（圆形镂空） | filter（feGaussianBlur） | ✅ 完美 |
| **use + symbol** | ❌ 空白 | **text** | ❌ 空白 |

**结论：P2 无需 canvas**——mask/clip-path/transform/dasharray/filter 全部原生支持，编译器只需**放行**并在
不支持项上诚实警告。实现：
- `SVG_P2_SUPPORT` 支持表（`svg-lower.ts`，实测结论文档化）+ `collectUnsupportedSvgTags`
- `template.ts` `warnUnsupportedSvgFeatures`：SVG 子树含 `use`/`symbol`/`text`/`tspan` → 编译期警告（含替代建议）
- 规则 `template/svg-p2-unsupported` 登记；`<text>` 纳入 SVG_TAGS（子树内即 SVG text）
- `svg-no-peer` 文案更新（不再指向过时的「canvas 路线」）

**验证**：`tests/svg-to-image.test.ts` 17 用例（含 P2：mask/clipPath/transform 放行 + use/text 警告 + 支持表导出）；
全量 2692/2692 · 门禁 93/93 · build:mp/web ✓。

**边界（诚实）**：`text`（SVG 文字）实测空白——警告引导转路径/图片；SVG 内部事件命中仍未实现（见 §9e）。

## 9e. ★use/symbol 编译期展开（2026-09-09）——从空白到完美渲染

**真机对照实证**：`<use href="#s">` 原始形态渲染空白；手动展开为内联图形后**完美渲染**（截图：两个圆点）。
→ 编译期展开有效，纯编译期转换（零运行时依赖）。

**实现**：`collectSymbols` 收集 `<symbol id>` 定义 → `<use href="#id" x y>` 展开为
`<g transform="translate(x,y)">symbol 内容</g>`；`<symbol>` 定义不输出；清理残留空 `<defs></defs>`。
`collectUnsupportedSvgTags` 区分「内部引用（已展开，不警告）」与「外部引用（symbol 未定义 → 警告 `use(外部引用)`）」。
`SVG_P2_SUPPORT.useExpanded` 分类记录。

**真机验证**：编译器 lowering 的 use 用例渲染出两个红点；手写原始 use 仍空白（同页对照）。
`tests/svg-to-image.test.ts` 18 用例 · 全量 2699/2699。

## 9f. ★事件命中可行性探测（2026-09-09，未实现——能力已确认）

离屏 canvas 打通后，重新评估「SVG 内部元素事件命中」（§9 标记的剩余能力）。探测结论：

| 能力 | 结果 |
|---|---|
| `ctx.getImageData(x,y,1,1).data` | ✅ 返回真实像素（中心 #e74c3c / 角落透明）——像素级命中可行 |
| `ctx.isPointInPath` | ✅ 存在——几何级命中更精确 |
| `canvas.createPath2D` | ✅ 存在 |
| tap 事件坐标 | ✅ 事件对象携带 `detail.x/y` 与 `touches[0].x/y`（页面坐标） |
| image 定位 | ✅ `boundingClientRect` 可用（换算相对坐标） |

**技术链路完整**：`<image @tap>` 拿坐标 → 减 boundingClientRect 偏移 → 换算 viewBox 坐标 →
对 shape 列表做 `isPointInPath` / 包围盒判定 → 派发对应 handler。

### ★★已实现（2026-09-09 晚）

**关键实证（推翻 tap 方案）**：Skyline 下 **`tap` 事件 `detail`/`touches`/`changedTouches` 全部 undefined（无坐标）**；
**`touchstart` 的 `touches[0]` 带 `pageX/pageY/clientX/clientY`** → 命中必须基于 **touchstart**。

**实现**（纯几何判定，零运行时依赖——未用离屏 canvas，更轻）：
- 编译期 `collectHitShapes`：收集带 `@click`/`@tap` 的图形几何（circle/rect/ellipse/path 包围盒；
  **带 transform 的子树诚实降级不参与**——坐标换算复杂度高）
- 模板：`<image id="proteus-svg-hit-N" bindtouchstart="proteusSvgHitN">`
- 脚本：`proteusSvgHitN(e)` → `touches[0]` 坐标 → `boundingClientRect` 换算 → `scale = viewBox/rect` →
  viewBox 坐标 → 逐图形判定（声明序，先命中先返回）→ 调 handler（经 `self` 调用——回调内 `this` 非组件实例）
- 规则 `template/svg-hit`（模板/脚本两侧同规则，可禁用）

**真机验证**（`examples/pages/svg-hit-test.vue`）：红圆(30,30) → `HIT: red circle`；
蓝圆(70,70) → `HIT: blue circle`；绿方(60-90,10-40) → `HIT: green rect`；空白区 → 不命中（RESET）。

**边界（诚实）**：`path` 用采样点包围盒近似（曲线/凹形可能误判）；transform 子树不参与；无 hit-test 缓存
（每次 touch 查询 rect——可优化）。`tests/svg-hit.test.ts` 7 用例。

## 10. ★顺带发现的两个编译器缺口（spike 过程中暴露，已登记）

1. **ref 赋值右侧三元表达式被切断**：`status.value = cond ? a : b` →
   `this.setData({ status: cond })` 后接悬空 `? a : b` → 产物语法错。需修 ref 赋值改写（三元/多行 RHS）。
2. **箭头函数参数类型注解未剥离**：`.node((res: any) => {...})` 的 `res: any` 残留进产物 → 语法错。
   stripTypeSyntax 未覆盖箭头函数参数位。

## 关联

- `docs/compiler-platform-alignment.md`（glass-easel 平台语义对齐——同源方法论：不自造语义）
- `template/svg-no-peer` 规则（G2 反黑盒警告——未覆盖标签仍警告）
- `src/components/p-svg/index.vue`（汇合点）
- PROJECT_MEMORY 本会话条目（2026-09-08 ⑨）
