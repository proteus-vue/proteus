# Proteus UI · OS 级组件库产品白皮书

> **组件不该是库，是系统的表面。**
> 定位：**Proteus UI**——Proteus 框架的 OS 级组件库（对外产品名，对标 ArkUI / WeUI 的品牌位；对标 ArkUI / SwiftUI / Material 的品质基准，非跨端框架 demo 级）
> 命名体系：对外品牌 **Proteus UI** · 对内工程代号 **Charites**（美惠三女神，备选 Parthenon、Kallos）——与 Themis（CSS 引擎）、Morpheus（动画引擎）、Hephaestus（能力组件）同属万神殿代号体系
> 本文是产品文档（对标商业产品介绍）；工程方案见 `docs/Proteus_OS级组件库方案.md`。所有现状数字来自仓内实测，来源在 §10 逐条可查；**未交付的能力一律标注为承诺而非事实**。

---

## §0 结论摘要（30 秒读完）

| 问题 | Proteus UI 的回答 |
|---|---|
| 这是什么 | 一部**设计宪法** + 四层组件体系 + 两个交互内核——把 Proteus 六件引擎级底座第一次拧成一个"系统表面" |
| 凭什么敢称 OS 级 | 四条判定缺一不可：设计语言成法（裸值即报错）/ 品质是默认项 / 一致性可证明（每组件过 Themis 三层门禁）/ 与平台融合（安全区·玻璃·形态自适应是系统行为） |
| 和 Vant / Ant Design Mobile 的区别 | 它们是 Web 组件库换壳，"三端长得一样"靠肉眼；这里**每组件逐属性对拍 Chromium、各端 ≤0.5dp、截图并排**——一致性是门禁不是愿望 |
| 和 uni-app / Taro 内置组件的区别 | 它们对齐"小程序语义"（兼容面）；Proteus UI 定义"设计语言"（品质面）——两层职责正交，Proteus 两层都有 |
| 现状到目标的差距 | 存量 **79 个组件**有"数量"没"宪法"：0 组件接设计 token（`--sa-*`）、0 组件过 A11y 门禁（22 个仅有零散 role/aria）——P0 先立法，P1 做减法，P2 补品质，P3 扩编 |

---

## §1 命名：对外品牌 Proteus UI · 对内代号 Charites

**对外，它叫 Proteus UI**——组件库与框架共用品牌位（ArkUI / WeUI 同款惯例）：开发者搜"Proteus 组件库"即可寻址，叙事上它是"Proteus 框架的系统表面"，不是又一个第三方库。

**对内，工程代号是 Charites**（美惠三女神：光辉 Aglaea · 欢愉 Euphrosyne · 繁盛 Thalia）——司美丽、优雅与装饰。χάρις（kharis）词根即"恩惠"，与 cosmetic 同源：**设计系统就是框架送给开发者的美之恩赐**。三女神恰可对应三层体系：token（光辉）/ 组件（欢愉）/ 页面骨架（繁盛）。代号用于工程方案文档、内部讨论与编译期诊断码前缀（CHARITES-xxx）。

万神殿一脉相承：Proteus（千变万化）→ Morpheus（形变）→ Themis（裁决）→ Hephaestus（锻造）→ **Charites（美与优雅）**。查重与排除名单见方案 §1（排除 Harmonia：与 HarmonyOS 谐音；排除 Athena：AWS 强占用）。

---

## §2 产品的世界：组件库的三种命运

**第一种命运：demo 级。** 多数跨端框架的内置组件——能跑，但视觉靠作者自觉、交互靠平台默认、三端差异靠用户发现。组件文档里最诚实的句子是"以下属性仅部分平台支持"。

**第二种命运：换壳级。** 把一个 Web 组件库（Vant / Ant Design Mobile）包一层跨端适配——Web 上精致，出了浏览器就开始"尽力还原"。品质的上限是 Web 的 DOM，下限是各端的 diff 清单。

**第三种命运：系统级。** ArkUI 之于 HarmonyOS、SwiftUI 之于 iOS——组件不是第三方库，是**操作系统与开发者的契约**：设计 token 是律法、动效是无障碍感知的一部分、深色模式不用声明就正确、一致性由系统保证而非开发者祈祷。

**Proteus 的处境很特殊：引擎层已经按第三种命运建完了，组件层还停在第一种。**

