# Proteus OS 级组件库方案

> 代号 **Charites**（美惠三女神——司美丽、优雅与装饰）。备选：Parthenon（帕特农神庙）、Kallos（καλλος，美且好）。**定名前须做正式商标与包名检索。**
> 版本 v1 · 关联：Themis（G-61 CSS 引擎）、Morpheus（动画引擎）、Hephaestus（高频原生能力组件）、Janus（原生资产复用）、《超级应用视觉设计规范》
> **验收标准（沿用用户 2026-10-03 为 Hephaestus 明示的口径）**：**超级应用标准，不是跨端框架 demo 级**。

---

## §0 结论摘要（30 秒读完）

| 问题 | 结论 |
|---|---|
| 有没有"天然条件"做 OS 级组件库 | ✅ **有，而且条件是引擎级的**——样式一致性引擎（Themis）、动效引擎（Morpheus）、环境自适应层（Fluid）、原生材质/能力/手势、147 原语目录、设计规范草案，六件资产别人凑不齐 |
| p-\* 现在到底差在哪 | 不是"组件少"（已有 **79 个 / 约 1.2 万行**），是**没有宪法**：0 个组件消费设计 token、0 个有无障碍标注、动效各写 CSS animation、同族组件三胞胎/五兄弟分叉 |
| 方案核心 | **先立法，再执法，最后扩编**：P0 立宪法（token 收口 + 内核统一 + lint 门禁）→ P1 家族治理（做减法）→ P2 补品质维度 → P3 扩编 |
| 与 Hephaestus 的分工 | Hephaestus 管**能力组件**（相机/定位/扫码…），本方案管 **UI 组件**（弹层/滚动/导航/表单/数据展示）——两轴正交，都不重写对方 |
| 最大风险 | 79 个存量组件的迁移量——靠**棘轮 + 家族收口**消化（每收一个家族减一套实现），不做一次性替换 |

---

## §1 命名

### 1.0 ★品牌决策（2026-10-07）：对外品牌定名 **Proteus UI**

- **对外产品名：`Proteus UI`**——组件库与框架共用品牌位（ArkUI / WeUI 同款惯例），是开发者可寻址的产品名；
- **对内工程代号：`Charites`**——用于工程文档、内部讨论、编译期诊断码前缀（CHARITES-xxx）；
- 本文与产品白皮书（`docs/Proteus_Charites组件库产品白皮书.md`）采用双名制：标题/对外叙事用 Proteus UI，工程语境用 Charites。
- 文件名暂不改（含 Keryx/Koine 方案中的交叉引用）；如需重命名建议一次性同步三处引用。

### 1.1 命名逻辑

框架名 **Proteus**（千变万化）、动画引擎 **Morpheus**（形变）、CSS 引擎 **Themis**（裁决与律法）、能力组件 **Hephaestus**（锻造）——本命名体系的语义轴是"神职即模块职责"。组件库的神职只有一个：**美与优雅的系统化**——这正是美惠三女神（Charites）的司掌。χάρις（kharis）词根即"恩惠"：设计系统是框架送给开发者的美之恩赐（cosmetic 一词与它同源，语义双关）。

### 1.2 候选与查重结论

| 候选 | 语义 | 查重结果 | 评估 |
|---|---|---|---|
| 🥇 **Charites** | 美惠三女神：光辉（Aglaea）/欢愉（Euphrosyne）/繁盛（Thalia）；司美丽、优雅、装饰 | ✅ 仓内零命中；同领域未见占用 | **推荐**。神名体系内语义最贴；三女神恰可对应三层体系（token/组件/骨架） |
| 🥈 **Parthenon** | 帕特农神庙：多立克柱式 = token 比例系统、预制大理石构件 = 标准化组件、"城邦的系统级建筑" | ⚠️ 有 PHP 框架占用（不在同领域） | 隐喻极强但破例用建筑名（本体系此前全为神名） |
| 🥉 **Kallos** | καλλος——希腊美学的核心命题"美且好"（美即善） | ✅ 未发现同领域占用 | 简洁好读；语义抽象度略高 |

### 1.3 必须排除的名字

| 名字 | 排除原因 |
|---|---|
| ~~**Harmonia**~~ | 与 **HarmonyOS** 谐音——在"鸿蒙宿主"语境里是致命混淆 |
| ~~**Athena**~~ | AWS Athena 强占用 |
| ~~**Graces**~~ | 英文泛词，检索不可寻址 |

**主推 `Charites`，备选 `Parthenon`。** 下文统一以 **Charites** 指代。

---

## §2 为什么是"天然条件"：六件别人凑不齐的引擎级资产

"OS 级组件库"的行业基准是 ArkUI / SwiftUI / Material / WeUI——共同点是：**组件不是孤立 UI 件，而是一部"系统"的对外表面**（设计语言 + 交互品质 + 平台融合 + 可证明的一致性）。逐条对照，Proteus 已有六件底座：

