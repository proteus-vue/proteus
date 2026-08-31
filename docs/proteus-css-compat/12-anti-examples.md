# 12 反例与迁移对照

> 明确「不该怎么写」+ 对照 uni-app uvue / Lynx，厘清边界。

## 一、Proteus 反例（禁止 / 应改写）

### ❌ 裸 backdrop-filter
```css
/* 错 */
.modal { backdrop-filter: blur(20px); }
```
✅ 改用 `<p-glass blur="20" />`

### ❌ float 布局
```css
/* 错 */
.sidebar { float: left; width: 200px; }
```
✅ 改用 `<p-flex direction="row">`

### ❌ 通用/属性选择器
```css
/* 错 */
* { box-sizing: border-box; }
[disabled] { opacity: 0.5; }
```
✅ 改用 class：`.disabled { opacity: 0.5 }`

### ❌ 深层后代
```css
/* 错 */
.list .item .title .icon { ... }
```
✅ 扁平化 + 语义组件 prop 驱动

### ❌ 依赖 z-index 层叠上下文
```css
/* 错 */
.parent { z-index: 10; }
.child  { z-index: 100; }  /* 依赖父级 stacking context */
```
✅ 用 `<p-overlay>` 等语义组件，层级由组件内部管理

### ❌ vh 做页面高度
```css
/* 错 */
.page { height: 100vh; }
```
✅ 改用 `<p-safe-area>` / `p-h-safe`

### ❌ 硬编码平台判断样式
```vue
<!-- 错 -->
<p-view v-if="platform === 'ios'" class="ios-style" />
```
✅ 语义组件 + 统一 class，差异内聚 Renderer

## 二、对照 uni-app uvue / ucss

| 维度 | uni-app x (uvue + ucss) | Proteus |
|------|------------------------|---------|
| 文件后缀 | 需 `.uvue`（蒸汽编译，无 JS 运行时） | **单 `.vue` SFC**（保留 Vue 运行时） |
| 样式子集 | 自创 `ucss`（较窄） | **更宽的 CSS 子集 + 编译转原生** |
| 布局 | 独立布局约束 | `p-flex` 等统一语义 |
| 编译目标 | Kotlin/Swift/ArkTS（无运行时通信） | IR → JSI 同步直调原生 |
| 生态 | 脱离 JS/npm | **保留 Vue + npm + 热更新** |

**关键差异**：uvue 是"放弃 JS 运行时"的必要副产品；Proteus 保留 JS，**无需第二后缀**。

## 三、对照 Lynx

| 维度 | Lynx | Proteus |
|------|------|---------|
| CSS | 真 CSS 子集 + **自研布局引擎** | CSS 子集 + **映射各端原生布局（不引 Yoga）** |
| 端覆盖 | iOS/Android/Web | Web + Skyline + App（三端同源） |

**关键差异**：Lynx 自研布局引擎保证像素一致；Proteus 委托原生布局，**换原生质感 + 系统特性免费继承**（原则 #10）。

## 四、对照 Flutter / Yoga

- **Flutter**：自绘（Skia/Impeller），像素级一致，但非原生控件、系统新特性滞后
- **Yoga**：跨端布局引擎（React Native 用），像素一致但需维护引擎
- **Proteus**：**语义一致、各端原生实现、不引自绘/引擎**

→ 这是原则 #10 的明确取舍：**不追求像素一致，追求原生质感 + 系统集成度**。

## 五、迁移速查（Web → Proteus）

| Web 习惯 | Proteus 做法 |
|----------|-------------|
| 任意 CSS 选择器 | class + scoped |
| `float` / `inline` 布局 | `p-flex` / `p-stack` |
| `calc()` / `vh` | 编译期重写 或 `p-safe-area` |
| `backdrop-filter` | `<p-glass>` |
| `position: sticky` | `<p-sticky>` |
| `overflow: scroll` | `<p-scroll>` |
| `box-shadow` 复杂 | `<p-shadow>` |
| `linear-gradient` | `<p-bg-gradient>` |
| `z-index` 层叠 | 语义组件内部管理 |
| `will-change` | Renderer 自动优化 |
| `mix-blend-mode` | 原生合成（平台特写） |

## 六、边界声明（写进 Architecture）

> **Proteus 不是"CSS 五端像素一致"方案，而是"CSS 子集语义一致 + 原生质感 + 系统特性免费继承"方案。**
> 超出子集的能力一律收敛为语义组件或编译期重写；无法收敛的由 `--strict-css` 报错并引导改写。
> **不引入跨端自绘布局引擎（Flutter/Yoga），不引入独立原生 DSL（类 uvue）。**

—— 原则 #10 在样式层的最终表述。
