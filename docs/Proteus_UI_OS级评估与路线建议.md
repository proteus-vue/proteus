# Proteus UI · OS 级评估与路线建议（升级 vs 新建）

> **评估时点**：2026-10-13 10:0x（**所有数字均为本时点实测**，命令见 §9）
> **问题**：内置组件库 `p-*` 离「OS 级标准 + 承载超级应用」还有多远？对 Material Design / ArkUI 对标，应**基于现有这套升级**还是**单独从零造**？
> **关联**：`docs/Proteus_OS级组件库方案.md`（Charites，2026-10-07）· `docs/Proteus_Charites组件库产品白皮书.md` · `docs/Proteus_内置组件体系重评估方案.md`（Koine）· `docs/Proteus_OS级图标库方案.md`（Keryx）· `docs/Proteus_液态玻璃系统组件库方案.md`（Aether，决策 #878）· `docs/Proteus_超级应用视觉设计规范.md`

---

## §0 结论（30 秒）

**不是二选一。正确形态是「底座复用 + 宪法执法 + p-\* 升级做减法 + 缺失族新建」。**

| 问 | 答 |
|---|---|
| 整库从零造？ | ❌ **不成立**。真正稀缺的不是那 1.1 万行组件代码，而是它下面**四层别人凑不齐的底座**：三端一致性可证明（Themis 三层对拍）· 语义 IR 账本（187 原语 + audit 闭环）· 环境自适应与动效引擎（Fluid / Morpheus）· 原生材质与能力（glass / capabilities / gesture）。重写 = 这些全部重做，且**新库若不经过 IR 就失去唯一区分度**（MD3 / ArkUI 是平台自有、不提供"可证明"，我们能）。 |
| 在 p-\* 上加样式？ | ❌ 也不够。OS 级缺的三样**在 p-\* 里长不出来**：① **两个内核**（弹层/滚动）② **L4 页面骨架/模式层** ③ **材质即身份的族**（玻璃外壳 / 图标）——就地长只会继续制造分叉。 |
| 那到底做什么？ | ✅ **四件事**：**保留底座** → **把已落地的宪法接上并执法**（token 消费 + 裸值/A11y 门禁）→ **对 p-\* 做减法**（家族收口 79→约 65）**并默认化品质维度** → **对缺失件与材质族另起正交体系**（Aether/Keryx 已是先例）。 |
| 本轮最重要的新事实 | ★**P0 的"执法载体"已经就位**：`@proteus-vue/tokens`（10-11 落地）+ `check:tokens` 门禁 + **ESLint 层（10-12 决策 #868）**——方案 v1（10-07）当时三者都还没有。窗口期成本最低。 |
| 一句风险提示 | **不要重写 79 个组件**（真机修复沉淀 + 四道组件门禁 + 78 页演示/文案/能力映射全要重做），也**不要指望"接上 token 就 OS 级"**——token 是必要条件，不是充分条件。 |

---

## §1 时点事实（2026-10-13 实测，与方案 v1 逐项对照）

方案 v1 的三条根因诊断（§3 根因 A/B/C）今天复核 —— **A、C 全未动，B 全未动**；**只有 A 的"前半步"（把 token 上移为真源）做完了**：

