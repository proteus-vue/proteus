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

## 当前状态速览（最近一次更新：**2026-10-20·（六〇二）· ★★★转入能力端主线：修掉一处「已落地却对外谎报未接线」（`useWebSocket` 经 runtime 间接）+ 产出源码级缺口清单 · 决策 #1112**——用户「可以在合适的时机转入能力端实现主线；内存有明确的治理实现就差不多了」。★**为什么现在转**：#1111 已裁决「那 25% 不拿」（div=3 会把 iOS 推向 1.50x 放大），解锁条件变成「需要强高频实拍样本」——那是取证工作，玻璃线收在**有明确结论**的位置。★**★先踩住一个差点犯的错**：本轮一开始想用 `primitives.ts` 的 `status:'planned'` 当缺口清单（数出 26 条），**然后发现本仓早把这个陷阱写进 `docs/generated/capability-priority.md` §0**：「不要把 catalog 的 `status` 读成已实现/未实现——对能力项它是**类别标记**（`planned` = 纯 Hook 无 C-IR 节点）」，首版曾因此把 useStorage/useNetwork 这些**日常在用**的能力读成"待实现"。差一点第三次踩同一个坑。★**缺陷 1（真缺陷·对外谎报）**：官网 websocket 的 iOS/Android 都标 🟡「能力桥未接线」，但宿主腿 **#1093 早已实现并编译通过**；根因 = `useWebSocket → wrap(res.connectWs(bridge,…))`，取值片段里**没有** `bridge.connectWebSocket`（真引用藏在 `capability-runtime.ts::connectWs()` 内）⇒ 解析器抽到 `refs=[]` ⇒ App 判 🟡。★与 #881（useMiniProgram refs 恒空）**同型第三次**：**生成器用文本解析源码 = 隐式契约，源码写法一变契约静默断裂，表现是"对外谎报"而非报错**。修法 = 新增 `RUNTIME_INDIRECT_REFS` **显式契约表**（runtime 方法 → 它内部真读的桥方法名）+ 抽取时展开；并加判据**校验该表与 runtime 实现同源**（防"表里写了个不存在的方法名"变成第二份谎言）。效果：websocket **🟡→✅**，iOS/Android 覆盖率 **40%→42%**，总览「网络与通信」**5/11→6/11**；鸿蒙仍 🟡（宿主壳未接线，**不顺手谎报**）。★**落地 2：能力端真实缺口清单 `scripts/capability-app-gap.mjs`**（口径 = 源码事实）：hook **95** · App 桥 **46** 方法 · ✅ 可接线 **38** · ❌ **真缺口 55** · ⚠️ 待核 1（`dispose`，资源管理非能力）；按影响面排序 `getStorage`(2: useStorage/useAuth) · `login`(2: useLogin/useAuth) · `addCalendarEvent`(2) · 其余 `getLocation`/`share`/`getPermission`/`openDocument`/`makePhoneCall`/`requestPayment`/`scanQR`/`track`/`log`/`getFileSystem`/`subscribeMessage`/`chooseContact`/`compressFile`/`addShortcut`/`getBluetooth`/`getNfc` 各 1。★**排除 `probe`**（它是"逐项探测 bridge 就绪"的自检钩子，会把每个缺失都算一遍 ⇒ 虚增影响面；去掉它是去掉一个**语义不同的消费者**，不是"让数据好看"）。★**该工具与官网能力页共用同一抽取器** ⇒ 页面状态与排期清单**不会分叉**（#1089 纪律的直接应用）。★**判据** `tests/gen-content-hook-refs.test.ts` 扩到 **10/10**（+3：useWebSocket refs 必须 = `['connectWebSocket']` · ★**间接契约表与 runtime 实现同源校验** · 修复落页 websocket iOS/Android ✅ 而鸿蒙 🟡）+ **破坏性**（删 `connectWs` 映射 ⇒ 当场红并直指"对外会谎报未接线"）+ content/en-drift/doc-links/file-size/codenames/script-compile 全绿。★**诚实边界**：① **只修一处谎报，没实现任何新能力**——55 个真缺口原样留着，是接下来的排期输入；② **「桥方法存在」≠「行为正确」**（方法体可能纯空壳，MP/Web 侧有 `bridge-impl-reality` 守，**App 侧无同等空壳检查**）⇒ 38 个"可接线"里仍可能藏空壳；③ 缺口清单**未覆盖鸿蒙**；④ `RUNTIME_INDIRECT_REFS` 是**人工登记表**，新增间接写法必须补登记（判据只能校验已登记项的自洽，发现不了未登记项）；⑤ 缺口数≠工作量。★**下一步（按影响面）**：① 先补**基础能力** `getStorage`/`getLocation`/`share`/`getPermission`（最常用、影响多个 hook）；② 再做**账号与支付** `login`/`requestPayment`（涉安全边界，需单独评审）；③ 每补一个能力同时补「App 桥方法 + 能力页重生成 + 真机判据」；④ 顺手给 App 侧补"空壳检查"（对齐 MP/Web 的 `bridge-impl-reality`）。

