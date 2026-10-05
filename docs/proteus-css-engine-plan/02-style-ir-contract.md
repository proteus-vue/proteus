# 02 · StyleIR v1 契约（B0 交付物）

> 本文件定义 **L-B StyleIR**——G-61 的**核心交付物**，"可以落地到每一个宿主"的那个东西。
> 状态：**草案（v1 draft）**。B0 批次收敛为规范后冻结版本号。
> 基线来源：`docs/Proteus_CSS_Profile规格.md:234-268`（`ComputedStyle` 草案）+ `packages/component-ir/src/pnode-style.ts`（`resolveLength`）。

> ★**基准声明（2026-10-05 追加，决策 #546）**：**IR 不是独立真值**——真值只有一个，即 **Web 端浏览器的计算样式**（B-a，A 档的直接推论）。IR 的角色是这份基准的**规范化载体**：可序列化、逐字段可比、可版本化，从而能被宿主消费、能被跨端比对。因此凡是「IR 与 Web 计算样式不一致」的场合，**默认判 IR 错**（除非能证明基准样本不合规或基准环境指纹漂移）。详见 `03-consistency-gates.md` §1。

---

## 1. StyleIR 的四条设计约束

| # | 约束 | 理由 |
|---|---|---|
| 1 | **唯一样式通路** | 今天 App 端 `parseStaticStyle` 直折引擎字段、`render-backend` 走 `patchProp` —— **两条通路**。IR 必须是唯一输入，否则"落地一致"无从谈起（INV-CE-02） |
| 2 | **逐字段可比** | 一致性判据①要求「IR vs 浏览器 `getComputedStyle` 逐属性比对」——IR 的字段名/值类型必须能一一映射到 CSS 计算值 |
| 3 | **可序列化 + 版本化** | 与 `packages/host-abi`（`ABI_VERSION=1`）同构：IR 是跨进程/跨宿主契约，**字段增删即破坏性变更** |
| 4 | **零运行期解析** | IR 的值必须是**已折叠的数值或比例**，不含 CSS 文本、不含函数表达式（承 `style.rs:5-6`、`pnode-style.ts:4`） |
| 5 | **与 Web 基准双向可映射** | `semantic` 字段必须能双向映射到浏览器计算值（IR ↔ `getComputedStyle`）——这是判据①（基准等价）成立的前提；`engine-only` 字段不参与该映射 |

---

## 2. 字段闭集与双口径映射（消掉 §现状的"49 vs 38"）

B0 必须显式声明三者的关系，**不再让两套口径并存**：

```
CSS 规范（全量）
   └─ 一致性矩阵「可表达字段」38  ← 语义子集（对外承诺的一致性范围）
         └─ App 折叠面 49 字段   ← 引擎超集（App 引擎实际能吃下的）
```

- **`StyleIR` 的字段闭集 = 38 语义子集 ∪ 49 引擎超集**，每条字段带一个 `scope` 标记：
  - `semantic`：属于 38（参与一致性承诺，必须在三层判据里被覆盖）
  - `engine-only`：仅 App 引擎消费（如 `widthRatio`/`marginAuto`/`boxSizing`），**不参与跨端一致性承诺**，但必须在能力矩阵登记
- **门禁**：任一字段未登记 `scope` ⇒ `check:style-ir-schema` 报错。

---

## 3. 值类型（v1）

```ts
// 长度：必须是"已折叠"的形态，不含 CSS 文本
type ResolvedLength =
  | { kind: 'absolute'; dp: number }                       // 已折叠为逻辑像素
  | { kind: 'ratio';    ratio: number; base: LengthBase }  // 运行时按基准求值
  | { kind: 'auto' }
  | null                                                   // 未设置

type LengthBase = 'width' | 'height' | 'viewportWidth' | 'viewportHeight' | 'fontSize' | 'rootFontSize'

// 颜色：统一规范化（rgba→#RRGGBBAA 由 CSE 完成，对齐 css-compat/src/rewrite.ts）
type Color = string   // 形如 '#RRGGBB' | '#RRGGBBAA'

type Edges<T>   = { top: T; right: T; bottom: T; left: T }
type Corners<T> = { topLeft: T; topRight: T; bottomRight: T; bottomLeft: T }

type Transform2D =
  | { tx: ResolvedLength; ty: ResolvedLength; sx: number; sy: number; rotateDeg: number; originX: number; originY: number }
  | null
```

