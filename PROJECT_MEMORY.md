# Proteus 项目记忆（PROJECT_MEMORY.md）

> **项目本地记忆文件**：新会话入口 —— 当前进度 + 关键点 + 阅读指引（详细历史在 `docs/project-memory-archive/`）。
> 新会话的 LLM **必须先读顶部「当前状态速览」**，再按 §「会话恢复指引」顺序阅读。
> **维护规则见 §《收纳规范》**（门禁 `pnpm check:memory`）——新里程碑的详细叙事**直接写进当月归档**，主文件只加一行速览。

---

## 项目概览

- **名称**：Proteus（普罗透斯）—— Vue 跨端编译框架
- **核心理念（架构方向已定案，决策 #290）**：**一份标准 Vue 源码 → 语义 IR（C-IR/CompilerIR）→ 可插拔渲染后端**（Render anywhere, on any engine）；不再是「小程序编译器」——小程序降级为 Layer 1 兼容层
- **四层可插拔（原则 #10 终极形态）**：编译（G-29 CompilerBackend）/ 逻辑（JS 引擎）/ UI（G-27 RenderBackend）/ 能力（G-28 NativeBackend）
- **技术栈**：Vue 3.4+ / Vite 5 / TypeScript 5.4+ / 微信基础库 2.29.2+（Skyline + wx.router）
- **包规模**：**45 个 @proteus-vue/* npm 包**（+ `packages/layout-core-rust` = **cargo crate，非 npm 包**，故不计数）（★2026-09-29 layout-core = App 排版核心）（check:pkg 0 error · `pnpm check:stats` 校验 ✓；31→38 修正 → G-07 glass 39 → Skyline 收口 worklet 40 → ★2026-09-14 组件库拆包 `@proteus-vue/components` 41 → ★Vapor 线新增 `@proteus-vue/slot-runtime` 42 + `@proteus-vue/layout-core` 43 → ★2026-09-30 MA1 新增 `@proteus-vue/animation` 44；版本统一 0.3.0-beta.8，见「当前状态速览」）
- **文档**：`docs/proteus-architecture.md`（L0 规约·真理来源）→ `docs/board-inventory.md`（全景索引）→ `docs/roadmap.md`（版本线）→ `roadmap-2-plan`（里程碑线）→ 各 plan

## 当前状态速览（最近一次更新：**2026-10-20·（五九七）· ★★万神殿上官网：只写方法论页、**不披露 14 个未检索代号**（N-3 纪律）· 决策 #1107**——用户「万神殿是不是可以放到官网，也是框架组成部分的另类叙事表达」。★**先取证，结论是只能走窄路**：命名表 §3 共 **16 个代号，仅 3 个 ✅ 已定名**（Proteus/Janus/Dactyl），11 个 🟡 待检索 + 2 个 🔵 暂定；而 **N-3 纪律写死「🟡/🔵 对外使用前必须先完成检索」**⇒ 整页发布 = 一次性违反自己 14 条纪律。★**落点纠正**：不是 `system/`（那是「柔性系统」专章），而是 **`website/guides/38-module-codenames.md`「架构与工程」组**（+ en 版）。★**页面只讲四件事**：① **神职即职责**的选名方法（附 3 个可对外例子）；② **三条纪律**（只收神名/一名一模块/定名前检索）；③ ★**诚实边界：被排除的名字**——Iris(动画引擎)/Athena(AWS)/Theia(Eclipse IDE)/Eos(区块链)/Metis(JS框架)/Hermes(RN引擎)/Nike(商标) 因外部撞名放弃，Hyaleos·Krystallos 因是**材质普通名词**破轴，Harmonia 因谐音 HarmonyOS；④ 对外披露现状 + 「未说已定名前以职能描述为准」。★**为什么不搬名单**：合规（改名成本随索引指数上升）/ 叙事价值低（神名不带价值描述是噪声）/ **排除案例比名单更有说服力**。★**★★执行中撞到两件事（如实记录，未硬做）**：① **三处生成物手改被门禁拦下**——先直接改了 `p-icon.md`/`page-lifecycle.md` 的代号文案，`check:content` 立刻报「3 个生成页与源不一致」（它们是 `gen-content.mjs` 的**产物**）；正确做法是改生成器再重生成，但那会牵动 `packages/icons` 整条命名（超出文档清理范围）⇒ **已回退**，登记为独立待办。★教训：#1105「判据能力边界」的第四次变体——这次是**改错了层**（改产物而非源）。② **Morpheus / Aether 不是"残留"，是已在对外使用**——`Morpheus` 是整套动画分区（含独立 `/animation` 产品页）的对外标题，`Aether` 被液态玻璃外壳库采用；按我们自己的纪律**本就该先检索再对外**，属**未收口** ⇒ 在新页里**如实标注这两处**（写明"不是残留，是检索未完成却已对外"），不假装不存在。★**门禁**：`check:en-drift` **306 对全绿**（新页中英结构签名逐项一致）· `check:doc-links` 388 个内容 md 全绿 · `check:content` 回退后恢复绿 · file-size/ai-tasks/decision-numbers/memory 全绿。★**诚实边界**：① 本轮**只清掉 `reference/cli.md` 的 Apollo 一处**（手写页可直接改），**Morpheus/Keryx/Aether 仍在**；② `check:docs-stats` 有 **1 处 pre-existing 红**（`Proteus_Themis…白皮书.md` 缺 IR 字段数断言，上次改动 #1037），**与本轮无关、未修**；③ 新页"已定名 3 个"依赖内部表 ✅ 状态，**后续代号转正需同步该页**；④ 代号收口两条路径（改生成器 / 补检索转正）**未选**，需产品决定。★**下一步**：① 决定 Morpheus/Keryx/Apollo/Aether 是"补检索转正"还是"改回职能描述"；② 万神殿页在代号转正后**增量更新**（只加表行、不改结构）；③ 顺带发现 `system/10-focus-navigation.md` **已完整公开** `navigateFocus` 算法 ⇒ 已在 TV 方案里加交叉引用，B2 落地后须同步更新该页（否则"官网说已有、方案说要做"观感冲突）。

## 当前状态速览（最近一次更新：**2026-10-20·（五九六）· ★★★TV 焦点原语执行级方案入库（代号 Hestia）——把调研落成 B1-B5 可开工计划、纠正调研三处表述、合入 G-25 主线 · 决策 #1106**——用户「新增的文档可以作为后面原语的试金石」→「先优化文档做成详细落地方案，合入主线计划」（**本轮不写代码**）。★**定位修正（最重要的判断）**：调研文档原名「TV 端验证方案」易读成"新开 TV 产品线"；本轮落成 **G-25（全终端柔性架构）的执行级子计划，不新开 G 号**——判据：TV 焦点不是新的"不绑 X"维度、也不是独立 SPI/后端矩阵，而是 G-25「三维断点 `F=remote`」的直接下游（先例：`end-alignment-plan` 之于 G-31）。落点 `docs/proteus-tv-focus-plan/`（7 份文档），G-25 行内加指针。★**命名 Hestia（灶神）**：**拉丁语 `focus` 本义就是"灶台/火炉"**，而 Hestia 是灶神 ⇒ 神职与职责在**词源层面同源**（本仓最强一次 N-1 契合）；仓内 0 命中；★外部同名 **HestiaCP**（服务器控制面板，非前端域）已在命名表明示；状态 🔵 **待检索**，备选 Teiresias。★**★★纠正调研文档三处表述（每处有取证）**：① 原文「App CSS 无 `:focus-visible`」——表里**根本没这条**，实际缺 `selector-pseudo-state`（`features[40]` = absent）⇒ 照原表述验收会对一个**不存在的条目**做；② 原文把「长按重复 10+次/秒」列判据——**`adb input keyevent` 是单次 down/up、`repeatCount` 恒 0，结构上造不出该条件** ⇒ 改"离散快按（不验 repeat）/ 宿主 dev 合成（验 repeat）"两条合法装置 + 措辞纪律；③ 原文「最长任务 <50ms」**会把宿主 native 的账记到 JS 头上**（实测 iOS mount 30–93ms 而 JS 同步仅 ~3ms）⇒ 强制**分栏归因**（`js_sync_p95`/`host_mount_*`/`key_to_focus`/`focus_to_paint`/`glass_pass`），**未归因前禁止引入调度原语**。★**四层架构**：① 输入归一（宿主只做一次，★`confirm` 必须同时认 `DPAD_CENTER(23)` 与 `ENTER(66)`——真实盒子两码并存，只认一个会出现"某类盒子 OK 键完全无反应"且极难归因）；② 焦点引擎（`nextFocus` = 现有 `navigateFocus:50` 转导出 + 新 `ensureVisible`(E1 已可见不动/E2 就近对齐/E3 钳制) + `createFocusEngine`；几何由 `getRects` **注入**⇒跨端一致唯一前提）；③ 视觉（App 无 `:focus` ⇒ **渲染器按 focusId 绘制期描边**，否掉"内核 overlay 节点"与"独立图层"两方案）；④ 滚动跟随（**不得推迟**——缺它=焦点跑屏外，比没焦点更糟）。★**批次**：B1 输入归一 → B2 引擎原语化 → B3 视觉 → B4 滚动跟随（**S1 = B1-B4**）→ B5 跨端一致性(S2)；已登记 `docs/ai-tasks.json` 五条 `planned`（95 条任务，门禁绿）。★**判据 7 条**：P1 焦点序列逐项相等 · ★**P2 四端 `focusSequence` 指纹一致（可 CI）** · P3 环位置 ±2px + 对比度 ≥3:1 · P4 连按 60 次**正反各一轮**不出屏 · P5 性能分栏 · P6 生命周期 · P7 内存 ⇒ P1/P2 不依赖真机，是能长期守住的**差异化证据**。★**顺带修掉一个我自己引入的门禁缺陷**：`check:decision-numbers` 报「#1/#2/#3 各被 4 条占用」——**不是真重号**，而是我前几轮在决策**正文**用了「  1. **小节标题**」，被该门禁（`^\s*(\d{1,4})\.\s+\*\*`，刻意缩进无关）当成新决策号 ⇒ 把那 9 行改成 `· **…**`（**不改门禁，改我的书写形态**）；★教训：**写决策正文要意识到有机器解析盯着行首形态**——与 #1105「判据能力边界」同族，这次是文档形态撞上解析器形态。★**诚实边界**：① **未写一行代码**（每句"已有"标 `文件:行`、"缺口"标 grep 命中数）；② **P2 跨端一致性是待验证假设**（三端都还没接遥控输入）；③ tvOS/鸿蒙宿主改动量**未评估**；④ TV **不是线程引擎**试金石（不多给线程），是**每帧预算**试金石；⑤ 16.7ms 是 60Hz 假设；⑥ Hestia 未检索。★**动工前置**：盒子规格（arm64 + Android 9+ + 1.5-2GB 压力机）· adb 可达 · 首端拍板（建议 Android TV）· Hestia 检索 · TV001-004 从"声明"转"实现"。

## 当前状态速览（最近一次更新：**2026-10-20·（五九五）· ★★捕获密度斜率已量出（div 2/3/4 = 4.37/3.28/2.90ms）但**决定不改默认值**——因为"逐点最大差"测不出 Android #1013 记录过的网格状织纹 · 决策 #1105**——承接 #1104「滚动时玻璃仍 5ms+/帧」。★**为什么看密度**：交互路径已被 backdrop 缓存解决（#1104），但**滚动时缓存必然失效**（采样源变 ⇒ `contentRevision` 递增）⇒ 滚动这条路上唯一可调的杠杆就是"抓多细"。★**真机斜率（交互 12 帧中位 · 缓存关闭强制重捕）**：div=2 `1.60+1.24+1.45=4.37ms`（crop 113220px）· div=3 **3.28ms（省 25%）**（50320px）· div=4 **2.90ms（省 34%）**（28305px）；readback+raster 随面积近线性降，而 ★**metal 几乎不随输入密度变**（1.45→1.18，−19%，它受**输出分辨率**控制）⇒ 压输入密度**收益递减**，继续提速必须动输出（画质风险更大）。★**★★为什么最后没改默认值（本轮最该记住的）**：我一度把默认改成 3，依据是"逐点最大通道差"——glass-nav 完全一致、mine 页仅 0.053% 像素差且**最大 2/255、无像素 >8**，看起来"肉眼不可辨"。**然后查到 Android #1013**：用户反馈「获取的映射感觉有点儿脏」，离线复现定位到 **DIV=2 时蓝色笔画周围出现「网格状插值织纹」（周期 ≈5-6px 斜向条纹，自相关峰 lag 2/4/6）**，最终 Android 把 DIV 从 2 改成 **1（全分辨率）**。⇒ ★**织纹是空间频率伪影，"最大通道差"会把周期性小偏差平均掉——我的判据结构上测不出它**；而我要取的值（3）比当年 Android 出问题的值（2）**更激进**。⇒ **默认保持 2**，理由不是"不要性能"而是**证据标准不够**：没建"自相关/频域"判据之前，拿"最大差 2/255"去改一个已被证伪过的参数 = 把同一个坑再踩一次。★**这是同一族纪律的第三次体现**：**判据的能力边界决定结论的可信边界**（#1100 末次读数冒充整体 / #1103 首遍读数冒充稳态 / #1105 逐点差异冒充画质）。★**落地（只留装置不改行为）**：`glassCaptureDiv` 单一常量（**默认 2**）+ `PROTEUS_GLASS_CAPTURE_DIV` 取证开关 + 读数 `px_per_pt`（每遍+末次，不记密度就没法横比）；★**输出分辨率 `glassOutScale` 保持不动**，判据里注明"输入密度 vs 输出分辨率是两个量"（判据第一版就误伤了输出那处）。★判据 `tests/perf-hot-path-budget.test.ts` **35/35**（+3：单一常量+开关+默认 2 且注明原因 · ★捕获密度**代码赋值行**必须用常量（按行过滤注释、只约束输入） · 密度写进读数）+ 真机 5 轮 + 编译/文件大小棘轮绿。★**顺带**：加开关把 `selfdraw-scene.swift` 顶到 8240 > 基线 8220 ⇒ 按纪律**再拆**而非抬基线：`pixelFormatSelfTest`（49 行自包含诊断）搬到 `host-support.swift` 扩展 ⇒ **8193** 行；★搬迁时差点放错类（它是 `SelfDrawBridge` 协议成员，我写成 `extension SelfDrawView` ⇒ 编译立刻报不符合协议）——**搬迁前先确认归属类，"看起来像视图方法"不是依据**。★**诚实边界**：① **没改默认值** ⇒ 滚动玻璃仍 ~4.37ms/帧，省 25% 的机会还在桌上；② 画质只做逐点差、**未做自相关/频域**（正是 Android 抓织纹的方法）；③ 样本为一次按住态截图、两页面，未测大面积/强对比/动态内容；④ 未做人眼盲测；⑤ ★**三端降采样现状不一致**：iOS=2（1.5px/pt）、**Android=1（#1013 全分辨率）**、鸿蒙 `S=3` ⇒ 玻璃画质本就不等价，本身是待收口的跨端差异。★**下一步**：① **先建"织纹"判据**（自相关峰 lag 2/4/6 幅度/频域能量比），用它复核 iOS div=2 与 3——这是解锁那 25% 的前提；② 三端降采样策略对齐；③ 若要继续压滚动成本，量"输出分辨率 vs 画质"斜率（风险更高）。

## ★《收纳规范》（2026-10-03 立 · 门禁 `pnpm check:memory`）

**为什么立这条**：本文件曾达 **11,118 行 / 2.4 MB**（每轮里程碑的详细叙事都内联插 H3），
「新会话先读顶部」的成本被历史内容淹没。⇒ 改为「**主文件 = 当前态薄入口；历史与长表全文在 `docs/project-memory-archive/`**」。

**主文件只放六类内容**（其余一律归档）：
1. 项目概览（要点，不放过程）
2. 当前状态速览——**只保留最近 3 条**；插入新条时，第 4 条起移入当月归档
3. 关键决策与文档偏差——**全文在 `decisions.md`**；主文件只留指针 + 锚点（决策号只增不改号）
4. 待办 / 注意事项（已完成项移归档）
5. 会话恢复指引（阅读顺序；指向归档而非内联历史）
6. 归档索引（归档文件清单 + 检索方式）

**新里程碑的写法**（替代旧习惯——详细叙事不再内联）：
1. **详细叙事**（交付 / 缺陷 / 验证 / 诚实边界）追加到 `docs/project-memory-archive/<YYYY-MM>.md`（当月文件；新月份新建）；
2. 主文件顶部加**一行**状态速览（`## 当前状态速览（…）`，含「下一步」）；
3. 需长期记住的教训 → 决策条目（号 +1）追加到 `decisions.md`，架构级同时在主文件「锚点」登记一行；
4. 跑 `pnpm check:memory` 自检（主文件上限 / 结构齐备 / 速览条数 / H3 泄漏）。

## 归档索引（历史在归档——**勿整读，按关键词 grep**）

| 文件 | 内容 |
|---|---|
| `docs/project-memory-archive/2026-10.md` | 2026-10 里程碑详细叙事 + 状态速览历史栈（约 10.5k 行）|
| `docs/project-memory-archive/2026-09.md` | 09 月全部叙事 + 柔性系统重组历史 + 2026-08 进度快照 + 已落地文件 + 09-19 验证状态（约 6.5k 行） |
| `docs/project-memory-archive/decisions.md` | 决策链全文 #1–#794——按号检索（`grep -n "^736\." …`）|

检索示例：`grep -n "2026-09-29\|判据建错靶" docs/project-memory-archive/2026-09.md`

## 关键决策与文档偏差（#1–#794 → 归档速查）

**全文在 `docs/project-memory-archive/decisions.md`**（按号检索：`grep -n "^290\." docs/project-memory-archive/decisions.md`）。
决策号**只增不改号**（外部文档按号引用）；新决策追加到该文件末尾（号 +1）。
**锚点**：`#290` 架构方向定案（语义 IR + 可插拔渲染后端）· `#314` 后包地图见「会话恢复指引」。

## 待办 / 注意事项

**★★（2026-10-17 收口 · 决策 #1036）点击切换回弹校准已完成** —— `FLOW_C 1.00→0.6508`（ζ=0.55），
真机 1 格过冲 14.5px(5.8%)/3 格 43.4px(5.7%)、起跳相位不回归（详见归档 2026-10-17 条目）。
**★唯一剩余 = 用户目视手感验收**（手感以用户为准）：若仍偏软/偏弹，按预标定表只调 `FLOW_C`
（ζ=0.50⇒25px · 0.55⇒14.5px · 0.60⇒5.8px · 0.65⇒1px；**必须按离散复算，连续公式高估约 2 倍**）。

**★★★（2026-10-12 收尾 · 明天续接）本轮（#861–#868）遗留清单** —— 玻璃性能三端已达标（安卓 121 / 鸿蒙 121 / iOS 59 满帧）+ 系统级 OOM/挂死三处已修 + 治理补层（engines/loop-guard/lint）已落。**按优先级**：
1. ✅ **（2026-10-13 已收口 · 决策 #869）既有 8 项全量失败全部修复**——Node 22 全量 **5764 通过 / 0 失败**（此前 5756/8）。含 **1 个真 bug**：`p-icon/index.vue` 的 `import.meta.env?.DEV`（#804 引入）被本仓自定义编译器残留进产物 ⇒ `new Function` 抛 `Cannot use 'import.meta' outside a module`（三处门禁同红），改无条件告警；其余为数字/快照/契约漂移（`check:stats` packages 47→48 / conformance 11→12 / plans 86→87 + `css-capability-alignment` 重生成 + `router-project-driven` 测试正则收窄 + `p-batch2-contract` 契约更新）。★**遗留评估**：`test:coupled` 触发面未含 `packages/components/**`（见 #869 教训）。
2. **端到端样例：真 `.vue` 用 `<pg-glass>` → 三端渲染玻璃**（把"编译折叠"与"原生玻璃"两半接起来验一次）——**含 `glass.radius` 单位校验**（★#864 遗留：iOS 宿主把 `radius` 按 pt×scale，而 `resolveGlass` 产出 `radiusPx` 物理 px ⇒ 真实 `<pg-glass>` 会踩"半径 ×3"）。
3. **`proteus audit glass` + 降级链核验**（`packages/cli/src/glass-audit.ts` 已存在，需接 CI + 校验三级降级）。
4. ✅ **（2026-10-13 已完成 · 决策 #870）`capability.ts`（8987 行）已拆为三层**——`capability-types.ts`（3849·契约）+ `capability-bridges.ts`（4040·平台桥）+ `capability.ts`（1096·工厂/Hook/响应式）。纯机械搬迁（行为零变化，全量 5764/0 与拆分前一致）。★遗留：`capability-bridges.ts` 4040 行仍偏大（按能力域再分需先解 `idleSeq` 共享可变态）。
5. **`noUncheckedIndexedAccess` 迁移**（tsconfig）——**迁移项目**（实测 2 包即 47 错，全仓数千条），须棘轮式分级上。
6. **lint 后续批次**：type-aware 规则（`no-floating-promises` 等，需配 `parserOptions.project`）+ warning 清理（1431 条）。

**★★★（2026-10-11 续 · 承接 2026-10-10 的四项新能力）新能力「跨端铺开 + 验收」清单** —— 10-10 四项（#791/#792/#793/#794）骨架在 Android；**10-11 两批已收口：#795（iOS+鸿蒙驱动）+ #796（能力归 runtime：驱动器全下沉、壳零接线、门禁 ④ 双向守）**。**剩余 = 鸿蒙签名 + 续建**：
1. **★鸿蒙真机取证（唯一剩余的环境动作）**——签名 p12 口令是**另一台机加密**的密文（本机解不开）⇒ 在 DevEco 里对 **框架参考宿主 `hosts/harmony/host-app`** 重新自动签名一次（Project Structure → Signing Configs → 勾 Automatically generate signature；本机 `build-profile.json5` 的 signingConfigs 已清空为干净态，DevEco 会自动重写），然后 `bash hosts/harmony/build-host-app.sh && bash hosts/harmony/run-superapp.sh --pump=l3,2500`（编译已过、判据脚本已就绪）。★**iOS 已收官**（真机 `calls=78 fire_ticks=78 anim_start_calls=5`）；**Android 已复验**（壳零接线版）。
2. **CSS 伪元素 `::before`/`::after` + `:active` 触发动画的 iOS/鸿蒙落点**（#791 同理只接 Android）。
3. **Web/MP 对齐**：`v-pump`（Web 走 `setInterval`/rAF、MP 走原生定时器）与 `v-animate`（Web 走 CSS 动画、MP 走 `wx.createAnimation`）——以 **Web 真值为基准**核 CSS 语义（见 AGENTS.md「CSS 基准 = Web」红线）。
4. **Dactyl 场景续建**：L3 色相沸腾 / L4 多指场 / L5 全叠加 + 总负载旋钮；D4（`dactyl-metrics.json` 生产者 · 天花板刻度尺 · 崩裂回放 · Playground 挂载 · 跨框架对照组）。★L1 涟漪的**判据**也要补：逐帧量伪元素区域（不是整帧 diff，见 #791⑧ 假阳性教训）。
5. **CSS 能力清单已回填**（本日随官网文档更新）：`docs/generated/css-capability-sources/app-profile-features.json` 新增 `selector-pseudo-element` / `selector-pseudo-state-active`，更正 `animation`（delay/iteration 已支持）。★**官网新文档**：`website/content/primitives/40-directives.md`（+en）=「指令原语」页（v-pump/v-animate/v-follow）——后续指令类能力都往这页加。


**★★（2026-10-10）Vapor 事件「方法引用 / 方法体」—— T1 + T2 均已交付** —— 计划 `docs/vapor-event-methods-plan.md`（决策 #740 立项 · **#741 T1 · #749 T2**）。
- **T1**：`@click="handleTap"` / `handleTap()` / 多语句方法体 ⇒ 编译期内联 `<script setup>` 方法体降级为动作表（ref `.value` 解包；`$emit`/`$nav`）。判据 `tests/vapor-events.test.ts` + 真实 App 管线 `tests/app-runtime-content.test.ts` ③。
- **T2**：**带实参调用** `add(2)`（⇒ `let` 形参绑定）· **方法形参** · **方法内局部变量** · **`if/else`**（⇒ `if` 条件动作）。**契约+执行器下沉** `@proteus-vue/slot-runtime`（`handler.ts` 的 `runHandlerActions`）——`screen-runtime` 与 `entry-vapor` 共用。判据 `tests/handler-actions.test.ts`（8）· `vapor-events`（+6）· `app-runtime-content` ④ · **三端真机判据 ㉓**（`t2x` 值/几何 `[0,6,12,0]`，三端全过 + 指纹一致）。
- **仍「明确不做」**（编译期诊断，不静默）：循环 / `async`·`await` / 任意函数（`console.log(...)`）。**T3**（方法调方法 / `console.*`→面板 / 模板串）待做。
- **★三端同步义务**：本轮**已三端重跑** `check:vapor-three-end`（dev 夹具 +T2 用例 ⇒ 三端都要重跑）——Android/鸿蒙/iOS 各 `run-vapor.sh`/`run-selfdraw.sh --vapor` 并提交 `results/vapor.json`（已做）。
- **现状缓解已回收**：#739 模板"必须内联"的过渡说明已改（模板仍用内联，但属风格选择，非强制）；guides/09（中英）已列出支持/仍不支持边界。

**★本轮（2026-10-08）留存 —— 新会话接手必读**
- **★★★App DevTools 面板（#672–#675）**：`proteus dev` 的 dev server 根路径 = 浏览器 DevTools（**设备环境** chips / 设备在线 / Bundle 版本·体积·重建耗时 / 当前屏 / 重建时间线 / **Elements 节点树（含内核 rect，点节点看盒模型）** / **Events 手势 trace** / **Network** / **Console** / **渲染耗时+mount**）。端点 `/`(面板) `/events`(SSE) `/ping`(心跳+env+perf) `/tree` `/inspect` `/trace` `/log`。宿主模板采集设备信息 + 推树(切屏自动刷) + JS console 垫片 + trace；**仅 dev**。
- **★★修（#694a · 2026-10-09 已修）**：App **导航挂载失败（点卡片不切屏）**——根因 = **env token 未解析**（编译产物 `"minHeight":"env:--pf-vh"` 字符串直进内核 ⇒ serde `expected f32` ⇒ `proteus_layout_create` 返 0）；Android 已由 #677 修、**iOS 漏了** ⇒ #694a 在 iOS `ScreenHost.mount` 补同一解析（`SelfDrawBridge.current` 单一实现）。★**仍欠**：**破坏性验证**（剥掉解析调用 ⇒ 应复现 create 返 0）未跑完——`packageIosHost` 会 `syncRuntimeUnits` 覆盖生成宿主，须剥**框架源码**重打包（那次被用户叫停）。★下次**别耗真机全流程**，用 **Node 层兜底**：直接对 `screen.mount` 载荷断言「无 `env:` 字符串残留」。**用户可见 ⇒ 优先**。
- **★★发版已完成（#664 → 已发布）**：用户已发布到 npm——公网各包 `latest = **0.3.0-beta.23**`（含 #663/#664 的 CLI 三修 + `templates-host`/App 能力；已验证 `resolveAppRoutes`/新主题在发布物内）。git 版本 bump 已提交追平（`8e42d962`）。
- **★★★彻底打通（#666 打包 + #667 dev 热刷，Android 纯 npm 免框架 checkout）**：外部工程（`npm create`+`npm install`，**不碰框架源码**）现可完整 `build --package` + `dev` 热刷。**打包**：桥源 `templates-host/shared/bridge/entry-superapp.ts` + AAR `templates-host/prebuilt/android/proteus-runtime.aar`（`build-runtime-aar.sh` 同步）随 CLI 包发布，无框架回退 + esbuild 按 node_modules 解析。**dev**：`resolveWatchRoots` 按**布局/配置**解析监听根（模板 `src/` 与根形态都覆盖）。**门禁**：`check:bridge-sync`（桥源真源⇄随包副本逐字节一致；改真源后跑 `node scripts/sync-host-bridge.mjs`）。真机验证：出包 3.4MB + 改源码 **59ms** 重建 → 宿主 `PROTEUS_DEV_RELOADED`。**★剩余**：iOS/harmony runtime（26/33MB 静态库）仍需独立托管（`host-runtime-package-plan.md`，已证伪其"尚未发生"前提）。
- **★★★"新工程 → 手机"已验证（#664 本地包 + #665 补更）**：`create-proteus` 新工程 → `build --target android --package` → 3.4MB APK → 装机 `PROTEUS_APP_READY`。修 **4** 缺陷：D1 `routesOutput` 硬编码（→ `app-routes.ts` 唯一实现）、D2 三端文本默认白→黑（Web 基准）、D3 CLI 宿主主题 `Theme.Material.NoActionBar`（状态栏透明）、D4 **App 页根块级满宽**（#665 · `buildLayoutTemplate` 单根补 `widthRatio:1`，修 `text-align:center`+根 padding 渲染成顶左）。**★已生成宿主需删 `dist/app/<端>/host` 重建**才拿 D3。**剩余**：App 端 `<button>` 的**原生外形**（圆角/阴影/按下态）属独立 UX 批次（语义已渲染，随 D2 可见）。
- **★★★CLI 启动期「陈旧 dist」守卫（#663）**：`npx proteus` 走 `packages/cli/dist/index.js`，**改了 `packages/*/src` 忘 `build-packages` ⇒ 跑的是旧代码**（实测：`proteus dev --target android` 仍启动 web），而 `tsx src` 手测正常=假绿。现 `main()` 顶部 `warnIfDistStale(cmd)` 从 dist 运行时会对陈旧包打 stderr 告警（不阻断）。**修法**：`node scripts/build-packages.mjs`。
- **★★★完整宿主 + CLI 出包 + dev 热刷（#662，Android 已端到端）**：`proteus build --target android --package`（`--host-dir` 可省）→ `dist/app/android/{host/, bundle-superapp.js, proteus-host.apk}`（**项目包名** = `proteus.config` native 段，如 `cn.proteus.superapp`）；`proteus dev --target android` → 改源码秒级热刷（真机验过 `PROTEUS_DEV_RELOADED`）。**剩余**：**iOS/鸿蒙 dev 热刷宿主通道待接**（iOS `#if DEBUG`+ATS / 鸿蒙 `buildMode`+NetworkKit）——本批**只端到端兑现 Android**；壳定位已收口（`hosts/*` 仅框架测试，CLI 生成宿主=项目自有）。
- **iOS 签名切换器（#657，两台电脑 office/home 分档）**：办公室机（kagsdeimac）已上档 `lyl@shxuxi.cn`；★**设备端需"信任新证书"**（设置→通用→VPN与设备管理——iOS 强制步骤；若 App 启动被拦先点这个）；**回家用机首次** `bash hosts/ios/signing.sh use <家里账号>` 上档一次即可；自查 `bash hosts/ios/signing.sh status`。
- **★超应用 CSS 能力扩展（主线，进行中）**：计划 `docs/proteus-superapp-css-expansion-plan.md`（5 个新族 **F1 定位 / F2 filter / F3 排版 / F4 交互态与伪元素 / F5 滚动**；裁定 A→E 顺序）。**★批 A（定位族）已收官**：fixed / sticky（全三端）· z-index 数值→语义层映射（#658）· 验收页 E 案例 + 四端验证（Android/iOS/鸿蒙红片在最上+Web 基准+MP 产物级）+ `css:verify z-index` 三段判据全过。**剩余**：
  · **iOS/鸿蒙的滚动锚定像素证据待补**（批 A⑤ 欠账；装置问题：iOS superapp 空跑起的是 `bundle-superapp.js` 而非 css-conformance ⇒ `--screen=` 无处可去；鸿蒙 `superapp-screen-*` 无滚动参数）。fixed/sticky 的 iOS/鸿蒙**实现已编译验证**（swiftc/HAP），仅缺滚动像素。
  · **批 B–E（F2 filter/backdrop-filter · F3 排版增强 · F4 状态伪类与伪元素 · F5 滚动增强）全部待做**。
  · **z-index v1 边界（#658 具名）**：负值 / stacking context 完整语义 / relative·sticky·flex·grid item 的 z 不生效——后续如需扩展从此处接。
