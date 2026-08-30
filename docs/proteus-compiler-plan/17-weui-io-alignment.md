# 微信视觉像素级对齐方法论（weui-io-alignment）

> 状态：✅ 已沉淀（2026-08-30）
> 适用范围：@proteus-vue/web 小程序语义 Web 模拟层的**视觉对齐**（wx.showToast/showModal/showActionSheet + 组件默认样式）
> 目标：Web 端 UI 与微信小程序/WeUI 视觉**像素级一致**——不靠"目测差不多"，靠"官方实测数值 + CDP 断言"

## 一、为什么需要这套方法论

Web 模拟层的样式"看起来像"微信 ≠ "像素级等于"微信。用户逐组件验收过程中发现大量细节偏差：
- modal 宽度/按钮色/字重/padding 全不对（300px→320px、绿→蓝、600→500…）
- toast 图标底色/尺寸/间距不对（绿圆→无底色白勾、40px、16px 间距…）
- 分割线粗细不对（1px 实线 → hairline scale 0.5）

根因：**凭印象写 CSS**。修正手段：**以官方实现为准（weui.io 实机预览 + CDP 抓取），逐项对比、逐项修正、逐项断言**。

## 二、权威参考源

| 源 | 用途 | 说明 |
|---|---|---|
| https://weui.io/#toast | toast 视觉 | 微信官方设计团队网页版实现，与小程序视觉一致 |
| https://weui.io/#dialog | modal 视觉 | 同上（iOS 风格对话框） |
| https://weui.io/#actionsheet | actionSheet 视觉 | 同上 |
| https://developers.weixin.qq.com/miniprogram/design/ | 设计规范 | 色阶/字号/间距体系（主色 #07c160、LINK #576b95、FG-0/1/2/3…） |
| 微信开发者工具 + 真机 | 最终验收 | 用户实测为准（如 toast 居中 vs weui.io top:40% 以真机为准） |

**优先级**：用户真机实测 > weui.io 官方实测 > 设计规范文档。

## 三、核心流程（5 步）

### Step 1：CDP 抓取官方实现（数值说话）

用 Playwright 打开 weui.io 对应页面，抓三类数据：
1. **DOM 结构**（`.weui-toast`/`.weui-dialog`/`.weui-actionsheet` 的 outerHTML——类名、层级、文案）
2. **官方 CSS 规则**（`document.styleSheets` 里 `.weui-xxx` 的 cssText——padding/font-size/color/line-height…）
3. **CSS 变量值**（`--weui-FG-0: rgba(0,0,0,.9)`、`--weui-BG-4: #4c4c4c`、`--weui-LINK: #576b95`、`--weui-DIALOG-LINE-COLOR: rgba(0,0,0,.1)`…——写死色值前先查变量）

```js
// 抓 CSS 规则 + 变量
const all = [...document.styleSheets].map((s) => {
  try { return [...s.cssRules].map((r) => r.cssText).join('\n') } catch { return '' }
}).join('\n')
const grab = (sel) => all.slice(all.indexOf(sel), all.indexOf('}', all.indexOf(sel)) + 1)
```

**注意**：weui.io 的 demo 组件默认隐藏（display:none/宽高 0）——抓样式用 CSS 规则，抓渲染尺寸需先强制显示（`el.style.display='flex'` 移到 body 末尾再量）。

### Step 2：diff 差异清单

把官方数值与 packages/web/src/style.css 当前值逐项对比，产出差异表（如"padding 16px 24px → 28px 20px"）。**不要只改看到的项**——把整个组件所有属性列出来逐项核对（padding/字号/字重/颜色/行高/圆角/分割线/间距/位置/按压态）。

### Step 3：修正 CSS（对齐 WeUI 语义）

- 颜色：优先映射 WeUI 变量（FG-0/1/3、BG-4、LINK、DIALOG-LINE-COLOR、RED）而非写死近似色
- **hairline 分割线**（微信特色：1px 视觉线 = 1px + scale(0.5)）：
  ```css
  .x::before {
    content: ' ';
    position: absolute; left: 0; right: 0; top: 0; height: 1px;
    border-top: 1px solid rgba(0, 0, 0, 0.1);
    transform: scaleY(0.5); transform-origin: 0 0;
  }
  ```
