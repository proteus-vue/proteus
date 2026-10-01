---
title: 声明面
order: 3
group: 使用
---

# 声明面

Morpheus 的对外表面只有一个包：**`@proteus-vue/animation`**（声明 + 校验 + 编译，纯函数、零运行时依赖）。它不做三件事——不持有动画状态、不做曲线数学、不碰平台 API。

## 闭环：声明 → 校验 → 编译 → 指令

| 步骤 | 入口 | 说明 |
|---|---|---|
| 声明 | `AnimDecl`（封闭集） | 属性 / 起点 / 终点 / 时长 / 曲线或弹簧或序列 |
| 校验 | `validateAnimations` | 7 类检查：非法属性 / 同属性重复 / 参数非法…… 失败**抛错并给修复建议** |
| 编译 | `compileAnimations(decls, targets)` | 声明与目标节点绑定；默认值在编译期落定（下发的指令无"未指定"） |
| 成批 | `compileRoute(spec, {enter, exit})` | 路由转场：两页各自一组已绑定指令 |
| 连线 | `compileTimeline({kinds, stops})` | 跨属性共享时间轴（多属性对齐同一停靠点，总时长由构造保证一致） |

## 属性与曲线（跨语言契约，编号不得改）

| 属性（`kind`） | 契约编号 | 是否合成属性 |
|---|---|---|
| `translateX` | 0 | ✅ |
| `translateY` | 1 | ✅ |
| `scale` | 2 | ✅ |
| `rotate` | 3 | ✅ |
| `opacity` | 4 | ✅ |
| `color` | 5..8（R/G/B/A 四通道） | ❌ **paint-only**（不触发布局，但不进平台零参与路径——见架构页） |
| `textColor` | 9..12（R/G/B/A 四通道，独立轨道） | ❌ **paint-only**（同上；与 `color` 可同节点并行） |
| `rotateX` / `rotateY` | 13 / 14 | ❌ **tick-only**（3D——见下文） |
| `clip` | 15..30（按参数槽分解，最多 16 通道） | ❌ **tick-only**（裁剪形变——见下文） |
| `strokeProgress` | 31（单通道标量：0..1 沿弧长画到哪） | ❌ **tick-only**（SVG 描边——见下文） |
| `gradientMix` | 32（单通道：两态渐变混合因子） | ❌ **tick-only**（渐变 v1+v2——见下文） |
| `pathMorph` | 33（单通道：两态路径插值因子） | ❌ **tick-only**（路径变形 v1+v2——见下文） |
| `glowIntensity` | 34（单通道：发光强度 0..1） | ❌ **tick-only**（发光——见下文） |
| `maskProgress` | 35（单通道：软边遮罩揭示进度） | ❌ **tick-only**（遮罩——见下文） |
| `skewX` / `skewY` | 36 / 37（度） | ❌ **tick-only**（倾斜——见下文） |

| 曲线 | 契约编号 |
|---|---|
| `linear` | 0 |
| `easeOut` | 1 |
| `easeIn` | 2 |
| `easeInOut` | 3 |
| `springApprox` | 4 |

**3D 旋转（`rotateX` / `rotateY`，2026-10-01）**：绕 X/Y 轴旋转（度；锚点 = 层中心），
透视在节点样式上声明（`perspective: 1200`，CSS 语义）。**走 tick 路径**——
两端平台插值器的 3D 语义不同，统一内核逐帧求值 + 宿主组矩阵（跨端一致优先，与 `color` 同源决策）。
预设：`presets.element.flipIn`（翻入）/ `flip3D`（翻面，可与 `repeat: 'infinite'` 组合成持续翻转）。

**循环与往复（`repeat` / `direction`，2026-10-01）**：`repeat: 3 | 'infinite'`
（= CSS `animation-iteration-count`）＋ `direction: 'alternate'`（= yoyo——奇偶轮反向、
**净位移 0**）。"呼吸灯/无限脉冲"不再需要"把时长写长"（那会把曲线拉伸变形）。
颜色动画同样支持（四条通道一起循环——少一条就是颜色分叉）。

**播放控制（`animControl`，2026-10-01）**：全局 `timeScale`（`0.25` 慢动作 / `2` 快进）
与 `paused`（冻结；恢复从冻结处继续，不是重置）。**只影响时间推进**——
`seek` 与滚动驱动的进度由外部给，暂停/慢放不破坏手势跟随语义。

