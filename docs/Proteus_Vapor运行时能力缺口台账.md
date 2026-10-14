# Proteus Vapor/App 运行时能力缺口台账（编译器折叠面 × 运行时订阅面）

> **定性（用户 2026-10-13 点名）**：「**不能遇到缺陷就直接绕过去，得记下来**——说明我们的编译器运行时对齐 Vapor 和 Vue 运行时**能力差得太远**，非常严重的问题」。
>
> 本台账记录**在真实 `.vue` 演示（`superapp/pages/glass-nav.vue` 悬浮玻璃导航）中实际撞到的每一面墙**。
> 造这个演示的过程**一步一坑**——坑全部来自 **App 端「编译期折叠 + 订阅表」相对 Vue 运行时的能力缺口**。
>
> **根因结构**：App 端**端上不执行 `<script>`**（见 `entry-vapor` 头注），只靠①**编译期折叠**（`buildLayoutTemplate` / `parseClassRules` / `staticInstantiate`）把值折成静态节点，②**订阅表**（`buildVaporSubscriptions` + `slot-runtime`）驱动运行期更新。
> 而 Web/MP 走**真正的 Vue 运行时**（computed/响应式/事件/条件渲染都是语言级能力）。
> ⇒ **App 折叠面/订阅表的「接受面」远窄于 Vue 运行时**——大量在 Vue 里天经地义的写法，在 App 端**静默失效**（无报错、无诊断，只是不动或不渲染）。**这是 OS 级承载的根本障碍。**

## 判定口径

- **静默**：失效时**无报错/无诊断**（最危险——`check` 全绿但页面就是不对）。
- **状态**：`修复` = 本会话已修（附决策号）；`绕开` = 本会话用改写法规避（**未修**，须补）；`登记` = 仅记录。

---

## A. 编译折叠面缺口（值/样式在构建期没折进产物）

| # | 现象（真机） | 根因（file:line） | 静默 | 状态 |
|---|---|---|---|---|
| A1 | **组件内 `computed(() => …)` 派生的 v-for 数据不渲染**（`pg-glass-nav` 的 `rows` computed ⇒ 导航项全空白）；**且运行期通路的响应式 v-for 被 `staticInstantiate` 静态展开**（`tpl.lists` 清空 ⇒ 运行期订阅表/列表被整条架空） | ① `computed` 不产 data（`app-component-registry.ts` 的 `extractRefLiterals` 只认 ref）；② 运行期通路也给 `buildLayoutTemplate` 传 `statics` ⇒ `staticInstantiate` 把可静态求值的 `v-for` 折成死节点 | ✅ 静默 | **部分修复**（#907：`keepReactiveStructure` 保留响应式 v-for/v-if；③ computed 产 data：**首个切片已收口 #938**——`<p-icon :name="动态">` 走运行期图标通道（`__iconPath` + 叶子折叠），Android/iOS 真机图标显示；★通用 computed 求值（依赖 props 的任意派生）仍为更大工程，未收） |
| A2 | **`v-for` 行内动态 `:class`（对象）渲染成黑块** | 行内 `:class` 对象被当 `list-item` style 处理、发错值（`build.ts` `inList` 分支 + `slot.ts` `toF32`） | ✅ 静默 | 绕开（去掉行内 `:class`） |
| A3 | **普通 `const` 数组不被当响应式源** ⇒ 子组件收不到该 prop | `sources.ts` 只把 `ref/reactive/computed/props/model` 当源；普通 `const` 数组不是源 ⇒ `component.items` 槽位不建 | ✅ 静默 | 绕开（改 `ref([...])`） |
| A4 | **`pg-glass`（玻璃叶子）被当「可展开组件」重复展开 ⇒ 卡片黑块** | `template.ts` `isComponentTag && !iconLeaf`——漏了 `glassLeaf`（glassResolver 折成叶子的标签不该再展开） | ✅ 静默 | **修复**（#906：加 `&& !glassLeaf`） |
| A5 | **框架标签族只有 `p-*`，不认 `pg-*`** ⇒ `pg-glass-nav` 不被当组件注册/展开 | `app-component-registry.ts` `tagRegex` 的 `/^p-[a-z]/`（`pg-` 第二字符是 `g`，不匹配） | ✅ 静默 | **修复**（#906：`/^p[a-z]?-[a-z]/`） |
| A6 | **`<pg-glass interactive-effect="displace">` 多词 prop（kebab）不折** | `template.ts` `strProp` 只认 camelCase prop 名 | ✅ 静默 | **修复**（#906：`strProp` 加 kebab 别名） |
| A7 | **App 无「图片」通路**（`<p-image :src>` 无落地）⇒ 演示无法用真实图片/纹理 | 无 `imageResolver`；宿主不处理 image 节点 | ✅ 静默 | 绕开（用色块网格当纹理） |

