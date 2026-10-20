# Proteus 液态玻璃系统组件库方案

> 代号 **Aether**（Αἰθήρ，原初之神·澄澈的上层天光/光之介质；备选 **Aletheia**）。**定名前须做正式商标与包名检索**（同 Charites 纪律）。
> 版本 v1（2026-10-13 立项）· 关联：`docs/proteus-glass-plan/`（玻璃**引擎**，底座）· `docs/Proteus_OS级组件库方案.md`（Charites / Proteus UI，**另一套**通用 UI 组件）· `docs/Proteus_超级应用视觉设计规范.md` · `docs/Proteus_高频原生能力组件方案.md`（Hephaestus，超级应用验收口径）
> **验收标准（沿用用户 2026-10-03 / 2026-10-13 明示口径）**：**OS 级高标准 + 超级应用生产可用**，不是跨端框架 demo 级。

---

## §0 结论摘要（30 秒读完）

| 问题 | 结论 |
|---|---|
| 这是什么 | **框架内置、独立于 `p-*` 的「液态玻璃系统组件库」**——用**玻璃材质**承载**系统外壳/应用容器**语义（导航条/标签栏/弹层/侧栏/分段…）的组件族 |
| 和既有三套的关系 | **不重叠、不合并**：`p-*`（Charites）= 通用 UI 原语（材质无关）；`lg-*`（本方案）= **玻璃系统外壳**（材质即身份）；玻璃**引擎**（G-07）= 两者共同底座 |
| 为什么现在立项 | 玻璃**引擎**已基本就绪（Rust WGSL 单源 → 三端自绘玻璃遍；`@proteus-vue/glass` SSOT；`<pg-glass>` 单入口；编译期折叠；治理门禁），**缺的是"成体系的组件产品"** |
| 标准 | OS 级四条（§4）+ 超级应用级验收（§8，逐条可执行） |
| 载体 | **`superapp/`**（框架最终验收场）——每个 `lg-*` 组件先在 superapp 真实业务形态里验（沿用 Hephaestus 口径） |
| 最大风险 | 玻璃自绘在 App 端**有已知性能坑**（#862–#864：瓶颈=背景捕获，非着色器）⇒ 组件须**声明式**、捕获策略由框架承担，不能各组件各写 |

---

## §1 命名

### 1.1 命名逻辑（万神殿「神职即模块职责」）

> ★命名体系**完整规范 + 总览**见 **`docs/Proteus_万神殿命名规范.md`**（决策 #879）——本模块取名须符合其纳名纪律（N-1 只收神话神名 / N-2 体系内不得撞名 / N-3 定名前须商标检索）。

框架神名体系：Proteus（千变万化）· Kairos（时机/动画）· Themis（律法/CSS）· Hephaestus（锻造/能力）· Janus（双面/原生资产）· Keryx（传令/图标）· Charites（美惠/组件库）· Mnemosyne（记忆/可归因）· Helios（全视/调试）。
本方案 = **通透的承光外壳**——神职是"**让光透过、覆于万物而万物在其下可见的介质**"。主推 **Aether**（Αἰθήρ）。

