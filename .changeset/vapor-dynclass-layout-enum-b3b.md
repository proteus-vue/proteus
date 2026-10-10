---
'@proteus-vue/slot-runtime': minor
'@proteus-vue/compiler': patch
---

Vapor B3b：动态 `:class` 的**枚举布局字段**端上真生效（索引编码走内核二进制 SET_STYLE）

承接 B3a（数值字段）。B3b 把**枚举布局字段**也用同一条 host-agnostic 通道生效：

- `display`/`flexDirection`/`flexWrap`/`position`/`overflow`/`alignItems`（`ENUM_LAYOUT_FIELDS`）的
  字符串值 → **索引编码**（f32），走内核二进制 `SET_STYLE`（与 `:width` 等同通道，零宿主改动）。
- **内核**（`layout-core-rust/ops_apply::apply_style_key`）：新增按索引解码的臂（display 升级为
  0=flex/1=grid/2=none；flexDirection/flexWrap/position/overflow/alignItems 各自索引表，**与 JS
  `ENUM_LAYOUT_FIELDS` 同序**——跨语言契约）。
- **清除回退**：plan 关闭该类 ⇒ 枚举发**默认索引**（如 alignItems→stretch、flexDirection→column）。
- **编译器**：诊断收窄——数值 + 枚举（白名单）不再诊断；仅无二进制通道的（grid 模板 / lineClamp /
  whiteSpace / wordBreak / overflowX/Y / justify* / alignContent / alignSelf）诊断。

验证：`vapor-sfc-to-tree` ⑦（display grid=1 / flexDirection row=0 / alignItems center=7 发内核
SET_STYLE）+ Rust 单测（索引解码臂）· **三端真机判据 ㉖**（`.hrow{flex-direction:row}` 子2 x
`[0,120,0]`：column→row→column，Android/鸿蒙/iOS 全过 + `check:vapor-three-end` 指纹一致）·
全量 5659 · vue-tsc 0。能力棘轮 `VAPOR_DYNCLASS_LAYOUT_UNSUPPORTED` **18→10**（已落账）。
★B3c（grid/whiteSpace/wordBreak/overflowX-Y 等）留后续。