- **★★（2026-10-10 · 已解决 #745）判据 ㉑（元素/文本混排）iOS 真机红** —— 根因 = `slot-runtime/instantiate.ts` 的 `normalizeWhiteSpace` **逐叶 `.trim()`** 吞混排行内空格（共享路径 ⇒ 三端都中）；修法 = collapse-only（不 trim）；三端真机重跑 ㉑ 全绿 + `check:vapor-three-end` 真机新证据（详见决策 #745）。
- **★环境更正**：iOS 一直可用（Xcode **26.5** 在 `/Volumes/data1/work/office-applications/Xcode.app`，iPhone 12 在线）；用 `source hosts/ios/lib/xcode-env.sh`（自动选 26.5）。
- **（2026-10-10 · 已修 #748）CI `verify` job 缺两处测试前置**：`pnpm test` 里的非 e2e 测试硬依赖 **Chromium**（consistency-web-probe）+ **`examples/dist/app/android/screen-content.json`**（app-screen-content-gate），而 verify job 未装浏览器、App 产物构建排在 `pnpm test` 之后 ⇒ 干净克隆/CI 必红（本地被残留掩盖）。已补：`pnpm test` 前加 `npx playwright install --with-deps chromium` + `pnpm run build:android`。

**★★（2026-10-10 发现·pre-existing）两条待修（不在 #742 的 5 红内）**：① **鸿蒙 executor 腿**真机复跑得 `app-stack-executor.json` `exec_content_nodes:0`（提交版为 114——已**保留提交版已知好证据**，未覆盖）⇒ 待查该腿真机为何零节点。② `check:host-invoke-contract` 报 harmony 未知方法 `dev.console`（**干净树同样红**）⇒ 登记表与实现漂移，待收口。
- **多端逐页视觉验收（长欠账）**：css-conformance **31 页** × 4 端逐页截图 + 独立子代理终评（现只覆盖代表页）。
- **鸿蒙签名现状（环境态，非代码）**：本机 `~/.ohos/config/*.p7b` 已可签 `dev.proteus.host`（**2026-10-10 真机装起+跑通**）；另一绑定 `dev.proteus.cssconf`（`--css` 产品）。★hdc 陷阱：若先用旧版 hdc（如 OpenHarmony SDK 1.3.0a）启了 hdc server，再混用 3.2.0d client 会报 `sdk hdc.exe version is too low` ⇒ `pkill -f "hdc -m"` 后用 DevEco 自带 hdc 单跑。
- **官网域后续**：可继续通读其余指南页（13 布局 / 19 平台 API / 22 Skyline 等）是否仍含"双端"旧叙事。
- **（已完成，勿重做）** iOS `styleOf` 透传覆盖门禁已落地（`pnpm check:ios-style-keys`，决策 #650）——本会话抓出并修掉 `borderRadiusPct` / `animation` 两处静默降级。

