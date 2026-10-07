---
title: 流体度量
order: 7
group: 柔性系统
---

# 流体度量

> **尺寸只有一个输入：容器宽度。** 画像里的 `visual.ratio` 声明「这一形态该多大」，`resolveFluidMetrics()` 把它解成 `k` 系数与全套 CSS 变量。没有绝对 px 尺寸表、没有 `transform: scale`（旧版缺陷：按自然视口渲染再缩放裁切——已移除）。

## 求解公式

```ts
k = clamp(ratio.min, containerWidth / ratio.ref, ratio.max)

// ratio.ref = 该形态的「基准容器宽」：容器等于 ref 时 k = 1，用设计尺寸
// min/max   = 可读性护栏（mockup 不缩成蚂蚁字 / 真实大屏不无限放大）
```

`ratio.ref` 有真实设备依据：手机 300（真机 390 下 k ≈ 1.3，正文 ≈ 17pt 对齐 HIG）、TV 620、车机 640、手表 198（k=1 即真机尺度）。

容器不可测（SSR / 首帧）→ `k = 1`（按设计尺寸渲染，渲染端自决，不阻塞首屏）。

## 产出变量（全部有真实消费者）

| 变量 | 含义 | 消费点举例 |
|---|---|---|
| `--pf-u` | 基准单位（= 字号） | 间距/圆角/热区的统一乘数 |
| `--pf-font` | 正文 | 全部文本 |
| `--pf-gap` | 元素间距 | 与 `--pf-gap-dense` 二次相乘（密度） |
| `--pf-pad` | 容器内边距 | 各拓扑 padding |
| `--pf-radius` | 圆角 | 卡片/胶囊 |
| `--pf-control` | **热区下限**（见下） | 按钮/瓦片/Tab 的 `min-height` |
| `--pf-media-ar` / `--pf-media-scale` | 媒体比例 / 展示尺度 | 封面纵横比；hero 形态 ×2.6（10ft 主视觉） |
| `--pf-safe-side/bottom/top` | 安全区 | overscan / Home Indicator / 刘海 |
| `--pf-fold-width` | 铰链带 | 折叠屏双栏 `column-gap`（真机 `env(fold-width)`） |

配套：`resolveFrameVars()` 产出展示帧相关量（含安全区与媒体尺度），与度量变量分开——帧只影响演示壳，不参与内容度量。

## 关键纪律：设备物理量按展示缩放投影

**热区（76dp / 44dp）、安全区（TV overscan 5%）是设备物理规格，不是缩略壳里的绝对像素。**

演示页把 1280pt 的车机画进 540px 的框（展示缩放 42%）——此时若把 76dp 当 76px 用，热区会占内容高 44%、主视觉被挤没；反之安全区 96px 直接塞进 620px 帧会占 15.5%（真机 5% 的三倍），TV 看起来"四周有边框、不沉浸"。

```ts
showScale = min(1, containerWidth / deviceWidth)   // 真机/超宽 → 1（不做反向放大）
control   = max(2.6, minDp × showScale / (baseFont × k))   // minDp = dpad ? 76 : 44
safeSide  = 96 × showScale                                  // TV overscan 5% 的设备量
```

这条纪律是**三次实测缺陷**（热区外溢 → TV 不沉浸 → 车机瓦片溢出）的共同根因，已固化为断言口径。

## 断言口径：换算回设备尺度

写测试或评审时，**禁止直接比较缩略壳里的 px**——必须换算回设备尺度再比，否则一换舞台宽断言就失真：

```ts
const dp = framePx / Math.min(1, containerWidth / FORM_PROFILES[form].viewport.width)
expect(dp).toBeGreaterThanOrEqual(76)   // 车机（AAOS）
expect(dp).toBeGreaterThanOrEqual(44)   // 触控（HIG 44pt / Material 48dp 的保守下界）
```

> 反例（历史坑）：早期断言 `carControl >= phoneControl` 曾因两种形态都错算成 76px 而**恒真**——断言看起来在守规范，实际什么都没守。

## 双视口验证纪律

同一形态在不同舞台宽度下**行高预算不同**（真实用户屏幕宽 ≠ 设计评审宽），布局改动必须在两档视口都验证：

| 视口 | 角色 | 覆盖 |
|---|---|---|
| 1280 | 窄舞台（用户实际常在此看到压缩） | 内容一屏装下、零重叠、零裁切 |
| **1512** | **用户实际屏幕（曾漏检的共同因素）** | 同上 |
| 1600 | 设计评审宽舞台 | 同上 |

机器门禁：`tests/e2e-website-multidevice.test.ts`（真 Chromium 双视口 × 八形态，含同会话切换）。

## 边界与降级

- **容器不可测**（SSR / MP 首帧）→ `k = 1`；`clamped` 诊断字段标记是否被护栏截断（`min` / `max`）。
- **MP（Skyline）**：`grid` / `container-query` / `aspect-ratio` 不可用 → 需 flex 降级分支（见[端与成熟度](/docs/framework/ends-matrix)）。
- **动态字号**：当前全量 px 度量**不响应**用户系统字号（已知边界）；愿景见 [OS 级路线图](/docs/system/01-overview)。

## 下一步

- [能力三态与降级](/docs/system/08-capabilities)：热区下限里的 `dpad` 判定从哪来
- [p-formfactor](/docs/system/11-formfactor-composition)：这些变量在组件层的落地
