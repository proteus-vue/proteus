---
title: 指令原语（v-pump / v-animate / v-follow）
order: 40
group: 指令原语
---

# 指令原语（v-pump / v-animate / v-follow）

> 一句话定位：**页面声明语义，各端自决实现**——Vue 指令是这条哲学在最贴近模板的一层的落点。

## 为什么是指令（不是组件）

组件是「结构形态」，指令是「**行为/状态的声明**」。App 端（自绘引擎）**不执行 `<script setup>`**，所以指令不能像 Web 那样在运行时跑一个 `mounted(el, binding)` 回调。Proteus 把指令收敛成两条落点：

- **编译期折叠**：把指令语义折成节点/页面的**纯数据字段**（JSON），内核与宿主据它执行——无需运行期脚本；
- **闭集注册表**：`v-animate` 这类「映射到已存在宿主能力」的指令，由注册表（`packages/slot-runtime` 的 `HOST_DIRECTIVE_SPECS`）定义——表内名字可直接用，表外名字编译期**精确诊断**（说明「端上不执行 script ⇒ 指令体不会运行」）。

同一个指令在 **Web / Skyline / App** 三端由各自 Backend 承接：前两端走 Vue 运行时 / 小程序原生，App 端走折叠面。**一份声明，三端生效**。

## 指令清单

| 指令 | 语义域 | 折叠落点 | 触发时机 | 端状态 |
|---|---|---|---|---|
| `v-pump` | 运行期数据源（按频率跳变） | 页面级**泵表** `template.pumps` | 宿主按帧驱动 `pumpTick(dtMs)` | App 已支持（Android 驱动就绪） |
| `v-animate` | 值变化播一次预设动画 | 节点 `directives`（预设 → 动画通道） | 首评 truthy / 值变化 | App 已支持 |
| `v-follow` | 手势跟手 / 场（一手势驱动一片） | 节点 `follow*` 字段 / 场容器 `followField` | 宿主手势 MOVE 直喂内核 | App 已支持 |

> 三者的共同点：**触发与执行都在"不跑脚本"的前提下完成**——数据源由宿主帧循环推进、动画由内核动画通道推进、跟手由内核合成变换推进。

## v-pump：声明式运行期数据泵

页面声明一个**具名数据源**，它会按 `hz` 自动跳变；页面对该源的**普通绑定**（`{{src}}` / `:style` / `:class` / `v-animate`）**自动联动**——文本 / 样式 / 动画一次覆盖。

```vue
<template>
  <view v-pump="{ src: 'p0', hz: 30, gen: { kind: 'int', min: 1, max: 99 } }">
    <text>{{ p0 }}</text>
  </view>
</template>
```

**规格**（`{src, hz, gen}`，均为静态字面量）：

| 键 | 含义 |
|---|---|
| `src` | 数据源名（普通绑定按它引用） |
| `hz` | 跳变频率（次/秒；宿主按 `1000/hz` 累加抽帧判到期） |
| `gen.kind` | 内置生成器：`int` / `float`（`[min,max]` 随机）· `sin`（`[min,max]` 正弦） |
| `gen.min` / `gen.max` | 取值范围（首帧初值 = `min`） |
| `gen.period` | `sin` 的正弦周期（ms，缺省 1000） |

**机理**：泵不走响应式框架，而是走既有的「数据 → 槽位 → 指令 → 内核」增量链（`writeSource` → O(1) 源级增量）。宿主只需一个**周期驱动**（Android Choreographer 帧回调按最小间隔到期才 eval，非每帧）——**App 端无 JS 定时器**，周期一律由宿主提供（合法帧源，无 sleep）。

**诚实边界**：泵走**数据通路**（Vapor/`applyOps`），**手势路径仍零 JS**；组件内部模板的 `v-pump` 不支持（与既有指令边界一致，如实诊断）。

## v-animate：值变化播一次预设动画

`:arg` 是动画预设名；值表达式**首评 truthy**（mounted 语义）或**值变化且 truthy**（updated 语义）时，在该节点**播一次**预设动画。

