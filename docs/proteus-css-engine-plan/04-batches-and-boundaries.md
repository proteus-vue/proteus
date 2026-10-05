# 04 · 分批实施 · 逐端验收 · 边界与风险

---

## 1. 分批实施（每批可独立验收）

| 批次 | 内容 | 依赖 | 验收判据 |
|---|---|---|---|
| **B0 契约冻结 ✅**（2026-10-05 达成） | ① `StyleIR v1` 规范（字段闭集 + 值类型 + 版本规则，见 `02-style-ir-contract.md`）② **Capability Registry 三表合一** ③ `SApp` SPI 签名冻结 ④ **基准 manifest**（Web 基准样本 + 环境指纹 + 快照寻址，承决策 #546） | 无 | ✅ 全达成：`pnpm check:app-css-surface` **绿**；`check:style-ir-schema` **0 error**（77 字段）；IR Golden（Node≡Rust **编码层**逐字节）**绿**；`check:baseline-manifest` **0 error**（B-a/B-b/B-c 三样本就位）|
| **B1 CSE 内核**（把 Profile **P3** 做完） | 收集 `@import` / 按 key selector 分桶索引 / 右→左匹配 / **完整五级层叠**（origin&importance → `@layer` → specificity (a,b,c) → source order）/ 继承传播 / 计算值（em/rem/%/vw/vh/rpx）；Node 与 Rust 双后端产同一 IR | B0 | 100+ 真实组件样本：IR vs `getComputedStyle`（**Web 基准 B-a**）逐属性一致率 **100%**（Profile 内）；`proteus explain` 能 trace 到规则与层叠步 |
| **B2 动态 class 预计算**（Profile **P4**） | **属性维度分解**（非 2ⁿ 枚举）+ 互斥分组 + 爆炸保护（表数 >16 / 取值数 >8 警告；不可枚举即 E-CSS-004 报错）+ 运行时位图查表 | B1 | 动态组合 IR 与浏览器该组合实测一致；查表 O(1) 有 profile 证据 |
| **B3 三端 Applier** | Web（**A 档：IR 探针 + 基准采集器**）/ Skyline（wxss 子集 + 降级）/ App（复用 `apply_style_key` 通道）各一，走**同一 conformance** | B1 | 同一 IR → 三端 snapshot **相对 Web 基准（B-a+B-b）** ≤0.5dp；**L2 覆盖 2/38 → 38/38** |
| **B4 降级编译 + lint 收口**（Profile **P5/P6**） | E-CSS-001~006 / W-CSS-101~105 全量；`degradeTo` 配方执行器（grid→嵌套 flex 等）；**Web 端 lint 接入**（一致性前置 + 基准自身合法 D4） | B0 | Profile 外写法在 **Web 端也报错**；降级产物过 Applier conformance |
| **B5 一致性门禁升级** | 三层判据全接棘轮 + **基准守护（清单/审批/腐化检测/写入守卫）** + 假绿防护（含基准侧） + 逐端真截图留证 | B3、B4 | 三端真截图**与 Web 基准并排**留证；像素基线登记（`vsBaseline: 'web'`）；基准腐化检测上线；报告数字不粉饰 |

**关键路径**：B0 → B1 → B2 →（B3 ∥ B4）→ B5。
**App 端零新增运行期成本**：B3 的 App Applier 复用 `layout-core-rust` + ops 通道，不引入任何运行期解析（INV-CE-03）。

---

## 2. App 端改造纪律（★已定调：新通路并行、逐字段切换）

**背景**：App 端现状是 `parseStaticStyle` **直折进引擎字段**（`packages/compiler/src/vapor/template.ts:508-1046`）。改成"IR 驱动"要触及 `parseStaticStyle` / `parseClassRules` —— **高风险重构区**。

**纪律（禁一次性替换）**：

1. **新通路与既有通路并行存在**：IR 通路先只覆盖**一个字段子集**，其余字段仍走既有直折。
2. **按字段逐批切换**：每批只切一组字段（如先 `backgroundColor/color/fontSize`，再盒模型，再 flex）。
3. **每批必须有 IR 等价判据兜底**：切换批次 ⇒ 既有 `tests/vapor-class-styles.test.ts`（现 118 组）+ 三端 `check:app-screen-content` 必须全绿；**任一批不达标即回退该批**，不带病前进。
4. **目标终态**：既有直折通路**下线**，IR 成为 App 端唯一样式输入 —— 此时铁律 **G-61.2**（禁绕过 IR 直折）方才生效；切换完成前，该铁律对本批未覆盖字段**暂不适用**（需在每批记录中显式声明未覆盖字段清单）。

