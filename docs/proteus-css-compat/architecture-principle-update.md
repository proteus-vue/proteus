# 原则 #10 更新：CSS 兼容性边界

> 本文件用于合并进 `architecture-principle.md`（「统一语义 + 原生实现」全局设计原则）。

## 新增子节：「样式层：CSS 兼容性边界」

**定位**：CSS 兼容 = **语义一致，非像素一致**。

### 允许范围（✅ 直映射）

布局：`p-flex`(direction/justify/align/gap)、`p-stack`、`p-grid`、盒模型(width/height/padding/margin/border/box-sizing)、`position`(relative/absolute/fixed)、transform(translate/scale)
视觉：color、opacity、background-color、border-radius、线性渐变(→`<p-bg-gradient>`)
选择器：仅 `.class` + 组件 scope + 伪类白名单(`:active/:hover/:first-child` 等)

### 语义封装（🔶 → `<p-*>`）

| 能力 | 组件 |
|------|------|
| 背景模糊 | `<p-glass>` |
| 吸顶 | `<p-sticky>` |
| 滚动 | `<p-scroll>` |
| 阴影 | `<p-shadow>` |
| 渐变 | `<p-bg-gradient>` |
| 安全区 | `<p-safe-area>` |

### 编译期重写（⚠️）

- `calc()` → 布局约束
- `vh/vw` → `p-safe-area`
- `rgba()` → ARGB（鸿蒙/Android shadow）
- 选择器级联 → 扁平 IR（运行期不下发选择器）

### 禁止（❌）

- `*` 选择器、`[attr]`、元素选择器、深层后代(>2级)
- `float`、`inline/inline-block`（非文本嵌套）
- 依赖跨父级 stacking context 的 `z-index`
- 硬编码 `vh` / 平台判断样式

### 反例（明确不做）

1. ❌ **不自研 CSS 引擎 / 迷你 CSSOM**（原生端无选择器概念，运行期实现 = 违背原则 #10）
2. ❌ **不追求像素级一致**（那是 Flutter/Yoga 目标，牺牲原生质感）
3. ❌ **不引入独立原生 DSL（类 `.uvue`）**——单 `.vue` SFC 经 Compiler 按 target 出三端 IR 即可
4. ❌ **不允许业务写平台分支样式**——差异内聚在 Renderer 映射表

### 对竞品的差异化定位

| 方案 | CSS 范围 | 代价 | 原生质感 |
|------|---------|------|---------|
| uni-app (WebView) | 全 CSS | 性能差 | ❌ |
| uni-app x (ucss) | 子集（窄） | 脱离 JS | ✅ |
| Lynx | 子集 + 自研布局 | 维护引擎 | ✅ |
| **Proteus** | **子集（比 ucss 宽）+ 编译转原生，不引 Yoga** | **中间态** | ✅✅ |

## 配套文档

`proteus-css-compat/` 目录（12 份）：
- 01 四级兼容矩阵（逐属性标注五端档位）
- 02 --strict-css lint 规则
- 03 编译期重写
- 04 语义样式组件
- 05 五端映射细则
- 06 选择器级联固化
- 07 盒模型与安全区
- 08 transform/动画边界
- 09 Compiler 管线集成
- 10 预算与 CI 门禁
- 11 分批策略 B1-B3
- 12 反例与迁移
