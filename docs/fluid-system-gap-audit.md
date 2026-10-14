# 柔性系统完整性审查（2026-10-13）

> **性质**：**审查报告**（不是立项计划）。回答一个问题：**当前的柔性系统，离「OS 级」还差什么。**
> **方法**：逐项核实（文件存在性 / 生产消费者 grep / 门禁实跑），不采信文档自述。
> **上游**：`docs/proteus-fluid-system-plan/04-closure.md`（2026-09-29 阶段收口）· `02-os-level-roadmap.md`（七视角复审）。
> **时间关系**：收口至今 **14 天**，本报告即「收口清单的当前核实状态」。
> **门禁实测**（Node 22.22.2）：`node scripts/check-fluid-wording.mjs` → ✅ 口径一致（8 形态 / 81 文件）；
> `vitest run` 7 个 fluid 测试文件 → **155 用例全过**（8.6s）。

---

## 0. 一句话结论

**方向已被操作系统自己证实（不是我们的判断），但当前实现与「OS 级」之间隔着一层结构性缺口：
L2 形态求解层是 Web 单端实现，且它依赖的"信号"全部来自声明而非实测。**
更值得先处理的是**一处 API 语义风险**：框架把 `orientation` 当**一等信号**暴露，
而这个信号正是各 OS 正在**取消**的那个——Android 17 之后在大屏上它不再随旋转变化。
**继续保留它，会诱导业务写出注定失效的代码；这比"缺功能"更贵。**

---

## 1. 方向校准：外部证据（本轮新取证，非转述）

### 1.1 Android 的两级拆除（官方原文）

| 版本 | 变化 | 对我们的意义 |
|---|---|---|
| **Android 16（API 36）** | 大屏（sw ≥ 600dp）上**系统忽略** `screenOrientation` / `setRequestedOrientation()` / `getRequestedOrientation()` / `resizeableActivity` / `minAspectRatio` / `maxAspectRatio`；`Configuration.screenWidthDp/screenHeightDp` **不再排除系统栏**，官方明确「用 Configuration 做布局计算**一直不推荐**，现在应当迁走」；`Configuration.orientation` 在**近方形设备**上被间接受影响 | 「横竖屏」在系统层**不再是可依赖的权威语义** |
| **Android 17（API 37）** | **移除开发者选择停用**——`PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY` 失效，目标 API 37 的应用**必须**能适应任意显示尺寸与方向 | 过渡期结束，「读方向锁布局」这条路**彻底关闭** |
| **Google 给的替代** | `computeCurrentWindowMetrics` / `WindowInsets` / **WindowSizeClass**（窗口级，非屏幕级） | 替代方案正是**窗口/容器驱动**——与 Proteus 容器查询同向 |

**厂商侧早已同向**（本仓 04-closure §1.3 已登记，非新增引用）：小米《大屏应用 UX 设计指南》原文
「**不要用 rotation，按宽高布局**」；华为《布局基础》双维度断点（宽 + 宽高比）。

> **判定**：用户判断成立，且证据比"验证方向"更强——**厂商指南在前，OS 强制在后**，
> 两段独立信号同向。这不是我们猜对了，是行业收敛到同一个结论。

### 1.2 但方向对 ≠ 当前形态对：本仓仍持两套方向语义

| 位置 | 实现 | 语义 | 判定 |
|---|---|---|---|
| `packages/fluid/src/context.ts:43` | `resolveOrientation(width, height)` | **容器宽高派生** | ✅ 正确方向（Android 17 之后唯一活路） |
| `packages/fluid/src/env.ts:30` | `matchMedia('(orientation: landscape)')` | **视口媒体查询** | ⚠️ 正是被弱化/取消的那类信号 |
| `packages/api/src/capability-bridges.ts:2642,2666,3991` | 同上（matchMedia） | 同上 | ⚠️ 第二处独立实现 |
| `packages/fluid/src/layout.ts:112` | `orientationchange` 监听 + 视口断点 | **视口级** | ⚠️ 与"响应式基准是容器而非视口"的设计宣言相冲突 |

**两个 `orientation` 会给出不同答案**：一个窄容器嵌在横屏视口里 → `context.ts` 说 `portrait`，
`env.ts` 说 `landscape`。`DeviceEnvState.orientation` 还是一等字段（`env.ts:11`），
业务可以合法地写 `if (env.orientation === 'landscape')`——**在 Android 17 大屏上这行代码永远为假或永远为真**。
`resolveOrientation` 自身也有边界退化：正方形（`height === width`）判 `landscape`
——而"近方形"恰是 Android 官方点名 orientation 语义失真的场景。