**任意缓动（`curveBezier`，2026-10-01 转正）**：封闭集之外的设计稿曲线不再需要走逃生口——
`curveBezier: [x1,y1,x2,y2]`（或 `parseCubicBezier('cubic-bezier(…)')` 直接粘贴 CSS 值）
走**内核同一台求值机器**（65 点表 + 插值，控制点表生成一次并缓存）。
约束：`x1/x2 ∈ [0,1]`（时间轴单调）；`y1/y2` 任意（> 1 = 回弹、< 0 = 预期），
与 `curve` / `spring` / `keyframes` 互斥（求值模式必须唯一）。

**裁剪形变（`clip`，2026-10-01）**：`clip-path` 形变动画。形状类型在节点样式**静态**声明
（`clipPath: { kind: 'inset' | 'circle' | 'polygon', … }`，参数为盒分数 0..1），参数可动画——
**一个声明 → 最多 16 条标量参数通道**（kind 15..30，与颜色同源的分解法：
曲线/弹簧/序列/循环/接管零改动复用）。异型间不插值（inset→circle 无意义，CSS 同规）。
渲染：iOS `CAShapeLayer` 作 `layer.mask` / Android `canvas.clipPath`（静/动两态都覆盖）。

**SVG 描边（`strokeProgress`，2026-10-01）**：路径本体（`d`）在节点样式声明
（`svgPath: { d, stroke, strokeWidth }`），动画只有一个标量：`{ kind: 'strokeProgress', from: 0, to: 1 }`
——0..1 = 沿路径弧长画到哪（"手写字/画线"）。路径由**内核唯一解析**（段列表 + 弧长，
两端共用同一份——不出现"同一条 `d` 两端画得不一样"）。
支持 `M/L/C/Q/Z`（相对命令与隐式重复已支持；`A` 弧线 / `S`/`T` 简写明确拒绝并给替代写法）。

**渐变填充与混合（`gradientMix`，2026-10-01 · v1+v2）**：节点样式声明 `fillGradient`
（`{ kind: 'linear'|'radial', angle | cx/cy/r, stops: [{offset, color, alpha?}] }`，2..8 色标、
offset 严格升序）；再声明 `fillGradientTo`（B 态——必须同 kind、同色标个数）后，一条
`gradientMix` 通道（32）在两态之间混合：**色标（颜色 + 位置）与几何（angle / cx·cy·r）
都随同一因子过渡**——"光本身在动"（月晕扩散 / 角度转向 / 光斑移动）。CSS 完全不能过渡
渐变几何（`linear-gradient` 的插值是"整幅互换"）；lerp 是内核唯一实现（`GradState::mixed`），
两端宿主零插值（只消费已算好的值）。

**路径变形（`pathMorph`，2026-10-01 · v1+v2）**：两态路径（`svgPath` A + `svgPathTo` B）
逐点插值——**CSS 完全不能做**（`d` 不在 CSS 过渡集，web 端必须引 GSAP MorphSVG / flubber
这类库逐点重算）。v2 起异构路径对（段数 / 段型不同）在建树时**自动重采样**到同构
（均匀弧长取点 + Catmull-Rom 转三次贝塞尔，段数 `max(两侧段数).clamp(12,48)`）；
重采样是近似（弧长差 <3%）且**如实标注**（查询响应带 `resampled` 字段）。lerp 唯一实现
在内核（`SvgPath::morphed`），宿主只翻译变形后的段列表（二进制通道，避开每帧 JSON 编解码）。

**发光（`glow` + `glowIntensity`，2026-10-01 · glow v1）**：节点声明 `glow: {color, radius, alpha}`，
通道 34 驱动呼吸 / 渐亮 / 渐隐（与描边进度联动——"画到哪、光到哪"）。渲染 = **N 层同心描边**
（N=5 跨语言常数；宽度梯度 `radius×k/N`、alpha 平方衰减 `a0×(1-(k-1)/N)²`）——
**刻意不用平台原生**：Android `Paint.setShadowLayer` 在硬件加速下只支持文本（对 Path 静默不画）、
iOS `CALayer.shadow*` 是高斯阴影（两端不同形）。分层描边是确定性算法、两端逐像素可预期，
实测每帧 p95 0.28ms（"几乎零成本"）。

