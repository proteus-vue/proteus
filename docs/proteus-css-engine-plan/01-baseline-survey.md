# 01 · 现状勘察与量化缺口（基线）

> 采集方式：对 `proteus` 仓库 HEAD 的**只读**勘察（2026-10-05）。**每条结论均带 `文件:行` 证据**。
> 本节是 G-61 的**立项依据**——不写"感觉"，只写"能 grep 到的事实"。

---

## 1. 今天实际存在的"三套样式实现"

| 端 | 样式实现者 | 时点 | 证据 |
|---|---|---|---|
| **Web** | 浏览器原生 CSSOM（唯一完整实现） | 运行期 | `docs/proteus-css-compat-plan/06-selector-cascade.md:10`「完整 CSSOM，运行时匹配」 |
| **Skyline** | 微信容器（**唯一刚性外部约束**） | 运行期（容器内） | `docs/Proteus_CSS_Profile规格.md:89-92`（端模型：Web / Skyline / App） |
| **App**（iOS/Android/鸿蒙） | **无 CSS 引擎**，编译期折叠为引擎字段 | 编译期 | `docs/generated/app-css-surface.md:6-7` 原文：「App 端**无 CSS 引擎**——样式在**编译期**由 `parseStaticStyle` 折叠为引擎字段（值仅 px/数字；宽高另支持百分比→比例）。选择器 / 层叠 / 伪类 / 媒体查询 / grid / box-shadow 等**均不在 App 端**」 |

> ★**App 是三具体平台共用一套自研 Rust 引擎**（一套 CSS 面、可扩展），iOS/Android/鸿蒙 不是三条独立样式轴（`Proteus_CSS_Profile规格.md:89-92`）。

---

## 2. 编译期做的是一个"字段折叠器"，不是 CSS 引擎

### 2.1 折叠面字段清单（`packages/compiler/src/vapor/template.ts:56-112`）

| 常量 | 数量 | 内容 |
|---|---|---|
| `APP_LAYOUT_FIELDS` | **32** | width/height/min·max/margin/padding/flexDirection/flexWrap/justifyContent/alignItems/alignContent/alignSelf/flexGrow/flexShrink/flexBasis/gap/rowGap/columnGap/display/position/top/left/right/bottom/overflow/gridTemplateColumns/gridTemplateRows/gridColumn/gridRow/aspectRatio/pointerEvents |
| `APP_PAINT_FIELDS` | **17** | backgroundColor/color/fontSize/fontWeight/fontFamily/textAlign/lineHeight/textOverflow/letterSpacing/textDecoration/visibility/borderRadius/borderColor/borderWidth/opacity/boxShadow/transform |
| `APP_DERIVED_FIELDS` | **10** | widthRatio/heightRatio/marginAuto/borderRadiusCorners/borderRadiusPct/transformOrigin/minWidthPct/maxWidthPct/minHeightPct/maxHeightPct |
| `APP_SPECIAL_FIELDS` | **1** | boxSizing |
| `APP_INHERITABLE_FIELDS` | **9** | color/fontSize/fontWeight/fontFamily/lineHeight/textAlign/textOverflow/letterSpacing/textDecoration |

### 2.2 自己写明的能力边界（`template.ts:1048-1063`，原文摘要）