## 当前状态速览（最近一次更新：**2026-10-20·（六〇一）· ★★★补上「织纹」判据（空间自相关）+ 揪出三端口径错误：iOS `div=2` 实为 **1:1**（对应 Android `DIV=1`，不是 `DIV=2`）· 决策 #1111**——承接 #1105「先建织纹判据才能评估降密度那 25%」。★**落地判据 `scripts/glass-weave-metric.mjs`**：与 Android #1013 定位织纹**同一套方法**——亮度→3×3 高通残差→归一化自相关（h/v/两对角）→**分数 = lag≥2 的最大相关**（lag=1 是所有平滑图的自然相关，不算证据）；★**内置 PNG 解码**（zlib 手写）——因 `pngjs` 在本仓只是传递依赖（.pnpm 未提升到根），`require` 会 MODULE_NOT_FOUND，**判据工具不该被别的包的依赖变动搞坏**。★**判据自证 7/7**（没有这步，"分数低"可能是判据失灵）：合成图造 #1013 同形态网格伪影（block=2/3/4）**必须显著高于**同内容平滑图（+0.15）· 各向同性噪声**不得**误判 · 常数图残差恒 0 · 斜坡内部≈0 · 方波在完整周期出峰（★测试自己踩了坑：`floor(x/k)%2` 的周期是 **2k 不是 k**，第一版期望写错被自己测出）。★**★★最大收获不是性能而是认知——一个真口径错误**：iOS 注释原写「与 Android DIV=2 / 鸿蒙 S=2 **同口径**」，实测 → **决定织纹风险的唯一量是「有效放大倍率 = 输出/捕获」**：iOS `div=2` 捕获 1.5/输出 1.5 = **1.00x** ✅；`div=3` = **1.50x** ⚠️；`div=4` = **2.00x** = Android 被肉眼否决的 DIV=2 ❌；Android **DIV=1** = 1.00x ✅（#1013 采用）；鸿蒙**默认不传 `glassS`** = 1.00x ✅。⇒ **三端默认倍率都是 1:1，但"除数"数字分别是 2/1/不设——数字完全不同**；原注释在**结果层面碰巧成立**、在**数字层面是错的**，而**按数字去对齐会出事**：①「把 iOS 对齐成 DIV=1」⇒ 抓 4 倍像素（1.5→3 px/pt）**纯浪费**；②「把 iOS 调到 div=3」⇒ 1.50x 放大，**正是 Android 明确否决的方向**。★顺带解释一直没说清的事：**iOS 从未出现那个织纹，因为它本来就在 1:1 上**。★**对 #1105 那 25% 的最终裁决：不拿**——div=3 把 iOS 从 1:1 推向 1.50x，而 2.00x 已被肉眼否决，1.50x 是同一失效机制半程，且**iOS 侧没有织纹实测样本**（差分自相关只能看到"有结构"，无法把内容结构与插值伪影分离）；★**解锁条件变了**：不是"有判据就行"，而是**要有"玻璃压在强高频内容上"的实拍样本**。★**口径守卫 `tests/glass-capture-ratio.test.ts` 5/5**：★iOS 默认倍率必须 == 1.00（从源码取两个常量算）· 注释不得再出现"与 Android DIV=2 同口径" · ★Android DIV 必须 = 1 · 鸿蒙默认不开 glassS · 取证开关仍在；**破坏性**：把 iOS 默认改成 3 ⇒ 当场红且**直指病因**（「1.50x，应为 1.00x；放大 >1 会引入织纹（Android #1013 已否决 2.00x）」）。+ 编译检查 / file-size / script-compile / codenames 全绿。★**诚实边界**：① **织纹判据只在合成图上验证过有效性**，真实截图的分数**无法单独定性**（差分会同时看到内容结构与插值伪影）；② 因此**没有任何"iOS div=3 画质合格/不合格"的真机结论**——只证明了 1.50x 属风险区间；③ 判据阈值（0.2/0.4）**只是打印标签**，不参与自动化结论（防"分数低=画质合格"误读，已写进头注与测试）；④ 三端"除数"数字不同但倍率相同**值得后续统一表述**（改成"放大倍率"参数），本轮只纠正注释未改代码语义。★**下一步**：① 造**强高频内容**玻璃实拍样本（压在文字/棋盘/细网格上）用本判据对比 div=2/3；② 若 1.50x 实测干净再考虑 div=3；否则维持 1:1 并转"减捕获面积/隔帧重捕"；③ 考虑把三端旋钮统一表述为「有效放大倍率」，避免下一个"数字看起来像"的口径错误。