> **A 类共性**：**Vue 运行时里这些都是语言级自然行为**（computed/响应式/动态类/组件 prop）；App 折叠面都得**显式枚举接受面**，漏一个写法就是一类静默失效（与 #889/#898/#899/#906 同族——「折叠的接受面要覆盖到每一层」）。

## B. 运行时订阅面缺口（订阅表/事件/布局在运行期不对）

| # | 现象（真机） | 根因（file:line） | 静默 | 状态 |
|---|---|---|---|---|
| B1 | **`v-for` 行内 handler 带行参（`@click="pick(r.key)"`）静默不生效** | handler 编成 `{k:'root',name:'r'}`（`events.ts`），而 `dispatch`（`screen-runtime.ts` → `slot-runtime/dispatch.ts` → `handler.ts`）**不传行作用域** ⇒ `r` 取不到 | ✅ 静默 | **修复**（#907：实例化产 `rowScopes`（含「实例节点 id ↔ 模板节点 id」映射 + 行作用域）；派发折回模板 id + handler `read` 走行作用域） |
| B2 | **`v-for` 行内绑定引用外层源（`:class="{on: active==r.k}"`）永不更新** | `build.ts` `inList` 分支**只**把行内槽位挂到**列表源**；`analyzeExprDeps` 已给出 `roots:['active']` 却被丢 ⇒ 外层源不进订阅图 | ✅ 静默 | **修复**（#907：`build.ts` 把行内槽位同时挂外层源 + `listSource`；运行期行内动态 `:class` 按行重算 + `paint.*` 批走宿主 `updatePatches`） |
| B3 | **组件 prop 传字符串值（`:active="navKey"`）⇒ 整屏 `[unsupported type]` 不渲** | `component-prop` 槽位发 `CALL_COMPONENT_UPDATE` 走 `toF32(value)`（只吃 number/boolean）⇒ 字符串抛 | ✅ 静默（整屏） | **修复**（#906：无 `onComponentProp` 时跳过该槽位） |
| B4 | **`position:fixed` 的 `bottom` 落到页面内容底部（屏外）** ⇒ 悬浮导航不显示 | 引擎 `taffy_engine.rs` 把 `fixed` 当 `absolute`、inset 相对**父**（App 页面层，内容高 1400）；CSS 语义应相对**视口** | ✅ 静默 | **修复**（#907：`build_taffy` fixed 挂根 + 运行期视口高 `app-root` 包层） |
| B5 | （同族）fixed 玻璃的**滚动补偿**在独立玻璃遍里缺失 ⇒ 玻璃随滚动下移/文字飞出屏 | `drawGlassPass` 在 onDraw 滚动变换之外，却给 fixed 加 `+scroll`（重复补偿） | ❌ 可见 | **修复**（#907：玻璃遍套用 onDraw 同款 `-scroll` 变换） |
| B7 | **内核增量重排：范围根为 stretch（无显式宽）时，其 `flex:1` 子项被塌成 0**（真机：悬浮 dock 的 4 个导航项宽 231→0，文字/图标消失；一条 `layout.left` 指令即触发） | 内核 `layout_subtree_and_writeback` 把范围子树隔离求解，而范围根**无显式宽**（宽由父 stretch 撑开）⇒ taffy 按 auto=内容宽算 ⇒ `flex-basis:0` 子项撑不出宽 ⇒ 范围根塌成内容尺寸 | ❌ 可见 | **修复**（#907：隔离求解前把范围根**上次解析出的实际尺寸**钉到拷贝子树根上——边界尺寸与内容无关，本次重排不该改它） |
| B6 | **行内 `:class` 的绘制字段（color/fontWeight）在运行期静默丢弃**——即使 B2 修好、槽位重算了，也“求值了但找不到节点” | 运行期 `createScreenRuntime` 的**实例化用 `ListRegistry` 与 `VaporRuntime` 用的不是同一实例** ⇒ 运行期读空表解析不到行节点；且运行期**未接 `onPaintProp` 出口**（绘制字段无处可去） | ✅ 静默 | **修复**（#907：共享 `ListRegistry` + 运行期 `onPaintProp`/`updatePatches` 批量通道，与 `entry-vapor` 同构） |

> **B 类共性**：**行作用域（row scope）在事件派发与跨源订阅里没有贯通**——`v-for` 里的绑定/handler 一碰到「行数据以外的东西」（外层源、行参），要么不订阅、要么派发时取不到 ⇒ 静默失效。**这是 Vue 运行时「作用域链」能力的结构性缺失。**

## C0. 运行期指令的单位缺口（跨端，非本会话引入）