| 候选 | 语义 / 神职映射 | 评估 |
|---|---|---|
| 🥇 **Aether** | Αἰθήρ，**原初之神：澄澈的上层天光 / 纯光元素**（与凡人浊气 Aer 相对的"神明呼吸的光之高层"）；古典物理学 "luminiferous aether" = **光传播的介质**。神职 = **让光透过的介质 / 覆于万物的穹顶** → 玻璃外壳 | ✅ 仓内零命中；前端领域未见显著占用；神职映射最贴（"光在其中穿行、万物在其下可见"）。**推荐** |
| 🥈 **Aletheia** | Ἀλήθεια，真理女神——"**去蔽/揭示**"（a-lethe = 非遮蔽）。神职 = 透明即揭示 | ✅ 仓内零命中；外部较干净；语义较抽象、略学究 |
| ❌ 排除 **Theia** | Θεία，光与视觉（"使万物可见的明亮之光"）——神职极贴 | **外部撞名 Eclipse Theia（知名 IDE 框架，领域相近）** ⇒ 排除（同本仓 Iris 排除先例） |
| ❌ 排除 **Aura** | Αὔρα，风之女神 | 外部撞名 Salesforce Aura 框架 ⇒ 排除 |
| ❌ 排除 **Eos** | Ἠώς，黎明——"光漫开" | 外部撞名 EOS（区块链）/ EOS 相机 ⇒ 排除 |
| ❌ 排除 **Metis** | Μῆτις，智慧/技艺 | 外部撞名 Metis JS 框架 ⇒ 排除 |
| ❌ 排除 ~~Hyaleos / Krystallos~~ | ὕαλος / κρύσταλλος = 玻璃 / 水晶（**普通名词，非神名**） | **破万神殿命名纪律**（本体系全为神名/泰坦）；用户裁定改神名 ⇒ 弃用 |
| ❌ 排除 ~~Iris / Hermes / Kinesis / Triton / Argus~~ | —— | 本仓**已裁定排除**（Iris=iris-engine 撞名 Rust+Vue3；Hermes=JS 引擎；Kinesis/Triton/Argus 见 Kairos/Themis 白皮书） |
| ❌ 排除 ~~Aegis / Vitreus / GlassUI~~ | 盾（非玻璃）/ 拉丁语系（破例）/ 不可寻址 | —— |

> ★**Aether 的神职映射（一句话）**：Aether 是"**光得以穿行的高层澄澈之气**"——正如玻璃是"**光得以穿行、而背后万物可见的介质**"。`lg-*` 组件把应用"覆"在一层这样的介质之下（系统外壳），故取此名。
> ★**定名前须做正式商标与包名检索**（对齐仓库命名纪律；检索通过前不入万神殿已定名清单）。

### 1.2 标签前缀（对外 API）

| 体系 | 前缀 | 例 |
|---|---|---|
| Charites 通用 UI | **`p-*`** | `<p-button>` `<p-modal>` |
| 玻璃**基件**（引擎单入口） | **`pg-*`** | `<pg-glass>` |
| **本方案：玻璃系统外壳** | **`lg-*`**（liquid glass） | `<lg-bar>` `<lg-sheet>` `<lg-tab-bar>` |

★`lg-*` 组件**内部渲染 `<pg-glass>`**（材质基件）——不重造材质，只提供**系统外壳语义 + 布局 + 交互品质**。

---

## §2 定位：为什么是"独立体系"

**一句话**：`p-*` 回答"这个 UI 件长什么样"（材质无关的通用原语）；**`lg-*` 回答"这个 App 的系统外壳在液态玻璃材质下长什么样"**——材质**就是**它的身份。

类比行业：Apple 的 Liquid Glass 不是"加了个玻璃按钮"，而是**把整套系统 UI（bar / sheet / toolbar / sidebar / segmented / 控件）重新用玻璃材质表达**。本方案 = Proteus 对等物。

**边界划分（三套体系，一张表说清）**：

| 体系 | 是什么 | 材质 | 谁消费 |
|---|---|---|---|
| **`p-*`**（Charites） | 通用 UI 原语（按钮/弹层/表单…，材质无关） | 无（由主题/token 决定） | 业务任意场景 |
| **`lg-*`**（本方案 Aether） | **玻璃系统外壳/应用容器**（导航/标签/弹层/侧栏/分段…） | **液态玻璃（身份）** | 超级应用系统 UI、OS 级外壳 |
| **玻璃引擎**（G-07） | `@proteus-vue/glass` + `glass.wgsl` + 三端自绘玻璃遍 + `<pg-glass>` + 编译期折叠 + 治理 | —— | **`lg-*` 与 `pg-glass` 的底座** |

★**正交不重叠**：`lg-*` 不重写 `p-*`；需要通用件（如按钮）时，`lg-button` 可以是"`p-button` + 玻璃材质包装"或 `p-button` 的玻璃变体——**复用而非分叉**（对齐 Charites §6「禁重复建设」纪律）。