**长期注意事项（仍在场）**
- ⚠ **CDP 视觉验收纪律**（2026-09-04 用户强反馈「你懂什么叫居中吗」）：官网改样式必须 CDP 截图 + **数值级核对**（居中/上下间距对称、偏差 <4px，禁目测）；布局壳禁用带默认布局语义的组件（`p-view` 默认 `flex-column` 会盖 `justify-content:center`——同源坑三次）。
- ⚠ **根 `vue-tsc` 零错误**须持续保持。
- **Skyline iOS 真机白屏**（微信平台已知问题，roadmap v0.5）：真机实测时记录复现路径（决策 #69）。

**历史已完工单（2026-08～09，全 ✅，勿重做）**：框架拆包 45 包 + npm 发布 · 组件库 P0 · i18n/devtools/types/security/app-plan B1 · 构建缓存 M8 · G-32 语义原语（capability 50/50、工程原语 28/28）等——详见 `docs/project-memory-archive/2026-09.md` 与 `decisions.md`（#1–#507）。

## 后续规划（更新于 2026-09-02，★以「当前状态速览」为准）

**主路线（G-32 完整语义落地，决策 #303-#311 链）**：
- **G-32 B3 续**：⑤ Capability **50/50 收官**（七/八期 12 能力：map(C4)/sms(C22)/background(C25)/socket-task(C28)/data-channel(C31)/cookie(C32)/face-id(C39)/in-app-purchase(C46)/mini-program(C47)/embedded(C48)/live(C49)/extension(C50)——web 真实 document.cookie·visibilitychange·WebSocket·WebAuthn + wx 原生 createMapContext·navigateToMiniProgram·startSoterAuthentication facial·onAppHide/Show·SocketTask·storage Cookie + 宿主桥 data-channel/embedded/live/extension 诚实降级，决策 #323）
- **G-32 B5**：⑥ 工程原语 28（**★★28/28 收官：首期 E1 useState/E2 useComputed/E3 useWatch/E6 useLifecycle/E7 useReady/E9 usePageParam（决策 #319）+ 续 E10-E17 路由语义化（决策 #320）+ 续二 E19-E23 动画（决策 #321）+ 续三 E24-E28 工程化（决策 #322）——`createEngineering`/`createRouterEngineering`/`createAnimationEngineering`/`createToolingEngineering` 注入式四工厂 + 组件形态 p-transition/p-animate（E19/E20 已 implemented）+ 纯声明工具 defineComponent/defineCapability**；B5 收官——唯一剩余 E18 router-link（声明式导航组件形态）待后续批次）；与 G-17 路由/G-34 HMR 协同
- **G-32 B6**：对照矩阵自动化（miniprogram-mapping 与 catalog 自动同步）+ codemod 完善（scroll-view/swiper AI 语义还原 + 路由名表）