> 「App 路径**没有 CSS 引擎**……」
> 「【支持的选择器子集（如实，不假装全支持）】类型（元素）选择器；类选择器 `.a`·复合 `.a.b`；后代/子组合 `.a .b`·`.a > .b`」
> 「**跳过**：伪类 `:` / 伪元素 `::` / 属性 `[x]` / `*` / `+`~` 兄弟 / `@media`；`@keyframes` 块整体不算选择器」
> 「【诚实边界】**无特异性权重（只按源序）· 无继承 · 只静态类**（动态 `:class` 值形态不可展开）」

### 2.3 解析实体分散在三处、互不构成一棵 CSSOM

| 实体 | 位置 | 性质 |
|---|---|---|
| `parseStaticStyle` | `template.ts:508-1046` | 值折叠（`!important`/`var()`/简写/枚举校验/百分比→ratio） |
| `parseClassRules` | `template.ts:1048-1153` | 选择器子集匹配（无特异性、只按源序） |
| `css-compat` lint/rewrite | `packages/css-compat/src/rewrite.ts:38-65` | **字符串级**重写（rgba→#RRGGBBAA / calc 二元折叠 / vh·vw→%） |

### 2.4 双口径（同一个仓库里两个"字段总数"）

- App 折叠面：**49 个**（32 布局 + 17 绘制）+ 11 派生/特殊。
- 一致性矩阵认定的"可表达字段"：**38 个**（`docs/generated/consistency-metrics.json` → `M1.union.total: 38`）。
- ⇒ 两套口径**并非同一集合**，未被显式声明映射关系。

---

## 3. 宿主侧没有"统一样式应用器"

三端各自手写读取**已解析字段**，**无共同 SPI、无共同 conformance**：

| 宿主 | 入口 | 证据 |
|---|---|---|
| Android | `VaporRenderHost` 读 `spec.optString("backgroundColor")` 等；`LAYOUT_KEYS` 白名单；逻辑→物理像素唯一换算点 | `hosts/android/app/src/main/java/dev/proteus/layoutcore/VaporRenderHost.java:1160-1177`、`:1179-1212`、`:1389+` |
| iOS | `makeLayer(style:nodeId:)` 读 style 字典；`style_key: UInt32`（**数值键**，进一步证明非字符串解析） | `hosts/ios/ProteusHost/selfdraw-scene.swift:614+` |
| 鸿蒙 | `OH_Drawing_*` 直绘，无样式层概念 | `hosts/harmony/host-app/entry/src/main/cpp/proteus_render.cpp` |

**渲染 SPI 缺口**：`packages/render-backend/src/spi.ts` 的 `ProteusRenderBackend` **只有 `patchProp`**（接受"已解析的 prop 值"）——**没有** "CSS 声明 → 后端字段"的集中映射入口。这正是 `packages/css-compat/README.md:34` 标注未做的 **B2（Style IR → 五端 Renderer 映射）**。

**内核侧的既定约束**（必须遵守，不可推翻）：

- `packages/layout-core-rust/src/style.rs:5-6`：「上游（编译期折叠）已把 CSS 折叠成数值/比例，本层**不做任何解析**」「运行时调用栈里不应出现「样式字符串 → 解析」这一步（Profile 门禁「运行时零解析」）」
- `packages/component-ir/src/pnode-style.ts` 头注：「**运行时不得存在 CSS 解析 / 单位换算**」

---

## 4. 量化缺口（全部来自仓库既有机器产物）

| 指标 | 当前值 | 证据 |
|---|---|---|
| 数值一致性覆盖率 **M1** | **0.5877** | `docs/generated/consistency-metrics.json` → `M1.value` |
| ├ 「布局字段层」L2 覆盖 | **2 / 38** | 同上 → `M1.byLayer.L2`（口径：几何 w/h → width/height；x/y 不计） |
| ├ 「样式键」L3 覆盖 | 27 / 38 | 同上 → `M1.byLayer.L3` |
| └ 支持度矩阵 L1 | 38 / 38 | 同上（**注意：L1 是"声明覆盖"，不等于"渲染等价"**） |
| Profile 实施 P3（折叠算法） | **◐ 半成品**（仅单位折叠 + Golden） | `docs/Proteus_CSS_Profile规格.md:427` |
| Profile 实施 P4（动态 class 预计算） | **❌ 未实现** | 同上 `:428` |
| Profile 实施 P5（E-CSS/W-CSS lint） | **◐ 仅 1 条**（E-CSS-006 拍平违规） | 同上 `:429` |
| Profile 实施 P6（Web 端 lint 前置） | **❌ 未实现** | 同上 `:430` |
| `css-compat` B2（StyleIR → 五端映射） | **❌ 未做** | `packages/css-compat/README.md:34` |
| `css-compat` B3（预算门禁 + DevTools 面板） | **❌ 未做** | 同上 `:35` |
| 三张样式属性表一致性 | **已报红**（半开状态） | `scripts/check-app-css-surface.mjs:5-23` |
| L4 像素判据 | **非门禁**（`gate: false`） | `packages/consistency/src/pixel.ts` |

**读法**：M1 = 0.5877 且 L2 = 2/38 —— 「多端视觉一致」目前**只在少数几个字段上有可判定证据**。这不是工程质量问题，是**没有层**在负责这件事。

---

## 5. 五个结构性缺口（根因）

| # | 缺口 | 证据 | 后果 |
|---|---|---|---|
| **G1** | **无 CSS 真源实现**。解析/匹配/层叠/继承/计算值分散三处，不构成一棵 CSSOM | `template.ts:1051-1063` 自述「无特异性、无继承、只静态类」；`rewrite.ts` 字符串替换 | 同一份 SFC 在三端的"样式含义"从未被证明相同 |
| **G2** | **无统一产物契约（StyleIR）**。链路无中间表示，只有"折叠后字段散落各处" | `render-backend/src/spi.ts` 仅 `patchProp`；`css-compat` B2 未做 | 各宿主各自理解"样式"，一致性无从判定 |
| **G3** | **宿主侧无统一样式应用器 SPI**。三端手写读字段，无 conformance | `VaporRenderHost.java:1389+` / `selfdraw-scene.swift:614+` / `proteus_render.cpp` | 新增一个 CSS 字段 = 改三处宿主 + 无验收 |
| **G4** | **能力协商不闭环**。三张属性表互不同步（已报红） | `check-app-css-surface.mjs:5-23`（违反铁律 #9「两处白名单必须同步」） | 一个属性"某路径允许、另一路径拒绝" |
| **G5** | **一致性判据不足**。像素非门禁；几何指纹不覆盖光栅化；L2 仅 2/38 | `pixel.ts` `gate:false`；`hosts/shared/check-cross-end-geometry.py` 诚实边界；`consistency-metrics.json` | 「多端视觉一致」无法客观验收（历史上已因此出过"只跑逻辑就宣称通过"，决策 #543） |

---

## 6. 已有正确资产（不要重造）

| 资产 | 位置 | 可用性 |
|---|---|---|
| Taffy 布局内核（flex **+ grid**）+ 样式键应用通道 | `packages/layout-core-rust`（`Cargo.toml` taffy 0.14；`src/ops_apply.rs::apply_style_key`） | ✅ 直接复用（App Applier 的落地通道） |
| 单位折叠最底层真值 | `packages/component-ir/src/pnode-style.ts`（`resolveLength`） | ✅ 直接复用（CSE Step6） |
| 一致性验证体系 | `packages/consistency`（snapshot / tolerance / probes-web / pixel / png / report） | ✅ 引擎已在，只差"喂给它的产物不统一" |
| Profile 规格（L0–L5 + 7 步算法 + `ComputedStyle` 草案） | `docs/Proteus_CSS_Profile规格.md:96-268` | ✅ 本 plan 是对它的**工程化落地** |
| CSS 能力矩阵生成器 + 漂移门禁 | `scripts/gen-css-capability-alignment.mjs` | ✅ 扩为编译期+运行期双端消费 |
| 边界校验与豁免机制 | `packages/css-compat/src/profile-boundary.ts`（`proteus-allow-profile`） | ✅ 复用 |
| Host ABI | `packages/host-abi/src/lib.rs`（`ABI_VERSION=1`） | ✅ StyleIR 版本化与它同构设计 |

---

## 7. 证据索引（完整）

| 事实 | 位置 |
|---|---|
| App 端无 CSS 引擎 | `docs/generated/app-css-surface.md:6-7` |
| App 折叠字段清单 | `packages/compiler/src/vapor/template.ts:56-112` |
| 选择器子集与诚实边界 | `packages/compiler/src/vapor/template.ts:1048-1155` |
| `parseStaticStyle`（值折叠） | `packages/compiler/src/vapor/template.ts:508-1046` |
| `parseCssVarTokens` 块感知修复 | `packages/compiler/src/vapor/template.ts:461-489` |
| 单位折叠最底层真值 | `packages/component-ir/src/pnode-style.ts`（`resolveLength`） |
| css-compat 定位与 B1/B2/B3 状态 | `packages/css-compat/README.md:3`、`:33-35` |
| CSS001-012 规则表 | `packages/css-compat/src/rules.ts:71-214` |
| 编译期重写（字符串级） | `packages/css-compat/src/rewrite.ts:38-65` |
| Profile 边界校验（只判静态字面量） | `packages/css-compat/src/profile-boundary.ts` |
| Skyline 边界规则（24 条，生成物） | `packages/css-compat/src/generated/skyline-boundary-rules.generated.ts` |
| 「运行期完整级联 = 自研迷你 CSSOM，违背原则 #10」 | `docs/proteus-css-compat-plan/06-selector-cascade.md:14` |
| 布局语义映射（grid 待接 L2） | `packages/css-compat/src/layout-semantics/mappings.ts` |
| Profile 7 步算法 / 运行期零解析 | `docs/Proteus_CSS_Profile规格.md:183-232` |
| Profile P1-P7 实施状态 | `docs/Proteus_CSS_Profile规格.md:423-435` |
| `ComputedStyle` 草案 | `docs/Proteus_CSS_Profile规格.md:234-268` |
| 动态 class 预计算方案 | `docs/Proteus_CSS_Profile规格.md:272-317` |
| 三端基线对照表 | `docs/Proteus_CSS_Profile规格.md:77-92` |
| RenderBackend SPI（仅 `patchProp`） | `packages/render-backend/src/spi.ts` |
| 五后端与就绪度 | `docs/proteus-render-backend-readiness-i6.md` |
| layout-core 不做解析 | `packages/layout-core-rust/src/style.rs:5-6` |
| 样式键应用通道 | `packages/layout-core-rust/src/ops_apply.rs`（`apply_style_key`） |
| 三张样式表不同步（报红） | `scripts/check-app-css-surface.mjs:5-23` |
| CSS 能力矩阵生成器 | `scripts/gen-css-capability-alignment.mjs` |
| App 能力数据源（人工维护） | `docs/generated/css-capability-sources/app-profile-features.json` |
| 一致性分层快照 | `packages/consistency/src/snapshot.ts`、`tolerance.ts` |
| 像素判据非门禁 | `packages/consistency/src/pixel.ts`（`gate: false`） |
| 像素噪声基线（`maxDiffRatio 0.035`） | `docs/consistency-pixel-noise.json` |
| 一致性指标（M1=0.5877，L2=2/38） | `docs/generated/consistency-metrics.json` |
| 几何逐字节判据与其边界 | `hosts/shared/check-cross-end-geometry.py` |
| 禁像素为主判据（G-56.7） | `docs/proteus-architecture.md:298` |
| 三端真值截图途径 | `hosts/android/run-superapp-launcher.sh`（`adb exec-out screencap`）/ iOS `takeSnapshot()` / 鸿蒙 `snapshot_display -f` |
| 原则 #10 / #13 | `docs/proteus-architecture.md:25-60` |
| 铁律 scope / 包注册表门禁实现 | `scripts/check-consistency.js:141-204` |
