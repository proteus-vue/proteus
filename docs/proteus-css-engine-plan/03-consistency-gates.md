# 03 · 一致性门禁：以 Web 视觉为基准的三层判据 + 棘轮

> 本文件回答一个问题：**"多端视觉一致性"凭什么算合格？**
> 现状：**没有一层在负责这件事**（见 `01-baseline-survey.md` §4、§5-G5）。本 plan 把它变成可判定。
> ★**已定调（2026-10-05，决策 #546）**：一致性的 **expected 只有一个来源 —— Web 端的真实渲染**。

---

## 1. 基准：Web 视觉（唯一基准）

### 1.1 基准是什么（可采集的三件套）

"以 Web 视觉为基准"必须落成**可采集的量**，否则又变回目视。基准 = 下列三项的**冻结快照**：

| # | 基准量 | 采集方式 | 现有资产 |
|---|---|---|---|
| **B-a** | **计算样式** | 浏览器 `getComputedStyle` 逐属性（Profile 内目标属性全量） | `packages/consistency/src/probes/web.ts` |
| **B-b** | **几何** | `getBoundingClientRect` → `GeometrySnapshot`（含 `geometry_digest`） | 同上 + `packages/consistency/src/snapshot.ts` |
| **B-c** | **视觉** | Playwright **真渲染截图**（viewport / DPR / 字体 / 主题锁定） | `packages/consistency/src/pixel.ts`、`docs/consistency-pixel-noise.json` |

> **判据与基准的对应**：判据① 用 **B-a**；判据② 用 **B-a + B-b**；判据③ 用 **B-c**。三层判据的 `expected` 全部来自这里，**没有第二个来源**。

### 1.2 为什么是 Web（三条理由，均非偏好）

1. **Web 是唯一完整实现**：只有 Web 端跑在完整 CSSOM 上（`docs/proteus-css-compat-plan/06-selector-cascade.md:10`「完整 CSSOM，运行时匹配」）。其余两端都是**子集实现**——用子集当基准，等于用"缺能力的那一端"定义"应该长什么样"。
2. **A 档决定了基准必须在 Web**（本 plan §2.1 已定调）：Web 端继续由浏览器原生渲染，浏览器算出来的值**就是**这份 CSS 的权威答案。IR 只是把这份答案**规范化**，不是另立一份答案。
3. **本仓已有先例，且已付过代价**：#542/#543/#545 三轮 superapp 视觉修复，全部以「App 与 **Web 基准**逐屏对比」驱动；其中 #543 的教训恰恰是**"只看一端"**（只验了 Android 就宣称三端通过）。本 plan 把这条经验固化为判据，而不是重新发明。

### 1.3 基准的四条纪律（★本节的实质）

| # | 纪律 | 内容 | 违反后果 |
|---|---|---|---|
| **D1** | **单一基准** | `expected` 唯一来源是 Web。**端间互比（App ↔ Skyline）只能作诊断，不得作定案** | 两端同错 = 判"通过"（假绿的最常见形态） |
| **D2** | **基准冻结** | 基准以 **golden 快照入仓**（可寻址、带版本），比对**不靠"当场再跑一遍 Web"**。Web 活体重采集的用途只有一个：**基准腐化检测** | 基准随每次运行漂移 ⇒ 差异无法归因 |
| **D3** | **基准可复现** | 基准必须登记**环境指纹**：浏览器版本 / DPR / 视口尺寸 / 字体栈 / 主题。任一变化 ⇒ **视作基准变更**，须审批 + diff 审计（`baseline-bump` 流程） | 基准悄悄变了，被读成"各端集体回归" |
| **D4** | **基准自身合法** | 基准样本必须先过 **Profile lint**（B4）——不合规的写法不得进基准集 | 「用不合规的样本证明一致性」（承 `Proteus_CSS_Profile规格.md:402-406` 的样本纪律） |

**基准由 CI 统一采集，不由被测端自证**：Web 基准在 CI 的 Playwright 中产出并入库；App/Skyline 的验收脚本**只读基准、不得写基准**（写入即视为篡改，门禁红）。

> ★**升级准则（2026-10-05 追加，决策 #548）**：本节设定（Web 为唯一真值 = A 档）是**当前选择、不是终局**——G-61 的目标是**框架自己的多端一致性引擎**（CSS 只是当前选用的基准载体）。若多端一致性在此设定下被证明**结构上无法达成**（触发准则 **E1–E4** 见 `README.md` §2.4：判据①封顶 / 判据②原地打转 / 基准自身不稳 / 降级不可收敛——均需证据包，非感觉），则切 **B 档**：IR 统一为含 Web 在内的全端唯一标准，本节"默认判 IR 错"等条文随之系统性修订。

