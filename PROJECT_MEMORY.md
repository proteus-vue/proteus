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

## 当前状态速览（最近一次更新：**2026-10-13·（四七五）· ★★★App 液态玻璃合成层对齐 iOS 基准——玻璃自身内容排除出背景 + 清晰画在玻璃面之上（三端共享 runtime）· 决策 #893（承接 #892）**——用户真机 App Store 取证规格：**iOS 液态玻璃 = ① 边缘折射/高光带 ② 过折射区淡淡模糊（只作用于「背后」）③ 卡片自身内容保持原样清晰**；并指定**App 三端基准 = iOS 液态玻璃（非 Web CSS）**。★**病灶（三端同源）**：三端玻璃遍都把**玻璃节点自身子树（含文本）一起录进"背景/背板"** ⇒ 自身内容被糊进材质 + 玻璃面盖在自身内容之上（真 iOS `UIVisualEffectView`：材质只糊背后、content 原样）。★**修（统一「背景排除自身子树 + 自身内容清晰盖上」，改**共享 runtime 源**⇒ CLI 所有项目继承）**：**iOS** 捕获前 `isHidden` 玻璃节点层（排除自身）+ 玻璃面 `zPosition 5000→-1`（降到自身内容之下）；**Android** `nodeParent` 算子集 → `captureGlassBackdrop` 的 `drawCmds` 排除该集 + `drawGlassPass` 后 `drawCmds(only=子树)` 重画自身（新增 `skipIds/onlyIds` 过滤，替换死标志 `capturingGlass`）；**鸿蒙自绘** `SDNode` 补 id/parentId + `drawContentNodes` 增 skip/only + 背景排除自身/面后重画。★**产物同步**：Android 重打 AAR（含 prebuilt + 源指纹）· 鸿蒙 `harmony-runtime-prebuilt.mjs` 同步。★**验证**：三端零设备编译 + glass-capability/pixel-parity(0.49)/audit/aar-fresh/harmony-prebuilt 全绿 · **真机 iOS/Android `superapp mine` 页并排一致**（磨砂白玻璃卡 + 文字**完全清晰**，原"均匀柔化/重影"消失）。★**教训**：**「材质只作用于背后」是玻璃合成的一般语义**（`UIVisualEffectView` / `backdrop-filter` 一致）——把自身子树录进背景 = 把材质错施到自身内容；**三端同源同 bug 说明"合成顺序"这类不变量必须一次定死**。★**#894（同轮）**：用户「玻璃下面没内容采样、看不出是玻璃」⇒ `mine.vue` 加**液态玻璃舞台**（背后**实色**蓝块+青圆的结构化内容，玻璃绝对定位浮其上）⇒ **边缘折射 + 内容淡模糊显形**；真机 iOS/Android 并排一致。★**平台约束**：App 不支持 `background:linear-gradient`（用实色）+ 内联裸 `z-index` 被 LY001 拦（靠**树序**叠放）。★**#896（同轮）**：**鸿蒙 superapp 收敛自绘路径**（#842 未到期项落地）——`Superapp.ets` 切 `setContentMode('self-draw')` + `proteus_render.cpp` 自绘补图元（描边/阴影/SVG/transform/clip/z序），**真机鸿蒙 App 出液态玻璃**（与 iOS/Android 并排一致）；真机抓出两处坐标 bug（**裁剪用绝对坐标**⇒全屏白屏 / 玻璃自身子树**双重平移**）已修。★**A/B 诚实发现**：`index` 屏**文本重叠**在 render-node 原路径**同样存在**、且编译产物即重叠 ⇒ **pre-existing，另立单**。★**下一步**：① `--trace-glass` ② `T-superapp-index-overlap`（index 重叠）③ `noUncheckedIndexedAccess` 迁移 · 存量大文件继续拆。★**#897（同轮）**：修鸿蒙参考宿主 `Superapp.ets` **tab 栏高亮不更新**——`chromeStateJson.current`（路由 current，boot 后恒 index）与实际渲染屏脱节；`paintTree` 落地时 `setChromeCurrent(page)` 同步（CLI 模板壳 `MainPage.ets` 本就正确，故**新工程不受影响**）。★**教训**：同一语义多份拷贝（chrome.current vs this.current）= 静默不一致高发区。★**#898（同轮）**：**液态玻璃文档 Props 用法端到端验证**——文档 `guides/31-liquid-glass` 7 个 prop 逐写法探针，**修 `:border="false"` 布尔字面量绑定被静默丢弃**（#889 数字字面量同族遗漏；`strProp` 白名单=值的形态，须一次补齐字符串/数字/布尔）；真 `.vue`（examples/glass-demo）三端 `glass-manifest` **逐字节一致**（14 节点）；`tests/glass-ir` 6→13 例；任务卡 `T-glass-end2end` 收口 done。★**教训**：**文档承诺 vs 实现接受面**的缺口只有按文档逐写法探针才抓得到（先对契约、再对实现）。★**下一步**：① `--trace-glass` ② `T-superapp-index-overlap` ③ `noUncheckedIndexedAccess` 迁移 · 存量大文件继续拆。★**#899（同轮）**：**收掉「v-for 静态列表」边界**——`static-instantiate` 增 `foldScalarBinds`：v-for 展开后**逐项特化标量绑定**（`:preset="p"`⇒`preset="card"`，`:class` 折入的泛化）；examples 七预设/intensity 现折出**逐项不同** spec（不再全回落 custom 默认），三端一致；文档补精确口径。★**教训**：**展开 v-for 只是一步，展开后的值要一级级求值**，下游静态消费方（玻璃只认字面量）才看得见。★**#900（同轮）**：**材质系统落地**——三端宿主按 `style.glass.material` **派发管线**（gen-shaders 出材质字典，数据驱动 ⇒ 加材质零改宿主）+ **backdropBlur 接活**（曾生成未消费=假绿）+ **新增 frosted/vibrancy**（复用 BlurUniforms）；`<pg-glass material="...">` 折入；真机 iOS/Android **四材质并排**、鸿蒙单材质正确。★**发现 pre-existing 鸿蒙 bug**：**内容溢出+滚动（scrollRoot>0）整屏空白**（#896 只验过不溢出短页；全部 cpp 还原 HEAD 亦然）⇒ 立卡 `T-harmony-selfdraw-scroll`。★**教训**：**「多材质设计」≠「多材质落地」**（基建数据驱动只保证能加，**要真消费者**）；**验证样本必须覆盖真实使用形态**（长页滚动从未压过）。
## 当前状态速览（最近一次更新：**2026-10-13·（四七四）· ★★★G0 端到端（真 `.vue <pg-glass>` → 三端出玻璃）——修两处（编译器绑定数字字面量未折叠 + 玻璃 radius/blur 单位三端不一致）+ 清卡 I2 存量红 8 处 · 决策 #890**——用户「现在可以继续端到端验证了」。★**病灶（真 `.vue` 才暴露，夹具掩盖）**：① **编译器**：`strProp()` 折 `<pg-glass>` 只认字符串字面量 ⇒ 绑定的数字字面量 `:radius="12"` **静默丢弃**、回落 preset（card 16）；② **单位**：IR 的 `glass.{blur,radius}` 是 **CSS 逻辑 px**（`resolveGlass` 不乘密度、Web `radiusPx→12px`），而三端着色器在**设备像素空间**（`size_px` 已 ×密度）⇒ 每端**必须**换算：Android **两值都不换算**（漏登记）/ iOS `radius × outScale` 但 #864 把 `blur` 当物理 px **直传**（实为逻辑）/ 鸿蒙两值 ×density（对）⇒ 三端**互不相同**（Android 圆角/模糊 1/3）。★**修**：① `strProp` 认纯数字字面量（动态表达式仍不折，诚实边界）；② Android `physicalizeSpec` 增 `glass{blur,radius} × lengthScale`；iOS `blur` 改 `× outScale`（**修正 #864 单位推断**：物理 blur=逻辑×密度，与 Web `blur(10px)` 基准同）；③ `check:glass-capability` 增**单位换算接缝**门禁（三端锚点，缺一即红）；④ 顺带清卡 I2 **HEAD 即红的存量 8 处**（玻璃背景位图/纹理尺寸 + chrome dp + 鸿蒙日志取整——**皆合法例外**，补 `I2-ALLOW` 登记，门禁 228→236 例外、转绿）。★**判据**：glass-capability/shader-capability/glass-audit/glass-pixel-parity（0.49）/host-rounding 全绿 · 三端零设备编译绿 · 定向玻璃 31/31 · **真机 `superapp mine` 页**：**Android ✅ / iOS ✅**（磨砂白玻璃卡、小圆角、内文正常）。★**鸿蒙真机抓出 2 处 pre-existing（如实记录 · 未标假绿）**：⑧a **superapp 不出玻璃**（内容走 `renderCommands` RS 树，玻璃只在 `g_selfDraw` 自绘通道画；superapp 未接 `setContentMode` = #842 未到期项）· ⑧b **var 派生文本偏大 ~1.6×**（字面 px 正常，另立项 `T-harmony-superapp-text`）。★**教训**：**端到端必须用真业务 `.vue`，不能用宿主夹具**（夹具手写值掩盖逻辑 px 语义，三端单位分叉静默存活，同 #864 遗留到期）· **"单位"是三端对齐最隐蔽类**（不报错/不崩/小圆角肉眼看不出，只有物理尺寸核验或静态锚点门禁才抓得住）· **"三端全过"不得假绿**（iOS/Android 已真机验，鸿蒙缺口如实标注）。★**续修 #891（用户抓出「安卓液态玻璃下面的文字那么小」）**：Android 宿主**缺省字号未乘密度**——`optDouble("fontSize", 14)` 的默认 14 当物理 px，而 `physicalizeSpec` 只缩放**显式** fontSize ⇒ **无 `font-size` 的文本**（玻璃内文 `<text class="mine-glass-t">`）渲染成应显的 1/density（实测 Android ink 14px vs iOS 358px；对照**显式** 14 的「深色模式」两端 341/342 一致 ⇒ 缺陷只在缺省路径）。修：`fontSizePx(spec)=optDouble("fontSize", 14*lengthScale)` 替 4 处读取点；真机复验 Android 371 vs iOS 358 一致。★**教训**：**默认值也是"值"，必须过同一套单位换算**（`optDouble(k, DEFAULT)` 的 DEFAULT 从未进 LEN_SCALARS 换算）。★**下一步**：① ★**基准纠正（#892，用户指定）：App 液态玻璃三端对齐基准 = iOS 液态玻璃（非 Web CSS）**——Web/MP `backdrop-filter` 是另一通路；真机测「我的」页玻璃卡内文 **iOS=均匀柔化 / Android=笔画清晰+淡重影** ⇒ **Android 玻璃对自身内容"糊得不够"**，偏离在宿主「捕获分辨率+面分辨率+模糊换算」层（iOS `scale/3`+`scale/2` / Android 全分辨率），须把 Android/鸿蒙对齐 iOS 后逐端复验 ② 鸿蒙 superapp 收敛自绘玻璃（#842 = ⑧a）③ 鸿蒙缺省字号内部不一致（度量 `fs=14`/绘制 `fs=24`，疑 ⑧b 真因）④ `--trace-glass` ⑤ `noUncheckedIndexedAccess` 迁移 · 存量大文件继续拆
## 当前状态速览（最近一次更新：**2026-10-13·（四七二）· ★★★玻璃引擎 Web 路径补 `saturate`（对齐 iOS 通透感）+ 导航项做成玻璃胶囊 · 决策 #888（承接 #887）**——用户：「玻璃导航好像没生效…我想的效果可能是 **iOS 那种玻璃导航**」→ 澄清「**不是整个导航条，是导航上的导航块是纯文字，不是 iOS 那种玻璃导航胶囊**」。★**诊断（先取证）**：CDP 实测导航 `blur(20px)` **确在渲染**但像实底——① **我造成的**：#887 传了 `tint=rgba(11,11,15,0.72)`（**72% 不透明**盖了模糊，预设本是白 15% 霜感）；② **引擎缺口（真问题）**：Web 玻璃只有 `blur`、**没有 `saturate`**——iOS `.regular` 材质是 **`blur + saturate(~1.8)`**，`saturate` 才是通透关键（深色下只 blur≈实底）；③ **需求误读**：要的是**导航项=玻璃胶囊**，我做了**整条导航条**。★**修**：① 引擎 `glassStyleFor` CSS 输出改 **`blur(b) saturate(1.8)`**（新导出 `CSS_SATURATE`，与原生端 WGSL `u.saturation` #875 对齐）——**一处改，全端玻璃通透感一起提升**；② 导航 `.nav-link` 绑**玻璃胶囊样式**（**由引擎 `resolveGlass`+`glassStyleFor` 派生**，dogfood）：非激活淡玻璃 / 激活品牌色玻璃 / `radius:999px`，去掉旧下划线。★**验证（CDP）**：导航项 `blur(12px) saturate(1.8)`+`radius:999px`、激活=品牌玻璃；截图=iOS 那味；glass 单测更新 · D-2 PASS · glass-capability/audit/file-size/doc-links/en-drift 绿。★**教训**：**"做了但看着没做"先查"是否被不透明层盖住"**（玻璃"没生效"真因=tint 0.72 盖 blur；**深色下 blur 单独≈实底，saturate 才通透**）；**"iOS 玻璃"要照苹果材质定义**（`.regular`=blur+saturate，不能只做 blur 就宣称 iOS 玻璃，同 #875）；**UI 需求先确认"容器还是单元"再动手**（我做了条、用户要块）。★**引擎产品化**：M1–M6 + #885/#887/#888 全完成；**余 G0 端到端（需真机）**。★**下一步**：① **G0 端到端（真 `.vue`→三端出玻璃 + radius 单位，需真机）** ② `--trace-glass` ③ `noUncheckedIndexedAccess` 迁移 ④ 存量大文件继续拆
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

