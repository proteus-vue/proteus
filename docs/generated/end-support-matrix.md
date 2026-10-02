# 端支持度矩阵（CSS Profile 属性 × Web / Skyline / WebView）

> ★自动生成（`node scripts/gen-end-support-matrix.mjs`），勿手改。漂移门禁：`--check`。
> 任务卡：`docs/Proteus_一致性校验任务卡清单.md` VC1-a / VC1-b / VC1-c。

## 证据来源（provenance）

| 列 | 采集方式 | 来源 | 采集日 |
|---|---|---|---|
| Web | Chromium CSS.supports（Playwright 151.0.7922.34） | 本机实测 | 2026-10-02 |
| Skyline | 官方《Skyline WXSS 样式支持与差异》解析 | https://developers.weixin.qq.com/miniprogram/dev/framework/runtime/skyline/wxss.html · sha f7f4d7ebaef41608 | 2026-10-02 |
| WebView | wechatide `fields({computedStyle})` 实测 | spike/vc0-skyline-geom/results/computed-webview.txt | 2026-10-02 |

## Profile 端支持度维度（VC2-a）

- 支持度维度（本块）与成本分级（L0–L5）是两个**正交**维度：成本分级决定"怎么实现/贵不贵"，支持度决定"哪端能不能用"。
- 准入规则（VC2-a 定案）：tier=universal ⇒ 可进 L0–L2；tier=conditional ⇒ 最高归 L3（"有条件可用"——需在 proteus.config 或组件级显式 opt-in，与 L3 既有"默认关闭"语义合并）；tier=unsupported ⇒ L5（编译期报错）。
- L5 同时保留既有语义性禁止项（运行时动态选择器/运行时插样式表等）——那些不属"引擎支持度"，本表不覆盖。
- Skyline 未收录（not-listed）按 conditional 保守处理：未收录 ≠ 确认不支持，需真机实测后升级（诚实边界）。

> 判定规则：universal = web∧skyline∧webview∧app 全支持且官方 formats/remark 无限制；unsupported = 全端不可用；其余 = conditional

### 「仅部分端支持」差集（conditional —— 需显式 opt-in / 归 L3）

| CSS | 编译器字段 | Web | Skyline | WebView | App | 受限原因 |
|---|---|---|---|---|---|---|
| `position` | `position` | supported | supported | supported | supported | fixed 在微信客户端 8.0.43 版本开始支持，只支持相对于窗口 viewport 定位，不支持 top / left / bottom / right  |
| `overflow` | `overflow` | supported | supported | supported | supported | scroll 不支持，只能通过 scroll-view 实现；不支持单独设置 overflow-x/y |
| `font-size` | `fontSize` | supported | supported | supported | supported | 不支持百分比；不支持 keyword (smaller..) |

### 官方 Skyline 对齐开关（VC2-c 消费）

| 开关 | 平台/基础库最低版本 |
|---|---|
| 开启默认Block布局 | Android 8.0.34 · iOS 8.0.36 · 开发者工具 Nightly Build (1.06.2304262) · 基础库 2.31.1 |
| 开启默认 ContentBox 盒模型 | Android 8.0.42 · iOS 8.0.42 · 开发者工具 Nightly Build (1.06.2310092) · 基础库 3.1.0 |
| 开启 tag 选择器全局匹配 | Android 8.0.51 · iOS 8.0.51 · 开发者工具 Nightly Build (1.06.2409032) · 基础库 3.6.0 |
| 开启 scroll-view 自动撑开 | Android 8.0.54 · iOS 8.0.54 · 基础库 3.7.2 |
| 开启 keyframe 样式全局共享 | Android 8.0.57 · iOS 8.0.57 · 基础库 3.8.0 |

## 结构性事实（端能力差异）

| 事实 | 判定 | 证据 |
|---|---|---|
| skylineComputedStyle | unsupported | spike/vc0-skyline-geom 实测：`fields({computedStyle})` 在 Skyline 下返回 {}（静默丢弃）；WebView 同装置可用（30/30） |
| skylineSelectorIdClass | supported | VC0 实测：#id ✓ / .class ✓（页面与组件作用域均通过） |
| skylineSelectorAttrTag | unsupported | VC0 实测：属性选择器 [data-*] 与 tag 选择器恒返 null（官方选择器表亦标 ×）；绕过=静态 id |
| skylineInlineStyleOnly | note | 装置事实：小程序不能 JS 写节点内联样式——样式变更必须经 setData/绑定（影响一致性校验的实现形态） |
| skylineDefaults | differ | 官方表：display 默认 flex、flex-direction 默认 column、box-sizing 默认 border-box（可经配置改 block/content-box）；与 WebView/Web 均不同 |

## 属性矩阵（编译器认的字段 = 覆盖范围）

