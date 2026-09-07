# 03 编译期重写

> 对 ⚠️ 级别语法，**Compiler 在构建期求值/转换**，产物不含原始表达式——运行期不下发平台 calc，不下发选择器。

## 一、重写清单

### 1. `calc()` → 约束

**问题**：ArkUI CAPI 早期不支持 calc/百分比（Taro 鸿蒙因此引入 Yoga）。
**解法**：Compiler 在 IR 生成阶段把 calc 求值或映射为各端等效布局约束。

```css
/* 输入 */
.card { width: calc(100% - 32px); }

/* IR 输出（伪码） */
{ type: 'flex-item', width: '100%', margin: { horizontal: 16 } }
```

- 百分比：直接下发（五端均支持）
- `calc(a - b)`：拆分为 `width:100% + margin/padding` 等效表达
- 无法拆分的复杂 calc：构建期**数值求值**（需已知容器尺寸，否则报错提示用 `p-*` 语义组件）

### 2. `vh` / `vw` → safe-area 语义

**问题**：`vh` 在微信/鸿蒙键盘弹出时不收缩，导致输入框被遮挡。
**解法**：引入语义指令，编译期替换。

```css
/* 输入 */
.page { height: 100vh; }

/* 输出：Web → 100vh；Skyline/iOS/Android/鸿蒙 → safe area 约束 */
{ type: 'page', height: 'fill-safe' }   // p-h-safe
```

可用语义：`p-h-safe` / `p-w-safe` / `env(keyboard-inset)` / `env(status-bar)`

### 3. 颜色：`rgba()` → ARGB（鸿蒙）

**问题**：鸿蒙 shadow/渐变吃 ARGB 十六进制，不吃 `rgba()`。
**解法**：Compiler 的 color 模块统一用 **#RRGGBBAA** 内部表示，
按端下发对应格式。

```ts
// Compiler color transform
function toNative(color: Color, platform: Platform) {
  if (platform === 'harmony' || platform === 'android-shadow')
    return color.toARGB()   // #RRGGBBAA
  return color.toCSS()      // rgba() / #rrggbb
}
```

### 4. 选择器级联 → 构建期展开

**核心洞察**：选择器的"级联"语义五端根本无法统一（Skyline 不支持 `*[attr]`，原生端无选择器概念）。
**解法**：只允许 `.class` + 组件 scope，**Compiler 构建期算出最终声明值**，运行期直接下发扁平样式。

```css
/* 输入 */
.btn { color: blue; }
.btn.primary { color: red; }

/* 编译产物（伪码）：按组件/变体预合并 */
{ component: 'p-button', variants: { default: {color:'blue'}, primary:{color:'red'} } }
```

运行期 Renderer 只做「取对应变体样式 → 下发原生属性」，**无选择器匹配开销**。

## 二、为何不在运行期处理

- **性能**：原生端无 CSS 引擎，运行期做 calc/级联 = 自研迷你 CSSOM，违背原则 #10
- **可预测**：编译期报错比运行期各端表现不一更易调试
- **摇树**：构建期确定样式 → 未用样式不进产物 → 体积更小

## 三、产物验证

`proteus compile --css-compat-report` 输出：

```json
{
  "rewritten": { "calc": 12, "vh": 3, "rgba-to-argb": 7 },
  "semanticComponents": { "p-glass": 5, "p-sticky": 2 },
  "forbidden": { "float": 0, "universalSelector": 0 },
  "bundleCssBytes": 4200
}
```

对接 DevTools「编译透明」面板，与 `--trace-transform` 同源。

## 四、边界声明

以下**不做自动重写**，一律报错（`--strict-css`）：
- `calc()` 含未知变量 / 运行时尺寸
- `@media` 自定义复杂查询（仅白名单：`dark` + 断点预设）
- `:has()` / `:not()` 复杂组合

→ 统一引导使用 `p-dark` / `p-breakpoint` / 语义组件。
