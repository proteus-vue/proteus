---
title: Skyline 渲染约束与组件写法（真机实证）
order: 22
group: 渲染与能力
---

# Skyline 渲染约束与组件写法（真机实证）

> 本页约束来自 2026-09-07 弹层族 Skyline 真机/模拟器回归的逐条实证（配套框架内台账与产物契约
> 测试 P7/P8 已锁定）。**目标是让「自研/生态 p-* 组件」一次写对：先看本页，再写浮层。**
> 核心主张：**结构决定命运——弹层内容必须待在「可靠渲染层」里，用静态字面量表达可变形态。**

## 1. 浮层事件：遮罩/纯背景元素不参与命中

Skyline 下自定义组件内的**纯背景/无内容子节点不参与命中测试**（视觉在、事件落不到它身上）。
把「点击关闭」绑在遮罩元素上 = 点不透。

**写**：关闭事件挂 **fixed 全屏容器 / 常驻 overlay**；遮罩只做视觉层。

```html
<view class="overlay" :class="{ on: open }" @click="close">  <!-- 事件在可靠层 -->
  <view class="mask" />                                        <!-- 纯视觉 -->
  <view class="panel" @click.stop="noop">…</view>              <!-- 面板吞自身冒泡 -->
</view>
```

## 2. 可变形态类：只用静态字面量，禁动态拼接

- **动态 class/style 在 Skyline 不可靠**（p-popup 定位左上角、动画丢失均由此）。
- 编译器对**模板内拼接类字面量**插 scope 后缀会**插到半截**：`'x--' + phase` → 产物
  `---data-v-xxx` 畸形类，**永不命中任何规则**。

**写**：同一元素按取值拆成**静态字面量分支**（每个分支类名完整、scoped 必命中）：

```html
<view v-if="pos === 'bottom'" class="panel panel--bottom">…</view>
<view v-else-if="pos === 'top'"    class="panel panel--top">…</view>
<view v-else                       class="panel panel--center">…</view>
```

纯运行时追加类（如动画 phase）用 **computed 产出裸类名**（模板不含类字面量 → 不插后缀），
配 `<style global>` 规则命中。

## 3. `inset` 简写不可用

Skyline 不认 `inset: 0`，尺寸塌成 0（背景在却看不见 → 「遮罩透明」假象）。

**写**：显式四边 `top/left/right/bottom: 0`。

## 4. 弹层内容：弃 `wx:if` 子树，用常驻挂载 + visibility

glass-easel 下 `wx:if` 动态挂载的浮层子树**可能整棵不渲染**（多轮实证）。

**写**：浮层**常驻挂载**，开合改容器类切 `visibility`（关闭态隐藏不拦截；可加方向性
`transition: visibility` 保留进出显隐）：

```css
.overlay { visibility: hidden; transition: visibility 0s linear .25s; }
.overlay.on { visibility: visible; transition: visibility 0s linear 0s; }
```

## 5. `root-portal`：脱离即失锚，慎用

官方 `<root-portal>`（子树脱离页面，类 fixed，专用于弹窗）可渲染，但**脱离树破坏锚定**——
absolute 面板落左上角。锚定型浮层（如 popover）**别用 portal**；若需最顶层，用
「rect 测量 + fixed 坐标」路线（另见 §7）。

> 附带：Skyline 项目**组件 json 需 `componentFramework: glass-easel`**（框架生成器已自动补；
> 只给页面加会导致组件内悬浮/portal 全部失效）。

## 6. 层叠：非 fixed 根子树按 DOM 序绘制

Skyline 层叠规则：**fixed 节点整体上浮**，其余（含 absolute 面板、z-index）**按 DOM 序**绘制。
因此锚定浮层的面板可能被**其后**的页面内容盖住（z-index 无法逃出 glass-easel 绘制序；
layer 因 fixed 上浮不受影响——点外关闭始终可用）。

**写**：fixed 全屏容器内含面板（drawer/modal/popup/action-sheet 模式）最稳；
锚定浮层避免紧跟重叠内容，或走 §7 坐标路线。

## 7. 确需动态坐标时的路线（P2）

组件内 `createSelectorQuery` 测 trigger rect → 面板 `position: fixed` + 像素坐标（面板随 fixed
上浮到最顶层）。涉及平台测量 API，按框架平台 API 审计引入。

## 8. 安全区：`env()` 不可用，用 `p-safe`（运行时读数）

**`env(safe-area-inset-*)` 在 Skyline 下不受支持**——含 `env()` 的整条 CSS 声明被**丢弃**
（连 `max(env(...), Npx)` 兜底写法也无效）。因为框架 app 是 `navigationStyle: custom`（无原生
导航栏），页面须自行避让状态栏 + 右上角胶囊按钮，否则**标题/内容被遮挡**。

**写**：页面顶部放 `<p-safe area="top" :fallback="50" />`。`p-safe` 在 MP 端读运行时实测值
（`getWindowInfo().statusBarHeight` + `getMenuButtonBoundingClientRect().bottom` 胶囊下沿）→ 内联 px；
Web 端仍走 `env()`。

```html
<view class="page">
  <p-safe area="top" :fallback="50" />
  <text class="title">…</text>
</view>
```

> 取**胶囊下沿**（而非仅状态栏高度）：否则内容与胶囊按钮**并列**（不重叠但难看）。

## 9. 内联事件参数：小数/负数/字符串都可（但成员访问不可）

小程序事件处理器**不能是带参调用**，编译器会把 `@tap="fn(1)"` 包装成 `proteusInlineFn1` 方法。
参数支持**裸标识符 / 字面量**（数字含小数与负数 `0.4`/`-1`、字符串、`true/false/null`）。

**不可校准 → 静默失效**的形态：**成员访问参数**（`fn(item.id)`）——会被原样输出
`bindtap="fn(item.id)"`（小程序**非法事件处理器**，点击无反应），编译期有警告。此时改用
无参方法或把值放到 data。

> ⚠️ 整数参数合法会**掩盖**参数类型问题——早期白名单漏了小数/负数，`setSpeed(0.4)` 静默失效，
> 而 `setSpeed(1)` 正常。已修（小数/负数/字符串均可）。

## 10. 回归自检

改完浮层/形态类，框架内跑**产物契约探针（P7/P8）** + Skyline 真机门禁再合入——大多数
「假象问题」（陈旧 IDE 产物等）先重编译/重启工具排除，再动代码。