**纪律**：
- `absolute` 与 `ratio` **不得同时表达同一维度的语义**（禁止"既给 dp 又给比例"导致各端自由选择）。
- `ratio.base` 必须显式——今天 `%` 在宽/高上的基准由折叠器隐式决定，IR 要求写到字段里（消除"宽高百分比基准"分歧）。

---

## 4. 字段清单（v1 · 按域分组）

> 完整 schema 以 B0 落地的 `packages/component-ir/src/style-ir.schema.ts` 为准；此处为分组骨架。

| 域 | 字段 | scope |
|---|---|---|
| **布局 · 盒** | width / height / minWidth / maxWidth / minHeight / maxHeight / margin / padding / boxSizing | semantic（boxSizing 为 engine-only） |
| **布局 · 流** | display / position / top / right / bottom / left / overflow / aspectRatio / pointerEvents | semantic |
| **布局 · flex** | flexDirection / flexWrap / justifyContent / alignItems / alignContent / alignSelf / flexGrow / flexShrink / flexBasis / rowGap / columnGap | semantic |
| **布局 · grid** | gridTemplateColumns / gridTemplateRows / gridColumn / gridRow | semantic（Skyline 端降级为嵌套 flex —— L-D 负责） |
| **绘制** | backgroundColor / borderRadius / borderWidth / borderColor / opacity / boxShadow / transform | semantic |
| **文本** | color / fontSize / fontWeight / fontFamily / lineHeight / textAlign / textOverflow / letterSpacing / textDecoration | semantic |
| **派生（App 引擎超集）** | widthRatio / heightRatio / marginAuto / borderRadiusCorners / borderRadiusPct / transformOrigin / min·maxWidthPct / min·maxHeightPct | engine-only |
| **继承标记** | `inheritedFrom?: NodePath`（可选，供 `proteus explain` trace） | 调试用 |

---

## 5. 版本与兼容规则

| 规则 | 内容 |
|---|---|
| 版本号 | `STYLE_IR_VERSION`，与 `packages/host-abi` 的 `ABI_VERSION` **独立编号、独立演进** |
| 破坏性变更 | 字段**增删**或**值类型变更** ⇒ major+1；必须**同步**：IR schema + 三 Applier + 三层判据（INV-CE-07）⇒ 否则门禁红 |
| 兼容性判定 | 与既有「major 相等 + minor 向后兼容」同构（承 `proteus-dev-host-plan` 的 ABI 兼容矩阵） |
| 序列化格式 | 确定性 key 顺序 + 不含浮点 NaN/Infinity（借用 `host-abi` 的 canonical 思路） |
| **基准联动** | 修订 IR 语义（如"块级是否默认撑满"）⇒ 必须**同时**解释对 Web 基准的影响：要么 IR 向基准收敛，要么登记为**明确的基准差异**（带理由与期限）。**禁止**通过重采基准来消掉 IR 与 Web 的差异 |

---

## 6. Capability Registry（L-D · 三表合一）

### 6.1 今天的三张表（互不同步，已报红）

| # | 表 | 位置 |
|---|---|---|
| ① | App 编译期折叠面 | `packages/compiler/src/vapor/template.ts:56-112`（`APP_*_FIELDS`） |
| ② | 运行时 Validator 白名单 | `packages/style-safety/src/index.ts`（`LENGTH/COLOR/NUMERIC/TRANSFORM_PROPS` + `FORBIDDEN_PROPS`） |
| ③ | CSS 矩阵级别 | `packages/contracts/src/style.ts`（`STYLE_PROP_LEVELS`） |

`scripts/check-app-css-surface.mjs:5-23` 头注原文：「仓库里存在**三张样式属性表**，此前互不引用、无门禁对照……三者对 App 端**不一致**……「同一属性一个路径允许、另一个路径拒绝」的**半开状态**（违反本仓铁律 #9）」。

### 6.2 合一后的 Registry 形态