---

## 2. 五维体检表（OS 级 = 信号 → 语义 → 落地 → 治理 → 契约）

| 维度 | OS 级该有的样子 | 当前实况 | 级 |
|---|---|---|---|
| **① 信号源** | 端实测上报（窗口度量 / 姿态事件 / 系统偏好） | 三层模型代码里已声明，但②环境探测与③容器尺寸**均 Web-only**；`createFormFactor` / `senseForm` / `probePointer` **生产消费者 0**（仅 `index.ts` 导出 + 自身定义） | **C** |
| **② 语义层** | 对齐 OS 原语（WindowSizeClass / size class / fold posture） | `vendorSizeClass(600/840 × 480/900)`、`resolveAspectClass`、`FormPosture` 已对齐**厂商规范**；但没有一处读 OS 算好的窗口尺寸类——**我们在自己重算 OS 已有的结论** | **B** |
| **③ 多端落地** | 五端同一语义求解 | Web ✅ 全量；**MP 🟡**（L1 部分已通，**L2 未接**）；App/iOS/Android/鸿蒙 🟡 未接线 | **C** |
| **④ 治理** | 组件层"柔性合规"机器判据 | FLD001–013 存在，但**FLD005（死尺寸）明确未启用**；门禁入口只有 `check:fluid-wording`（管**文案**）；FLD 只扫 pages/src 的 `.vue`，**组件自身裸 px 不在扫描面**（`p-formfactor` 1410 行 / `p-ad` 裸 px 均漏网） | **B-** |
| **⑤ 契约** | 决策一致性 fixture + 跨形态状态连续 | `onFormChange` / 状态迁移 / 焦点滚动恢复 **均无** | **C** |

---

## 3. 缺口清单（含本轮逐项核实）

### 3.1 上一阶段已登记、当前状态复核（09-29 → 10-13）

| # | 缺口 | 收口文档所述 | **10-13 核实** | 结论 |
|---|---|---|---|---|
| **P0-1** | 运行时能力协商 | `caps-negotiation.ts` 不存在 | `packages/fluid/src/caps-negotiation.ts` **仍不存在** | 未推进 |
| **P0-2** | 形态感知服务（信号源） | `createFormFactor` 零消费者 | **仍零生产消费者**（`p-formfactor` 用自带 `senseFormFast`，仅按宽度推断，`formfactor.ts:177`） | 未推进 |
| **P1-3** | 系统偏好联动 | `prefers-color-scheme` / `forced-colors` 未接 | 全仓 grep `packages/` **零命中** | 未推进 |
| **P1-4** | 跨形态状态连续契约 | 无 `onFormChange` | 仍无 | 未推进 |
| **P1-5** | 纵向流体 | `props.height` 零读取 | `p-formfactor/index.vue:121` 有 `height` prop，但求解仍由 `metricWidth` 单变量驱动（`:266`） | 未推进 |
| **P2-6** | 每后端决策一致性 fixture | 未实现 | 未实现 | 未推进 |
| **P2-7** | MP 降级路径 | `p-formfactor` 未接容器工厂 | **确认未接**：`mpContainerObserverFactory` 只有 3 个消费者（`p-zone` / `p-split` / `p-toolbar`），`p-formfactor` 零命中 | 未推进 |
| **P2-8** | 焦点导航性能 | 未做 | 未做 | 未推进 |

> **读完这张表的判断**：收口文档的"未收项"**没有一项在 14 天内推进**。
> 这不是批评——14 天里主线是玻璃三端 + 治理补层。但它说明一件事：
> **这些缺口不是"随手补"的量级，它们需要一次正式立项**（收口文档 §7 也是这么要求的）。

### 3.2 本轮新增发现（上游文档未登记）

1. **L2 是 Web 单端实现，却承担"OS 级"对外表述**。
   `p-formfactor/index.vue` 的求解链是 DOM 强耦合：`querySelectorAll`(`:322`)、
   `getBoundingClientRect`(`:355`)、`addEventListener`(`:422`)、`HTMLElement`(`:137`)。
   而 `04-closure.md §4` 自己写了纪律：「不要在无外部可验证证据时用『OS 级』」——
   **纪律已写下，但表述没跟上**。

2. **`resolveAspectClass` 吃的是"声明视口"而非实测尺寸**。
   `p-formfactor/index.vue:225-226`：`const vp = postureDef.value?.viewport ?? profile.value.viewport`。
   姿态语义（华为双维度断点）**有**，但"按当前真实窗口宽高比求解"**没接**——
   这正是 P0-2 + P1-5 缺席的直接后果，且它让 L2 的"姿态感知"在真机上退化成"读画像"。

