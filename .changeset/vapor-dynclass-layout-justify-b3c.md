---
'@proteus-vue/slot-runtime': minor
'@proteus-vue/compiler': patch
---

Vapor B3c：动态 `:class` 补 `justifyContent`/`alignContent`/`alignSelf`（索引编码走内核 SET_STYLE）

承接 B3a（数值）/ B3b（枚举）。B3c 把内核**字符串布局字段** `justify-content`/`align-content`/
`align-self` 也索引编码（同一 host-agnostic 二进制通道）：

- `ENUM_LAYOUT_FIELDS` 增三项（值表含 CSS 别名 `start`/`end`；`alignSelf` 0=auto ⇒ 清空回落父）。
- 内核 `apply_style_key` 加索引解码臂（与 JS 表逐字同序，值 = `taffy_engine::parse_justify`/
  `parse_align_content`/`parse_align_items` 接受的字符串）。
- 编译器诊断收窄（`justifyContent`/`alignContent`/`alignSelf` 不再诊断）。

验证：`vapor-sfc-to-tree` ⑦（justify-content center=4 / align-self end=4 发内核 SET_STYLE）+
Rust 单测 · **三端真机判据 ㉖ 扩展**（`.hrow{flex-direction:row; justify-content:center}` 子2 x
`[0,200,0]`——含 justify-content 居中；Android/鸿蒙/iOS 全过 + `check:vapor-three-end` 指纹一致）·
全量 5659 · vue-tsc 0。能力棘轮 `VAPOR_DYNCLASS_LAYOUT_UNSUPPORTED` **10→8**（已落账）。
★仍待做：grid 模板（字符串 token 串，需新内核 op）· whiteSpace/wordBreak · overflowX/Y（内核无轴级字段）。