| # | 资产 | 给组件库的供给 | 证据 |
|---|---|---|---|
| ① | **Themis**（G-61，B0–B5 ✅） | 组件视觉一致性**可证明**：IR ≡ Chromium 逐属性、各端 ≡ Web ≤0.5dp、真截图并排——别的框架做组件库，"三端长得一样"靠肉眼；这里靠门禁 | `docs/proteus-css-engine-plan/README.md` §3 |
| ② | **Morpheus**（动画引擎） | 系统动效：组件只声明 motion token（进出场/微反馈/转场），实现统一走引擎——现状组件各自手写 CSS animation（`p-popup`/`p-loading` 即如此） | `docs/Proteus_声明式动画引擎Morpheus方案.md` |
| ③ | **Fluid System** | OS 级的"环境自适应"已有框架层：formfactor / breakpoint / safe-area / env-vars / focus-nav / scale / motion——组件的响应式与安全区避让**天然是系统行为**而非组件各自实现 | `packages/fluid/src/`（15 模块） |
| ④ | **原生材质与能力层** | `glass`（系统玻璃材质与降级）+ `capabilities`（84 Hook）+ `gesture`（识别器）+ Janus（原生资产复用）——OS 级的"材质感"与原生融合有真后端 | `packages/glass/src`、`packages/capabilities/src`、`packages/gesture/src` |
| ⑤ | **PRIMITIVE_CATALOG（147 原语）+ audit 闭环** | 组件有 **IR 级单一事实源**：每个 p-\* 是原语的语义化封装，目录一致性有审计（`auditCatalogConsistency`）——组件库不会漂成"第二套运行时" | `packages/component-ir/src/primitives.ts`（147 条） |
| ⑥ | **《超级应用视觉设计规范》** | 设计语言已起草：L1 token（品牌靛蓝、WCAG AA 语义色、字号/间距/圆角/阴影/动效、深色模式机制）、L2 组件类、L3 六种页面骨架 | `docs/Proteus_超级应用视觉设计规范.md` + `superapp/styles/global.css` |

**结论：Proteus 是目前唯一"引擎层先行、组件层后补"的跨端框架——组件库不是从零造，是把六件底座第一次拧成一个表面。**

---

## §3 现状诊断：p-\* 为什么"粗糙"（三条根因，全部可 grep）

存量盘点：**79 个 p-\* 组件，约 11,927 行**；最大 `p-formfactor` 1410 行，最小如 `p-mask` 35 行、`p-box` 约 50 行。数量不缺，缺的是三样东西：

### 根因 A · 视觉无真源（最致命）
- **0 个组件消费设计 token**：`packages/components/p-*/` 全目录 grep `var(--` **零命中**——《视觉规范》定义了 `--sa-*`，引擎定义了 `--pf-*`，组件却全部字面样式（`p-avatar` 75 行、`p-skeleton` 56 行，无一变量）。
- **三套 token 命名空间并存互不相通**：`--sa-*`（superapp 视觉）、`--pf-*`（引擎环境变量）、组件内字面值——"换主题/深色模式/品牌定制"对 p-\* 组件**不生效**。

### 根因 B · 家族分叉（同一职责多套实现）
| 家族 | 分叉现状 | 证据 |
|---|---|---|
| 滚动 | **三胞胎**：p-scroll（44 行）/ p-scroll-view（157 行）/ p-scrollable（82 行），各自描述"滚动容器 + refresh/loadMore" | 三份头注释三种说法（"对齐 scroll-view" / "薄包装" / "bounce+refresh+loadMore"） |
| 弹层 | **五兄弟**：p-modal（239）/ p-popup（192）/ p-popover（183）/ p-drawer（122）/ p-mask（35）——遮罩、定位、转场动画、关闭语义**各自手写** | 各文件头注释；p-modal 已自行长出 `p-adaptive` 形态声明（仓内验证过的正确方向） |
| 加载 | **三件**：p-loading（79）/ p-loading-host（283）/ p-loading-region（103）——头注释自带"【它与 p-loading 的分工（别混）】"，**连代码库自己都在担心混淆** | `packages/components/p-loading-host/index.vue` |
| 导航 | **三件**：p-nav（57）/ p-nav-bar（148）/ p-tabbar（104），安全区避让与返回语义不共享 | 各文件头注释 |

### 根因 C · 品质缺维度
- **0 个组件有无障碍标注**：`aria-`/`role=` 在 p-\* 全目录**零命中**——OS 级的第一道门就没过。
- **动效未接引擎**：转场/微反馈全部 CSS animation 手写，Morpheus 未成为组件动效后端。
- **触达/键盘/RTL 无系统治理**：44px 触达、焦点环、键盘导航（fluid 的 focus-nav 已有）无一处成为组件默认项。
- **双组件体系并存**：`built-in-components`（13 个小程序对齐 shim，1094 行）与 `components`（79 个）各自演化。