| 类别 | 编译器字段 | CSS | 档位 | Web | Skyline | Skyline 支持格式 | Skyline 默认 | WebView |
|---|---|---|---|---|---|---|---|---|
| layout | `width` | `width` | universal | supported | supported | <length> | auto | supported |
| layout | `height` | `height` | universal | supported | supported | <length> | auto | supported |
| layout | `minWidth` | `min-width` | universal | supported | supported | <length> | auto | supported |
| layout | `maxWidth` | `max-width` | universal | supported | supported | <length> | auto | supported |
| layout | `minHeight` | `min-height` | universal | supported | supported | <length> | none | supported |
| layout | `maxHeight` | `max-height` | universal | supported | supported | <length> | none | supported |
| layout | `margin` | `margin-top` | universal | supported | supported | <length> | 0 | supported |
| layout | `padding` | `padding-top` | universal | supported | supported | <length> | 0 | supported |
| layout | `flexDirection` | `flex-direction` | universal | supported | supported | row / row-reverse  / column  / column-reverse | column | supported |
| layout | `justifyContent` | `justify-content` | universal | supported | supported | center / flex-start  / flex-end  / space-between  / space-ar | flex-start | supported |
| layout | `alignItems` | `align-items` | universal | supported | supported | stretch / center / flex-start / flex-end / baseline | stretch | supported |
| layout | `alignSelf` | `align-self` | universal | supported | supported | auto / stretch  / center  / flex-start  / flex-end  / baseli | auto | supported |
| layout | `flexGrow` | `flex-grow` | universal | supported | supported | <float> | 0 | supported |
| layout | `flexShrink` | `flex-shrink` | universal | supported | supported | <float> | 1 | supported |
| layout | `flexBasis` | `flex-basis` | universal | supported | supported | <length> | auto | supported |
| layout | `gap` | `gap` | universal | supported | supported | <length> | 0 | supported |
| layout | `display` | `display` | universal | supported | supported | none / flex / block | flex | supported |
| layout | `position` | `position` | conditional | supported | supported | relative / absolute / fixed | relative | supported |
| layout | `top` | `top` | universal | supported | supported | <length> | auto | supported |
| layout | `left` | `left` | universal | supported | supported | <length> | auto | supported |
| layout | `overflow` | `overflow` | conditional | supported | supported | hidden / visible | visible | supported |
| paint | `backgroundColor` | `background-color` | universal | supported | supported | <color> | transparent | supported |
| paint | `color` | `color` | universal | supported | supported | <color> | black | supported |
| paint | `fontSize` | `font-size` | conditional | supported | supported | <length> | 16px | supported |
| paint | `borderRadius` | `border-radius` | universal | supported | supported | — | — | supported |
| paint | `borderColor` | `border-color` | universal | supported | supported | — | — | supported |
| paint | `borderWidth` | `border-width` | universal | supported | supported | — | — | supported |
| paint | `opacity` | `opacity` | universal | supported | supported | <float> | 1 | supported |

## 引擎扩展通道（非 CSS 属性——独立于上表）

| 编译器字段 | 声明属性 | 说明 |
|---|---|---|
| `fill-gradient` | `fill-gradient` | 引擎扩展通道（JSON 属性载体，非 CSS 属性）——App 宿主真源探针已验证（A/B 批次 probeChannels）；Web/小程序端由编译器映射，属 VC4 一致性校验范围 |
| `fill-gradient-to` | `fill-gradient-to` | 引擎扩展通道（JSON 属性载体，非 CSS 属性）——App 宿主真源探针已验证（A/B 批次 probeChannels）；Web/小程序端由编译器映射，属 VC4 一致性校验范围 |
| `clip-path` | `clip-path` | 引擎扩展通道（JSON 属性载体，非 CSS 属性）——App 宿主真源探针已验证（A/B 批次 probeChannels）；Web/小程序端由编译器映射，属 VC4 一致性校验范围 |
| `glow` | `glow` | 引擎扩展通道（JSON 属性载体，非 CSS 属性）——App 宿主真源探针已验证（A/B 批次 probeChannels）；Web/小程序端由编译器映射，属 VC4 一致性校验范围 |
| `mask` | `mask` | 引擎扩展通道（JSON 属性载体，非 CSS 属性）——App 宿主真源探针已验证（A/B 批次 probeChannels）；Web/小程序端由编译器映射，属 VC4 一致性校验范围 |
| `svg-path` | `svg-path` | 引擎扩展通道（JSON 属性载体，非 CSS 属性）——App 宿主真源探针已验证（A/B 批次 probeChannels）；Web/小程序端由编译器映射，属 VC4 一致性校验范围 |
| `svg-path-to` | `svg-path-to` | 引擎扩展通道（JSON 属性载体，非 CSS 属性）——App 宿主真源探针已验证（A/B 批次 probeChannels）；Web/小程序端由编译器映射，属 VC4 一致性校验范围 |

> 判定口径：Web=`CSS.supports` 实测；Skyline=官方表**收录**（未收录≠确认不支持——需实测补证）；
> WebView=实测读回值判定（supported=声明被采纳；absent=取不到）。`not-measured` 为待补项（诚实标注）。
> 属性清单与编译器单一事实源同步：`packages/compiler/src/vapor/template.ts` 的 LAYOUT_FIELDS / PAINT_FIELDS / PAINT_DECL_ATTRS。
