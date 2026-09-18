# weui 组件规范参考（自绘内置组件的视觉基准）

> **定位**：Proteus `p-*` 内置组件**自绘**（统一视觉语言），其视觉基准 = **微信 weui 官方规范**。
> 本文件把**基础库 `app.asar` 里提取的权威规格**集中记录，供新增/修改自绘组件时对照。
> **提取方法**：`grep -ao 'wx-checkbox .wx-checkbox-input{[^}]*}' <微信开发者工具>/Contents/Resources/app.asar`
> **关联**：`docs/skyline-pitfalls.md`（渲染陷阱）· `docs/proteus-end-alignment-plan/`（属性对齐）

---

## 0. ★吸收原则（2026-09-13 用户评审定案——本条优先于下文全部具体规格）

**weui 是「参考」，不是「教条」**：

1. **吸收正确的（现代）设计**——weui 里符合当代交互/视觉规范的部分（如半屏弹层选择器：× 关闭 + 居中标题 + 灰色 indicator + 底部主按钮）**直接采纳**。
2. **不照搬陈旧 / 非现代设计**——weui 里属于历史包袱或过时形态的部分（如某些平台的「取消/确定」顶栏式选择器、原生 `switch type=checkbox` 等）**不必对齐**，可按现代规范自绘。
3. **判定依据是「设计是否现代/正确」，不是「是否出自 weui」**：某个形态该不该吸收，看它是不是好设计；**不能因为「官方如此」就无条件固化**（与 G-31「禁止把平台私有形态上升为框架标准」一致）。
4. **⚠ 反例（我的真实误判）**：曾把「对齐原生 picker」理解为照搬原生「取消/确定」顶栏，**改坏了已按 weui 现代形态实现的 WebPicker**——错因是**缺失本条原则**（把原生形态当成了必须服从的基准）。正确做法：**Web 与小程序两端都应是同一套现代规范形态**；小程序原生 `<picker>` 仅在无法自绘时才回退。

> **一句话**：**好设计就吸收，陈旧的就不要**——两端产出一致的现代规范体验，而不是照抄某个平台的历史形态。

---

## 1. checkbox（`wx-checkbox`）

```css
wx-checkbox .wx-checkbox-input {
  background-color: #fff;
  border: 1px solid #d1d1d1;
  border-radius: 3px;
  height: 22px;
  width: 22px;
  margin-right: 5px;
}
/* 选中：白底 + 绿勾（★不是绿底白勾——常见误解） */
wx-checkbox .wx-checkbox-input.wx-checkbox-input-checked .wx-checkbox-icon { color: #09bb07; display: flex; }
wx-checkbox .wx-checkbox-input.wx-checkbox-input-disabled { background-color: #e1e1e1; }
```

| 项 | 值 |
|---|---|
| 尺寸 | **22 × 22** |
| 圆角 | 3px |
| 边框 | 1px solid #d1d1d1 |
| 选中态 | **白底 + 绿勾**（勾色 #09bb07 / 品牌绿 #07c160） |
| 禁用 | 底 #e1e1e1、勾 #adadad |

## 2. radio（`wx-radio`）

```css
wx-radio .wx-radio-input {
  background-color: #fff;
  border: 1px solid #d1d1d1;
  border-radius: 50%;
  height: 22px;
  width: 22px;
}
/* 选中：绿底填充 + 白点 */
wx-radio .wx-radio-input.wx-radio-input-checked { background-color: #09bb07; border-color: #09bb07; }
wx-radio .wx-radio-input.wx-radio-input-checked .wx-radio-icon { color: #fff; display: flex; }
wx-radio .wx-radio-input.wx-radio-input-disabled { background-color: #e1e1e1; border-color: #d1d1d1; }
```

| 项 | 值 |
|---|---|
| 尺寸 | **22 × 22**（圆形 `border-radius: 50%`） |
| 边框 | 1px solid #d1d1d1 |
| 选中态 | **绿底填充 + 白点**（★与 checkbox 相反：一个填充、一个描边） |
| 禁用 | 底 #e1e1e1、边 #d1d1d1 |

## 3. switch（`wx-switch`）

```css
wx-switch .wx-switch-input { background-color: rgba(0,0,0,.1); border-color: transparent; border-width: 2px; }
wx-switch .wx-switch-input:after { box-shadow: 0 2px 3px rgba(0,0,0,.06); height: 28px; width: 28px; }
wx-switch .wx-switch-input.wx-switch-input-checked { background-color: #07c160; border-color: #07c160; }
wx-switch .wx-switch-input.wx-switch-input-disabled { opacity: .3; }
/* type=checkbox 形态：内部换用 wx-checkbox-input（22px 小方框） */
```

