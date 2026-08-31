# 06 选择器级联的编译期固化

> **核心洞察**：选择器的「级联」语义五端根本无法统一——Skyline 不支持 `*[attr]`，原生端根本没有选择器概念。
> Proteus 解法：**样式只允许 `.class` + 组件 scope，禁止元素/属性/深层后代选择器，由 Compiler 构建期算好级联，运行期不下发选择器。**

## 一、为何级联无法跨端统一

| 端 | 选择器能力 |
|----|-----------|
| Web | 完整 CSSOM，运行时匹配 |
| Skyline | 仅 class + 有限伪类，无 `* / [attr]` |
| iOS / Android / 鸿蒙 | **无 CSS 选择器概念**（原生属性赋值） |

若在运行期实现完整级联 = 在原生端自研迷你 CSSOM，**违背原则 #10（不自研 CSS 引擎）**。

## 二、允许的选择器

✅ `.class`
✅ 组件 scope（SFC `<style scoped>`）
✅ 伪类白名单：`:active / :hover / :focus / :disabled / :first-child / :last-child`
✅ 一级组合：`.parent > .child`、`.parent .child`（仅 2 级）

## 三、禁止的选择器（CSS003-007）

❌ `*` 通用选择器
❌ `[attr]` / `[attr=value]` 属性选择器
❌ 元素选择器 `div {}` `span {}`
❌ 深层后代组合 `.a .b .c`（>2 级）
❌ 依赖跨父级 stacking context 的 `z-index`

## 四、编译期展开示例

```css
/* 输入 SFC */
<p-glass class="card primary" />

<style scoped>
.card      { color: blue;  padding: 8px; }
.card.primary { color: red; }
</style>

/* Compiler 构建期算出版本（伪 IR） */
{
  component: 'p-glass',
  scoped: true,
  variants: {
    default:  { color: 'blue',  padding: '8px' },
    primary:  { color: 'red' },   // 合并 .card + .card.primary
  }
}
```

运行期 Renderer：`variantFor(props) → 扁平样式对象 → 下发原生属性`。
**零选择器匹配开销。**

## 五、`:nth-child` 等伪类处理

- `:first-child / :last-child / :only-child` → Renderer patch 时按 index 展开为状态类（构建期生成对应变体）
- `:nth-child(an+b)` 复杂表达式 → 仅 Web/Skyline 支持，原生端需在 Renderer 用 index 逻辑模拟 → **默认 warn（CSS010），建议改显式 prop**

## 六、级联的「设计代价」与收益

**代价**：开发者不能写任意 CSS 级联，需遵循 class + 语义组件范式。
**收益**：
1. 五端样式行为一致（无"原生端表现不一"）
2. 样式摇树彻底（未用 class 不进产物）
3. 运行时零 CSSOM 开销 → 启动更快、内存更低（呼应 Memory plan）
4. DevTools 可追溯每个样式值的来源（编译透明）

## 七、迁移指南（从 Web 项目）

| Web 写法 | Proteus 写法 |
|----------|-------------|
| `div.card > span.title` | `<p-view class="card"><p-text class="title" /></p-view>` + class |
| `.list [data-active]` | `<p-list :active="true">` + class 绑定 |
| `*:focus` | 组件内 `:focus` 处理 |
| `.a .b .c .d` 深层嵌套 | 提取语义组件，prop 驱动 |

→ 大多数 Vue SFC（本来就用 class + scoped）**几乎零改动**即可迁移。
