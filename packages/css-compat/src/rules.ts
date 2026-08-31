// packages/css-compat/src/rules.ts
// G-21 css-compat B1：--strict-css 校验规则（02-strict-css-lint.md 表 CSS001-012）
// 数据驱动注册表：每条规则 { code, name, severity, fixable, check }；postcss AST 遍历时按序执行
import type { AtRule, Declaration, Rule } from 'postcss'
import type { CssViolation, StrictCssOptions } from './types'

export interface CssRule {
  code: string
  name: string
  /** strict 模式级别（02 表） */
  severity: 'error' | 'warn'
  description: string
  fixable: boolean
  /** 选择器类规则：返回违规（含 selector 定位） */
  checkSelector?: (selector: string, opts: Required<StrictCssOptions>) => string | null
  /** 声明类规则：返回违规（含 prop 定位） */
  checkDeclaration?: (prop: string, value: string, opts: Required<StrictCssOptions>) => string | null
  /** at-rule 类规则 */
  checkAtRule?: (params: string, opts: Required<StrictCssOptions>) => string | null
}

/** 元素选择器检测：独立标签 token（前面是选择器边界，后面是边界字符；.div/#div/[data-div] 不误伤） */
const ELEMENT_TAGS =
  'div|span|p|a|ul|ol|li|img|button|input|textarea|select|form|label|table|tr|td|th|thead|tbody|section|article|header|footer|nav|main|aside|h1|h2|h3|h4|h5|h6|video|audio'
const TAG_RE = new RegExp(`(^|[\\s>+~,(])(${ELEMENT_TAGS})(?=[\\s.:#>+~),([]|$)`, 'g')