## 当前状态速览（最近一次更新：**2026-10-20·（六百）· ★★★万神殿命名纪律工具化：`check:codenames` 把"散文纪律"变成机器判据（R1 排除名单 / R2 未定名代号 / 解析自检 / 债务账本）· 决策 #1110**——承接 #1108 的 Morpheus 撞名事故。★**为什么必须工具化**：`Morpheus` 在官网当产品名用了很久，**直到一次 npm 检索才发现同域已有同名动画库** ⇒ 117 文件全局改名；而纪律只写在规范 §3/§5 的**散文里**（「🟡/🔵 不得对外」）。★**散文拦不住**——与 sleep 盲等 / 全量重复跑 / 提交不推同源，只有**工具层门禁**能停下。★**判据设计**：**R1** §4 **排除名单**名字绝不得进对外面（用了就是第二次 Morpheus）；**R2** §3 里 **🟡/🔵 未定名**代号不得进对外面，除非登记进 `PUBLIC_PENDING`；**解析自检**（解析源就是命名规范本身，**不维护第二份名单**；命中数低于下限即红 ⇒ 防"表被改格式、门禁静默全过"）；**债务账本**每次运行都打印且**棘轮只减不增**（转 ✅ 后不删会提示回收）。★**★能力边界（已写进脚本头注 + 规范 §9，防新型假绿）**：本门禁**查不出"某代号在外部世界是否撞名"**（需 npm/GitHub/商标库，人或联网工具做）——它守的是**流程**；**真正的撞名发现仍靠人**（Morpheus 就是靠 npm 检索抓到的）⇒ 必须明写，否则会出现"门禁绿了 ⇒ 以为名字没问题"。★**对外面定义**：算 `website/{content,guides,en,animation,framework}/**` + `website/src/**`（.vue 剥离 style 与注释；md 整篇算文案）；**不算** `docs/**` / `packages/**` / `hosts/**` / ★`project-memory-archive/**`（历史归档是追溯锚点，绝不回改）；**白名单** `38-module-codenames.md` 中英版（它存在的意义就是记录排除名单）。★**接线三道**：`package.json` · `verify` 链（插在 `check:decision-numbers` 后）· CI `ci.yml`；★接线时 `check:gates-sync` **当场红**并点名"新增门禁必须接线或声明仅本地"——这正是它该做的，本门禁纯静态扫描、CI 能跑 ⇒ **接 CI 而非塞 LOCAL_ONLY**。★**判据** `tests/codenames-gate.test.ts` **9/9**：接线三件 · ★**不维护第二份名单** · `PUBLIC_PENDING` 每条**必须带检索证据**（防退化成"允许清单"）· 能力边界明文 · 现行通过 + 账本如实打印 · **破坏性三条**（注入 Iris ⇒ R1 红 / 注入 Hephaestus ⇒ R2 红 / 改掉 §4 标题 ⇒ **exit 2 解析失败**，不静默全过）；测试用「临时改文件→跑→finally 还原」。+ codenames/gates-sync/file-size/ai-tasks/decision-numbers/memory 全绿。★**现行债务（建账时真实状态）**：**Kairos / Themis / Keryx / Aether 四个状态仍 🟡**（只做 npm/GitHub 粗查、**未做正式商标检索**）但**已在官网当产品名用**（导航「引擎▾」+ 各自产品页）⇒ 登记为存量债；粗查均未发现同域占用（Kairos=时间计算器 / Themis=JSON Schema·加密库 / Keryx=MCP 框架·AI 编码工具 / Aether=JS 教学工具·GitHub 高星多为网络隧道）。★**诚实边界**：① 门禁守**流程**不守**事实**（不能证明"没撞名"，只能保证"没登记的进不来"）；② 四个存量代号**仍在对外面**（本轮不清，需产品决定补检索 vs 改职能描述）；③ `PUBLIC_PENDING` 人工维护，门禁只能"不让它悄悄发生"；④ 扫描是**词级匹配**，短名或嵌在连续标识符里的可能漏检。★**下一步**：① 正式商标检索（Kairos → Themis → Aether），转 ✅ 后从账本删除；② Keryx 只出现在生成的能力页+产品页，可只改生成器降风险；③ 新代号流程：**登记 §3（🟡）→ 检索 → 转 ✅**，任何对外使用都过本门禁。

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