---

## §3 现状：玻璃资产盘点（引擎已基本就绪 · 全可 grep）

| # | 资产 | 状态 | 证据 |
|---|---|---|---|
| ① | **算法单源**：Rust `glass.wgsl` → naga → MSL / AGSL / SPIR-V | ✅ | `packages/shader-codegen-rust/src/materials/glass.wgsl`；`gen-shaders.mjs`；`check:shader-generated`/`shader-capability` |
| ② | **逻辑 SSOT**：`@proteus-vue/glass`（preset/props/降级/能力，408 行零依赖） | ✅ | `packages/glass/src/`（`resolveGlass` 唯一解析） |
| ③ | **业务单入口**：`<pg-glass>`（Web/MP 运行时；App 编译期折叠成 `style.glass`） | ✅ | `packages/components/pg-glass/index.vue`；`cli/app-component-registry.ts:glassResolver` |
| ④ | **三端自绘玻璃遍**（真折射） | ✅ | `hosts/{ios,android,harmony}` glass 宿主；`check:glass-pixel-parity`（MSL ⇄ CPU oracle 0.49/255） |
| ⑤ | **内置消费范式**：tab 栏玻璃（值钉 `==` glass preset） | ✅ | `packages/render-backend/src/tab-bar-spec.ts`；`check:glass-capability` |
| ⑥ | **治理**：`proteus audit glass`（GLS001-006）+ 像素等价门禁 | 🟡（audit 未接 CI） | `packages/cli/src/glass-audit.ts` |
| ⑦ | **端到端验证**（真 `.vue <pg-glass>` → 三端出玻璃，含 radius 单位） | ⬜ **从未跑通一次** | 缺口（曾列待办，未做） |
| ⑧ | **Web/MP 边界** | ✅ 已裁 | 纯 CSS `backdrop-filter`，**无折射**（决策 #877，`glass-plan/07`） |

★**结论**：引擎七件里六件就绪，**缺的是"成体系的组件产品"（本方案）+"一次端到端合体验证"（§8 判据 1）**。

---

## §4 "OS 级"的判定标准（四条，写进验收 · 玻璃特化）

| # | 判据 | 对标 |
|---|---|---|
| **GL-OS1 材质是律法不是建议** | 玻璃参数**只许走 `resolveGlass`**：组件源码不得硬编码 `blur/tint/radius`、不得裸写 `backdrop-filter`（`proteus audit glass` GLS001 fail-closed + 纳入 lint 棘轮） | Material tokens / ArkUI 资源体系 |
| **GL-OS2 系统外壳品质是默认项** | 安全区避让、玻璃与滚动联动（`.fixed` 钉住、内容滑过）、`prefers-reduced-transparency` → solid、深色模式——**不声明也正确**，声明可覆盖 | SwiftUI / HIG |
| **GL-OS3 一致性可证明** | 每组件纳入 **Themis 三层对拍**（计算样式 golden + 几何 ≤0.5dp + 截图并排）**＋ 玻璃像素等价**（MSL ⇄ CPU oracle，跨端） | ——（只有 Proteus 能做） |
| **GL-OS4 与平台融合** | 玻璃映射到**该端最强**：App 走自绘玻璃遍（真折射）· Web/MP 走 CSS（L1，无折射，边界 #877）；**组件只写意图**，端实现由框架承担（含降级） | ArkUI（声明式 + 系统代偿） |

---

## §5 架构：引擎底座 + 组件体系（两段）