---

## 3. 逐端验收清单（"落地到每一个宿主"的可执行定义 · 全部相对 **Web 基准**）

对每个宿主，**四项全绿才算"落地"**：

| 项 | 内容 | 判据（`expected` = Web 基准） |
|---|---|---|
| ✅ **能力声明** | 该端 `HostStyleCapabilities` 覆盖 IR 全字段（或显式登记降级路径） | Registry byHost 校验 0 error |
| ✅ **应用器通过 conformance** | 同一 IR → 应用后状态与**基准端（Web）**等价 | Applier conformance 套件（**比对对象 = Web 基准，不是端与端互比**） |
| ✅ **数值判据** | snapshot 相对 **Web 基准快照** ≤0.5dp，无未登记差异 | `check:consistency-snapshot`（digest 与基准比，非"三端同为某值"） |
| ✅ **视觉证据** | 该端**真截图**留证（**不许由别端推断**），且**与 Web 基准截图并排** | PNG 产物（三端 + Web 基准同图幅）+ 逐端差异说明（相对基准） |

### 当前进度（立项时）

| 端 | 能力声明 | Applier | 数值判据 | 视觉证据 | 综合 |
|---|---|---|---|---|---|
| **Web** | ✅（**基准端**） | ◐（A 档：IR 探针 + 基准采集器） | ◐（基准侧：golden 未入仓） | ◐ | **基准端** |
| **Skyline** | ◐（实测矩阵 P1 已 25/25） | ❌ 无 Applier 概念 | ◐ | ◐ | 缺 IR 通路 |
| **App**（iOS/Android/鸿蒙） | ◐（引擎字段通路在） | ❌ 无 Applier 概念 | ◐（L2 2/38） | ◐（#543 起逐端截图，基准对照自 #545 起） | 缺 IR 通路 + 重构未做 |

> ★**App 是一端三平台**（一套自研引擎，见 `Proteus_CSS_Profile规格.md:89-92`）——视觉证据需**每个具体平台各出一张**（Android/iOS/鸿蒙），不可互相推断。
> ★**基准端自身也要留证**：Web 基准截图（B-c）必须同批产出并入库，作为各端差异的**参照物**；只留三端图、不留基准图 = 无法判定"谁偏了"。

---

## 4. 不做清单（沿用既有立场，不重议）

| 不做 | 理由 |
|---|---|
| ❌ 不自研文本基础设施（字体 / BiDi / RTL / emoji / OpenType） | Profile **L4**：复用 CoreText / StaticLayout / 平台字体栈；Satori 在此认输的领域不重复投入 |
| ❌ 不在任何宿主**运行期**做选择器匹配 / 层叠 / 单位换算 | 承 `06-selector-cascade.md:14`、`Proteus_CSS_Profile规格.md:225`，也是 INV-CE-03 |
| ❌ 不追求"Web CSS 五端像素级兼容" | 那是 Flutter/Yoga 的路（`css-compat-plan/README.md:8-9`） |
| ❌ 不引 Blink / WebF | 体积 + C++↔宿主桥接代价（记录于 `Proteus_CSS_Profile规格.md:439-445`） |
| ❌ 不以像素比对为**主**判据 | 铁律 G-56.7 |
| ❌ **不以"端间互比"作为一致性判据** | App ↔ Skyline 互比只能当**诊断**（定位"谁偏了"），不得作定案——两端可以同时偏且一致（D1，决策 #546） |
| ❌ **不以"重采基准"消掉差异** | 基准漂移是独立事件，须走审批 + diff 审计；用改基准让判据变绿属于造假（INV-CE-10） |

---

## 5. 风险与处置