> **一句话诊断**：不是组件库太小，是**没有宪法**——视觉靠各组件作者自觉、交互品质无门禁、同族实现靠注释里写"别混"来维持秩序。

---

## §4 "OS 级"的判定标准（四条，写进验收）

| # | 判据 | 对标 |
|---|---|---|
| **OS-1 设计语言成法** | token 是**律法不是建议**：组件源码出现裸色值/裸字号/裸间距即编译期报错（复用 Themis lint 机制，棘轮） | Material tokens / ArkUI 资源体系 |
| **OS-2 交互品质是默认项** | 手势反馈、动效、无障碍（role/aria/焦点）、44px 触达、键盘导航、深色模式——**不声明也正确**，声明可覆盖 | SwiftUI / HIG |
| **OS-3 一致性可证明** | 每组件纳入 Themis 基准三件套（计算样式 golden + 几何 ≤0.5dp + 截图并排），三端门禁绿才算交付 | ——（只有 Proteus 能做） |
| **OS-4 与平台融合** | 安全区避让、系统玻璃（p-glass）、系统手势、键盘避让是**系统层行为**：组件写对意图，端实现由框架承担 | ArkUI（声明式 + 系统代偿） |

---

## §5 架构：一部宪法 + 四层体系 + 两个内核

```
宪 法 层   Charites Design Tokens —— 单一真源
           收口三套命名空间：--sa-*(视觉) ∪ --pf-*(环境) ∪ 组件字面值
           token = CSS 变量 → 编译期经 CSE 折叠 → lint 拦截裸值（棘轮）
┌────────────────────────────────────────────────────────┐
│ L1 Token      色彩/字号/间距/圆角/阴影/动效曲线/触达     │
│ L2 原语       PRIMITIVE_CATALOG 147 条（已有，不动）      │
│ L3 语义组件   p-*：升级面（本方案主战场）                 │
│ L4 页面骨架   六种标准骨架（视觉规范 L3 收编为组件）       │
└────────────────────────────────────────────────────────┘
横切系统    Motion(Morpheus token 匾) · Gesture · A11y · FormFactor(p-adaptive 收编)
两 个 内核  OverlayKernel（弹层）· ScrollKernel（滚动）
```

**两个内核是本方案的杠杆点**——一次投入，五个/三个组件同时受益：

- **OverlayKernel**：遮罩层级（三层挂载规范对齐）+ 智能锚定定位 + 形态自适应（`sheet/dialog/popover` 按 formfactor 自动切换——p-modal 已验证该 API 形状）+ 焦点陷阱 + 滚动锁定 + 进出场动效（走 Morpheus）。p-modal / p-popup / p-popover / p-drawer / p-mask 全部变成**同一内核的五个声明式预设**，行为差异只体现在 props 契约上。
- **ScrollKernel**：滚动方向 + bounce + refresh + loadMore + 视口裁剪（对齐可停靠滚动/编排方案）+ 滚动锁定（弹层联动）。p-scroll-view 保留为**小程序对齐面**（微信语义），p-scrollable 并入内核实现，p-scroll 淘汰。

---

## §6 与既有方案的对账（禁重复建设——Hephaestus 的教训前置）

| 既有资产 | 本方案态度 |
|---|---|
| **Hephaestus**（能力组件：相机/定位/扫码/地图…） | **正交不重叠**：能力组件的"超级应用级验收"（真机矩阵/基座列）本方案直接沿用；UI 组件需要能力时（如 p-camera 预览）调用 Hephaestus 产物，不重写 |
| **《超级应用视觉设计规范》**（--sa-\* + global.css） | **升级为宪法真源**：token 从"superapp 工程的样式表"上移为框架包（`@proteus-vue/tokens`），规范文档变为 token 的说明页 |
| **p-modal 的 p-adaptive 形态声明** | **采纳为 OverlayKernel 的公开 API 形状**（仓内已验证，不自创新形） |
| **built-in-components（13 shim）** | 保持小程序对齐面不动；p-\* 语义组件是其上层，**不合并**（对齐面是端语义，组件库是设计语言） |
| **147 条 PRIMITIVE_CATALOG** | SSOT 不动，新组件必须先登记原语再建组件（audit 闭环已有） |

---

## §7 分期：先立法，再执法，最后扩编