| # | 项 | 方案 v1（10-07） | **今天（10-13 实测）** | 判定 |
|---|---|---|---|---|
| 1 | `--sa-*` 设计 token 被组件消费 | 0 命中 | **仍 0 命中**（`git grep -l "var(--sa-" -- 'packages/components/*'`） | ⬜ 未动 |
| 2 | `--pf-*` 环境 token 被组件消费 | 未统计 | **1 个文件**（仅 `p-formfactor`） | ⬜ 未动 |
| 3 | 组件自有局部变量 `--p-*` | 23 处引用 | **39 个变量名**（仍是无宪法时代的"自留地"） | ⬜ |
| 4 | token 真源上移为框架包 | ⬜ 待做 | ✅ **`@proteus-vue/tokens` 已落地 + `check:tokens` 门禁**（双写漂移 + WCAG AA 对比度） | ✅ **P0① 完成** |
| 5 | 裸值 lint（裸色值/字号/间距 ⇒ 报错） | ⬜ 待做 | ❌ **未落地**（唯一 token 相关门禁是 `check:tokens`，它只管"包↔工程样式表一致"，**不看组件源码**） | ⬜ **P0② 未动** |
| 6 | **ESLint 工具链层**（方案 v1 时不存在） | —— | ✅ **10-12 补齐（决策 #868，flat config + suppressions 棘轮）** | ✅ **新事实：lint 载体已就位** |
| 7 | OverlayKernel / ScrollKernel（两个内核） | ⬜ 待做 | ❌ **代码 0 命中**（`OverlayKernel`/`ScrollKernel` 只出现在 4 份 md 里） | ⬜ P0③ 未动 |
| 8 | 家族分叉（滚动三胞胎 / 弹层五兄弟 / 加载三件 / 导航三件） | 5 组重复 | **14 个组件全在**（p-scroll 44 / p-scroll-view 157 / p-scrollable 82 · p-modal 239 / p-popup 192 / p-popover 186 / p-drawer 127 / p-mask 35 · p-loading 79 / p-loading-host 283 / p-loading-region 103 · p-nav 57 / p-nav-bar 148 / p-tabbar 104） | ⬜ P1 未动 |
| 9 | A11y 门禁 | 0 门禁（22 文件零散 role/aria） | ❌ **`scripts/*.mjs` 零 a11y 判据、`eslint.config.mjs` 零 a11y 规则**；**23 个**组件文件有零散 role/aria | ⬜ P2 未动 |
| 10 | 组件动效接 Morpheus 引擎 | 未接（CSS 手写） | ❌ **0 命中**；**19 个 `index.vue` 手写 `animation:`** | ⬜ P2 未动 |
| 11 | 组件规模 | 79 个 / 11,927 行 | **79 个目录（78 个已发布页）**；`index.vue` 合计 **10,261 行**，p-\* 全部源 **10,977 行** | ≈ 持平（未扩编） |
| 12 | 材质族另起（Aether / `lg-*`） | —— | ✅ **已立项（决策 #878，10-13）+ 任务板 `T-glass-system-ui-g1`** | ✅ **新事实：先例已立** |

**读法**：**"立法"已完成（token 真源 + ESLint 载体），"执法"一步未动** —— 这正是当前最高杠杆的位置。

---

## §2 为什么"整库从零"不成立（四条护城河，全部可 grep）

| # | 护城河 | 为什么它决定"不能从零" |
|---|---|---|
| ① | **三端一致性可证明**（Themis 三层对拍：IR ≡ Chromium 逐属性 / 各端 ≡ Web ≤0.5dp / 真截图并排） | OS 级四条判据里 OS-3 只有 Proteus 能做（MD3/ArkUI 是平台自有，无需自证）。**新库若绕过 IR 编译链，OS-3 自动失效** ⇒ 从零造反而降级。 |
| ② | **语义 IR 账本**（PRIMITIVE_CATALOG 187 条 + `auditCatalogConsistency` 闭环） | 组件不是孤立 UI 件，是"原语的语义化封装"。新库若不登记原语，就漂成"第二套运行时"（方案 §6 明确禁止）。 |
| ③ | **真机修复沉淀**（可 grep 的注释密度） | MP 样式隔离 ⇒ 编译器 theme 通道 / 单类变体 / `:class` 字面量键 / scopeId 后缀；`hover-class` 必须在 `<style global>`；Web/MP 按下态**不能用同一 CSS 写法**；变体必须对齐**基础库权威值**（`grep` 微信 `app.asar`）。这些是**跑出来的**，重写 = 重交学费（Koine §8 与 Aether §9 各自都写了这条）。 |
| ④ | **四道组件门禁 + 78 页配套** | `check:mp-attrs` / `check:showcase-catalog`（API 表 ⊇ defineProps/defineEmits）/ `check:component-demo` / `check:capability-demo` + 双语文案 + 能力映射（`docs/generated/miniprogram-mapping.md`）。整库重写要把这套全部重做一遍。 |

**另有一条反向证据**：`p-*` 目前是**唯一同时跑通 Web / 微信 / App 三个渲染后端的组件集**。从零造意味着"先用一个只有一端的组件库去追 ArkUI 的品质"——**在错误的地基上比美**。

---

## §3 但"在 p-\* 上加样式"同样不够（缺的三样长不出来）