- 样式一致性引擎 **Themis** 已上线：组件"三端长得一样"可以逐属性证明（113 用例 / 153 项 ≡ Chromium、各端 ≤0.5dp）；
- 动效引擎 **Morpheus** 已在：组件动效却还在手写 CSS animation；
- Fluid 系统已在（formfactor / 安全区 / 焦点导航 / 缩放）：组件却在各自实现避让；
- 187 条原语目录已在（IR 级单一事实源）：组件却在同族分叉——滚动三胞胎、弹层五兄弟、加载三件，连 `p-loading-host` 的注释都在提醒"它与 p-loading 的分工（别混）"。

**存量盘点：79 个组件、约 11,927 行。数量不缺——0 个组件消费设计 token（`--sa-*`），0 个组件过 A11y 门禁（22 个文件有零散 role/aria，无系统清单）。缺的不是组件，是一部宪法。**

**Proteus UI 就是这部宪法。**

---

## §3 产品主张（三条）

**主张一 · 先立法，再扩编。**
设计 token 是**律法不是建议**：组件源码出现裸色值、裸字号、裸间距，编译期直接报错（复用 Themis lint 机制，棘轮只减不增）。在扩编任何新组件之前，先把"美"从作者自觉变成系统强制——顺序不能反。

**主张二 · 品质是默认项，不是可选项。**
手势反馈、进出场动效、无障碍（role/aria/焦点）、44px 触达、键盘导航、深色模式——**不声明也正确，声明可覆盖**。一个组件忘记写 `role`，不是"待优化"，是构建失败。

**主张三 · 每个像素有据可查。**
组件交付的定义不是"写完了"，是**过了门禁**：IR ≡ Chromium 逐属性、各端 ≡ Web ≤0.5dp、三端真截图与 Web 基准并排、深色模式截图并排。Themis 引擎已经把这条管线建好——Proteus UI 是它的第一个大规模消费者。

---

## §4 工作方式：一部宪法 + 四层体系 + 两个内核

```
宪 法 层   Proteus UI Design Tokens —— 单一真源
           收口三套命名空间：--sa-*(视觉) ∪ --pf-*(环境) ∪ 组件字面值
           token = CSS 变量 → 编译期经 CSE 折叠 → lint 拦截裸值（棘轮）
┌────────────────────────────────────────────────────────┐
│ L1 Token      色彩/字号/间距/圆角/阴影/动效曲线/触达      │
│ L2 原语       PRIMITIVE_CATALOG 187 条（既有 SSOT，不动）  │
│ L3 语义组件   p-*：79 个存量的升级面                      │
│ L4 页面骨架   六种标准骨架（视觉规范 L3 收编为组件）        │
└────────────────────────────────────────────────────────┘
横切系统    Motion(Morpheus) · Gesture · A11y · FormFactor
两 个 内核  OverlayKernel（弹层）· ScrollKernel（滚动）
```

**两个内核是杠杆点**——一次投入，一族组件同时受益：

- **OverlayKernel**：遮罩层级（对齐三层挂载规范）+ 智能锚定 + 形态自适应 + 焦点陷阱 + 滚动锁定 + 进出场动效（Morpheus 承接）。p-modal / p-popup / p-popover / p-drawer / p-mask 收编为**同一内核的五个声明式预设**。
- **ScrollKernel**：方向 + bounce + refresh + loadMore + 视口裁剪 + 滚动锁定（与弹层联动）。p-scroll-view 保留为小程序对齐面，p-scrollable 并入内核，p-scroll 淘汰。

---

## §5 八大能力

### 5.1 设计律法（Design Tokens as Law）
三套命名空间收口为单一真源：`--sa-*` 视觉 token（品牌靛蓝、WCAG AA 语义状态色、字号/间距/圆角/阴影/动效曲线、深浅两套）∪ `--pf-*` 引擎环境变量（安全区/系统栏）∪ 组件字面值（清零）。组件不感知主题——深浅色、品牌定制由 token 自动生效。

### 5.2 形态自适应（Adaptive Form）
一次声明，端无关：`<p-modal p-adaptive="sheet|dialog|popover">`——手机底部滑入 / 平板居中 / 桌面锚定触发器，按 formfactor 自动切换。该 API 形状已在 p-modal 验证，内核将它推广到全部弹层族。

### 5.3 动效即声明（Motion by Declaration）
组件动效从手写 CSS animation 改为声明 motion token（进出场/微反馈/转场三档），Morpheus 引擎统一实现——动效在 Skyline 走 Worklet、在 App 走原生驱动，组件零平台分支。

### 5.4 可证明的一致性（Provable Consistency）
每组件纳入 Themis 基准三件套：计算样式 golden（IR ≡ `getComputedStyle` 逐属性）+ 几何对拍（≤0.5dp，容差逐字段）+ 截图并排（每行左半 = Web 基准，缺证据如实标注）。**这是别的组件库给不出的交付物。**