---

## 2. 三层判据总览（全部以 Web 为 expected）

| 层 | 判据 | `expected`（基准） | `observed`（被测） | 时点 | 门禁 | 本 plan 要补的 |
|---|---|---|---|---|---|---|
| **①** | **基准等价（IR ≡ Web 计算样式）** | **B-a** Web 计算样式 | StyleIR（Node/Rust 双后端） | 编译期 | **硬** | IR 层缺失——需新增 IR Golden + 「IR vs `getComputedStyle`」逐属性比对 |
| **②** | **数值等价（各端 ≡ Web）** | **B-a + B-b** Web 快照 | 各端 `GeometrySnapshot` + `NormalizedStyle` | 运行期 | **硬** | 引擎已有，**覆盖不足**（L2 2/38）⇒ B3 推到 38/38 |
| **③** | **像素观察（各端 ≡ Web）** | **B-c** Web 基准截图 | 各端真截图 | 运行期 | **非门禁** | 假绿防护 + 逐端留证纪律 |

**一句话**：**编译期把 IR 钉在 Web 计算样式上，运行期把各端钉在 Web 几何/样式上，像素只作观察。**

---

## 3. 判据① · 基准等价（编译期 · 硬）

### 3.1 两个子判据

| 子判据 | 内容 | 判据形式 |
|---|---|---|
| **①-a 后端等价** | 同一 SFC，**Node 后端与 Rust 后端产出的 IR 逐字节相同** | 与既有「Node/Rust 双后端语义等价 Golden」同机制（`docs/proteus-compiler-backend-spi-plan`） |
| **①-b 基准等价** | IR 与浏览器 **`getComputedStyle`（B-a）** 逐属性比对，Profile 内目标一致率 **100%** | 取 100+ 真实组件样本；动态 class 各组合单独比对（承 `Proteus_CSS_Profile规格.md:402-406`） |

### 3.2 ①-b 的语义（本 plan 的关键定义）

- **Web 计算样式是真值，IR 是它的规范化载体**。①-b 失败时，**默认判 IR 错**（除非能证明基准样本不合规 D4 / 基准环境指纹漂移 D3）——**不允许用"改基准"来消掉差异**。
- **限定在 Profile 内**比对——Profile 外的写法由 lint 拦截（判据外），不进入比对，避免"用不一致的样本证明一致性"。

### 3.3 `proteus explain` 必须能 trace

某节点某属性的最终值 ← 哪条规则 ← 经过哪几步层叠判定。
**这是"引擎"与"字段折叠器"的分界线**（承 `Proteus_CSS_Profile规格.md:226`）。

### 3.5 B1 落地现状（2026-10-05 · 判据①-b 首次达成）

- **比对器**：`tests/e2e-cse-parity.test.ts`（装置：真 Chromium + data: URL 单页批量；CSE 与浏览器**同源**跑同一 CSS + DOM）
- **用例表**：`tests/fixtures/cse-parity-cases.ts`（**113 用例 / 153 项**，覆盖值形态 / 层叠 / 继承 / 计算值 / 简写竞争）
- **结果**：**100% 一致**（A/B 类全过）。★**C 类（ratio/auto）不进本判据**——resolved 是布局结果（归判据②几何）。
- **门禁**：`pnpm run test:cse-parity`（CI + verify 接线）。
- **执行栈**：`packages/compiler/src/cse/{parse,match,cascade,compute,shorthand,extract,colors-named}.ts`（L-A 唯一实现；
  与 `vapor/template.ts` 旧折叠通路**并行**——B3 按端/字段切换后旧件下线，plan §2.2）。
- **trace**：`proteus explain --style`（逐字段 ← 选择器 [层 · 特异性 · 源序 · !important · 简写来源]；继承标 `inherited`）。

### 3.4 比对阶段口径（★防 E1 假触发——2026-10-05 追加，随决策 #548）

CSS 的值有阶段：声明值 → **计算值（computed）** → **使用值（used，经布局）** → 实际值（actual）。
浏览器 `getComputedStyle` 返回 **resolved value**：多数属性 = computed；但**布局相关的长度**（`width`/`height`/`margin`/`padding`/`top`/`left`…）在元素**已布局**时返回**使用值（px）**。
⇒ 判据①的比对必须按阶段分流——否则会把"阶段差异"误判成"引擎不可收敛"，**假触发 E1**：

