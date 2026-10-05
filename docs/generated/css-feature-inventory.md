# CSS Web 全量能力清单（自动生成——勿手改；生成器 scripts/gen-css-feature-inventory.mjs）

> 总 949 项（property 651 · selector 144 · at-rule 19 · function 105 · unit 30）
> 实现：**not-started** 555 · **excluded** 280 · **implemented** 108 · **partial** 6
> 优先级：P2 115 · excluded 280 · P0 29 · done 108 · P1 417
> ★**可推项（非已实现/非排除）**：561（其中 **P0 29**）

## P0 —— 语料在用但未实现（真实需求，最优先）

| 属性 | MDN 状态 | 分组 | 语料用量 | 实现 | 说明 |
|---|---|---|---|---|---|
| `-webkit-line-clamp` | standard | WebKit Extensions, CSS Overflow | 4 | not-started | — |
| `background-image` | standard | CSS Backgrounds and Borders | 2 | partial | 有结构化属性通道（非 CSS 属性形态）——CSS 写法待接 |
| `background-position` | standard | CSS Backgrounds and Borders | 4 | not-started | 未接：位置需背景图/渐变定位语义（证据：未接（待评）） |
| `background-size` | standard | CSS Backgrounds and Borders | 2 | not-started | 未接：尺寸需背景图语义（证据：未接（待评）） |
| `container-type` | standard | CSS Conditional Rules | 1 | not-started | — |
| `grid-auto-columns` | standard | CSS Grid Layout | 1 | not-started | — |
| `grid-auto-flow` | standard | CSS Grid Layout | 3 | not-started | 未接：自动流（证据：未接） |
| `grid-auto-rows` | standard | CSS Grid Layout | 1 | not-started | — |
| `grid-template-areas` | standard | CSS Grid Layout | 2 | not-started | 未接：命名区域（证据：未接（CSE 支持 template-columns/rows；areas 未接）） |
| `justify-self` | standard | CSS Box Alignment | 9 | not-started | — |
| `object-fit` | standard | CSS Images | 3 | not-started | 未接：图片填充方式（证据：未接（图片组件通道）） |
| `outline` | standard | CSS Basic User Interface | 2 | not-started | — |
| `outline-offset` | standard | CSS Basic User Interface | 3 | not-started | 未接：轮廓（证据：未接） |
| `overflow-x` | standard | CSS Overflow | 10 | partial | **简写展开**：overflow——单轴 overflow（x/y 同值才可表达为 overflow——CSE 合并）（证据：CSE shorthand.ts（overflow 分支）） |
| `overflow-y` | standard | CSS Overflow | 10 | partial | **简写展开**：overflow——同上（证据：同上） |
| `overscroll-behavior-y` | standard | CSS Overscroll Behavior | 1 | not-started | — |
| `place-items` | standard | CSS Box Alignment | 1 | not-started | — |
| `text-shadow` | standard | CSS Text Decoration | 2 | not-started | 未接：文本阴影（证据：未接） |
| `transition-property` | standard | CSS Transitions | 1 | not-started | — |
| `transition-timing-function` | standard | CSS Transitions | 1 | not-started | — |
| `will-change` | standard | CSS Will Change | 1 | not-started | — |
| `word-break` | standard | CSS Text | 7 | not-started | 未接：断词（证据：未接） |

## P1 —— 标准且常用分组（未实现）