### 5.5 无障碍门禁（A11y Gates）
交互组件缺 `role`/`aria` ⇒ 编译期 E；焦点管理接 Fluid focus-nav；对比度 AA 由语义状态色 token 保证（沿用视觉规范既有达标结论）。无障碍从 README 里的"路线图"变成门禁里的红绿灯。

### 5.6 与系统能力同仓（Native-Grade Fusion）
安全区避让、系统玻璃（p-glass）、键盘避让是**系统层行为**；84 个能力 Hook 与 Hephaestus 能力组件（相机/定位/扫码/地图）正交互补——UI 组件需要能力时调用现成产物，不重写。支持度矩阵含"是否需原生基座"列。

### 5.7 原语 SSOT（Primitive Catalog）
187 条 PRIMITIVE_CATALOG 是组件的 IR 级单一事实源，目录一致性有审计闭环（`auditCatalogConsistency`）——组件库永远不会漂成"第二套运行时"。新组件必须先登记原语再建组件。

### 5.8 页面骨架（Page Skeletons）
视觉规范 L3 的六种标准骨架（工作台/列表/设置/表单/详情/控制台）从样式类（`.sa-*`）收编为组件——生产应用最高频的"页级结构"开箱即得，分组间距与安全区留白由骨架默认承担。

---

## §6 数字页（现状基线 × 门禁承诺，口径分列）

| 指标 | 数值 | 口径 |
|---|---|---|
| **79** 个语义组件 / **11,927** 行 | 现状存量 | `packages/components` 2026-10-07 实测 |
| **187** 条原语 | 现状 SSOT | PRIMITIVE_CATALOG + audit 闭环 |
| **84** 个能力 Hook | 现状可复用 | Hephaestus / capabilities 体系 |
| **0** 个组件接设计 token（`--sa-*`）/ **0** 个过 A11y 门禁（22 个仅零散 role/aria） | **现状缺口**（P0/P2 收口对象） | `grep -rl "var(--sa-" packages/components/p-*/` 零命中；`aria-`/`role=` 命中 22 文件但无门禁清单 |
| **≤0.5 dp** 几何对拍 | **交付门禁**（每组件） | Themis 判据②，容差逐字段 |
| **逐属性** ≡ Chromium | **交付门禁**（每组件样式） | Themis 判据①管线 |
| **44 px** 触达 / **AA** 对比度 | **交付门禁** | HIG 基准 / token 语义色 |
| 79 → **约 65** 组件 | P1 目标（做减法） | 家族收口 + deprecation 棘轮 |
| **6** 种页面骨架 | P3 收编目标 | 视觉规范 L3 |

> 口径纪律：现状与承诺分列——**79/187/84/0 是今天的实测**；门禁行是组件"交付"的准入线，未过线不标交付（数字不粉饰，沿用 Hephaestus 对外口径铁律）。

---

## §7 横向对比

| 维度 | **Proteus UI** | ArkUI / SwiftUI | WeUI | Vant / Ant DM | uni-app / Taro 内置 |
|---|---|---|---|---|---|
| 定位 | 系统表面（宪法 + 四层 + 内核） | 系统表面 | 微信视觉规范 | Web 组件库 | 小程序语义对齐 |
| 设计 token | **律法（裸值即报错，棘轮）** | 资源体系 | 样式表建议 | 主题变量（可绕过） | 无 |
| 多端一致 | **每组件三层对拍 + 截图并排（可证明）** | 单端系统（无此问题） | 单端 | 跨端靠肉眼/端差清单 | 端差文档化 |
| 动效 | **引擎承接（Morpheus，声明 token）** | 系统动画 | CSS | CSS 手写 | 各端各写 |
| 无障碍 | **编译期门禁** | 系统级 | 部分 | 文档建议 | 无系统治理 |
| 平台融合 | 安全区/玻璃/形态自适应为系统行为 | 系统级 | 微信容器 | DOM 行为 | 小程序容器 |
| 能力组件 | **同仓正交（Hephaestus，84 Hook）** | 系统API | 无 | 无 | 插件/基座 |

**一句话差异化**：Web 组件库把"跨端"当适配问题，OS 组件库把"一致"当系统职责——**只有 Proteus 同时拥有引擎（可证明）与能力层（可融合），Proteus UI 是第一个把两者用在组件上的体系。**

---

## §8 开发者体验

**弹层只写意图，形态交给系统：**