/** 通用选择器检测：独立 *（[class*="x"] 内不误伤，:not(*) 会命中） */
const UNIVERSAL_SELECTOR_RE = /(^|[\s>+~,(])\*(?=[\s.:#>+~),(\[]|$)/
export { UNIVERSAL_SELECTOR_RE }

/** vh/vw 单位（var(--vh) 不误伤：要求数字前缀） */
const VH_RE = /\d+(?:\.\d+)?(?:vh|vw)\b/
const CALC_RE = /calc\(/i

/** 后代/子代组合符计数（屏蔽 [] 与 () 内容后统计层级）
 * ★多行选择器（每行行首缩进空格）不误计：先折叠换行+行首空白 */
function countCascadeDepth(selector: string): number {
  // 多行格式化（逗号列表/长选择器换行）：\n + 行首缩进 → 空格（不产生组合符）
  const flat = selector.replace(/\s*\n\s*/g, '')
  let depth = 0
  let inBracket = 0
  let inParen = 0
  let prevSignificant = ''
  for (const ch of flat) {
    if (ch === '[') inBracket++
    else if (ch === ']') inBracket = Math.max(0, inBracket - 1)
    else if (ch === '(') inParen++
    else if (ch === ')') inParen = Math.max(0, inParen - 1)
    if (inBracket > 0 || inParen > 0) continue
    if (ch === ' ' || ch === '>' || ch === '+' || ch === '~') {
      if (prevSignificant === 'combinator') continue // 连续空格只算一次
      depth++
      prevSignificant = 'combinator'
    } else if (ch !== '\n' && ch !== '\t') {
      prevSignificant = ch
    }
  }
  return depth
}

/** 白名单 @media 检测：params 含任一白名单词（dark/sm/md/lg 预设） */
function isMediaWhitelisted(params: string, whitelist: string[]): boolean {
  const low = params.toLowerCase()
  return whitelist.some((w) => low.includes(w.toLowerCase()))
}

export const CSS_RULES: CssRule[] = [
  {
    code: 'CSS001',
    name: 'float 禁止',
    severity: 'error',
    description: 'float 在 Skyline/原生端无对应，五端无法统一',
    fixable: false,
    checkDeclaration: (prop) => (prop === 'float' ? '使用 float：五端无法统一（Skyline/原生端不支持）' : null),
  },
  {
    code: 'CSS002',
    name: 'display: inline 禁止',
    severity: 'error',
    description: 'inline/inline-block 仅 Web 语义（文本内嵌套除外）',
    fixable: false,
    checkDeclaration: (prop, value) =>
      prop === 'display' && /^inline(-block)?$/.test(value.trim())
        ? 'display: ' + value.trim() + ' 仅 Web 语义：五端原生不支持（文本内嵌套场景走 <p-text> 语义）'
        : null,
  },
  {
    code: 'CSS003',
    name: '通用选择器禁止',
    severity: 'error',
    description: '* 在 Skyline/原生端无选择器概念',
    fixable: false,
    checkSelector: (selector) => (UNIVERSAL_SELECTOR_RE.test(selector) ? '通用选择器 *：Skyline/原生端不支持' : null),
  },
  {
    code: 'CSS004',
    name: '属性选择器禁止',
    severity: 'error',
    description: '[attr] 在 Skyline/原生端无对应',
    fixable: false,
    checkSelector: (selector) => (selector.includes('[') ? '属性选择器 [attr]：Skyline/原生端不支持（用类名 + 变体）' : null),
  },
  {
    code: 'CSS005',
    name: '元素选择器禁止',
    severity: 'error',
    description: 'div{} / span{} 等元素选择器依赖 UA 样式，原生端无',
    fixable: false,
    checkSelector: (selector) => {
      // ★exec 而非 match：带 g 标志的 match 不返回捕获组（m[2] 拿不到标签名）
      const m = new RegExp(TAG_RE.source, TAG_RE.flags).exec(selector)
      return m ? `元素选择器 ${m[2]}：原生端无 UA 样式（用类名选择器）` : null
    },
  },
  {
    code: 'CSS006',
    name: '深层后代组合禁止',
    severity: 'error',
    description: '超过 2 级后代/子代组合（.a .b .c）',
    fixable: false,
    checkSelector: (selector) => {
      const depth = countCascadeDepth(selector)
      return depth >= 2 ? `深层组合（${depth} 层）：最多 2 级（编译器按变体预合并，避免运行期选择器匹配）` : null
    },
  },
  {
    code: 'CSS007',
    name: 'z-index 依赖 stacking context',
    severity: 'warn',
    description: '跨父级 stacking 无法五端统一（B1 保守提示，精确判定需 IR 上下文）',
    fixable: false,
    checkDeclaration: (prop) => (prop === 'z-index' ? 'z-index 依赖 stacking context：跨父级无法五端统一（B1 保守提示，精确判定需 IR 上下文）' : null),
  },
  {
    code: 'CSS008',
    name: 'calc()/vh/vw 需编译期重写',
    severity: 'error',
    description: 'ArkUI 早期不支持 calc；vh/vw 键盘弹出不收缩',
    fixable: true,
    checkDeclaration: (prop, value) => {
      if (CALC_RE.test(value)) return 'calc() 需编译期求值/拆分（简单数值可 --fix 折叠；含百分比走 <p-* 布局语义>）'
      // ★vh/vw 仅 height/width 误报（键盘弹出遮挡输入框）；min-height:100vh 等弹性安全用法豁免（不会遮挡）
      if (VH_RE.test(value) && (prop === 'height' || prop === 'width')) return 'vh/vw 需编译期重写（键盘弹出不收缩，--fix 转 % 语义）'
      return null
    },
  },
  {
    code: 'CSS009',
    name: '裸 backdrop-filter 禁止',
    severity: 'error',
    description: '必须走 <p-glass> 语义组件',
    fixable: true,
    checkDeclaration: (prop) => (prop === 'backdrop-filter' ? '裸 backdrop-filter：必须走 <p-glass blur="…"> 语义组件（--fix 仅提示，需改模板）' : null),
  },
  {
    code: 'CSS010',
    name: ':nth-child 复杂表达式',
    severity: 'warn',
    description: '仅 :first/:last 形态可跨端（B2 展开）',
    fixable: false,
    checkSelector: (selector) => {
      const m = selector.match(/:nth-child\(([^)]*)\)/)
      if (!m) return null
      const arg = m[1].trim()
      return /^(first|last)$/.test(arg) ? null : `:nth-child(${arg}) 复杂表达式：仅 :first/:last 形态可跨端（B2 由 Renderer 展开）`
    },
  },
  {
    code: 'CSS011',
    name: 'box-shadow rgba 需 ARGB 重写',
    severity: 'warn',
    description: 'shadow 高级参数各端吃 ARGB',
    fixable: true,
    checkDeclaration: (prop, value) =>
      prop === 'box-shadow' && /rgba?\(/i.test(value) ? 'box-shadow 含 rgba：各端 shadow API 吃 ARGB（--fix 转 #RRGGBBAA）' : null,
  },
  {
    code: 'CSS012',
    name: '@media 非白名单',
    severity: 'warn',
    description: '仅 dark + 断点预设（sm/md/lg）',
    fixable: false,
    checkAtRule: (params, opts) =>
      isMediaWhitelisted(params, opts.mediaWhitelist) ? null : `@media(${params.trim()}) 非白名单（允许：${opts.mediaWhitelist.join(', ')}）——用 <p-dark>/<p-breakpoint> 语义组件`,
  },
]

export const CSS_RULE_MAP: Record<string, CssRule> = Object.fromEntries(CSS_RULES.map((r) => [r.code, r]))

export function defaultStrictOptions(partial: StrictCssOptions = {}): Required<StrictCssOptions> {
  return {
    strict: partial.strict !== false,
    allowSelectors: partial.allowSelectors ?? ['class', 'component-scope'],
    allowUnits: partial.allowUnits ?? ['px', '%', 'rem'],
    mediaWhitelist: partial.mediaWhitelist ?? ['dark', 'sm', 'md', 'lg'],
    autoFix: partial.autoFix ?? false,
  }
}

/** postcss AST 遍历执行全部规则（02 §二 校验时机：①选择器 ②属性 ③at-rule） */
export function applyRules(node: Rule | AtRule, opts: Required<StrictCssOptions>, out: CssViolation[]): void {
  if (node.type === 'rule') {
    const ruleNode = node as Rule
    // ① 选择器校验
    for (const rule of CSS_RULES) {
      if (!rule.checkSelector) continue
      const msg = rule.checkSelector(ruleNode.selector, opts)
      if (msg) out.push(makeViolation(rule, msg, opts, ruleNode))
    }
    // ② 属性校验（声明）
    ruleNode.walkDecls((decl: Declaration) => {
      for (const rule of CSS_RULES) {
        if (!rule.checkDeclaration) continue
        const msg = rule.checkDeclaration(decl.prop, decl.value, opts)
        if (msg) {
          out.push({
            code: rule.code,
            message: msg,
            severity: severityOf(rule, opts),
            selector: ruleNode.selector,
            prop: decl.prop,
            loc: { line: decl.source?.start?.line ?? 0, column: decl.source?.start?.column ?? 0 },
            fixable: rule.fixable,
          })
        }
      }
    })
  } else {
    // ③ at-rule 校验
    const at = node as AtRule
    for (const rule of CSS_RULES) {
      if (!rule.checkAtRule) continue
      const msg = rule.checkAtRule(at.params ?? '', opts)
      if (msg) {
        out.push({ code: rule.code, message: msg, severity: severityOf(rule, opts), selector: undefined, prop: undefined, loc: nodeLoc(at), fixable: rule.fixable })
      }
    }
  }
}

function severityOf(rule: CssRule, opts: Required<StrictCssOptions>): 'error' | 'warn' {
  if (opts.strict) return rule.severity
  // 非 strict 降级：error → warn（02 表「降级」列）
  return 'warn'
}

function makeViolation(rule: CssRule, message: string, opts: Required<StrictCssOptions>, node: Rule): CssViolation {
  return {
    code: rule.code,
    message,
    severity: severityOf(rule, opts),
    selector: node.selector,
    prop: undefined,
    loc: nodeLoc(node),
    fixable: rule.fixable,
  }
}

function nodeLoc(node: Rule | AtRule): { line: number; column: number } {
  return { line: node.source?.start?.line ?? 0, column: node.source?.start?.column ?? 0 }
}