**并行候选（按顺序）**：
- **G-29 B2**：RustBackend（SWC 生态 → 同一 CompilerIR——conformance IR Golden Test 已就绪，接入即可验证）
- **G-27 B6**：混合渲染（Texture Sharing 抽象 + 页面级切后端 + DevTools 可视化）
- **G-31 收尾**：B7 续（useFetch/useStorage 已收口——剩 router 语义化对齐）

**★已整合（决策 #312-#314）**：`docs/proteus-website-v3-plus/` 与 `docs/proteus-website-v3-final/`（未跟踪）的新内容 G-33/G-34 已抽离入库为 **`docs/proteus-ai-agent-plan/`（G-36 AI Agent）** 与 **`docs/proteus-render-backend-spi-plan/`（G-37 RenderBackend SPI）**（编号避让：G-33=CLI、G-34=HMR 已实现占用）；**另发现同批 zip `proteus-compiler-backend-spi.zip`（pack.sh 产物）内含第三个新 plan——CompilerBackend SPI 原稿 G-35（与 app-config 冲突）→ 一并整合为 **`docs/proteus-compiler-backend-spi-plan/`（G-38，含 verify.sh/pack.sh/MANIFEST/conformance-runner.js 自检工具链）**；原稿引用 G-34（RenderBackend SPI）→ G-37、原则 #11（可插拔可验证）→ #13（含 #13.5-7 编译器专项子原则）同步重指向**；MCP Server（AI B1）、SPI 套件（G-37 B2）、编译器 SPI（G-38 B1）、宿主运行时 SPI（G-39 B1）可与既有 `@proteus-vue/render-backend`·`@proteus-vue/compiler-backend`·`@proteus-vue/renderer-app` 实现互为印证。**另发现第四 plan `proteus-host-runtime-plan`（未跟踪，原稿 G-36 与 AI Agent 冲突 + 兄弟引用旧编号）→ 按 #312 同法整合为 **`docs/proteus-host-runtime-plan/`（G-39，编号避让 G-36→G-39 / G-34→G-37 / G-35→G-38 / 原则 #11→#13，决策 #314）**。

