// packages/css-compat/src/types.ts
// G-21 css-compat B1：--strict-css 校验（CSS001-012）+ 编译期重写 + css-compat-report 共享类型
// ★纯逻辑零运行时依赖：本包不 import 任何运行时框架（postcss 仅构建期工具）

export type CssSeverity = 'error' | 'warn'

/** 一条 CSS 兼容违规（报错码见 02-strict-css-lint.md 表） */
export interface CssViolation {
  /** CSS001..CSS012 */
  code: string
  message: string
  severity: CssSeverity
  /** 所在选择器（选择器类违规）或规则描述 */
  selector?: string
  /** 所在属性（声明类违规） */
  prop?: string
  loc?: { line: number; column: number }
  /** 是否可由 --fix 自动重写（02 §三 fixable 表） */
  fixable: boolean
}

/** --strict-css 选项（对齐 02 §四 / 09 §五 配置形状） */
export interface StrictCssOptions {
  /** strict 模式 error / 关闭则降级 warn + 自动修复建议（默认 true） */
  strict?: boolean
  /** 允许的选择器形态（默认 ['class', 'component-scope']，仅作配置透传） */
  allowSelectors?: string[]
  /** 允许的单位（默认 ['px', '%', 'rem']，vh/vw/calc 禁用） */
  allowUnits?: string[]
  /** @media 白名单（默认 ['dark', 'sm', 'md', 'lg']） */
  mediaWhitelist?: string[]
  /** 自动修复可重写项（默认 false） */
  autoFix?: boolean
}

/** 编译期重写统计（03 §三 报告 rewritten 字段） */
export interface RewriteCounts {
  calc: number
  vh: number
  'rgba-to-argb': number
}

/** css-compat-report.json 结构（03 §三 / 09 定义） */
export interface CssCompatReport {
  rewritten: RewriteCounts
  /** 检测到的语义组件建议（04：p-glass/p-sticky/p-scroll/p-shadow/p-bg-gradient） */
  semanticComponents: Record<string, number>
  /** 禁止项计数（CSS001-007 落地的核心几项） */
  forbidden: {
    float: number
    universalSelector: number
  }
  /** 禁止项总数（10 §四 check-css-report assert forbidden === 0） */
  forbiddenCount: number
  /** 选择器数量（10 §一 ≤800） */
  selectors: number
  /** 类选择器数量（semanticRatio 数据源：.class 范式 = 语义化，06 哲学） */
  classSelectors: number
  bundleCssBytes: number
  violations: CssViolation[]
}

/** 单文件样式审计结果（CLI css:check 聚合用） */
export interface CssFileResult {
  file: string
  report: CssCompatReport
}