3. **`orientation` 语义的降级没有做**（见 §1.2）——上游文档没有把这一条单列，但它优先级应高于 P0-1。

4. **FLD005（死尺寸）关闭**与柔性系统的定位直接冲突：
   柔性系统最该管的坏味道就是"写死尺寸"，而这条规则因"启发式噪音大"被关闭。
   正确解法不是放着不管，而是**把启发式换成语法级判据**（组件内联 `px` 字面量 / 非 clamp 的 width·height）。

---

## 4. 建议：先做"语义校准"，再做"信号补齐"

### 建议 A（成本最低、收益最高）——**把 `orientation` 从一等信号降为派生量**

- `DeviceEnvState.orientation` 标注为 **Web 兼容字段**（或直接移除，改由容器宽高派生）；
- `env.ts` / `capability-bridges.ts` 的 matchMedia 实现标注"仅为 Web 兼容层，不得作为布局依据"；
- `resolveOrientation` 补近方形退化语义（`|w-h| / max(w,h) < ε` → 独立档，而非硬判 landscape）；
- 在 `check-fluid-wording.mjs` 增一条**禁用语**判据：文档/示例中不得出现
  `if (orientation === ...)` 式的布局分支（与既有"弃用术语"同一机器门禁）。

> 这条做的是**防止框架把业务带向死路**，而不是补功能。

### 建议 B——**P0-2 形态感知（信号源）立项**（它是 P0-1 / P1-4 的公共前置）

按收口文档 §7 的顺序：P0-2 → P0-1 → P1-5（可并行）→ P2-7。
落地面：`FormSignal { displayMode, hinge, windowKind, input }` → `sensePosture(signal)`，
各端接 `WindowInfoTracker.FoldingFeature` / ArkUI `display.foldStatus` / Web `env(fold-*)`，
**并把 `ResolvedForm.source` 落到 `data-pf-source`**（让"读的是画像还是实测"可机器断言）。

### 建议 C——**治本一条：优先读 OS 已经算好的尺寸类**

`vendorSizeClass` 是我们**自己实现**的窗口尺寸类。Android 有 `computeCurrentWindowMetrics`、
iOS 有 `traitCollection.horizontalSizeClass`、鸿蒙有 `windowStage`——
"OS 级"的正确姿势不是"我按同一套阈值再算一遍"（那是**模仿**），
而是**优先消费系统结论、缺则以我们的阈值兜底**（与 `detectFluidCapabilities` 的
`css-supports → 声明` 降级链同一模式）。这一条把语义层从 B 拉到 A。

---

## 5. 需要拍板

1. **`orientation` 语义是否按建议 A 降级**（改 `env.ts` + 加禁用语门禁）？这是"框架给出的 API 形状"决策，改起来会触到 `env.ts` / `capability-bridges.ts` / 文档三处。
2. **是否本轮就立项 P0-2**（`docs/proteus-fluid-system-plan/05-form-signal.md` + `board-inventory` 登记 + 决策条目）？
3. **「OS 级」表述是否按端限定**——目前 L2 只有 Web 端；建议对外改「Web 端已落地 / 其余端路线图」，或直链兼容表。

## 6. 可复现验收

```bash
node scripts/check-fluid-wording.mjs                                   # 预期：✅ 口径一致（8 形态）
npx vitest run tests/fluid-*.test.ts tests/adaptive.test.ts            # 预期：7 文件 155 用例全过
grep -rc "createFormFactor" packages/ --include=*.vue                 # 预期：0（信号源零消费者）
grep -rl "mpContainerObserverFactory" packages/ --include=*.vue       # 预期：仅 p-zone/p-split/p-toolbar
```

---

## 附：诚实边界（本报告不主张什么）

- 本报告**未**主张"柔性系统落后"：它的语义层（形态画像 / 能力三态 / 姿态 / 厂商档位）在跨端框架里
  确实少见，方向取证也成立。缺的是**信号与落地面**，不是设计。
- 本报告**只做了定向抽测**（155/155），未跑全量；全量结论需 `PROTEUS_ALLOW_FULL_SUITE=1 pnpm test`。
- Android 16/17 行为引官方文档；**厂商指南（ITGSA / 小米 / 华为 / vivo）为二手引用**，
  沿用 `04-closure.md §3.3` 的诚实边界，未独立核实原文（OPPO 指南仍未读）。
- 未核实：`hosts/android` 是否存在读 `Configuration.orientation` 的原生代码（本轮 grep 零命中 ⇒ 当前**未踩**被废弃 API；
  但这也是"App 端信号链根本不存在"的另一面）。