| 缺什么 | 为什么在 p-\* 里长不出来 | 正确做法 |
|---|---|---|
| **两个内核**（OverlayKernel / ScrollKernel） | 弹层五兄弟各有遮罩/层级/焦点/转场；滚动三胞胎各有 bounce/refresh/loadMore。**在各自文件里继续加 = 分叉继续深化**；共享一个内核才是"一次投入、5+3 组件受益" | 新建内核包，p-\* 变成内核的**声明式预设**（`p-modal` 的 `p-adaptive` 形态声明已是现成 API 形状） |
| **L4 页面骨架 / 模式层** | 骨架是**组合语义**（列表页/详情页/表单页/空态/错误态/加载态），不是单个组件职责；写成 p-\* 会得到一个"什么都装得下"的巨型组件 | 新建 L4 层（骨架 + 模式），组合 L3 |
| **材质即身份的族**（系统外壳） | 玻璃外壳 `/lg-bar` `/lg-tab-bar` `/lg-sheet` 的"身份"是**材质**，与 p-\* 的"材质无关通用原语"正交。混进 p-\* 会让 `p-tabbar` 分裂出"玻璃版/非玻璃版" | **另起一族**（决策 #878 已立项 Aether，`lg-*` + 内部渲染 `<pg-glass>`，不重造材质） |

---

## §4 分层处置表（留 / 升级 / 新建 / 废弃）

| 处置 | 对象 | 依据 |
|---|---|---|
| **留（底座，一行不改）** | Themis 一致性管线 · Fluid 自适应 · Morpheus 动效引擎 · glass 材质 · capabilities（84 Hook）· gesture · PRIMITIVE_CATALOG（187 原语 + audit）· IR 编译链 · Web shim 13 件 · MP 词形对齐面 · `@proteus-vue/tokens` | 别人凑不齐；决策 #878 ⑨ 已立规矩：**引擎（底座）复用 vs 产品（组件体系）新建**要分清 |
| **留（新宪法）** | `@proteus-vue/tokens` + `check:tokens` + **ESLint 层** | 10-11 / 10-12 已落地，**执法载体就位**（这是与方案 v1 最大的环境差异） |
| **升级 · 执法**（P0 收尾） | ① 组件全量接 `--sa-*`（今天 0）② **裸值 lint**（裸色值/字号/间距/圆角 ⇒ E 报错 + 存量棘轮，接 ESLint）③ `theme` prop 进 `BaseProps` 契约（`packages/components/contracts/props.ts` 现无） | 方案 §4 OS-1「设计语言成法」；`check:tokens` 已示范棘轮写法 |
| **升级 · 做减法**（P1） | 家族收口：滚动 3 → `ScrollKernel` + `p-scroll-view`（MP 对齐面）· 弹层 5 → `OverlayKernel` 五预设 · 加载 3 → 职责重划（服务态/骨架态/宿主）· 导航 3 → 统一安全区与返回语义。**79 → 约 65** | 14 个组件里 4 组重复；被收编件走 deprecation 棘轮 |
| **升级 · 品质默认化**（P2） | ① A11y：role/aria **必填清单** + 焦点管理接 fluid focus-nav（`scripts` 与 eslint 现在都是 0）② Motion：19 个手写 `animation:` 改**声明 motion token**（Morpheus 承接，今天 0 命中）③ 触达 44px / 键盘 / RTL 默认项化 ④ 深色截图并排留证 | 方案 §4 OS-2 + §8 验收 |
| **新建（从零，但只新建该新建的）** | ① `OverlayKernel` / `ScrollKernel` ② L4 页面骨架/模式层 ③ **缺失族**（§5 清单）④ **Aether `lg-*`**（已立项 #878）⑤ **Keryx 图标**（`packages/icons` 已起：`set.ts`/`transform.ts`/`normalize.ts`） | 这些就地长会制造分叉；按 #878 的"**正交不重叠**"证成方式另起 |
| **废弃** | `p-scroll`（方案已定淘汰，并入 ScrollKernel）· `p-icon` 的 unicode `GLYPHS` 表与 `built-in-components/icon.ts` 手绘集（Keryx 要淘汰）· Web shim 里字面 `#09BB07` 之类裸色 | Koine §8 / Keryx 方案 §淘汰关系 |

---

## §5 缺失件清单（对标 MD3 / ArkUI 的"扩编面"）

以下名称**当前全部无对应 `p-*` 目录**（一条命令即可复核，见 §9）。分组给出"现状对应物"与判定：