**软边遮罩（`mask` + `maskProgress`，2026-10-01 · mask v1）**：与 `clip` 互补——clip 是硬边
一刀切、mask 是软边渐隐（"从雾里渗开"），两者天然可叠加。`mask: {kind: 'linear'|'radial',
angle|cx/cy/r, softness, progress?}`；通道 35（0=全隐 / 1=全显）驱动**双色标柔化揭示**，
揭示数学是内核唯一实现（宿主零数学）。端点**显式短路**——f32 实测教训：`1.0×1.4−0.4`
在 f32 下是 `0.99999994` ⇒ 不靠浮点比较（否则"进度到底了但画面留一条软边"）。

**倾斜与变换原点（`skewX` / `skewY` + `transformOrigin`，2026-10-01）**：通道 36/37（度；
`x' = x + tan(skewX)·y`，CSS `skewX` 同式）；配 `transformOrigin: {x, y}`（盒分数）任意锚点
——"从根部弯折"（底边中点）/"门轴旋转"（左缘）/"从角落放大"（角点）。两端都不是一等属性
（Android 无 `setSkewX`、iOS `CALayer` 无倾斜属性）⇒ 统一 tick 路径。变换栈至此完整：
位移 / 缩放 / 旋转 / 3D / 倾斜 × 任意锚点。

**合成属性 = 可以走平台零参与路径**。五个标量属性是合成属性；**`color` / `textColor` / `rotateX` / `rotateY` / `clip` / `strokeProgress` / `gradientMix` / `pathMorph` / `glowIntensity` / `maskProgress` / `skewX` / `skewY` 是 tick-only 或 paint-only 但非合成**（不触发布局，但两端平台插值器语义不同或无法插值 ⇒ 统一走内核逐帧路径，跨端一致优先）。另注意：**修改布局属性（宽度/边距）不是动画，是重排**，编译期会直接拦下。

```ts
// 颜色是**一个声明**——编译成内核的**四条通道**
compileAnimations([{ kind: 'color', from: '#2f6fed', to: '#ff5533', durationMs: 200 }], { nodeId: 7 })
// ⇒ 4 条指令（kind 5/6/7/8）· batch.composited === false（paint-only——见架构页）

// 文字色：独立轨道（kind 9..12），支持 keyframes 多段序列（与标量序列同语义）
compileAnimations([{ kind: 'textColor', from: '#ffffff', to: '#00ff00',
  keyframes: [{ to: '#ff0000', durationMs: 100 }] }], { nodeId: 7 })
```

## 预设库（13 条）

预设优先于参数——常见演出都是一句话。全部条目（含"何时用/如何验证"）见 [Morpheus 声明项说明书](/docs/generated/anim-manual)。

| 类别 | 预设 | 一句话 |
|---|---|---|
| 路由转场 | `route.slideUp` / `route.slideDown` / `route.bottomSheet` / `route.zoom` / `route.cupertinoModal` | 推入 / 下滑关闭 / 半屏弹窗 / 缩放下沉 / iOS 模态 |
| 列表 | `list.shift` | 列表增删时其他项平滑让位（FLIP） |
| 元素 | `element.press` / `element.shake` / `element.sharedElement` / `element.fadeIn` | 下压回弹 / 抖动 / 跨元素飞行 / 渐显 |
| 滚动联动 | `scroll.parallax` / `scroll.sticky` / `scroll.fadeIn` | 视差 / 吸顶 / 渐显 |

```ts
import { presets, compileRoute } from '@proteus-vue/animation'

const spec = presets.route.bottomSheet()      // 半屏弹窗：只动进场页
const batch = compileRoute(spec, { enter: 101, exit: 100 })
// batch.enter / batch.exit → 两组已绑定节点的引擎指令
```

## 与 AI 说明书同源

48 条声明项（21 预设 / 19 声明面原语 / 6 约束 / 2 边界）以 `ANIM_RULES` 为单一事实源，与编译器 112 条规则**同构**：每条含 what / why / when / 示例 / 如何验证 / 实现位置，AI 可单独消费一条。
生成物 [anim-manual](/docs/generated/anim-manual) 在生成前会跑 `runConformance()` 对账——预设必须真实存在于导出面、跨语言契约值必须一致、`verify` 必须可追溯；**对不上就不生成文档**。

## 下一步

- [路由转场](/docs/animation/03-transitions)——统一枚举如何跨三端兑现、push/pop 的方向语义
- [证据与诚实边界](/docs/animation/04-boundaries)——真机读数与未做清单