```ts
interface StyleCapability {
  field: string                          // StyleIR 字段名
  scope: 'semantic' | 'engine-only'
  tier: 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5'   // 承 Profile §3 分级
  hosts: {
    web:     Support,                    // 'native' | 'rewritten' | 'degraded' | 'absent'
    skyline: Support,
    app:     Support,
  }
  degradeTo?: DegradeRecipe              // 编译期降级配方（如 grid → 嵌套 flex）
  evidence?: string                      // 该端能力的实测/文档证据路径
}

type Support = { support: 'native' | 'rewritten' | 'degraded' | 'absent'; note?: string }
```

- **单一事实源**：由 `scripts/gen-css-capability-alignment.mjs` 的生成物**驱动**（Web=Playwright 实测 / Skyline=官方文档解析 / App=**机器推导**）。
- **消除人工表漂移**：App 列当前是人工维护的 `app-profile-features.json`（36570B）⇒ 改为「由 StyleIR 规范 + 三 Applier 实现共同推导」，人工表只保留**豁免与理由**。
- **降级配方进注册表**：`degradeTo` 让"降级"成为**可验证的编译期产物**，而非各端隐式行为。

---

## 7. SApp · 宿主样式应用器 SPI（草案）

```ts
interface ProteusStyleApplier {
  /** 声明该端能原生实现的能力（喂给 Capability Registry 的 byHost 校验） */
  capabilities(): HostStyleCapabilities

  /** 完整应用一棵（子）树的 IR —— 首次上屏 / 整屏重建 */
  applyStyleIR(node: NodeHandle, ir: StyleIR, phase: ApplyPhase): void

  /** 增量应用 —— 与既有 patchProp 通道对接（动态 class / 主题切换） */
  applyDiff(node: NodeHandle, patch: StylePatch): void

  /** 可选：文本/自适应度量（承接既有 measure 能力） */
  measure?(node: NodeHandle): MeasureResult
}

type ApplyPhase = 'mount' | 'update' | 'theme' | 'animate'
```

### 7.1 三端实现策略（分层，**不追求对称**）

| 宿主 | 策略 | 说明 |
|---|---|---|
| **Web** | **A 档**：不接管渲染；**Web 计算样式即基准真值**，IR 是其规范化载体（影子） | 浏览器原生 CSSOM 继续渲染；IR 用于①与 `getComputedStyle` 比对（判据①，**IR 侧为被测**）②与 App/Skyline 比对（判据②，**基准侧为 expected**）。**不新增 Web 样式应用器实现**，实现的是"IR 探针 + 基准采集器" |
| **Skyline** | IR → wxss 子集 + 编译期降级 | 复用 `skyline-boundary-rules.generated.ts`（24 条边界）；`degradeTo` 配方在此执行 |
| **App** | IR → `layout-core-rust` 引擎字段 + 绘制属性 | **复用既有 `apply_style_key` / ops 通道**，零新增运行期成本；`paint.*` / `text.*` / `attr.*` 键按 `ops_apply.rs` 既有分流 |

### 7.2 Applier conformance（判据②的落地方式）

同一份 IR 喂给三个 Applier ⇒ 产出"应用后状态" ⇒ 用 `packages/consistency` 的 snapshot 判定等价。
**准入**：任一 Applier 未过 conformance ⇒ 不得标记该端"已落地"（对照原则 #13 的「SPI + Conformance + ≥2 参考实现」）。

---

## 8. B0 验收判据

| 判据 | 命令 | 期望 |
|---|---|---|
| 三表合一后无半开状态 | `pnpm check:app-css-surface` | **由红转绿** |
| IR schema 与能力矩阵一致 | 新增 `pnpm check:style-ir-schema` | 0 error |
| 双后端 IR 等价 | 新 Golden（`tests/style-ir-golden.test.ts`） | Node ≡ Rust，逐字节 |
| 每个字段都有 `scope` 登记 | 同上 schema 校验 | 未登记即红 |
| **基准 manifest 就位** | 新增 `pnpm check:baseline-manifest` | Web 基准样本 + 环境指纹（浏览器/DPR/视口/字体/主题）0 error；**无基准即无法进入 B1** |