```
┌── 引擎底座（G-07 · 复用，本方案不改）──────────────────────────────┐
│  算法单源 glass.wgsl → naga → MSL/AGSL/SPIR-V                       │
│  逻辑 SSOT @proteus-vue/glass（resolveGlass 唯一解析）              │
│  单入口 <pg-glass>（Web/MP 运行时 · App 编译期折叠 style.glass）    │
│  三端自绘玻璃遍（Metal/Vulkan/AGSL）· 治理（audit glass + 像素门禁）│
└────────────────────────────────────────────────────────────────────┘
                              ▼  被 lg-* 复用（不重造材质）
┌── 组件体系（本方案 · 玻璃系统外壳）────────────────────────────────┐
│  lg-bar / lg-nav-bar / lg-tab-bar     系统条族（导航/标签/toolbar） │
│  lg-sheet / lg-sidebar / lg-menu      弹层与侧栏族                   │
│  lg-floating / lg-segmented           浮动与分段族                   │
│  lg-card / lg-button / lg-search      表面与控件族                   │
└────────────────────────────────────────────────────────────────────┘
```

**分层映射（对齐 Charites §5 四层）**：

| 层 | 内容 | 关系 |
|---|---|---|
| L1 Token | `--sa-*` / `--pf-*` | 复用 Charites 宪法（不另起命名空间） |
| L2 原语 | `PRIMITIVE_CATALOG`（含 `glass` 语义通道） | 复用，不动 |
| **L3 玻璃组件** | **`lg-*`（本方案主战场）** | 新体系 |
| L4 页面骨架 | 超级应用六种骨架（视觉规范 L3） | `lg-*` 组合出骨架 |

**复用而非分叉（关键纪律）**：`lg-*` 组件**不重写**玻璃材质——内部渲染 `<pg-glass>`（或经编译期折叠），玻璃参数全部经 `resolveGlass`；`lg-*` 只负责**系统外壳语义 + 布局 + 交互品质 + 无障碍**。

---

## §6 v1 组件清单（玻璃系统外壳族）

> 命名 `lg-*`；每项 = 玻璃材质 + 系统外壳语义。★**清单是提案，逐个过 §4 四条判据 + §8 验收才交付**。

| 组件 | 语义 | 端能力差异（诚实标注） |
|---|---|---|
| **`lg-bar`** | 玻璃条（顶部/底部通用基件） | App 自绘玻璃遍（真折射）· Web/MP CSS（无折射） |
| **`lg-nav-bar`** | 玻璃导航栏（标题/返回/动作，安全区避让） | 同上；App 端接系统状态栏 |
| **`lg-tab-bar`** | 玻璃标签栏（对齐 `tab-bar-spec.glass` 单源） | 同上；复用既有 tab 玻璃规格 |
| **`lg-sheet`** | 玻璃半屏弹层（modal sheet） | 同上；弹层内核复用 Charites OverlayKernel 方向 |
| **`lg-sidebar`** | 玻璃侧边栏 | 同上 |
| **`lg-menu`** | 玻璃菜单/上下文菜单 | 同上 |
| **`lg-floating`** | 玻璃浮动层（浮动控制/胶囊） | 同上 |
| **`lg-segmented`** | 玻璃分段控件（iOS 风） | 同上 |
| **`lg-card`** | 玻璃卡片（内容容器） | 同上 |
| **`lg-button`** | 玻璃按钮 | 同上；复用 `p-button` 交互语义 |
| **`lg-search`** | 玻璃搜索框 | 同上 |

**v1 收敛建议**：先落 **`lg-bar`（基件）+ `lg-nav-bar` + `lg-tab-bar` + `lg-sheet`**（承载超级应用最高频外壳），验证体系成立后再扩。

---

## §7 分期：先合体，再成体系，最后铺开

| 期 | 内容 | 交付判据 |
|---|---|---|
| **G0 引擎合体**（先行，不可跳过） | 端到端跑通一次：真 `.vue` 写 `<pg-glass>`（+ `<lg-*>` 雏形）→ **三端真出玻璃**；含 `glass.radius` 单位校验；补 `audit glass` 接 CI | 三端真机截图 + radius 单位一致 + `check:glass-*` 全绿（§8 判据 1/5） |
| **G1 组件体系奠基** | `lg-bar` 基件 + `lg-nav-bar` + `lg-tab-bar`（三者共享"玻璃条"内核：安全区 + 滚动钉住 + 玻璃联动） | 三组件过 §4 四条 + Themis 对拍 + 真机矩阵 |
| **G2 弹层/侧栏族** | `lg-sheet` + `lg-sidebar` + `lg-menu`（复用弹层内核方向） | 同上 |
| **G3 控件/表面族** | `lg-segmented` + `lg-card` + `lg-button` + `lg-search` + `lg-floating` | 同上 |
| **G4 产品化** | 全组件进 superapp 真实业务形态；Playground 玻璃演示；多端对比页 | superapp 承载验收（§8 判据 2） |

