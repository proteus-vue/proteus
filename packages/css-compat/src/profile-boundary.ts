// packages/css-compat/src/profile-boundary.ts
// VC2-b：**编译期静态校验**——「使用了某端不支持的样式」在编译期报错（不是警告）。
//
// 【这一层补的是什么（卡片 VC2-b 原文）】Profile 已有 CSS001-012（三端统一性规则），但它们
//   按"框架自定语义"手写；而**官方 Skyline 支持格式**是另一份权威事实（"display 只认
//   none/flex/block"、"overflow 只认 hidden/visible"、"position 只认 relative/absolute/fixed"…）。
//   开发者写 `overflow: scroll`（Skyline 不支持）或 `display: grid`（Skyline 退化）时，
//   Web 端浏览器照常渲染 ⇒ 问题在 App/Skyline 才暴露。本模块把官方 formats 白名单变成
//   **编译期错误**，让"Web 跑通 = 全端一致"。
//
// 【数据来源（SSOT 纪律）】规则**由官方文档派生**（`scripts/gen-css-capability-alignment.mjs`
//   生成 `src/generated/skyline-boundary-rules.generated.ts`）——不手抄、不凭印象；
//   官方文档更新 ⇒ 重新生成 ⇒ 本模块自动跟上。
//
// 【escape hatch（卡片硬性要求：显式声明 + 可被扫描统计）】样式块内注释：
//   `/* proteus-allow-profile: <理由> */` —— 理由必须非空；该块的全部边界违规降级为
//   `info` 并计入 `escapes` 统计（`grep -rn "proteus-allow-profile" src/` 即可扫出全部豁免）。
//
// 【诚实边界】① 只判**静态字面量值**（变量/CSS 自定义属性/calc 等动态形态跳过——运行期由
//   各端自身兜底）；② 白名单来自官方 formats 列的**枚举形态**（含 `<占位符>` 的属性视为
//   开放值域，不判——宁漏勿误）；③ 数值单位折算（px/rpx/%）不在此处（那是编译器折叠的活）。

import type { SkylineBoundaryRule } from './generated/skyline-boundary-rules.generated'
import { SKYLINE_BOUNDARY_RULES } from './generated/skyline-boundary-rules.generated'

export interface ProfileBoundaryViolation {
  ruleId: string
  /** 越界属性（CSS 名） */
  prop: string
  /** 写入的静态值 */
  value: string
  /** 越界的端（当前只有 skyline——官方文档是 Skyline 的事实来源） */
  end: 'skyline'
  /** 该端接受的值域（官方 formats 列） */
  accept: string
  /** 建议替代方案（官方 remark 派生或通用改写提示） */
  suggestion: string
  /** 源码行号（1 基；postcss 提供） */
  line: number
}

export interface ProfileBoundaryResult {
  violations: ProfileBoundaryViolation[]
  /** 命中 escape hatch 而被放行的条数（可审计——卡片要求"可被扫描统计"） */
  escapes: number
  /** 判过的静态声明数（诊断——防"零违规 = 没判"的空绿） */
  checked: number
}

// ★理由必须含**非空白字符**——`/* proteus-allow-profile: */`（空理由）不得放行。
//   ★实现细节（单测抓出两轮）：不能写成 `\s*\S+`（`\S` 会匹配注释结尾的 `*/`）⇒
//   用捕获组取注释体、`trim()` 后判非空（语义直白、无正则陷阱）。
const ALLOW_RE = /\/\*\s*proteus-allow-profile\s*:\s*([\s\S]*?)\*\//

/** 值归一化：小写、压缩空白（`Space-Between` 等大小写/空格差异不算越界） */
const normValue = (v: string): string => v.trim().toLowerCase().replace(/\s+/g, ' ')