| 类 | MD3 / ArkUI 有、我们没有 | 现状对应物 | 判定 |
|---|---|---|---|
| 表面/容器 | Card · Chip · Cell/List item · Empty state · Banner | `p-box`（无 elevation 语义、无交互态）· `p-list-view`（虚拟列表，非"列表项"） | **缺** |
| 导航 | Search bar · Breadcrumb · Pagination · Stepper · Navigation rail | `p-sidebar`（自适应导航，非 rail）· `p-segment` | **缺** |
| 反馈/浮层 | Tooltip · Snackbar（带 action）· Context menu · Rating · Gauge · Marquee · Counter/Badge | `p-toast`（无 action）· `p-popover` · `.sa-badge`（**CSS 类，不是组件**） | **缺** |
| 手势 | Swipe-to-dismiss · Pull-to-refresh（独立语义）· Carousel/Swiper | 散在 `p-scroll*` 内 · MP 有原生 `swiper`（走词形层） | **缺/未组件化** |
| 数据展示 | Data table · Tree · Timeline · Accordion | 无 | **缺** |
| 交互基底 | **State layer / Ripple** · Elevation 语义体系 | 仅 3 档 shadow token（`--sa-shadow-sm/md/lg`） | **缺**（MD3 的"触摸反馈正确感"就靠这层） |
| 动效 | Motion system（时长/缓动/弹簧 + 转场族） | `--sa-dur-*` / `--sa-ease-*` 3+2 档；**Morpheus 未接** | **半** |
| 无障碍 | role/aria 必填清单 · 焦点环 · 44px 触达 · RTL | fluid `focus-nav` 有底，组件未默认接；门禁 0 | **缺** |
| 自适应 | Window size classes / 断点体系 | Fluid 有底；但 `p-formfactor` 是 **1410 行 Web 单端**实现（DOM 强耦合，`querySelectorAll`/`getBoundingClientRect`） | **半**（见 `docs/fluid-system-gap-audit.md`） |

**口径**：上表是"对标 MD3/ArkUI 的**完备性**缺口"，**不是**"都必须做"。按 `capability-component-granularity.md` 的既定原则（**不做纯覆盖式铺开，按需驱动**），建议以"超级应用真实页面"反推（`superapp/` 是现成载体）。

---

## §6 路线建议（与既有四条主线的关系）

```
                ┌── 已有：Themis（一致性）· Fluid（自适应）· Morpheus（动效）· PRIMITIVE_CATALOG（IR）
   底座（留）    └── 已有：glass（材质）· capabilities（84 Hook）· gesture · IR 编译链 · Web shim
                        │
   宪法（留）  @proteus-vue/tokens ✅ + check:tokens ✅ + ESLint 层 ✅（10-11/10-12 已落地）
                        │
   ┌────────────────────┼─────────────────────────┬──────────────────────┐
   │ U0 执法            │ U1 内核 + 做减法         │ U2 品质默认化         │ U3 扩编 / 新族
   │ p-* 接 token       │ OverlayKernel            │ A11y 门禁 + role/aria │ 缺失件（按需）
   │ 裸值 lint（棘轮）  │ ScrollKernel             │ Motion → Morpheus     │ Aether lg-*（#878 ✅）
   │ theme 进 BaseProps │ 79 → 约 65               │ 触达/键盘/深色留证    │ Keryx 图标（已起）
   └────────────────────┴─────────────────────────┴──────────────────────┘
   ←────────── p-* = Charites（通用 UI，材质无关）──────────→   ←── 新材料族（材质即身份）──→
```

**顺序理由**（沿用方案 §7"先立法、再执法、最后扩编"，本轮补充一条）：
1. **U0 必须先做**：不接 token 就扩编 = 把裸值规模从 79 个组件扩到 100+ 个，债复利增长；
2. **U1 在 U3 之前**：不做减法就扩编，组件总数上升而非下降（方案 P1 的目标是**下降**）；
3. **U2 与 U1 可并行**（改的是不同文件面），但 **U2 的 A11y 清单必须一次定死**（否则逐组件返工）；
4. **U3 的"新族"与 p-\* 正交**：材质族（Aether）已用 #878 证明这条路走得通——**同一判据：正交不重叠 = 独立成族**；
5. **不在本轮**：RTL 全量、screen reader 全流程、动效全量 token 化（方案 §9 的 v1 不承诺项，本轮不改口径）。