| # | 风险 | 处置 |
|---|---|---|
| **R1** | **App 端重构风险**（改 `parseStaticStyle` 恐改乱） | **新通路并行 + 逐字段切换 + 每批 IR 等价兜底**（§2）；不做一次性替换 |
| **R2** | **三表合一的连带影响** | 会触碰当前报红项；**保留已登记豁免**（`display`/`position`/`overflow` 的引擎字段层差异）——**更新豁免登记，不放宽判据** |
| **R3** | **Skyline 刚性约束** | 唯一外部约束：能力矩阵必须以**真机实测**为输入并持续棘轮（P1 已 25/25）；`grid` 等降级需与微信基础库版本绑定 |
| **R4** | **IR 引入"第三个概念"导致三套并存** | 靠 INV-CE-07（四同步）+ 铁律 G-61.2（单一通路）压住；**切换期显式登记未覆盖字段**，避免"看起来已统一"的假象 |
| **R5** | **覆盖率提升被误读为"视觉已一致"** | M1/L2/L3 只反映**字段级**覆盖；光栅化差异归判据③（非门禁）；报告须并列标注两者，**不得混算** |
| **R6** | **基准漂移 / 基准腐化**（浏览器版本或字体升级 ⇒ 基准变了，被读成"各端集体回归"；或基准样本悄悄失效） | 基准**冻结入仓 + 环境指纹登记**（D2/D3）⇒ 指纹不一致即先归因环境；**变更须审批 + diff 审计**；B5 上基准腐化检测（非门禁告警） |
| **R7** | **基准的字体/DPR 敏感性**（CI 容器与开发者机器字体栈不同 ⇒ 文本度量类基准不可跨机复现，"基准"本身成了噪声源） | 文本度量样本标 `baseline-sensitive: text`，走 `tolerance.ts` 的 `textMetrics` 档而非严格相等；基准环境指纹含字体栈，采集一律在 CI 内 |

---

## 6. 规约冲突处理（必须正面回答）

| 冲突点 | 原文 | 处理 |
|---|---|---|
| 「自研 CSS 引擎违背原则 #10」 | `docs/proteus-css-compat-plan/06-selector-cascade.md:14`：「若在运行期实现完整级联 = 在原生端自研迷你 CSSOM，**违背原则 #10（不自研 CSS 引擎）**」 | **不改立场，改措辞** ⇒ B0 同步把该句改写为：「**不在任何宿主运行期实现选择器匹配 / 层叠 / 单位换算**；样式真源为**编译期 CSS 引擎（唯一实现）**，产物为 StyleIR」。原句反的是"运行期 CSSOM"，本 plan 引擎在编译期，**立场一致** |
| 「运行时不存在 CSS 解析」 | `Proteus_CSS_Profile规格.md:225` | **保留不动** —— 本 plan 是该条的**实现**，不是违背 |
| 原则 #10「统一语义 + 后端实现」 | `docs/proteus-architecture.md:37` | **本 plan 就是 #10 在样式域的实例化**：把"做什么"（样式语义）从碎片化收敛为 StyleIR，"怎么做"由每端 Applier 实现 |
| RenderBackend SPI（G-27/G-37） | `packages/render-backend/src/spi.ts` 仅有 `patchProp` | **不造第二套 SPI**：`SApp` 定位为 **G-27 的样式子域**（补 `patchProp` 之上的"声明→字段"映射），避免两套 SPI 打架 |
| 铁律 #9「两处白名单必须同步」 | `scripts/check-app-css-surface.mjs:5-23` | **B0 三表合一**，让报红项转绿 |
| 铁律 G-56.7（禁像素主判据） | `docs/proteus-architecture.md:298` | **遵守**：本 plan 判据③ 明确非门禁（`03-consistency-gates.md` §5） |
| 既有三端几何判据「三端 digest 逐字节一致」 | `hosts/shared/check-cross-end-geometry.py` | **收敛为"各端 vs Web 基准 digest"**：原判据在"三端同时偏且偏得一样"时判绿（D1 缺陷）。**不删既有脚本**——先并行（基准判据为准、三端一致线作诊断），B3 后以基准判据为门禁 |
| 既有「Web = 真值基准」散落表述 | `Proteus_CSS_Profile规格.md:400`、`03` 各节 | **不冲突**：本批把散落表述收敛为**唯一基准定义 + 四条纪律 + 守护机制**（决策 #546），是同一立场的强化而非改向 |
