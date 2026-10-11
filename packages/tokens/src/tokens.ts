// packages/tokens/src/tokens.ts
// ★★★Proteus UI 宪法（Charites Design Tokens）——`--sa-*` 视觉 token **单一真源**（浅/深两套）。
//
// 【为什么是宪法（OS级组件库方案 §4 OS-1 / §5 宪法层）】此前 `--sa-*` 只活在**工程样式表**
//   （`superapp/styles/global.css`）里 ⇒ 不是框架律法 ⇒ 任何工程都能绕过、任意裸值都能注入。
//   本包把它上移为**框架包 = 唯一真源**：值、深色覆盖、分组、审计口径都在此；工程样式表与各端
//   消费方（编译器 token 折叠 / 组件 / 门禁）**据此派生**（门禁 `check:tokens` 钉住一致）。
//
// 【与 `--pf-*` 的关系】`--pf-*`（环境变量）的 SSOT 是 `packages/contracts/src/env-vars.ts`（决策 #593）——
//   本包**不重复定义**，只在其上汇总（宪法 = `--sa-*` ∪ `--pf-*` ∪ 组件字面值收口，见 index.ts）。
//
// 【诚实边界】本包是**数据 + CSS 生成**（零运行时）。Web/MP 仍吃 CSS 变量；App 端由编译器把
//   token 折成 IR 属性值（`substituteCssVars`）。本包是两侧的共同真源。

/** 分组（文档/诊断/门禁归类）。 */
export type TokenGroup =
  | 'brand'
  | 'neutral'
  | 'semantic'
  | 'elevation'
  | 'radius'
  | 'space'
  | 'font'
  | 'weight'
  | 'shadow'
  | 'family'
  | 'motion'
  | 'safearea'
  | 'component'
  | 'global'

export interface TokenDef {
  /** 值（浅色/默认）。可为 CSS 变量引用（如 `var(--sa-bg)`）或 `env(...)`（安全区）。 */
  value: string
  /** 深色覆盖值（缺省 = 不随主题变；`none` 语义 = 深色沿用 value）。 */
  dark?: string
  group: TokenGroup
  desc?: string
}

/**
 * `--sa-*` 视觉 token 全表（**唯一真源**）。
 * ★值来源：既有 `superapp/styles/global.css` 的 `:root` / `.sa-dark`（2026-10-11 上移，值逐项对齐）。
 * ★新增/改值只改这里；门禁 `check:tokens` 校验工程样式表与本表一致（防双写漂移）。
 */