| 项 | 值 |
|---|---|
| 轨道 | 52 × 32（`border-radius: 16px`） |
| 关闭底 | **rgba(0,0,0,.1)**，边框 transparent |
| 打开底 | #07c160 |
| 滑块 | 28 × 28，阴影 `0 2px 3px rgba(0,0,0,.06)` |
| 禁用 | **opacity: .3** |

## 4. button（`wx-button`）

```css
wx-button { border-radius: 4px; font-size: 17px; font-weight: 700; line-height: 1.41176471; padding: 8px 24px; }
wx-button:not([size=mini]) { margin-left: auto; margin-right: auto; width: 184px; }
wx-button[type=primary] { background-color: #07c160; }
wx-button[type=default] { background-color: #f2f2f2; color: #06ae56; }
wx-button[type=default][plain] { background-color: transparent; border: 1px solid #353535; color: #353535; }
wx-button[size=mini] { font-size: 16px; line-height: 2; padding: 0 .75em; width: auto; }
/* 按下态：保留色相、压暗一档 */
.button-hover { background-color: #dedede; }
.button-hover[type=primary] { background-color: #179b16; }
```

## 5. picker（weui-picker）

```css
.weui-picker { position:fixed; left:0; bottom:0; width:100%; z-index:5000; background:#fff;
  padding-bottom: env(safe-area-inset-bottom); }
.weui-picker__hd { display:flex; padding:16px; font-size:17px; line-height:1.4; }  /* 底部 1px 细线 */
.weui-picker__bd { display:flex; height:240px; overflow:hidden; background:#fff; }
.weui-picker__group { flex:1; height:100%; }
.weui-picker__item { height:48px; line-height:48px; text-align:center; color:rgba(0,0,0,.9); }
.weui-picker__indicator { height:56px; top:92px; }            /* 上下 1px 指示线 */
.weui-picker__mask { background:linear-gradient(...); background-size:100% 92px; }  /* 上下渐隐 */
```

| 项 | 值 |
|---|---|
| 面板 | fixed bottom / 白底 / z-index 5000 / safe-area 底 padding |
| 头部 | padding 16px / font-size 17px / **底部 1px 细线** |
| 选择区 | **height 240px** |
| 选项 | **height 48px** / 居中 / `rgba(0,0,0,.9)` |
| 视线区 | indicator 56px @ top 92px；**上下各 1px 细线**（`__before/__after`，非灰底块）；mask 上下 92px 渐隐 |
| 居中技巧 | 上下留白 **96px = (240-48)/2**（选中项视觉居中） |
| 底部按钮 | `__ft` padding **0 24px 32px**；双按钮 **inline-block 120px / margin 0 8px** |
| 顶栏动作 | `__action`：`:first-child` 取消（左）/ `:last-child` 确定（右，BRAND 色）——weui 的 hd 动作位 |

> **★两端统一（2026-09-13 定案）**：`<p-picker>` 的 **Web 与小程序用同一套 weui 半屏形态**——
> Web 走 `WebPicker`（半屏弹层），小程序**自绘同一半屏外壳 + 原生 `<picker-view>` 滚轮**（`__WEB__` 宏分叉）。
> **不采用**原生 `<picker>` 的「取消/确定」顶栏形态（陈旧/非现代，见 §0 吸收原则）。

## 6. 通用约定（本仓库自绘组件遵循）

| 约定 | 说明 |
|---|---|
| 品牌绿 | **#07c160**（weui 新版）；基础库部分旧规则用 **#09bb07**（checkbox/radio 勾选色） |
| 禁用灰 | 底 **#e1e1e1** / 文字 `rgba(0,0,0,.3)` |
| 默认边框 | **#d1d1d1** |
| 禁用的两种表达 | 组件包装层**淡化**（p-switch/p-checkbox/p-radio 用 0.5，两端一致可辨）；weui 原生用 opacity .3（switch）或换底色 |
| **避免单边异色 border** | `border-top-color` 等 + `border-radius` 在 Skyline 下**圆角失效**（见 skyline-pitfalls S2）→ 统一色 |
| 尺寸优先 px | Skyline 对 `calc()` 百分比/`flex:1` 支持有限（S25/S31）→ 关键尺寸写 px |
| **组件事件载荷 = 裸值** | `emit('change', payload)` → MP `triggerEvent` → 页面 `e.detail = payload`；**勿再包 `{ detail }`**（会双层 → 页面读不到，见 skyline-pitfalls S37）；页面侧用 `e?.detail ?? e` 跨端通吃 |
| 模板内禁函数调用 | WXML 表达式不支持函数调用 → 用 **computed**（S38） |