**遗留已知限制**（★2026-09-19 复核）：~~tabBar 100vh 遮挡~~ **已实测关闭**（Skyline 的 100vh **按页面类型解析**——tabBar 页得 `windowHeight`=762（底边恰在 tabBar 顶边）、非 tabBar 页得 `screenHeight`=844 满屏 ⇒ 不存在遮挡；已加几何回归锁）。**仍存**：半屏页 / 长列表 list-view 摊平 / 下拉刷新 Web 端未桥接；其余 roadmap 大项（v0.5 多端 / v0.6 App+Vapor / v1.0 生产可用）见 docs/roadmap.md。

## 会话恢复指引（新 LLM 按此顺序阅读）

0. **★★★先挂载效率规范 Skill（每会话强制）**：执行 `Skill(ai-efficiency-rules)`
   （文件 `.agents/skills/ai-efficiency-rules/SKILL.md`），再开始任何工具调用——
   约束固定 `sleep` 盲等 / 重复拉取远程资源 / 重复读文件 / 无归因重试 / 该并行却串行 / 输出爆炸。
   同规则见根目录 `AGENTS.md` §0。
1. `PROJECT_MEMORY.md`（本文件）—— **★先读顶部「当前状态速览」**（只保留最近 3 条）：架构方向 / 最近里程碑 / 当前数量 / 路线图位置 / 待决项；**详细历史与决策链全文在 `docs/project-memory-archive/`（按月归档 + decisions.md，勿整读、按号/关键词 grep）**。
2. `docs/proteus-architecture.md` —— **L0 规约（真理来源）**：原则 #0-#12 + 铁律 + 十系规则总表（G-31.1-4/CMP005-8/RND001-005 等）
3. `docs/board-inventory.md` —— **架构规划全景（v2）**：六层 plan 分层索引 + 双路线对照 + 资产对照（改新增 plan/包后同步此表）
4. `docs/proteus-positioning-v3.md` —— 对外门面（slogan One semantic model. Any render engine.）
5. `docs/roadmap.md` + `docs/roadmap-2-plan/` —— 版本线 + 里程碑线（M1 双 SPI 原型 → M2 能力 → M3 生态）
6. `LLM_IMPLEMENTATION_GUIDE.md` —— §0 痛点对照 + 阶段任务指令
7. `packages/compiler/src/transforms/registry.ts` + `README.md` —— 编译规则注册表（AI 说明书，改动编译器前先查）
8. `proteus.config.ts` —— 当前配置；`examples/pages/` 是 Playground 演示
9. **多 AI 协作开发规范（决策 #871/#872/#874）**——**可执行形态 = `Skill(ai-development)`**（`.agents/skills/ai-development/SKILL.md`；规范正文 `docs/ai-development-spec.md`）：生命周期 7 关 × 三链路 A/B/C × 协作原语（任务单元 / 所有权边界 / 认领 / 交接 / 追溯）+ **反巨型化（源文件 < 1000 行）**；**认领任务 = 往 `docs/ai-tasks.json` 写一行**，门禁 `pnpm check:ai-tasks` / `pnpm check:file-size`。（A 链=开发框架 · B=G-36 用框架 · C=`Skill(ai-cobuild)` 外部缺陷）
10. **万神殿命名规范（决策 #879）**——`docs/Proteus_万神殿命名规范.md`：本仓模块/方案**代号命名 SSOT**（命名轴「**神职即模块职责**」+ 三纪律 N-1 只收神话神名 / N-2 体系内不得撞名 / N-3 定名前须商标检索 + **万神殿总览** + 排除名单 + 新命名七步）。**新增/改名模块代号 → 先过该规范再登记。**