```vue
<template>
  <view>
    <text v-animate:zoom="beat">{{ beat }}</text>
  </view>
</template>
```

**可用预设**：`fade` / `slide-up` / `slide-down` / `slide-left` / `slide-right` / `zoom` / `fade-slide-up`（与 `<Transition>` 同一份 `TRANSITION_PRESETS`——一处实现）。**无参数**缺省 `fade`；**无值** = 恒真（首评即播）。

**机理**：预设 → 动画通道在**编译期**解析；运行期只判「值变了没有」，然后经宿主 `animStart` 交给**内核动画通道**（`anim_start` + 帧循环）。与 `<Transition>` 完全同一套内核能力，零新增平台能力。

**诚实边界**：只支持注册表内指令（表外产诊断）；`v-for` 行内指令未支持（需行作用域求值，编译期诊断）；组件内部模板的指令不执行。

## v-follow：跟手 / 场

把「一个手势 → 一片节点」的语义折成节点的 `follow*` 字段，宿主 MOVE 时**直接喂内核**（换算/夹取/吸附/弹簧全在内核，**零 JS 跨界**）。

```vue
<template>
  <!-- 单节点跟手：整块随指平移（可夹取 / 松手回弹 / 过阈值吸附） -->
  <view class="knob" v-follow="{ axis: 'x', clamp: [-120, 120], snap: { threshold: 60, target: 120 } }" />

  <!-- 场：容器内一片节点，每个按「距焦点距离」求高度/朝向（如针林穹顶） -->
  <view class="field" v-follow="{ field: { falloff: 240, minScale: 0.08, maxScale: 1, rotate: 0.3 } }">
    <view class="needle" /> <!-- …一片叶 -->
  </view>
</template>
```

**支持键**（静态对象字面量）：

| 键 | 含义 |
|---|---|
| `axis` | `'x'` / `'y'` / `'both'`（缺省 y）——跟手轴 |
| `gain` | 跟手增益（位移倍数） |
| `clamp` | `[min, max]`——跟手夹取区间 |
| `spring` | `{stiffness, damping, mass}`——松手回弹弹簧 |
| `snap` | `{threshold, target}`——过阈值吸附到 ±target，否则回弹 0 |
| `field` | `{falloff, minScale, maxScale, rotate}`——**场**：容器子叶按距焦点求 scale/rotate |

**机理**：内核「场跟手」原语 `follow_field`（容器子树叶 = 尖峰，逐个按距焦点求合成属性）+ JNI/FFI 直喂。宿主 MOVE 只记焦点 + 标脏，**每帧一次**内核调用——大 N（4000/10000 根）下走**二进制精简记录 + 批量绘制**（大 N 下 JSON 文本通道致命）。

**诚实边界**：场容器**不进入单节点跟手表**（否则整片被当"可平移节点"拖走）；组件内部模板的 `v-follow` 不支持。

## 相关：`<Transition>`（显隐过渡）

`<Transition>` 不是指令，但与本页同族——它是「**可见性翻转 → 过渡动画**」的声明式形态，复用**同一份** `TRANSITION_PRESETS` 与**同一条**内核动画通道：`v-show` 等可见性变化时，入场（enter）/ 离场（leave）通道按 from→to 播放。`v-animate` 可视为它的「命令式/一次性」补充。

## 端能力与基准

- **基准 = Web**：三端判定一律以浏览器真值为准；「三端内部自洽」不等于「与 Web 一致」。
- 指令折叠面集中在 `packages/compiler/src/vapor/template.ts`；运行期触发在 `packages/slot-runtime`（`directives.ts` 注册表 + `anim-trigger.ts`）与 `packages/render-backend`（`screen-runtime`）；宿主驱动各端自持（Android 已就绪）。
- 相关参考：[CSS 多端支持参考](/docs/reference/css-support)（`@keyframes` / `animation` / `:active` / `::before`/`::after` 折叠面）· [过渡组件](/docs/component/p-transition) · [Skyline 渲染约束](/docs/22-skyline-render-constraints)。
