---
'@proteus-vue/slot-runtime': minor
'@proteus-vue/compiler': patch
---

Vapor B3a：动态 `:class` 的**数值布局字段**端上真生效（走内核二进制 SET_STYLE · 零宿主改动）

背景（对齐计划 B3）：动态 `:class` 命中的**布局字段**端上不生效（诊断 `DYNCLASS_LAYOUT_UNSUPPORTED`，
28 页命中）。探针实证根因：plan 产出字段值为 **StyleIR 描述符**（`{kind:'absolute',dp:N}`），
运行期把它们统一经 `onPaintProp` 交给宿主**绘制**补丁通道——而该通道不认布局/描述符 ⇒ 不重排。

- **运行期**（`slot-runtime/runtime`）：`paint.class` 字段**分流**——**数值布局字段**
  （`NUMERIC_LAYOUT_FIELDS`：width/height/min|max/flex*/gap/top/left/right/bottom/margin*/padding*/
  aspectRatio）改走**内核二进制 `SET_STYLE`**（host-agnostic：内核重排 ⇒ **三端零宿主改动**即生效）；
  其余（绘制色/字号/圆角…）仍走 `onPaintProp`。★**清除回退**：plan 关闭该类返回 `null` ⇒ 发 `UNSET`
  （NaN ⇒ 内核 `None`）。`layoutNumber` 解包描述符/原始数。class 块守卫**不再要求 `onPaintProp`**。
- **内核**（`layout-core-rust/ops_apply::apply_style_key`）：补登记 `right`/`bottom`/`padding` 四向/
  `aspectRatio`（`LStyle` 早已有这些字段，指令映射表此前漏登记）。
- **编译器**（`vapor/build`）：诊断收窄——**数值布局字段不再诊断**；仅对**无二进制通道**的布局字段
  （枚举 `display`/`flexDirection`… · grid）诊断（`padding`/`margin` 对象在 plan 里已摊平为数值 ⇒ 视为支持）。

验证：`vapor-sfc-to-tree` ⑥（数值字段发内核 SET_STYLE、**不进** onPaintProp；数值无诊断/枚举仍诊断）·
`layout-core-rust` Rust 单测（新映射臂）· **三端真机判据 ㉕**（动态 :class 数值布局字段几何 `[0,200,0]`：
关→开→关，Android/鸿蒙/iOS 全过 + `check:vapor-three-end` 指纹一致）· 全量 5658 · vue-tsc 0。
能力棘轮改善：`VAPOR_DYNCLASS_LAYOUT_UNSUPPORTED` **28→18**（已 `--update` 落账）。
★B3b（枚举/grid 类布局字段）需**新内核 op + 三端宿主**，留后续。