---

## §8 验收标准（超级应用级，逐条可执行）

1. **端到端（引擎合体）**：真 `.vue` 写 `<pg-glass>`/`<lg-*>` → 三端真机**真出玻璃**；`glass.radius` 单位跨端一致（App 折叠面 vs Web/MP 组件面同参）。
2. **真机矩阵**：多品牌多版本真机（沿用 Hephaestus 口径），非模拟器跑通。
3. **材质单源**：每组件玻璃参数**只经 `resolveGlass`**；**跨路径同参断言**（组件面 ⇄ 编译期折叠面 出同一份参数）。
4. **降级链核验**：三级（设备/版本/性能）+ `prefers-reduced-transparency` → solid，逐组件登记（静默失败必有单测）。
5. **治理门禁**：`proteus audit glass` 接 CI/verify；每组件**零裸玻璃**（GLS001）；`check:glass-capability`/`shader-*`/`glass-pixel-parity` 全绿。
6. **一致性三层对拍**（Themis）：计算样式 golden + 几何 ≤0.5dp + 截图并排。
7. **允许差异显式登记**：进 `docs/allow-differences.json`（如 Web/MP 无折射 #877）。
8. **深色模式**：每组件深色截图并排留证。

---

## §9 不做清单（诚实边界）

- **不重造玻璃引擎**：`@proteus-vue/glass` / `glass.wgsl` / `<pg-glass>` / 三端玻璃遍 = 底座，本方案**复用**。
- **不与 `p-*` 合并**：`p-*` = 通用 UI 原语，`lg-*` = 玻璃系统外壳，两轴正交（对齐 Charites 与 Hephaestus 的"正交不重叠"纪律）。
- **不承诺多端折射一致**：**Web/MP = 纯 CSS（无折射）**（决策 #877）；折射 = App 原生端专属。组件文档须标注。
- **不引第三方玻璃库套壳**（OS 级判据只有自研能满足）。
- **不在组件里各写玻璃捕获策略**：App 端性能坑（#862–#864 背景捕获）由**框架**承担，组件只声明。
- **v1 不承诺**：全组件族一次性交付（先 G0 合体 + G1 三件）；跨 ROM 系统材质；RTL 全量。

---

## §10 证据索引（每条可 grep）

| 本文表述 | 证据 |
|---|---|
| 玻璃引擎七件资产 | `packages/glass/src/`、`packages/shader-codegen-rust/src/materials/glass.wgsl`、`packages/components/pg-glass/`、`packages/cli/src/app-component-registry.ts`、`hosts/{ios,android,harmony}` glass 宿主 |
| tab 栏玻璃单源 | `packages/render-backend/src/tab-bar-spec.ts`（`glass:` 字段）+ `check:glass-capability` |
| 治理门禁 | `package.json`（`check:glass-*`/`shader-*`）、`packages/cli/src/glass-audit.ts`（GLS001-006） |
| Web/MP 边界 | `docs/proteus-glass-plan/07-mapping-web-skyline.md` §边界声明 + 决策 #877 |
| App 玻璃性能坑（背景捕获） | 决策 #862/#863/#864（`docs/project-memory-archive/`） |
| OS 级四条 / 正交不重叠 / 超级应用验收 | `docs/Proteus_OS级组件库方案.md` §4/§6/§8；`docs/Proteus_高频原生能力组件方案.md` 头部验收 |
| 超级应用载体 + 视觉规范 | `superapp/`；`docs/Proteus_超级应用视觉设计规范.md` |