- 首项无线规则（`first-child::after/before { display: none }`）
- 按压态（`:active` background --weui-BG-COLOR-ACTIVE: #ececec）
- 保留用户真机实测结论（如 modal 宽度 320px 固定 + max-width 90vw 兜底，即使 weui.io 是 left/right 16px——用户真机优先）

### Step 4：CDP 复测断言（构建后）

`npm --prefix packages/web run build && npm run build:web` 后打开本地 preview，断言 computed style 与官方一致：

```js
// 断言示例（scripts/cdp-modal-check.mjs）
{
  title: { padding, fontSize, fontWeight, color },
  content: { padding, marginBottom, fontSize, color },
  btn: { height, fontSize, fontWeight, color },
  divider: getComputedStyle(el, '::before').borderTopColor + ' ' + transform,
}
```

像素级断言要点：
- padding/margin/fontSize/fontWeight/lineHeight/color 全部断言（不只肉眼可见项）
- 高度用 `getBoundingClientRect().height`（如按钮 64px、cell 56px、toast 132×132）
- 伪元素（::before/::after hairline）用 `getComputedStyle(el, '::before')`
- **视口适配**：320/375/414/430 四档视口各测一遍（固定宽度 vs 等比缩放）

### Step 5：全量测试 + 提交

- 单元测试（jsdom）断言**结构/类名/内联样式**（jsdom 读不到外部 CSS，样式断言靠 CDP）
- `npm run verify`（测试 + build:web + build:mp + workspaces）全绿
- commit message 记录：官方实测数值 + 每项 diff（before→after）+ CDP 断言结果 + 测试数

## 四、关键经验（Pitfalls）

| 坑 | 现象 | 解法 |
|---|---|---|
| jsdom 读不到外部 CSS | getComputedStyle(padding) 返回空 | jsdom 只断言结构/类名/内联 style，视觉断言全走 CDP |
| weui.io demo 默认隐藏 | 元素宽高 0 | 先强制显示（移到 body + display:flex + opacity:1）再量 |
| mask SVG 无法 canvas 采样 | 图标像素拿不到 | 用 mask 的 SVG path 画到 canvas 采样；或解析 path 几何（挖空 subpath → 叹号） |
| 布尔属性 | `show-info` 在 attrs 是空字符串 kebab 键 | `attrs['show-info'] ?? attrs.showInfo` 双查 |
| CSS 类名冲突 | 共享 `.pws-thumb` 误伤 switch/slider | 类名按组件分离（.pws-thumb switch / .pws-slider-thumb slider） |
| 固定宽度被 max-width 截断 | width 320 实量 300 | `max-width: 90vw` 在 375 下 = 300px——小屏兜底需留余量 |
| width:max-content 撑大方形 | 图标态 toast 被长文字撑到 203px | 图标态固定 width/height（132px），文字内部换行 |
| :active 压感丢失 | 无按压反馈 | 加 `:active { background: #ececec }` |
| 用户真机 ≠ weui.io | toast 居中 vs top:40% | 用户真机实测优先（记录在 style.css 注释） |

## 五、验证清单（组件 × 指标）

| 指标 | 组件 | 官方值（2026-08-30 实测） |
|---|---|---|
| toast 尺寸 | 图标态 132×132 方形；纯文字短 96×44（12px 20px）；长文字 max 320 | padding 28px 20px / 12px 20px |
| toast 视觉 | bg #4c4c4c、圆角 8px、文字 rgba(255,255,255,0.9)、图标 40px + margin-bottom 16px、位置居中（真机） | 图标 success 无底色白勾 / error 白圆黑叹号 / loading spinner |
| modal | 宽 320px + max-width 90vw、圆角 12px | 标题 32px 24px 16px / 17px / 500 / FG-0；内容 0 24px + mb 32px / FG-1；按钮 20px 8px / 500 / LINK(#576b95)；hairline rgba(0,0,0,0.1)；无标题内容 32px 24px 0 + FG-0 |
| actionSheet | cell 16px 16px / 17px / 1.41176 / 56px / FG-0；hairline 首项无；:active #ececec；取消 margin-top 8px | bg #f7f7f7 / cell #fff |

## 六、后续复用

- 新组件视觉对齐（picker/swiper/checkbox/radio/loading…）：按本方法论五步走
- scripts/cdp-*.mjs 是现成断言脚本（cdp-style-check / cdp-modal-check），新组件照抄扩展
- 组件验收时用户反馈差异 → 先查官方数值（本清单或 weui.io）→ 改 → CDP 断言 → verify → 提交
