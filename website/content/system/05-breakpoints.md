---
title: 断点与形态
order: 5
group: 柔性系统
---

# 断点与形态

> 在 Proteus 里，断点不是 CSS 魔法数，而是**形态推导**：宽度进、形态出——`formForWidth(1440) → popover`。「设备类型」这个离散枚举，被降维成「容器特征」这个连续空间。

## 宽度 → 形态档位：formForWidth

`@proteus-vue/test-ir`（G-44 断点矩阵）导出真实求解函数，档位名称与 `p-adaptive` 的 sheet / dialog / popover 一脉相承：

```ts
export function formForWidth(w: number): 'sheet' | 'dialog' | 'popover' {
  if (w >= 1200) return 'popover'
  if (w >= 840) return 'dialog'
  return 'sheet'
}
```

| 容器宽度 | 形态 |
|---|---|
| < 840 | `sheet`（Web 端底部全宽） |
| 840 – 1199 | `dialog`（Web 端居中） |
| ≥ 1200 | `popover`（居中；有 anchor 时锚定触发源下方） |

注意求解只看宽度、不看「设备叫什么」：834px 的平板与 390px 的手机同为 `sheet` 档——形态由容器特征决定，这正是它跨端公平的原因。需要自己的档位就用 `p-adaptive` 区间表达式（如 `p-modal` 缺省 `sheet(0,600) | dialog(600,840) | popover(840,∞)`，区间左闭右开、须连续不重叠——FLD007 / FLD009 门禁）。

## 自己求解：p-adaptive 纯函数

`@proteus-vue/fluid` 导出同一套求解逻辑（零依赖纯函数，可单测可自定义）：

```ts
import { parseAdaptiveExpression, validateAdaptiveRanges, computeAdaptiveForm, createAdaptiveController } from '@proteus-vue/fluid'

const modes = parseAdaptiveExpression('sheet(0,600) | dialog(600,840) | popover(840,∞)')
validateAdaptiveRanges(modes)      // [] 空数组 = 区间连续不重叠（FLD007 通过）
computeAdaptiveForm(modes, 390)    // → 'sheet'
computeAdaptiveForm(modes, 600)    // → 'dialog'（区间左闭右开 [lo, hi)）
computeAdaptiveForm(modes, 1024)   // → 'popover'

// 运行时：监听容器尺寸 → 实时求解形态（复用 createContainerQuery；稳态零开销，不轮询）
const controller = createAdaptiveController(el, { modes })
controller.subscribe(({ form, width }) => { /* form: 当前形态 */ })
controller.destroy()
```

`p-modal` 就是这套纯函数的消费端：一次声明 `p-adaptive` 属性，视口 / 容器宽度变化时弹窗在 sheet（底部全宽）与 dialog / popover（居中）之间自动切换。

## Playground 就是活例子

官网 Playground 的 **DEVICE 下拉**用真实档位求解：五档设备以真实宽高进预览框，页脚实时显示 `Profile3D 1440×900 · F=popover`（[在线体验](/playground)）：

| DEVICE 档 | 宽 × 高 | formForWidth 求解 |
|---|---|---|
| Web 1440 | 1440 × 900 | `popover` |
| 平板 834 | 834 × 1112 | `sheet` |
| 手机 390 | 390 × 844 | `sheet` |
| 车机 1280 | 1280 × 720 | `popover` |
| 手表 198 | 198 × 194 | `sheet` |

同一份 demo 源码，切 DEVICE 即验证各形态渲染——预览框宽高是真的，形态求解是真的，输出树也是真跑的。

## G-25：三维断点模型（W × H × F）

宽度只解决了手机 / 平板 / PC 的差异。G-25（全终端柔性架构，plan 已入库）把「设备类型」降维成三维容器特征：

```
容器特征 = (W 宽度档位, H 高度档位, F 输入形态)
```

| 维度 | 档位 / 取值 | 说明 |
|---|---|---|
| W 宽度 | xs 0–320 / sm 320–600 / md 600–900 / lg 900–1280 / xl 1280+（pt） | 沿用 G-22 |
| H 高度 | xs 0–320 / sm 320–500 / md 500–800 / lg 800+（pt） | 车机矮屏 / TV 竖屏等特殊比例 |
| F 输入 | touch / cursor / remote / dial / voice（+ driving 子形态） | 手指、鼠标键盘、TV 遥控器、手表表冠、语音 |

为什么只有 W 不够：车机宽度可能比 PC 还大（xl）但交互是触摸 + 语音、TV 宽度也是 xl 但输入是遥控器、手表宽度极小但输入是表冠——**宽度无法区分它们，必须引入输入形态**。三维写法向后兼容：`sheet(0,600)` ≡ `sheet(0,600,*)`，已有 p-adaptive 代码不受影响。

G-44 测试层已把三维矩阵参数化：`W_BREAK [320,600,840,1200,1920] × H_BREAK [480,720,1080,1200] × F_FORMS [touch,cursor,remote,dial,voice]` → `generateBreakpointSuite()` 生成 100 个 Test IR，由 Device 后端按宽度档位求解执行——断点正确性机器可判，不是「看起来对」。

## 两层「断点」各管各的

| 层 | API | 基准 | 档位 |
|---|---|---|---|
| 容器断点 | [createContainerQuery](/docs/system/02-container-query)（`p-split` / `p-sidebar` / `p-zone` 内部） | 元素容器宽度 | sm / md / lg / xl（设计稿 × 0.5 / 0.875 / 1.25 / 1.625） |
| 形态档位 | `formForWidth` / `computeAdaptiveForm`（`p-adaptive` / `p-modal`） | 宽度 → 形态区间 | sheet / dialog / popover（表达式可自定义） |
| 三维特征 | `Profile3D`（W × H × F） | 宽 + 高 + 输入形态 | xs–xl 档位 + 5 种输入形态 |

组件布局决策（列数、分栏、折叠）用容器断点；弹层 / 导航形态切换用形态档位；全终端适配用三维特征。另外还有设备环境信号：`createDeviceEnv` 的折叠形态 `displayMode`（standard / fold / span / expand）与 drive-mode——折叠屏铰链避让、驾驶中禁动效（`shouldReduceMotion`）都从它来。

## 落地状态（诚实分级）

- ✅ `formForWidth` 档位求解 + 100 profiles 三维断点矩阵（`@proteus-vue/test-ir`，G-44；Device 后端按宽度档位求解 p-adaptive form）
- ✅ 折叠形态 `displayMode`、drive-mode 注入、`prefers-reduced-motion`——`createDeviceEnv` + `shouldReduceMotion`（Fluid System S2 / S3）
- ✅ 容器级断点推导与求解——`deriveContainerBreakpoints` / `resolveBreakpoint`（`@proteus-vue/fluid`）
- 📋 `useContainerProfile()` 组合查询、车机 / TV / 手表原语（焦点引擎、表冠、单列一屏）——G-25 组件层 plan 已入库未实现
- 📋 配套铁律：车机 driving-safe（VEH001）/ TV 焦点模式（TV001）/ 手表单列（WATCH001）/ 禁止手动 `if (isTV)`——用容器特征查询替代（BP003）

> 状态图例：✅ 已落地可验证 · 📋 规划已入库（plan + 参考实现，无可运行集成）。

## 下一步

- [全终端适配](/docs/21-device-adaptation)：G-24 桌面原语 + G-25 全终端
- [柔性系统总览](/docs/system/01-overview)：回到全景
- [容器与宿主](/docs/framework/33-containers-hosts)：容器形态与宿主运行时
