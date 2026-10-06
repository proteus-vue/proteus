// packages/contracts/src/env-vars.ts
// ★★★框架内置 CSS 环境变量（`--pf-*`）契约 —— SSOT（决策 #593）
//
// 【它解决什么】超级应用在多端下必须感知**运行期环境量**：安全区避让、系统栏本体的高度、
//   挖孔/刘海、键盘、导航模式（手势 vs 三键）、折叠铰链……这些**在编译期不可知**（设备相关、
//   随旋转/折叠/系统栏显隐而变），但开发者希望**只写 CSS**（零平台分支、零胶水 JS）。
//
//   ⇒ 框架把它们做成**内置 CSS 变量**（前缀沿用既有 `--pf-*` 约定，见 `packages/fluid`），
//     开发者写 `padding-top: var(--pf-inset-top)`，四端同语义。
//
// 【单位口径】一律**逻辑像素**（App: dp / 鸿蒙: vp / iOS: pt / Web&MP: CSS px）——各端采集层
//   出口归一（鸿蒙 px→vp、Android px→dp），消费侧不再换算（决策 #593 · 坑 P2）。
//
// 【三组】A 避让（inset，内容该离屏幕边多远）· B 系统栏本体（栏本身多高，用于铺背景）·
//   C 环境态（flags / 局部量）。Stage 1 落地这三组的**长度子集**；标量/主题组见 §Stage-2。
//
// 【与既有 `--pf-safe-*` 的关系（不冲突）】`--pf-safe-top/-bottom/-side` 是 form-profile
//   推导的**设计默认值**（平板/车机/手表的默认安全距离，`packages/fluid/src/formfactor.ts`）；
//   本文件的 `--pf-inset-*` 是**运行期实测值**（宿主采集）。合成规则：
//   **实测 > profile 默认 > 0**；`--pf-safe-*` 语义**不改**（避免破坏既有消费者）。

/**
 * 内置环境变量名（**闭集**）——长度子集（可作 `ResolvedLength.env.name`）。
 * ★新增变量必须同时改：① 本表 ② 生成器/门禁 ③ 三端宿主采集 ④ 文档（INV-CE-07 同源纪律）。
 */
export type EnvVarName =
  // ── A 组 · 避让量（inset）──
  | '--pf-inset-top'
  | '--pf-inset-right'
  | '--pf-inset-bottom'
  | '--pf-inset-left'
  // ── B 组 · 系统栏本体尺寸 ──
  | '--pf-status-bar-height'
  | '--pf-nav-bar-height'
  | '--pf-indicator-height'
  | '--pf-nav-bar-total' // 派生 = nav-bar-height + indicator-height
  // ── C 组 · 环境态（长度子集）──
  | '--pf-cutout-top'
  | '--pf-cutout-left'
  | '--pf-cutout-right'
  | '--pf-keyboard-height' // ★“不参与布局”——仅供“贴键盘”场景（坑 P9）
  | '--pf-fold-left'
  | '--pf-fold-width'

/** 变量元数据（语义 + 分组 + 是否参与布局）。 */
export interface EnvVarSpec {
  /** 语义说明（开发者可见） */
  desc: string
  /** 分组：A 避让 / B 系统栏本体 / C 环境态 */
  group: 'A' | 'B' | 'C'
  /** 是否参与布局（false ⇒ 宿主提供但**不触发重排**；如键盘高度） */
  layout: boolean
}

/** 闭集 + 元数据（SSOT；门禁 `check-env-vars` 据此校验）。 */
export const ENV_VARS: Record<EnvVarName, EnvVarSpec> = {
  '--pf-inset-top': { desc: '顶部避让（状态栏 ∪ 挖孔）', group: 'A', layout: true },
  '--pf-inset-right': { desc: '右侧避让（横屏挖孔）', group: 'A', layout: true },
  '--pf-inset-bottom': { desc: '底部避让（导航栏 ∪ 手势条）', group: 'A', layout: true },
  '--pf-inset-left': { desc: '左侧避让', group: 'A', layout: true },
  '--pf-status-bar-height': { desc: '状态栏本体高度', group: 'B', layout: true },
  '--pf-nav-bar-height': { desc: '底部虚拟三键导航高度（手势机 = 0）', group: 'B', layout: true },
  '--pf-indicator-height': { desc: '底部手势横条高度（三键机 = 0）', group: 'B', layout: true },
  '--pf-nav-bar-total': { desc: '派生 = nav-bar-height + indicator-height', group: 'B', layout: true },
  '--pf-cutout-top': { desc: '挖孔顶部尺寸', group: 'C', layout: true },
  '--pf-cutout-left': { desc: '挖孔左侧尺寸（横屏）', group: 'C', layout: true },
  '--pf-cutout-right': { desc: '挖孔右侧尺寸（横屏）', group: 'C', layout: true },
  '--pf-keyboard-height': { desc: '软键盘高度（不参与布局——仅供“贴键盘”场景）', group: 'C', layout: false },
  '--pf-fold-left': { desc: '折叠铰链左缘（屏左 → 铰链左缘）', group: 'C', layout: true },
  '--pf-fold-width': { desc: '折叠铰链带宽', group: 'C', layout: true },
}

/** 是否为合法内置环境变量名（`--pf-*` 闭集内）。 */
export function isEnvVarName(name: string): name is EnvVarName {
  return Object.prototype.hasOwnProperty.call(ENV_VARS, name)
}

/** CSS `env(safe-area-inset-<side>)` → 内置变量名（同源映射；Web/原生两端写法归一）。 */
export const SAFE_AREA_ENV_ALIAS: Record<string, EnvVarName> = {
  'safe-area-inset-top': '--pf-inset-top',
  'safe-area-inset-right': '--pf-inset-right',
  'safe-area-inset-bottom': '--pf-inset-bottom',
  'safe-area-inset-left': '--pf-inset-left',
}