---

## §7 验收判据（沿用 OS-1..OS-4，加上本轮的可测化）

| 判据 | 可执行形态（门禁） |
|---|---|
| **OS-1 设计语言成法** | 裸值 lint：组件源码出现裸色值/字号/间距/圆角 ⇒ E；存量棘轮基线只减不增；**目标：`--sa-*` 消费面从 0 → 全量** |
| **OS-2 品质是默认项** | A11y：交互组件缺 role/aria ⇒ E；触达 44px 断言；19 处手写 `animation:` → 0 |
| **OS-3 一致性可证明** | 每组件 Themis 三层对拍（IR ≡ Chromium / 各端 ≤0.5dp / 截图并排）；深色截图并排留证 |
| **OS-4 与平台融合** | 安全区/系统玻璃/系统手势/键盘避让由框架承担；降级路径逐组件登记单测 |
| **新增：正交性** | 新族必须给出"与 p-\* 不重叠"的证明（#878 的证成方式），否则不许另起 |

---

## §8 不做清单（诚实边界）

- **不整库重写 `p-*`**——四条护城河 + 真机学费 + 78 页配套，收益为负；
- **不引 Vant/Ant/WeUI 套壳**——OS-3 判据只有自研能满足；
- **不另起第三套 token 命名空间**（收口 `--sa-*`/`--pf-*`，而非发明 `--ct-*`）；
- **不新建"第二套运行时"**——新组件必须先登记 IR 原语（audit 闭环）；
- **不做纯覆盖式铺开**——缺失件按超级应用真实页面反推，而非对着 MD3 目录抄；
- **本轮不承诺**：RTL 全量、screen reader 全流程、动效全量 token 化（如实标注，不粉饰）；
- **本评估不改任何代码**——全部为只读实测；结论是"路线建议"，**未立项**。

---

## §9 证据索引（每条可复现）

```bash
cd /Volumes/data1/work/office/debug/proteus

# 1) 组件 0 消费设计 token（方案 v1 的诊断，今天仍成立）
git grep -l "var(--sa-" -- 'packages/components/*' | wc -l        # → 0
git grep -l "var(--pf-" -- 'packages/components/*'                # → 仅 p-formfactor
git grep -hoE "\-\-p-[a-z0-9-]+" -- 'packages/components/*' | sort -u | wc -l   # → 39

# 2) 两个内核未落地（只存在文档）
git grep -ln "OverlayKernel\|ScrollKernel" -- 'packages/*'        # → 空（0 源码命中）

# 3) 家族分叉仍在
wc -l packages/components/{p-scroll,p-scroll-view,p-scrollable}/index.vue \
      packages/components/{p-modal,p-popup,p-popover,p-drawer,p-mask}/index.vue \
      packages/components/{p-loading,p-loading-host,p-loading-region}/index.vue \
      packages/components/{p-nav,p-nav-bar,p-tabbar}/index.vue

# 4) A11y 门禁 = 0；动效 = 手写
git grep -ln "aria-\|a11y" -- 'scripts/*.mjs'                      # → 空
grep -nE "a11y|aria" eslint.config.mjs                             # → 空
git grep -l "animation:" -- 'packages/components/*/index.vue' | wc -l   # → 19
git grep -l "Morpheus\|morpheus" -- 'packages/components/*' | wc -l     # → 0

# 5) 缺失件（全部无目录）
for n in card chip badge tooltip search carousel table tree timeline accordion \
         breadcrumb pagination stepper rating gauge marquee counter empty cell menu snackbar; do
  [ -d packages/components/p-$n ] && echo "有: p-$n"; done          # → 无输出

# 6) 新事实：token 包 + 门禁 + ESLint 已落地
ls packages/tokens/src/ && sed -n '1,12p' scripts/check-tokens.mjs
git log --format='%h | %ad | %s' --date=short -1 -- eslint.config.mjs   # → #868 (10-12)

# 7) 规模口径
ls -d packages/components/p-*/ | wc -l                             # → 79（+ pg-glass 1）
cat packages/components/*/index.vue | wc -l                        # → 10,261 行
```

**证据**：`docs/ai-tasks.json` 任务板（7 条 planned，含 `T-glass-system-ui-g1`）· 决策 #607（四条主线入库）· #868（ESLint 层）· #878（Aether 立项）· `docs/board-inventory.md:180–182`。
