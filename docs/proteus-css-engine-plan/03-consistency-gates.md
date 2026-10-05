# 03 · 一致性门禁：三层判据 + 棘轮

> 本文件回答一个问题：**"多端视觉一致性"凭什么算合格？**
> 现状：**没有一层在负责这件事**（见 `01-baseline-survey.md` §4、§5-G5）。本 plan 把它变成可判定。

---

## 1. 三层判据总览

| 层 | 判据 | 时点 | 门禁 | 现有资产 | 本 plan 要补的 |
|---|---|---|---|---|---|
| **①** | **IR 等价** | 编译期 | **硬** | Node/Rust Golden（`tests/golden.test.ts`） | IR 层缺失——需新增 IR Golden + IR vs `getComputedStyle` 比对 |
| **②** | **数值等价** | 运行期 | **硬** | `packages/consistency`（snapshot / tolerance / compare） | 引擎已有，**覆盖不足**（L2 2/38）⇒ B3 推到 38/38 |
| **③** | **像素观察** | 运行期 | **非门禁** | `packages/consistency/src/pixel.ts` + `docs/consistency-pixel-noise.json` | 假绿防护 + 逐端留证纪律 |

---

## 2. 判据① · IR 等价（编译期 · 硬）

### 2.1 两个子判据

| 子判据 | 内容 | 判据形式 |
|---|---|---|
| **①-a 后端等价** | 同一 SFC，**Node 后端与 Rust 后端产出的 IR 逐字节相同** | 与既有「Node/Rust 双后端语义等价 Golden」同机制（`docs/proteus-compiler-backend-spi-plan`） |
| **①-b 真值等价** | IR 与浏览器 `getComputedStyle` **逐属性比对**（Profile 内目标一致率 **100%**） | 取 100+ 真实组件样本；动态 class 各组合单独比对（承 `Proteus_CSS_Profile规格.md:402-406`） |

### 2.2 为什么 ①-b 是可行的

- **Web 端由浏览器原生渲染**（A 档），因此浏览器就是天然的**真值基准**：`getComputedStyle` + `getBoundingClientRect`（`packages/consistency/src/probes/web.ts` 已实现）。
- 这是 Proteus 相对其他跨端框架的**天然优势**（`Proteus_CSS_Profile规格.md:400`），必须利用。
- **限定在 Profile 内**比对——Profile 外的写法由 lint 拦截（判据外），不进入比对，避免"用不一致的样本证明一致性"。

### 2.3 `proteus explain` 必须能 trace

某节点某属性的最终值 ← 哪条规则 ← 经过哪几步层叠判定。
**这是"引擎"与"字段折叠器"的分界线**（承 `Proteus_CSS_Profile规格.md:226`）。

---

## 3. 判据② · 数值等价（运行期 · 硬）

### 3.1 比对对象

| 项 | 载体 |
|---|---|
| 几何 | `GeometrySnapshot`（`packages/consistency/src/snapshot.ts`） |
| 归一化样式 | `NormalizedStyle`（闭集：颜色/字体/间距/边框/圆角/透明度/display/position/visibility + 布局族扩展） |
| 容差 | `packages/consistency/src/tolerance.ts` —— structure / color / font / textMetrics / nonDeterministic，**禁止全局差异阈值**；颜色裁决 `channelDelta: 0`（精确相等） |

### 3.2 目标：把 L2 从 2/38 推到 38/38

- 现状口径（`consistency-metrics.json`）：L2 只把几何 `w/h` 折算为 `width/height`，**x/y 是位置不是字段，保守计 2**。
- B3 要求：**每个 IR `semantic` 字段**都有对应 snapshot 读数与比对用例 ⇒ 分母 38 全覆盖。
- 棘轮：覆盖率只增不减（写入 `docs/generated/consistency-metrics.json`）。

### 3.3 端到端判定

三端（Web / Skyline / App）各自 snapshot ⇒ 比 `geometry_digest`（FNV-1a over f32 位模式，`hosts/shared/check-cross-end-geometry.py`）**逐字节一致** + `NormalizedStyle` 容差内一致。

> ⚠ 诚实边界（继承既有）：逐字节几何指纹**只覆盖布局几何**——"画出来一样"还取决于光栅化（圆角裁剪 / 阴影 / 文本基线 / 字体 hinting），那部分归判据③。

---

## 4. 判据③ · 像素观察（运行期 · **非门禁**）

### 4.1 为什么非门禁

- **铁律 G-56.7**（`docs/proteus-architecture.md:298`）：「**无障碍树优先于截图比对：跨设备视觉断言禁止以像素比对为主判据**」。
- 现状实现一致：`packages/consistency/src/pixel.ts` 的 `gate: false`；`scripts/check-consistency-pixel.mjs`「观测结论**从不**导致非零退出」。

### 4.2 本 plan 对判据③ 的两项强化

| 强化 | 内容 |
|---|---|
| **逐端真截图**（纪律，非判据） | 跨端验收**必须逐端产出视觉证据 PNG**——**禁止"一端看多端推断"**（决策 #543 教训）。三端真值途径：Android `adb exec-out screencap` · iOS `takeSnapshot()`（`UIGraphicsImageRenderer` + `drawHierarchy`）· 鸿蒙 `snapshot_display -f` + `hdc file recv` |
| **假绿防护** | 锚定归一后仍须校验"两图**不是同一个错误页**" —— `scripts/check-consistency-pixel.mjs` 头注已自我警示「若两张图都是同一个错误页……会判 `identical`——这是最危险的假绿」，本轮**固化为判据** |

### 4.3 基线登记

已知光栅化差异进 `docs/consistency-pixel-noise.json`（现 v3：`maxDiffRatio 0.035`、`maxHashDistance 0`），规则：`id/reason/recordedBy/recordedAt` 必填且唯一，`reason` 必须说明"为什么是噪声而非缺陷"，超带宽即查清而非登记（schema 门禁违规 `exit 2`）。

---

## 5. 反退化：全部棘轮

| 棘轮 | 载体 |
|---|---|
| IR 字段闭集 | `check:style-ir-schema`（新） |
| 三表同源 | `check:app-css-surface` |
| 能力矩阵 | `check:css-capability-alignment`（生成器 `--check` + 空绿防护） |
| 一致性覆盖率 M1/L1/L2/L3 | `check:consistency-metrics` |
| 像素噪声带宽 | `check:consistency-pixel`（schema 门禁） |
| 边界规则 | `check:profile-boundary`（VC2-b，baseline 棘轮） |

**规则**：新增 CSS 字段 ⇒ 必须同时进 IR 规范 + 三 Applier + 三层判据，否则门禁红（INV-CE-07）。

---

## 6. 与既有门禁的关系

- 既有 Node/Rust 双后端 Golden、五后端测试、`test:coupled` **全部继续通过**（不得注册为"计划中失败"）。
- `check:gates-sync` 校验门禁脚本注册一致性 —— 新增脚本必须同步注册。
- 数字口径：报告数字**不粉饰**（承 `G-55.7`/`G-60.7`）——未覆盖字段不得算入"通过"，空样本覆盖率 = 0 不是 1。
