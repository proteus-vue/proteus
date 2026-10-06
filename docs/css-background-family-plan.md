# 背景定位家族（background-size / background-position / background-repeat）· 实施计划（登记态 · 2026-10-07）

> **★状态（2026-10-07 更新）**：**编译期 + 一致性链 + 三端宿主几何已落地**（决策 #568）——
> `css:verify` size/position/repeat 三段全绿 · 验收页 `css-conformance/pages/background-position.vue` 五案例 + Web 基准采毕；
> **四端真机像素验收（MP/Android/iOS/鸿蒙）+ 子代理终评**为收尾项（见 §3 第 7 步）。
> **具名边界（留下一批）**：动画定位（@keyframes）· 多层渐变 · iOS `CAGradientLayer` 的 repeat（无 tile 模式）· size 的 cover/contain。
>
> **★真机验收发现的实质缺陷（本批修复，逐像素/probe 抓出）**：
> ① **Android `LinearGradient`+CLAMP 恒铺满整个绘制矩形**——只改 shader 端点不生效 ⇒ 必须**把填充本身收进图像盒**（已在 `drawCmds` 修）。
> ② **iOS `styleOf` 白名单漏登记** size/position/repeat ⇒ 静默丢弃（PLAYBOOK 已记的第 N 次同款）——已补。
> ③ **iOS 渐变子层建层时父 bounds=0** ⇒ frame 恒为 0 ⇒ 不可见——改由**布局后统一 `syncGradientFrames()`** 设帧（多条建层路径同享一次）。
> ④ **图像盒可超出元素**（如 size 400%）⇒ 必须裁到元素盒（Web 背景绘制区）——Android/iOS/鸿蒙三端均补裁剪。
> ★**取图口径教训（probe 报 mp/鸿蒙边缘差）**：5 案例高于视口 ⇒ 设备截图为**视口裁剪**，而 probe 拿**整页** Web 基准比对 ⇒ 假红；粘性截图需按页面视口裁剪基准。
> ★**（#569 已补）鸿蒙 grad 通路**：已在本项内接通（`appScreenCommands` 产 `grad` 键 + px×density + `gradEndpoints` 几何改 CSS 同式）；**iOS repeat** 亦本项内解决（栅格化 tile + `draw(byTiling:)`）。
> ★**（#569 修）鸿蒙逐屏截图锚点**：`superapp-screen-*` 路径原**滚到底**（`scrollToBottom`）⇒ 内容高于视口的页（如本页 contentH 857 > 视口 816）**切掉页头/标题**、与 Web 基准（**视口截图=页顶锚定**）坐标系不符（用户抓出「鸿蒙页面偏下」）。改为**不滚到底**（保持 offset=0，页顶对齐）。

> **来源**：`css:next` 指向 `background-position`（P0 · 用法 4×）。侦察发现它**不可独立交付**——
> 三端宿主把渐变**硬编码为「填满整个盒」**（无 size/position/repeat 概念），且语料 4× 全部与
> `background-size` 配对、其中 2 为 `@keyframes` 动画。用户裁定：**做「背景定位」家族 · 静态单层**
> （动画 / 多层渐变为具名边界，留下一批）。本文件是登记件 + 实施计划。

## 0. 为什么是一个家族（侦察结论）

| 事实 | 证据 |
|---|---|
| 三端宿主渐变**恒填满盒**（无 size/position） | Android `ProteusHostView.java:2423-2452`（线性端点 = 盒中心±半程向量；径向半径 = r×盒宽）；iOS `selfdraw-scene.swift:1630-1645`（`CAGradientLayer` 单位空间 = 节点 bounds）；鸿蒙 `proteus_render.cpp:351`（`OH_Drawing_RectCreate(0,0,w,h)`） |
| 内核无 size/position 字段 | `layout-core-rust/src/style.rs` `GradState`（L253-283）只有 kind/angle/cx/cy/r/stops；无 `bg_size`/`bg_position` |
| blob 无渐变位 | `blob.rs` `grep gradient` = 0（渐变走 JSON DTO `fillGradient`，非二进制） |
| 编译器折叠只产 `{kind,angle/cx/cy/r,stops}` | `compiler/src/vapor/template.ts` `parseCssGradient` L2494-2542（径向 `at <pos>` 被丢弃，几何硬编码 0.5,0.5,1.0） |
| MP/Web 已原生支持（CSS 直通） | MP 走 `transformStyleToWxss` 原样透传；Web 浏览器原生 ⇒ **本批是 App 自绘缺口** |
| 语料 | `built-in-components/src/style.css:607`（`center top, center bottom` + `size 100% 92px`，**多层**）；`p-progress:156-159` + `p-skeleton:53-54`（**@keyframes 动画**） |

