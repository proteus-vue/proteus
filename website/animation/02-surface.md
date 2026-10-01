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

**合成属性 = 可以走平台零参与路径**。五个标量属性是合成属性；**`color` / `textColor` 是 paint-only 但非合成**（不触发布局，但 Android 的 RenderNode 无法插值颜色 ⇒ 两端一致走 tick 路径）。另注意：**修改布局属性（宽度/边距）不是动画，是重排**，编译期会直接拦下。

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

26 条声明项（13 预设 / 6 声明面原语 / 5 约束 / 2 边界）以 `ANIM_RULES` 为单一事实源，与编译器 111 条规则**同构**：每条含 what / why / when / 示例 / 如何验证 / 实现位置，AI 可单独消费一条。

生成物 [anim-manual](/docs/generated/anim-manual) 在生成前会跑 `runConformance()` 对账——预设必须真实存在于导出面、跨语言契约值必须一致、`verify` 必须可追溯；**对不上就不生成文档**。

## 下一步

- [路由转场](/docs/animation/03-transitions)——统一枚举如何跨三端兑现、push/pop 的方向语义
- [证据与诚实边界](/docs/animation/04-boundaries)——真机读数与未做清单