| # | 现象（真机） | 根因（file:line） | 静默 | 状态 |
|---|---|---|---|---|
| U0 | **`applyOps`（运行期增量指令）里的长度值不乘密度** ⇒ App 上「动态改 left/width/…」只走 1× 距离（静态 mount 正确——它走 physicalizeTree ×密度）。真机：悬浮 dock 高亮胶囊 hlLeft 从 83→237（逻辑）到位应为 711 物理，实际只到 237 物理（=0.33×，胶囊**落在错误项**） | `VaporRenderHost.physicalizeTree` 只物理化 **mount 的 tree JSON**；`applyOps` 的**二进制指令值在 JS 侧编码、内核侧解码** ⇒ 宿主无法介入换算（**已在源码注册为 U0**，见 physicalizeTree 注释「诚实边界」） | ❌ 可见 | **已修（#935）**——内核侧接密度：新增 `proteus_layout_set_density`（`TreeEntry.density`），`apply_style_key_d` 对**长度键**（width/height/*inset/margin/padding/gap/flexBasis 等，白名单 `is_length_key`）×density（枚举/比例/比值不缩放）；Android 宿主 `mount`/`mountVirtual` 建 handle 后调 `RustLayout.setDensity(handle, lengthScale)`。真机：胶囊 hlLeft 到位 873（=192 项左缘），四点位全部命中正确项 |

> **U0 共性**：**「单位换算在入口做一次」** 只覆盖了 mount 通路；**运行期指令通路（applyOps）**是另一条**跨语言边界**（值在 JS 编、内核解），宿主没有介入点 ⇒ **动态几何值的单位与静态值不一致**。iOS 因 CALayer=point（逻辑）而**恰好**正确（与 #892 同因），Android 显式换算 ⇒ 只在 Android 显形。**这与 B7（内核增量）是两回事**：B7 是几何求解错（已修），U0 是**单位**错（未修）。

## C. 我本会话引入的 bug（非框架缺口，如实记录防混淆）

| # | 现象 | 根因 | 修复 |
|---|---|---|---|
| C1 | 长内容只画首屏、新加内容全不显示 | 本会话 #907 给运行期内容包视口高 `app-root` 时**误加 `overflow:hidden`** ⇒ 内容被裁到视口高 | #907 补修（去 `overflow:hidden`） |
| C2 | 悬浮玻璃滚动时下移 | #906 给玻璃遍误加 fixed `+scroll` 补偿（玻璃遍本在滚动变换之外） | #907（玻璃遍套同款变换） |
| C3 | 误判「复合类 `.gna-c.c0` 不折」并改单类 | **实为误判**——探针证明复合类**能折**（真实因是 C1 的裁剪） | 如实标注（不必改） |

---

## 结论与主张

1. **App 端「编译折叠面 + 订阅表」相对 Vue 运行时是「窄接受面」**：`computed`、动态 `:class`（行内）、行作用域事件、跨源订阅、图片通路——**均缺**，且**静默**。
2. **造一个真实演示就撞出 12 面墙**（7 编译折叠 + 5 运行时 + 我引入 3 个 bug）——**OS 级承载（超级应用）无法建立在这种接受面上**。
   ★**本轮（#907）已收口**：A1（`keepReactiveStructure` 保留响应式 v-for/v-if）· B1（行作用域事件）· B2（行内跨源绑定 + `paint.*` 批通道）——**三面墙落地**；其余（computed 产 data / 图片通路 / 普通 const 源）仍**登记待补**。
3. **主张**：把「**App 折叠面/订阅表 ⇄ Vue 运行时**」列为**独立专项**，像「端能力对齐（#477）」那样：以 **Vue 运行时语义为标尺**，逐项登记「Vue 有 / App 折叠面有」的差集，**逐项补接受面 + 配门禁 + 真机判据**。
4. **纪律（本台账的直接诉求）**：**遇到接受面缺口，禁止用改写法绕过**——**必须登记台账 + 立任务卡**（本会话多处以「绕开」处理属反面教材）。
5. **根因一句话**：运行期通路此前**与静态通路共用 `staticInstantiate`**（把`v-for` 折死）+ **A1/B1/B2/B6 的接受面**——墙都在「运行期不被静态折叠取代」这条边界上。`keepReactiveStructure` 把这条边界划出来了：**静态通路（无运行期）折死；运行期通路（`runtime-content.json`）保留活结构**。

## 关联

- 既有相关：`docs/Proteus_Vapor三端能力对照.md` · `docs/Proteus_指令与Vapor能力缺口调研与补齐方案.md` · `docs/Proteus_App三端对齐缺口与收口路线.md` · `docs/proteus-end-alignment-plan/`
- 本会话决策：#906（玻璃契约/叶子/组件族）· #907（fixed 视口语义 + 玻璃内核重做 + 运行期接受面收口 A1/B1/B2/B6）