## 1. Web 真值（真 Chromium 实测，2026-10-07）

解析后的几何（供内核 + 三端宿主统一实现）：

- **`background-size` → 图像尺寸**（px）：`50px 50px`→50×50；`50% 50%`→半盒；`400% 100%`→4×盒宽 × 1×盒高。
  `auto` = 图像固有尺寸（渐变无固有尺寸 ⇒ 对渐变 **auto = 整个定位区**）。
- **`background-position` → 偏移**：
  · 关键字：`center`=`50% 50%` · `right`/`bottom`=`100%` · `left`/`top`=`0`；
  · **px** = 直接偏移；
  · **%** = `X% × (盒宽 − 图宽)`（**注意减图尺寸**——实测 `size 50px` + `pos 100%` 于 100px 盒 ⇒ offset 50px）。
- **`background-repeat`**：`no-repeat` ⇒ 只画一次（在偏移处）；`repeat` ⇒ 以**图像尺寸为砖**平铺，相位 = 偏移。
- **渐变方向**相对**图像盒**（不是元素盒）：`linear-gradient(90deg,…)` 的端点在图像盒的左→右边。

## 2. 交付范围（本批）

- `background-size`（长度 / 百分比 / auto）、`background-position`（px / % / 关键字）、`background-repeat`（no-repeat / repeat）。
- **单层渐变**（语料为单层；多层 = 具名边界）。
- 覆盖 `built-in-components/src/style.css:607` 的静态用法。

**具名边界（留下一批）**：
- **@keyframes 动画定位**（p-progress 行进条纹 / p-skeleton shimmer）——需动画通道携带 bg 几何（与既有 `gradientMix` 同族但更广）；本批不做。
- **多层渐变 + 逐层定位**（built-in-components 那条）——需 background 层数组；本批不做（页面具名）。
- 渐变 **`auto`/固有尺寸**：渐变无固有尺寸，auto 语义需与 Web 逐值核对（本批先按"定位区"近似并在页面具名）。

## 3. 实施链（按依赖序）

1. **契约四同步**：`contracts/src/style.ts` 新级别 `BackgroundSize`/`BackgroundPosition`/`BackgroundRepeat`（值集 = 四端可表达子集）+ runtime `PROP_TYPES`/narrowing + 注册表 `VALUE_TYPE_BY_LEVEL`（`gen-style-ir-registry.mjs` 重生成）。
2. **编译器折叠**：`compiler/src/vapor/template.ts` `parseStaticStyle` 解析三属性（含简写 `background` 内联），产 `fillGradientGeom = {size:{w,h,unit}, position:{x,y,unit}, repeat}`（挂在既有 `fillGradient` 旁）；CSE（`cse/compute.ts`）纳入继承/枚举。
3. **内核 Rust**：`style.rs` `GradState` 加 `size_x/size_y/pos_x/pos_y`（+ 单位位）与 `repeat`；`ffi.rs` `parse_gradient` 解析；blob 视需要加字段（渐变本走 JSON ⇒ 可能免改）。
4. **三端宿主渐变几何重写**（★核心工作量）：按 §1 公式，把端点/径向中心**重算到图像盒**而非元素盒；repeat 用 `TileMode.REPEAT`（Android）/ `CAGradientLayer` 之外的 tiling（iOS）/ 鸿蒙绘制循环。
5. **一致性链**：`consistency/{snapshot,coverage,appliers/{app,skyline,web},probes/web}.ts` + `gradient-contract` 键表（`animation/src/gradient.ts`）+ appliers applier 映射。
6. **验收页** `css-conformance/pages/background-position.vue`（稳定 `id="case-*"`）+ `router/auto-routes.ts` 注册 + `verify-css-feature.mjs` `PROBE_VALUES` + `css-conformance.mjs` `COMPUTED_PROPS`。
7. **四端真机 + probe + 子代理终评**（按 PLAYBOOK 七步）。

## 4. 风险与纪律

- **跨语言几何一致性 = 本仓最高风险面**（`check-gradient-contract`）：三端 + TS 端点式必须**同式**（既有注释已标 "与 TS linearGradientEndpoints / iOS applyGradient 同式"）——改几何要四处同改 + golden。
- **动画通道**：既有 `gradientMix` 是"两态混合色标+几何"，本批的静态几何**不得**破坏它。
- **PLAYBOOK 纪律**：机器判据先行（probe 1.5s）· 一轮收齐一次修 · 继承/缺省先查 Web 真值。

## 5. 关联

`css-conformance/PLAYBOOK.md` · `scripts/gen-css-feature-inventory.mjs`（`background-position`/`background-size` 的 `notYet` 登记）· `scripts/check-gradient-contract.mjs` · 决策 #561/#562（同族逐项对齐的契约四同步 + 宿主键白名单纪律）。
