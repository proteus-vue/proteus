# 端支持度矩阵（CSS Profile 属性 × Web / Skyline / WebView）

> ★自动生成（`node scripts/gen-end-support-matrix.mjs`），勿手改。漂移门禁：`--check`。
> 任务卡：`docs/Proteus_一致性校验任务卡清单.md` VC1-a / VC1-b / VC1-c。

## 证据来源（provenance）

| 列 | 采集方式 | 来源 | 采集日 |
|---|---|---|---|
| Web | Chromium CSS.supports（Playwright 151.0.7922.34） | 本机实测 | 2026-10-02 |
| Skyline | 官方《Skyline WXSS 样式支持与差异》解析 | https://developers.weixin.qq.com/miniprogram/dev/framework/runtime/skyline/wxss.html · sha f7f4d7ebaef41608 | 2026-10-02 |
| WebView | wechatide `fields({computedStyle})` 实测 | spike/vc0-skyline-geom/results/computed-webview.txt | 2026-10-02 |

## 结构性事实（端能力差异）

| 事实 | 判定 | 证据 |
|---|---|---|
| skylineComputedStyle | unsupported | spike/vc0-skyline-geom 实测：`fields({computedStyle})` 在 Skyline 下返回 {}（静默丢弃）；WebView 同装置可用（30/30） |
| skylineSelectorIdClass | supported | VC0 实测：#id ✓ / .class ✓（页面与组件作用域均通过） |
| skylineSelectorAttrTag | unsupported | VC0 实测：属性选择器 [data-*] 与 tag 选择器恒返 null（官方选择器表亦标 ×）；绕过=静态 id |
| skylineInlineStyleOnly | note | 装置事实：小程序不能 JS 写节点内联样式——样式变更必须经 setData/绑定（影响一致性校验的实现形态） |
| skylineDefaults | differ | 官方表：display 默认 flex、flex-direction 默认 column、box-sizing 默认 border-box（可经配置改 block/content-box）；与 WebView/Web 均不同 |

## 属性矩阵（编译器认的字段 = 覆盖范围）

| 类别 | 编译器字段 | CSS | Web | Skyline | Skyline 支持格式 | Skyline 默认 | WebView |
|---|---|---|---|---|---|---|---|
| layout | `width` | `width` | supported | listed | <length> | auto | supported |
| layout | `height` | `height` | supported | listed | <length> | auto | supported |
| layout | `minWidth` | `min-width` | supported | listed | <length> | auto | supported |
| layout | `maxWidth` | `max-width` | supported | listed | <length> | auto | supported |
| layout | `minHeight` | `min-height` | supported | listed | <length> | none | supported |
| layout | `maxHeight` | `max-height` | supported | listed | <length> | none | supported |
| layout | `margin` | `margin-top` | supported | listed | <length> | 0 | supported |
| layout | `padding` | `padding-top` | supported | listed | <length> | 0 | supported |
| layout | `flexDirection` | `flex-direction` | supported | listed | row / row-reverse  / column  / column-reverse | column | supported |
| layout | `justifyContent` | `justify-content` | supported | listed | center / flex-start  / flex-end  / space-between  / space-ar | flex-start | supported |
| layout | `alignItems` | `align-items` | supported | listed | stretch / center / flex-start / flex-end / baseline | stretch | supported |
| layout | `alignSelf` | `align-self` | supported | listed | auto / stretch  / center  / flex-start  / flex-end  / baseli | auto | supported |
| layout | `flexGrow` | `flex-grow` | supported | listed | <float> | 0 | supported |
| layout | `flexShrink` | `flex-shrink` | supported | listed | <float> | 1 | supported |
| layout | `flexBasis` | `flex-basis` | supported | listed | <length> | auto | supported |
| layout | `gap` | `gap` | supported | listed | <length> | 0 | supported |
| layout | `display` | `display` | supported | listed | none / flex / block | flex | supported |
| layout | `position` | `position` | supported | listed | relative / absolute / fixed | relative | supported |
| layout | `top` | `top` | supported | listed | <length> | auto | supported |
| layout | `left` | `left` | supported | listed | <length> | auto | supported |
| layout | `overflow` | `overflow` | supported | listed | hidden / visible | visible | supported |
| paint | `backgroundColor` | `background-color` | supported | listed | <color> | transparent | supported |
| paint | `color` | `color` | supported | listed | <color> | black | supported |
| paint | `fontSize` | `font-size` | supported | listed | <length> | 16px | supported |
| paint | `borderRadius` | `border-radius` | supported | listed | — | — | supported |
| paint | `borderColor` | `border-color` | supported | listed | — | — | supported |
| paint | `borderWidth` | `border-width` | supported | listed | — | — | supported |
| paint | `opacity` | `opacity` | supported | listed | <float> | 1 | supported |

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