```vue
<p-modal v-model:visible p-adaptive="sheet(0,600) | dialog(600,840) | popover(840,∞)" :anchor="triggerRef">
  <!-- 手机 = 底部 Sheet / 平板 = 居中 Dialog / 桌面 = 锚定 Popover -->
  <!-- 遮罩层级、焦点陷阱、滚动锁定、进出场动效：内核默认，无需声明 -->
</p-modal>
```

**主题只写 token，组件自动跟随：**

```css
:root { --sa-brand: #4f46e5; }          /* 品牌定制——所有组件跟随 */
@media (prefers-color-scheme: dark) { … } /* 深色：token 双套自动生效 */
```

**写错即构建失败：**

```
error CHARITES-001: p-button 源码出现裸色值 "#4f46e5"
  → 使用 var(--sa-brand) 或语义 token（--sa-intent-primary）。
    组件内禁止字面样式（Charites 宪法 OS-1，棘轮基线见 baseline 文件）。

error CHARITES-011: 交互组件 <p-switch> 缺少 role/aria 标注
  → 开关类语义 role="switch" + :aria-checked（宪法 OS-2 门禁）。
```

**收编不静默：**

```
warn DEPRECATION: <p-scroll> 已收编进 ScrollKernel（p-scroll-view）
  → 本构建允许使用；下个 minor 起编译期报错（棘轮）。
```

---

## §9 边界与承诺（诚实边界 = 产品原则）

**分期承诺，不提前支取：**
- P0（宪法/双内核）、P1（家族收口）、P2（品质维度）、P3（扩编）——**本白皮书描述的是终态与门禁，当前处于 P0 立项**；任何"已支持"表述以分期验收记录为准。
- 存量 79 组件在 P0/P1 期间**行为不变**（并行、逐批收口、每批可回退——沿用 Themis §2.2"禁一次性替换"纪律）。

**禁语（对外表述纪律）：**
- 不得说"像素级一致"——是逐属性 + ≤0.5dp + 截图观察三层，像素层非门禁；
- 不得说"完整无障碍"——是"交互组件 role/aria 门禁 + 焦点管理"，screen reader 全流程不在 v1 承诺内；
- 不得说"性能零开销"——内核抽象层有成本，数字以真机矩阵为准；
- 不得说"79 个组件全部 OS 级"——收编是逐家族的，未过门禁的组件如实标注"存量"。

**不做清单：**
- 不重写 Hephaestus 能力组件；不建第二套能力 Hook；
- 不另起第三套 token 命名空间（收口而非发明 --ct-\*）；
- 不引第三方组件库分叉做套壳（§4 判据 OS-3 只有自研能满足）；
- 不做一次性替换。

---

## §10 证据索引（每条可 grep）

| 本文表述 | 证据 |
|---|---|
| 79 组件 / 11,927 行 / 家族行数分布 | `ls packages/components/p-*`、逐目录 `wc -l`（2026-10-07 实测） |
| 0 设计 token 消费 / 0 A11y 门禁（22 文件有零散 role/aria）/ 动效手写 | `grep -rl "var(--sa-" packages/components/p-*/` 零命中（`var(--` 命中 23 处但均为组件级 `--p-*` 局部变量）；`grep -rlE "aria-\|role=" packages/components/p-*/` 命中 22 文件（无门禁清单） |
| 滚动三胞胎 / 弹层五兄弟 / 加载三件 | `packages/components/p-{scroll,scroll-view,scrollable}` / `p-{modal,popup,popover,drawer,mask}` / `p-{loading,loading-host,loading-region}` 头注释 |
| p-adaptive 形态声明（内核 API 形状） | `packages/components/p-modal/index.vue` |
| 187 原语 + audit 闭环 | `packages/component-ir/src/primitives.ts`、`audit.ts` |
| Themis 三层门禁 / 113 用例 153 项 | `docs/proteus-css-engine-plan/README.md` §3/§4 |
| 视觉规范 L1/L2/L3、AA 达标、深色机制 | `docs/Proteus_超级应用视觉设计规范.md`、`superapp/styles/global.css` |
| Fluid 模块清单 / glass / gesture / 84 Hook | `packages/fluid/src`、`packages/glass/src`、`packages/gesture/src`、`packages/capabilities/src` |
| 超级应用验收口径 / 数字不粉饰铁律 | `docs/Proteus_高频原生能力组件方案.md` 头部 |
| 分期与收口纪律 / 诚实边界 | `docs/Proteus_OS级组件库方案.md` §5–§9 |

---

> **Proteus UI**（代号 Charites）——美不是作者自觉，是系统律法；优雅不是适配结果，是默认行为。