| 类 | 字段形态（例） | 比对方式 |
|---|---|---|
| **A. 布局无关的计算值** | color / backgroundColor / fontSize / fontWeight / opacity / display / textAlign / letterSpacing / flexGrow / zIndex / visibility… | **字面比对**（配规范化表：颜色 `#RRGGBBAA`、`fontWeight: normal→400`、`font-family` 去引号、`0px≡0`；`lineHeight` 的 `normal`/数值/px 三形态 resolved 行为需**实测登记**） |
| **B. 绝对长度** | IR `{kind:'absolute', dp}`（如 `width:320px`） | **字面比对**（resolved 亦为 px，不受布局影响）；容差走 `tolerance.ts` 档 |
| **C. 比例 / auto / 依赖布局** | IR `{kind:'ratio'}`、`{kind:'auto'}`（`width:50%` / `margin:auto` / `%` 基准） | **不进判据①**——resolved 值是布局结果（used px）⇒ **归判据②**（几何 snapshot：`0.5 × 父 used 宽 == 子 rect 宽`）；判据①对此类只核**折叠形态正确**（ratio 与 base 写对） |

- **逐字段对照表**（字段 → A/B/C 类 + 规范化规则）是 **B1 交付物**；**未分类字段不得计入①的"通过"**（未覆盖就报未覆盖——承 G-55.7/G-60.7 数字口径）。
- ★本节同时是 **E1 的判定前提**：E1 =「分类完成后仍无法收敛」，**不是**「还没分类就对不齐」。

---

## 4. 判据② · 数值等价（运行期 · 硬 · expected = Web）

### 4.1 比对对象

| 项 | 载体 |
|---|---|
| 几何（`expected` = Web B-b） | `GeometrySnapshot`（`packages/consistency/src/snapshot.ts`） |
| 归一化样式（`expected` = Web B-a） | `NormalizedStyle`（闭集：颜色/字体/间距/边框/圆角/透明度/display/position/visibility + 布局族扩展） |
| 容差 | `packages/consistency/src/tolerance.ts` —— structure / color / font / textMetrics / nonDeterministic，**禁止全局差异阈值**；颜色裁决 `channelDelta: 0`（精确相等） |

### 4.2 判定的正确形态（相对基准，不是"三端彼此相等"）

```
各端 snapshot ──┐
                ├─► 与 Web 基准快照比对（≤0.5dp / NormalizedStyle 容差内）
Web 基准快照 ───┘         ▲
                          └─ 基准自身有 `geometry_digest`（FNV-1a over f32 位模式）
                             各端 digest **等于基准 digest** 才算过
```

- **`geometry_digest` 的正确用法是"各端 vs 基准"**，不是"三端摘出同一个 digest 就算过"（后者在 D1 下是**不能被接受的证法**——三端可以一起偏）。
- 基准侧同时保有 **Web 基准自身的截图/读数**，用于①发现"IR 与 Web 已经不一致"、②发现"基准腐化"。

### 4.3 目标：把 L2 从 2/38 推到 38/38

- 现状口径（`consistency-metrics.json`）：L2 只把几何 `w/h` 折算为 `width/height`，**x/y 是位置不是字段，保守计 2**。
- B3 要求：**每个 IR `semantic` 字段**都有对应 snapshot 读数与**相对 Web 基准的**比对用例 ⇒ 分母 38 全覆盖。
- 棘轮：覆盖率只增不减（写入 `docs/generated/consistency-metrics.json`）。

> ⚠ 诚实边界（继承既有）：逐字节几何指纹**只覆盖布局几何**——"画出来一样"还取决于光栅化（圆角裁剪 / 阴影 / 文本基线 / 字体 hinting），那部分归判据③。

---

## 5. 判据③ · 像素观察（运行期 · **非门禁** · expected = Web 基准截图）

### 5.1 为什么非门禁

- **铁律 G-56.7**（`docs/proteus-architecture.md:298`）：「**无障碍树优先于截图比对：跨设备视觉断言禁止以像素比对为主判据**」。
- 现状实现一致：`packages/consistency/src/pixel.ts` 的 `gate: false`；`scripts/check-consistency-pixel.mjs`「观测结论**从不**导致非零退出」。

### 5.2 本 plan 对判据③ 的三项强化