| 期 | 内容 | 交付判据 |
|---|---|---|
| **P0 宪法**（先行，不可跳过） | ① `@proteus-vue/tokens`：收口 `--sa-*`/`--pf-*` 为单一真源（含深色两套、语义状态色 AA 达标沿用既有）② **裸值 lint**：p-\* 源码裸色值/字号/间距 ⇒ E 报错，存量钉棘轮基线 ③ **OverlayKernel + ScrollKernel** 两个内核落地（存量组件行为回归对拍） | 内核组件过 Themis 三层对拍；lint 在 Web 构建链真实拦截 |
| **P1 家族治理**（做减法） | 弹层五兄弟 → 内核五预设；滚动三胞胎 → p-scroll-view（对齐面）+ 内核；加载三件 → 职责重划（loading=服务态 / skeleton=骨架态 / host=宿主）；导航三件 → 统一安全区与返回语义；**deprecation 棘轮**（被收编组件先 warn 后 error） | 家族内行为差异全部登记进 `allow-differences.json` 或消除；组件总数**下降**（79 → 约 65） |
| **P2 品质维度** | ① A11y：role/aria 必填清单 + 焦点管理接 fluid focus-nav ② Motion：组件动效全部改声明 motion token（Morpheus 承接）③ 触达 44px / 键盘 / RTL 默认项化 | A11y 门禁（缺失即 E）；动效零手写 CSS animation |
| **P3 扩编** | 补超级应用高频件（需求以现有最大组件为证：p-picker 429 行最大，picker 族值得官方分级；segmented / badge / cell / fab / 空态官方化——吸收 `.sa-*` 类成组件） | 新组件逐个过 §4 四条判据 + 真机矩阵（沿用 Hephaestus 超级应用验收） |

---

## §8 验收标准（超级应用级，逐条可执行）

1. **每组件三层对拍**：IR ≡ Chromium 逐属性 / 各端 ≡ Web ≤0.5dp / 截图并排（ Themis 门禁，非自愿）。
2. **真机矩阵**：多品牌多版本真机，不是模拟器跑通（沿用 Hephaestus 口径）。
3. **静默失败必有单测**：降级路径（如 Skyline 无 aspect-ratio → p-box 已示范）逐组件登记。
4. **支持度矩阵含"是否需原生基座"列**（与 uni-app 的分水岭指标）。
5. **A11y 门禁**：交互组件缺 role/aria ⇒ 编译期 E。
6. **裸值门禁**：组件源码零裸 token 值（棘轮只减不增）。
7. **允许差异显式登记**（追加进 `docs/allow-differences.json` A 序列）。
8. **深色模式**：每组件深色截图并排留证（token 双套自动生效，组件不得硬编码例外）。

---

## §9 不做清单（诚实边界）

- **不重写 Hephaestus 能力组件**、不建第二套能力 Hook。
- **不另起第三套 token 命名空间**（收口 --sa-\*/--pf-\*，而非发明 --ct-\*）。
- **不引 Vant/Ant/WeUI 分叉**做"套壳"——OS 级的判定标准（§4）第三条只有自研能满足。
- **不一次性替换 79 个组件**——家族收口 + 棘轮，每一步可回退（沿用 G-61 §2.2"并行、逐批切换"纪律）。
- **v1 不承诺**：RTL 全量治理、复杂无障碍场景（screen reader 全流程）、动效全量 token 化——如实标注覆盖范围，不粉饰。

---

## §10 证据索引（每条可 grep）

| 本文表述 | 证据 |
|---|---|
| 79 组件 / 11,927 行 / 行数分布 | `ls packages/components/p-*`；逐目录 `wc -l`（2026-10-07 实测） |
| 组件 0 token 消费 | `grep -r "var(--" packages/components/p-*/` 零命中 |
| 全组件 0 无障碍 | `grep -r "aria-\|role=" packages/components/p-*/` 零命中 |
| 滚动三胞胎/弹层五兄弟/加载三件/导航三件 | `packages/components/{p-scroll,p-scroll-view,p-scrollable}/{p-modal,p-popup,p-popover,p-drawer,p-mask}/{p-loading,p-loading-host,p-loading-region}/{p-nav,p-nav-bar,p-tabbar}` 头注释 |
| p-modal p-adaptive 形态声明（内核 API 形状） | `packages/components/p-modal/index.vue` 头注释 |
| 147 原语 + audit 闭环 | `packages/component-ir/src/primitives.ts`、`audit.ts` |
| Themis 三层门禁 / 动效引擎 / fluid 模块清单 | `docs/proteus-css-engine-plan/README.md`、`docs/Proteus_声明式动画引擎Morpheus方案.md`、`packages/fluid/src/` |
| 视觉规范 L1/L2/L3 与 --sa-\* | `docs/Proteus_超级应用视觉设计规范.md`、`superapp/styles/global.css` |
| 超级应用验收口径（真机矩阵/基座列/单测） | `docs/Proteus_高频原生能力组件方案.md` 头部验收标准 |