| 属性 | 分组 | 实现 |
|---|---|---|
| `animation-composition` | CSS Animations | not-started |
| `animation-direction` | CSS Animations | not-started |
| `animation-fill-mode` | CSS Animations | not-started |
| `animation-play-state` | CSS Animations | not-started |
| `animation-trigger` | CSS Animations | not-started |
| `appearance` | CSS Basic User Interface | not-started |
| `backface-visibility` | CSS Transforms | not-started |
| `background-attachment` | CSS Backgrounds and Borders | not-started |
| `background-clip` | CSS Backgrounds and Borders | not-started |
| `background-origin` | CSS Backgrounds and Borders | not-started |
| `background-position-x` | CSS Backgrounds and Borders | not-started |
| `background-position-y` | CSS Backgrounds and Borders | not-started |
| `background-repeat` | CSS Backgrounds and Borders | not-started |
| `border-end-end-radius` | CSS Logical Properties and Values | not-started |
| `border-end-start-radius` | CSS Logical Properties and Values | not-started |
| `border-image` | CSS Backgrounds and Borders | not-started |
| `border-image-outset` | CSS Backgrounds and Borders | not-started |
| `border-image-repeat` | CSS Backgrounds and Borders | not-started |
| `border-image-slice` | CSS Backgrounds and Borders | not-started |
| `border-image-source` | CSS Backgrounds and Borders | not-started |
| `border-image-width` | CSS Backgrounds and Borders | not-started |
| `border-start-end-radius` | CSS Logical Properties and Values | not-started |
| `border-start-start-radius` | CSS Logical Properties and Values | not-started |
| `caret` | CSS Basic User Interface | not-started |
| `caret-animation` | CSS Basic User Interface | not-started |
| `caret-shape` | CSS Basic User Interface | not-started |
| `corner-bottom-shape` | CSS Backgrounds and Borders | not-started |
| `corner-bottom-left-shape` | CSS Backgrounds and Borders | not-started |
| `corner-bottom-right-shape` | CSS Backgrounds and Borders | not-started |
| `corner-end-end-shape` | CSS Backgrounds and Borders | not-started |
| `corner-end-start-shape` | CSS Backgrounds and Borders | not-started |
| `corner-left-shape` | CSS Backgrounds and Borders | not-started |
| `corner-right-shape` | CSS Backgrounds and Borders | not-started |
| `corner-shape` | CSS Backgrounds and Borders | not-started |
| `corner-start-start-shape` | CSS Backgrounds and Borders | not-started |
| `corner-start-end-shape` | CSS Backgrounds and Borders | not-started |
| `corner-top-shape` | CSS Backgrounds and Borders | not-started |
| `corner-top-left-shape` | CSS Backgrounds and Borders | not-started |
| `corner-top-right-shape` | CSS Backgrounds and Borders | not-started |
| `font` | CSS Fonts | not-started |
| `font-language-override` | CSS Fonts | not-started |
| `font-optical-sizing` | CSS Fonts | not-started |
| `font-palette` | CSS Fonts | not-started |
| `font-size-adjust` | CSS Fonts | not-started |
| `font-style` | CSS Fonts | not-started |
| `font-synthesis` | CSS Fonts | not-started |
| `font-synthesis-small-caps` | CSS Fonts | not-started |
| `font-synthesis-style` | CSS Fonts | not-started |
| `font-synthesis-weight` | CSS Fonts | not-started |
| `font-variant` | CSS Fonts | not-started |
| `font-variant-alternates` | CSS Fonts | not-started |
| `font-variant-caps` | CSS Fonts | not-started |
| `font-variant-east-asian` | CSS Fonts | not-started |
| `font-variant-numeric` | CSS Fonts | not-started |
| `font-variant-position` | CSS Fonts | not-started |
| `font-variation-settings` | CSS Fonts | not-started |
| `grid` | CSS Grid Layout | not-started |
| `grid-column-end` | CSS Grid Layout | not-started |
| `grid-column-start` | CSS Grid Layout | not-started |
| `grid-row-end` | CSS Grid Layout | not-started |
| `grid-row-start` | CSS Grid Layout | not-started |
| `grid-template` | CSS Grid Layout | not-started |
| `hanging-punctuation` | CSS Text | not-started |
| `hyphenate-character` | CSS Text | not-started |
| `hyphenate-limit-chars` | CSS Text | not-started |
| `image-orientation` | CSS Images | not-started |
| `interactivity` | CSS Basic User Interface | not-started |
| `interest-delay` | CSS Basic User Interface | not-started |
| `interest-delay-end` | CSS Basic User Interface | not-started |
| `interest-delay-start` | CSS Basic User Interface | not-started |
| `justify-items` | CSS Box Alignment | not-started |
| `line-break` | CSS Text | not-started |
| `line-clamp` | CSS Overflow | not-started |
| `object-position` | CSS Images | not-started |
| `order` | CSS Display | not-started |
| `outline-color` | CSS Basic User Interface | not-started |
| `outline-style` | CSS Basic User Interface | not-started |
| `outline-width` | CSS Basic User Interface | not-started |
| `overflow-clip-margin` | CSS Overflow | not-started |
| `overflow-wrap` | CSS Text | not-started |

（P2 与 excluded 全量见 JSON；本 MD 只列推进面）