| 强化 | 内容 |
|---|---|
| **逐端真截图**（纪律，非判据） | 跨端验收**必须逐端产出视觉证据 PNG**——**禁止"一端看多端推断"**（决策 #543 教训）。三端真值途径：Android `adb exec-out screencap` · iOS `takeSnapshot()`（`UIGraphicsImageRenderer` + `drawHierarchy`）· 鸿蒙 `snapshot_display -f` + `hdc file recv` |
| **差异相对 Web 基准登记** | 像素产物一律**与 Web 基准截图（B-c）并排**产出（同一 viewport/DPR/主题）；差异登记进 `docs/consistency-pixel-noise.json`，**禁止"三端互比无差异即通过"** |
| **双向假绿防护** | ①被测侧：锚定归一后仍须校验"两图**不是同一个错误页**"——`check-consistency-pixel.mjs` 头注已自我警示「若两张图都是同一个错误页……会判 `identical`——这是最危险的假绿」；②**基准侧**（新增）：**基准图自身**不得是错误页/占位页/空态（校验基准图非纯色、含预期锚点文本）——否则"以坏基准比对通过所有端" |

### 5.3 基线登记

已知光栅化差异进 `docs/consistency-pixel-noise.json`（现 v3：`maxDiffRatio 0.035`、`maxHashDistance 0`），规则：`id/reason/recordedBy/recordedAt` 必填且唯一，`reason` 必须说明"为什么是噪声而非缺陷"，超带宽即查清而非登记（schema 门禁违规 `exit 2`）。
**新增**：每条基线须标明 `vsBaseline: 'web'`（相对基准端）——基线是"相对 Web 的容许差"，不是"端与端之间的差"。

---

## 6. 基准守护（baseline guard · 本 plan 新增）

> 引入基准就引入了一个**新的可腐败资产**。没有守护，"Web 基准"会从锚变成漂移源。

| 守护 | 内容 | 载体 |
|---|---|---|
| **基准清单可寻址** | `docs/generated/style-baseline/manifest.json`：每条基准样本的 id / 快照路径 / **环境指纹**（浏览器版本 / DPR / 视口 / 字体栈 / 主题）/ 生成时间 / 采集脚本版本 | 新增 `check:baseline-manifest`（schema 门禁） |
| **基准变更须审批** | 基准快照 diff 一旦非空 ⇒ 必须**显式 bump**（`baseline-bump`），提交信息带批准人与原因；**匿名变更即门禁红** | 同上 + `check:gates-sync` |
| **基准腐化检测** | 定期（非门禁）用 CI 的 Web 活体重采集与 golden 比对：**仅当环境指纹一致时**，差异即基准腐化 ⇒ 告警；指纹不一致 ⇒ 先归因环境，不告警 | 新增 `scripts/check-baseline-freshness.mjs`（非门禁） |
| **基准不得自证** | 采集器与比对器**分离**：App/Skyline 侧脚本无写基准权限（路径白名单校验） | `check:baseline-write-guard`（新增） |
| **字体敏感样本标记** | 文本度量类样本标 `baseline-sensitive: text`（跨平台字体栈差异最大）—— 这类样本**不得**用于判据②的严格相等，改用文本度量容差 | `tolerance.ts` 的 `textMetrics` 档 |

---

## 7. 反退化：全部棘轮

| 棘轮 | 载体 |
|---|---|
| **基准清单与环境指纹** | `check:baseline-manifest`（新） |
| IR 字段闭集 | `check:style-ir-schema`（新） |
| 三表同源 | `check:app-css-surface` |
| 能力矩阵 | `check:css-capability-alignment`（生成器 `--check` + 空绿防护） |
| 一致性覆盖率 M1/L1/L2/L3 | `check:consistency-metrics` |
| 像素噪声带宽 | `check:consistency-pixel`（schema 门禁） |
| 边界规则 | `check:profile-boundary`（VC2-b，baseline 棘轮） |

**规则**：新增 CSS 字段 ⇒ 必须同时进 IR 规范 + 三 Applier + 三层判据，否则门禁红（INV-CE-07）。

---

## 8. 与既有门禁的关系

- 既有 Node/Rust 双后端 Golden、五后端测试、`test:coupled` **全部继续通过**（不得注册为"计划中失败"）。
- `check:gates-sync` 校验门禁脚本注册一致性 —— 新增脚本必须同步注册。
- 数字口径：报告数字**不粉饰**（承 `G-55.7`/`G-60.7`）——未覆盖字段不得算入"通过"，空样本覆盖率 = 0 不是 1。
- 报告须**并列**写明：基准端 = Web（含环境指纹）+ 各端相对基准的差异 —— 不得只报"三端一致"（那是 D1 禁止的证法）。