/** 值是否动态形态（变量/函数/计算——跳过不判；见诚实边界 ①） */
const isDynamic = (v: string): boolean => /var\(|calc\(|env\(|theme\(|{{|\$/.test(v)

/**
 * 校验一段 CSS（单个 `<style>` 块内容）。
 *
 * @param css   样式源码（无预处理器——预处理器块在产物层另有门禁）
 * @param rules 边界规则（缺省用生成产物；测试可注入）
 */
export function checkProfileBoundary(
  css: string,
  rules: SkylineBoundaryRule[] = SKYLINE_BOUNDARY_RULES,
): ProfileBoundaryResult {
  const out: ProfileBoundaryResult = { violations: [], escapes: 0, checked: 0 }
  // ★escape hatch：块级声明（注释在块内任意位置 ⇒ 整块豁免——"显式声明"语义按块粒度，
  //   与 scoped 样式块的粒度一致；理由必须非空（空理由视为未声明——不静默放行）
  const allowMatch = ALLOW_RE.exec(css)
  const allowed = !!(allowMatch && allowMatch[1].trim().length > 0)
  const byProp = new Map(rules.map((r) => [r.prop, r]))

  // 手写遍历（不引 postcss：本函数只吃声明，规则窄；完整 CSS 分析在 buildCssCompatReport）
  // ★行号：按 \n 切分逐行匹配（一行可有多条声明，分号切分后仍能定位到行）
  //
  // ★★解析纪律（两轮真机实测抓出的 bug，都修在这里）：
  //   ① **跨行块注释必须整块剥**：组件注释常引用示例代码（`/* 此前 display:block;overflow:auto 会… */`）
  //      ——逐行去注释处理不了跨行块注释，会把示例当真实声明 ⇒ **误报**（实测抓到 p-scroll-view）。
  //      修：先整块剥（**保留换行**，行号不漂移）。
  //   ② 声明可能紧跟选择器（`.a { overflow: scroll; }` 单行形态）⇒ 分号切出的片段里 prop 会带
  //      选择器前缀（`.a { overflow`）⇒ 先按 `{`/`}` 切掉选择器与块边界。
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  const cleanDecl = (s: string): string => {
    let t = s
    const brace = t.lastIndexOf('{')
    if (brace >= 0) t = t.slice(brace + 1)
    const close = t.indexOf('}')
    if (close >= 0) t = t.slice(0, close)
    return t.trim()
  }
  const lines = stripped.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    for (const piece of raw.split(';')) {
      const decl = cleanDecl(piece)
      if (!decl) continue
      const idx = decl.indexOf(':')
      if (idx < 0) continue
      const prop = decl.slice(0, idx).trim().toLowerCase()
      const value = decl.slice(idx + 1).replace(/[{}]/g, '').trim()
      if (!prop || !value || prop.includes(' ') || prop.startsWith('@') || prop.startsWith('//')) continue
      const rule = byProp.get(prop)
      if (!rule) continue
      // ★值健全性（第三道防线）：CSS 值不应含反引号/中文/散文符号——防"注释剥离不全"类误报
      if (/[`\u4e00-\u9fa5]|→|\*\*/.test(value)) continue
      if (isDynamic(value)) continue
      out.checked++
      const nv = normValue(value)
      const ok = rule.accept.some((a) => normValue(a) === nv)
      if (ok) continue
      if (allowed) {
        out.escapes++
        continue
      }
      out.violations.push({
        ruleId: rule.id,
        prop,
        value,
        end: 'skyline',
        accept: rule.accept.join(' / '),
        suggestion: rule.suggestion,
        line: i + 1,
      })
    }
  }
  return out
}

/** 供 CLI/插件格式化的单行文案（含卡片要求的四要素：属性名 / 越界的端 / 值域 / 替代方案） */
export function formatProfileBoundaryViolation(v: ProfileBoundaryViolation): string {
  return `${v.ruleId} \`${v.prop}: ${v.value}\` 在 ${v.end} 端不受支持（该端接受：${v.accept}）—— ${v.suggestion}`
}