**关键包地图（决策 #314 后）**：`@proteus-vue/render-backend`（G-27 五后端 + conformance）· `@proteus-vue/component-ir`（G-31 C-IR + G-32 128 原语 SSOT + audit）· `@proteus-vue/compiler-backend`（G-29 编译器 SPI + NodeBackend）· `packages/compiler-backend-rust`（G-29 B2 RustBackend cargo crate——同一 CompilerIR）· `@proteus-vue/gesture`（G-32 ④）· `@proteus-vue/api/capability.ts`（G-32 ⑤ useXxx 50/50——传感器/WebAuthn/useAuth/近场媒体/收官 12 能力）· `@proteus-vue/api/router-engineering.ts`（G-32 B5 续 E10-E17 路由语义化）· `@proteus-vue/api/animation-engineering.ts`（G-32 B5 续二 E21-E23 动画 Hook）+ `src/components/p-transition`·`p-animate`（E19/E20 组件形态，IR engineering.transition/animate implemented）· `@proteus-vue/api/tooling-engineering.ts`（G-32 B5 续三 E24-E28 工程化 Hook + define 工具）· `@proteus-vue/api/request-engineering.ts`（请求数据层 R1-R4：策略请求/useQuery SWR/enqueue/去重）· `@proteus-vue/compat-miniprogram`（G-31 B6 迁移）· `@proteus-vue/desktop`（G-24 B1 桌面交互原语——v-p-hover/-shortcut/-focus-trap/-context-menu）· `src/components/p-*`（57 组件聚合导出）；规划 SPI（同批四 plan：G-36 AI Agent / G-37 RenderBackend SPI / G-38 CompilerBackend SPI / G-39 Host Runtime SPI，均有规约 + conformance 套件 + 参考实现，与既有包互为印证）

