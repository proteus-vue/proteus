---
title: 能力三态与降级
order: 8
group: 柔性系统
---

# 能力三态与降级

> **能力不是布尔值。** 「车机不支持多规格选择」是错的——真实约束是「驾驶中不做精细多选，改用语音/旋钮单选」。柔性系统用三态表达这件事，并让每一项都产生**可观测的渲染后果**。

## 三态语义

```ts
type CapsLevel = 'supported' | 'fallback' | 'unsupported' | boolean

supported    → 正常渲染该能力对应的完整 UI
fallback     → 渲染**降级路径**（同一任务的另一种做法，不是删除）
unsupported  → 不渲染（该形态确实没有这条路径）
```

| 辅助函数 | 语义 |
|---|---|
| `capsEnabled(level)` | `supported` / `fallback` 都为真（有路径），`unsupported` 为假 |
| `capsDegraded(level)` | 是否为 `fallback`（走了降级） |
| `capsLabel(level)` | 归一为三态字符串（`boolean` 兼容旧写法：`true→supported` / `false→unsupported`） |

> ⚠️ **禁止裸真值判断**：`v-if="caps.drawer"` 对字符串 `'unsupported'` **恒真**——这是一个真实踩过的 P0（七形态全渲染假徽标，而面板显示「未支持」）。组件与 SSOT 内的判断必须走 `capsEnabled()`；静态扫描门禁会拦住裸写法。

## 14 项能力与真值表

`FORM_CAP_KEYS` 是能力键的 SSOT（14 项），七个形态的 `caps` 键集必须与之逐项相等：

| 能力 | 语义 | watch | phone | fold | tablet | pc | car | tv |
|---|---|---|---|---|---|---|---|---|
| `skuMulti` | 多规格选择 | — | ✅ | ✅ | ✅ | ✅ | **◐ fallback** | — |
| `tabs` | 底部 Tab | — | ✅ | ✅ | — | — | — | — |
| `hover` | 指针悬停 | — | — | — | — | ✅ | — | — |
| `dpad` | 遥控方向键焦点 | — | — | — | — | — | ✅ | ✅ |
| `crown` | 表冠 / 旋钮 | ✅ | — | — | — | — | ✅ | — |
| `dense` | 高密度信息 | — | ✅ | ✅ | ✅ | ✅ | — | — |
| `focusTree` | 焦点树导航 | — | — | — | — | — | ✅ | — |
| `focusRows` | 横向焦点行 | — | — | — | — | — | ✅ | ✅ |
| `multiCol` | 多列并排 | — | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| `sidebar` | 持久侧栏 | — | — | — | ✅ | ✅ | — | — |
| `drawer` | 抽屉 / 侧滑弹层 | — | ✅ | ✅ | ✅ | — | — | — |
| `notch` | 异形屏安全区 | — | ✅ | ✅ | — | — | — | — |
| `keyboard` | 物理键盘 | — | — | — | — | ✅ | — | — |
| `driveAware` | 驾驶降干扰 | — | — | — | — | — | ✅ | — |

（`—` = unsupported；表由 `FORM_CAP_KEYS × FORM_PROFILES` 生成，与源码逐项对账）

两处值得注意：**车机 `skuMulti` 是唯一的 fallback**——渲染「🎙/↻ 语音或旋钮选择」的降级条（宿主可经 `degraded-hint` 注入文案），而非静默删除；**TV 没有 `dense`**——10ft 观看距离下高密度信息不可读。

## 消费点：每项都要有可观测后果

| 消费形式 | 举例 |
|---|---|
| 模板过滤 | `v-if="capsEnabled(caps.drawer)"` → 渲染抽屉把手（未声明则零 DOM） |
| 根类映射 | 14 项 → `has-dpad` / `is-dense` / `has-crown` …（CSS 与行为据此接线） |
| 降级渲染 | `skuLevel === 'fallback'` → 降级条；`supported` → 真实多规格槽 |
| 行为开关 | `focusEnabled = capsEnabled(caps.dpad)` → 遥控系才接管方向键（PC 保留原生 Tab 顺序，避免 WCAG 违规） |
| 布局切换 | `caps.focusRows` → 推荐区转横向焦点行（TV/车机） |
| 尺寸影响 | `caps.dpad` → 热区下限 76dp（否则 44dp）；`caps.dense` → 紧凑间距 |

门禁同时保证「**有声明必有后果**」与「**有后果必先声明**」：静态扫描（14 项消费点）+ 渲染级对账（`data-pf-caps`）。

## 能力证据面：`data-pf-caps`

每个 `p-formfactor` 根节点暴露一份机器可读的三态摘要（按 `FORM_CAP_KEYS` 顺序稳定排序）：

```html
<div class="p-formfactor topo-dashboard form-car" data-pf-caps="skuMulti=fallback;dpad=supported;crown=supported;…">
```

用途：**「声明 ≠ 空头」的机器化判据**——外部/门禁无须读源码即可断言某形态最终生效了哪些能力；e2e 用例逐形态与画像声明对账（防「有类名但没声明」或「声明了但摘要缺失」）。

## 诚实边界

- 当前能力**全部来自画像声明**（静态表）。端上是否有真表冠、真遥控器属**运行时能力协商**（端上报 → 与声明求交 → 三态收敛），尚未实现——愿景与接口草案见 [OS 级路线图](/docs/system/01-overview)。
- `fallback` 的渲染路径目前由组件层提供（`pf-sku-fallback` + 宿主文案注入）；业务自定义降级路径（降级路径注册表）属规划项。
- 三态是**封闭枚举**：不扩展为四态/五态——需要更细的表达时走独立的「降级路径注册表」，避免击穿既有门禁与消费语义。

## 下一步

- [折叠姿态](/docs/system/09-postures)：姿态会覆盖拓扑与度量（另一种"动态能力"）
- [p-formfactor](/docs/system/11-p-formfactor)：能力的容器组件落地