export const SA_TOKENS: Record<string, TokenDef> = {
  // ── 品牌色（靛蓝；白字 on #5b5bd6 = 5.1:1 AA 临界）──
  '--sa-brand': { value: '#5b5bd6', dark: '#7b7bef', group: 'brand', desc: '品牌主色' },
  '--sa-brand-ink': { value: '#4a4ab8', dark: '#9393f5', group: 'brand', desc: '品牌深档（文字/描边）' },
  '--sa-brand-soft': { value: 'rgba(91, 91, 214, 0.10)', dark: 'rgba(123, 123, 239, 0.16)', group: 'brand', desc: '品牌浅底' },
  '--sa-brand-soft-2': { value: 'rgba(91, 91, 214, 0.18)', dark: 'rgba(123, 123, 239, 0.26)', group: 'brand', desc: '品牌浅底（强）' },

  // ── 中性面（浅色默认）──
  '--sa-bg': { value: '#f4f5f7', dark: '#121418', group: 'neutral', desc: '页面底色' },
  '--sa-surface': { value: '#ffffff', dark: '#1c1f26', group: 'neutral', desc: '卡片/控件面' },
  '--sa-surface-2': { value: '#fafbfc', dark: '#232730', group: 'neutral', desc: '次级面' },
  '--sa-line': { value: '#dcdfe5', dark: '#2e3340', group: 'neutral', desc: '分隔线' },
  '--sa-line-soft': { value: '#e8eaee', dark: '#262b36', group: 'neutral', desc: '弱分隔线' },
  '--sa-line-strong': { value: '#d8dbe1', dark: '#3a4150', group: 'neutral', desc: '分隔线加深档' },
  '--sa-text': { value: '#1a1c22', dark: '#eef0f5', group: 'neutral', desc: '正文' },
  '--sa-text-2': { value: '#4b5058', dark: '#b6bcc9', group: 'neutral', desc: '次级文本' },
  '--sa-text-3': { value: '#5f6673', dark: '#9aa1af', group: 'neutral', desc: '辅助文本（AA 5.30:1）' },

  // ── 语义状态（AA 全达）──
  '--sa-ok': { value: '#1f9d5f', dark: '#3ec27e', group: 'semantic', desc: '成功' },
  '--sa-warn': { value: '#c47f17', dark: '#e0a53a', group: 'semantic', desc: '警告' },
  '--sa-rec': { value: '#d64545', dark: '#f07070', group: 'semantic', desc: '危险/提示红' },
  '--sa-info': { value: '#2f6fd6', dark: '#6da2f0', group: 'semantic', desc: '信息' },

  // ── 层级背景 ──
  '--sa-bg-elevated': { value: '#ffffff', dark: '#1c1f26', group: 'elevation', desc: '浮层背景' },
  '--sa-bg-sunken': { value: '#eceef1', dark: '#101217', group: 'elevation', desc: '下沉背景' },

  // ── 圆角（语义化；页面禁写裸 px）──
  '--sa-radius-sm': { value: '6px', group: 'radius' },
  '--sa-radius-md': { value: '10px', group: 'radius' },
  '--sa-radius-lg': { value: '14px', group: 'radius' },
  '--sa-radius-xl': { value: '20px', group: 'radius' },
  '--sa-radius-pill': { value: '999px', group: 'radius' },

  // ── 间距（4 的倍数）──
  '--sa-1': { value: '4px', group: 'space' },
  '--sa-2': { value: '8px', group: 'space' },
  '--sa-3': { value: '12px', group: 'space' },
  '--sa-4': { value: '16px', group: 'space' },
  '--sa-5': { value: '20px', group: 'space' },
  '--sa-6': { value: '24px', group: 'space' },
  '--sa-8': { value: '32px', group: 'space' },
  '--sa-10': { value: '40px', group: 'space' },

  // ── 字号 / 行高 ──
  '--sa-font-xs': { value: '11px', group: 'font' },
  '--sa-font-sm': { value: '12px', group: 'font' },
  '--sa-font-md': { value: '14px', group: 'font' },
  '--sa-font-lg': { value: '16px', group: 'font' },
  '--sa-font-xl': { value: '20px', group: 'font' },
  '--sa-font-xxl': { value: '26px', group: 'font' },
  '--sa-lh-tight': { value: '1.25', group: 'font' },
  '--sa-lh-normal': { value: '1.5', group: 'font' },
  '--sa-lh-loose': { value: '1.7', group: 'font' },

  // ── 字重 ──
  '--sa-fw-regular': { value: '400', group: 'weight' },
  '--sa-fw-medium': { value: '500', group: 'weight' },
  '--sa-fw-semibold': { value: '600', group: 'weight' },
  '--sa-fw-bold': { value: '700', group: 'weight' },

  // ── 阴影（克制）──
  '--sa-shadow-sm': { value: '0 1px 2px rgba(26, 28, 34, 0.05)', dark: '0 1px 2px rgba(0, 0, 0, 0.35)', group: 'shadow' },
  '--sa-shadow-md': { value: '0 2px 8px rgba(26, 28, 34, 0.07)', dark: '0 2px 10px rgba(0, 0, 0, 0.45)', group: 'shadow' },
  '--sa-shadow-lg': { value: '0 8px 24px rgba(26, 28, 34, 0.10)', dark: '0 10px 28px rgba(0, 0, 0, 0.55)', group: 'shadow' },

  // ── 字体族 ──
  '--sa-font': { value: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', system-ui, sans-serif", group: 'family' },
  '--sa-mono': { value: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace", group: 'family' },

  // ── 动效 ──
  '--sa-dur-fast': { value: '140ms', group: 'motion' },
  '--sa-dur-med': { value: '240ms', group: 'motion' },
  '--sa-dur-slow': { value: '380ms', group: 'motion' },
  '--sa-ease-out': { value: 'cubic-bezier(0.22, 0.61, 0.36, 1)', group: 'motion' },
  '--sa-ease-in-out': { value: 'cubic-bezier(0.4, 0, 0.2, 1)', group: 'motion' },

  // ── 安全区（env 派生；不随主题）──
  '--sa-safe-top': { value: 'env(safe-area-inset-top, 0px)', group: 'safearea' },
  '--sa-safe-bottom': { value: 'env(safe-area-inset-bottom, 0px)', group: 'safearea' },

  // ── 框架组件品牌主题（跨组件需在 page 级定义——微信组件样式隔离，实测）──
  '--p-page-bg': { value: 'var(--sa-bg)', dark: 'var(--sa-bg)', group: 'component', desc: '页面底色（框架组件）' },
  '--p-auth-gate-action-bg': { value: 'var(--sa-brand)', group: 'component', desc: '鉴权门主按钮' },
  '--p-toast-tone': { value: 'rgba(29, 32, 40, 0.92)', group: 'component', desc: 'Toast 底色' },

  // ── 全局层 / 浮层（八条场景消费；宿主可整体换肤）──
  '--sa-fab-bg': { value: 'var(--sa-brand)', group: 'global', desc: '悬浮球底' },
  '--sa-fab-ink': { value: '#ffffff', group: 'global' },
  '--sa-music-bg': { value: '#1d2028', group: 'global' },
  '--sa-music-ink': { value: '#f2f3f6', group: 'global' },
  '--sa-music-accent': { value: '#9ea8ff', group: 'global' },
  '--sa-badge-bg': { value: 'var(--sa-rec)', group: 'global' },
  '--sa-badge-ink': { value: '#ffffff', group: 'global' },
  '--sa-netbar-bg': { value: '#fff7e6', dark: '#3a2f18', group: 'global' },
  '--sa-netbar-ink': { value: '#8a6d3b', dark: '#e8c887', group: 'global' },
}

/** 深色覆盖表（`name → darkValue`；由 `SA_TOKENS` 派生，不含无深色项的 token）。 */
export function darkOverrides(tokens: Record<string, TokenDef> = SA_TOKENS): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(tokens)) if (v.dark !== undefined) out[k] = v.dark
  return out
}

/** 按分组取 token（诊断/文档/门禁用）。 */
export function tokensByGroup(group: TokenGroup, tokens: Record<string, TokenDef> = SA_TOKENS): string[] {
  return Object.keys(tokens).filter((k) => tokens[k]!.group === group)
}
