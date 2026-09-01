// packages/cli/src/fluid-check.ts
// ★G-22 柔性布局严格规则（fluid-layout-plan 01 §9 / 03 + adaptive-container-plan）：proteus fluid:check
//   FLD001 error   禁止手写 @media 断点（改用 p-fluid / p-grid）
//   FLD002 warning 禁止硬编码断点值（768/1024/1440px——用 app.config.layout.breakpoints）
//   FLD003 error   p-fluid 须提供 prop(min, max) 区间
//   FLD004 error   p-grid 须声明 min-col-width
//   FLD005 warning 避免固定死尺寸（启发式噪音大，MVP 不启用——文档标注）
//   FLD006 error   禁止 Dimensions.get() 手动算（跨端无此 API，用语义组件）
//   FLD007 error   p-adaptive 区间必须连续不重叠（adaptive-container-plan，铁律 G-22.5）
//   FLD008 error   禁止手动判断宽度切换形态（if (width < N) → 用 p-adaptive）
//   FLD009 warning p-adaptive 区间端点须来自 app.config.layout.breakpoints
//   FLD012 warning 过小字号（font-size ≤ 11px——无障碍风险，用 p-scale 动态字号）
//   FLD013 warning p-scale level 越界（0-3）/ density 非法（compact/regular/comfortable）
//   ★编号说明：FLD010/011 由 adaptive-container-plan architecture-update 预留（自适应组件内部禁硬编码宽 / 暴露 adaptive-config）
// 扫描 .vue 的 style / template / script 块（行号定位）；纯逻辑可单测
import fs from 'node:fs'
import path from 'node:path'
import { parseFluidExpr } from '@proteus-vue/compiler'
import { parseAdaptiveExpression, validateAdaptiveRanges } from '@proteus-vue/fluid'

export interface FluidViolation {
  rule: string
  file: string
  line: number
  message: string
}

export interface FluidCheckResult {
  ok: boolean
  violations: FluidViolation[]
  fileCount: number
}

/** 硬编码断点值（FLD002）——与 app.config.layout.breakpoints 冲突的手写值 */
const HARDCODED_BREAKPOINTS = [768, 1024, 1440]

/** 常用容器断点（FLD009）——p-adaptive 区间端点建议来自 app.config.layout.breakpoints */
const ADAPTIVE_BREAKPOINTS = [600, 768, 840, 1280, 1440]

function walkVueFiles(dir: string): string[] {
  const out: string[] = []
  if (fs.existsSync(dir) && fs.statSync(dir).isFile() && dir.endsWith('.vue')) return [dir]
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push.apply(out, walkVueFiles(full))
    else if (entry.name.endsWith('.vue')) out.push(full)
  }
  return out.sort()
}

/** 提取块（style/template/script）起始行号（内容块边界正则；返回 { content, startLine }[]） */
function extractBlocks(source: string, tag: string): Array<{ content: string; startLine: number }> {
  const out: Array<{ content: string; startLine: number }> = []
  const re = new RegExp(`<${tag}\\b[^>]*>`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    const startLine = source.slice(0, m.index).split('\n').length
    const closeTag = `</${tag}>`
    const end = source.indexOf(closeTag, m.index)
    if (end < 0) continue
    const content = source.slice(m.index, end + closeTag.length)
    out.push({ content, startLine })
  }
  return out
}

/** 定位模板属性命中行号 */
function lineOf(content: string, startLine: number, index: number): number {
  return startLine + content.slice(0, index).split('\n').length - 1
}

/** 单文件检查：style → FLD001/002/012；template → FLD003/004/007/009/013；script → FLD006/008 */
export function checkFluidFile(file: string): FluidViolation[] {
  const source = fs.readFileSync(file, 'utf8')
  const violations: FluidViolation[] = []
  const push = (rule: string, line: number, message: string): void => {
    violations.push({ rule, file, line, message })
  }

  // style 块：@media（FLD001）+ 硬编码断点值（FLD002）+ 过小字号（FLD012）
  for (const block of extractBlocks(source, 'style')) {
    const lines = block.content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i] as string
      if (/@media\b/.test(l)) {
        push('FLD001', block.startLine + i, '禁止手写 @media 断点——改用 p-fluid / p-grid 语义（@media 在跨端无对等，App 端不渲染）')
      }
      for (const bp of HARDCODED_BREAKPOINTS) {
        if (new RegExp(`\\b${bp}\\s*px\\b`).test(l)) {
          push('FLD002', block.startLine + i, `硬编码断点值 ${bp}px——用 app.config.layout.breakpoints 统一管理`)
        }
      }
      // ★FLD012：过小字号（≤11px）——无障碍风险（动态字号缩放下限，App 端跟随系统字号）
      const fs = l.match(/font-size\s*:\s*(\d+(?:\.\d+)?)px\b/)
      if (fs && Number(fs[1] as string) <= 11) {
        push('FLD012', block.startLine + i, `font-size ${fs[1]}px 过小（≤11px 无障碍风险）——用 p-scale 动态字号或 ≥12px`)
      }
    }
  }

  // template 块：p-fluid（FLD003）+ p-grid（FLD004）+ p-adaptive（FLD007/009）+ p-scale（FLD013）
  for (const block of extractBlocks(source, 'template')) {
    // FLD003：p-fluid 表达式须 prop(min, max)
    const fluidRe = /p-fluid="([^"]*)"/g
    let fm: RegExpExecArray | null
    while ((fm = fluidRe.exec(block.content))) {
      const line = lineOf(block.content, block.startLine, fm.index)
      if (parseFluidExpr(fm[1] as string).length === 0) {
        push('FLD003', line, `p-fluid="${fm[1]}" 未提供 prop(min, max) 区间——格式：p-fluid="font-size(20, 32)"`)
      }
    }
    // FLD004：p-grid 必须声明 min-col-width
    const gridRe = /<p-grid\b([^>]*)\/?>/g
    let gm: RegExpExecArray | null
    while ((gm = gridRe.exec(block.content))) {
      const line = lineOf(block.content, block.startLine, gm.index)
      if (!/min-col-width/.test(gm[1] as string)) {
        push('FLD004', line, '<p-grid> 未声明 min-col-width（列数自动求解的前提）——如 :min-col-width="160"')
      }
    }
    // ★p-adaptive：区间连续不重叠（FLD007）+ 端点来自 breakpoints（FLD009）
    const adaptiveRe = /\bp-adaptive\s*=\s*"([^"]*)"/g
    let am: RegExpExecArray | null
    while ((am = adaptiveRe.exec(block.content))) {
      const line = lineOf(block.content, block.startLine, am.index)
      const modes = parseAdaptiveExpression(am[1] as string)
      for (const d of validateAdaptiveRanges(modes)) {
        push(d.code, line, d.message)
      }
      for (const m of modes) {
        for (const v of [m.lo, m.hi]) {
          if (v > 0 && isFinite(v) && ADAPTIVE_BREAKPOINTS.indexOf(v) < 0) {
            push('FLD009', line, `p-adaptive 区间端点 ${v} 未在常用断点（${ADAPTIVE_BREAKPOINTS.join('/')}）中——建议来自 app.config.layout.breakpoints`)
          }
        }
      }
    }
    // ★FLD013：p-scale level 越界（0-3）/ density 非法（compact/regular/comfortable）
    const scaleRe = /<p-scale\b([^>]*)\/?>/g
    let sm: RegExpExecArray | null
    while ((sm = scaleRe.exec(block.content))) {
      const line = lineOf(block.content, block.startLine, sm.index)
      const attrs = sm[1] as string
      const lvl = attrs.match(/:?level\s*=\s*"?(\d+)"?/)
      if (lvl && Number(lvl[1] as string) > 3) {
        push('FLD013', line, `p-scale level="${lvl[1]}" 越界（0-3）——无障碍字号档位`)
      }
      const den = attrs.match(/density\s*=\s*"([^"]+)"/)
      if (den && !/^(compact|regular|comfortable)$/.test(den[1] as string)) {
        push('FLD013', line, `p-scale density="${den[1]}" 非法（compact/regular/comfortable）`)
      }
    }
  }

  // script 块：Dimensions.get（FLD006）+ 手动宽度判断（FLD008，铁律 G-22.5）
  for (const block of extractBlocks(source, 'script')) {
    const lines = block.content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i] as string
      if (/Dimensions\s*\.\s*get\b/.test(l)) {
        push('FLD006', block.startLine + i, '禁止 Dimensions.get() 手动算布局——跨端无对等 API，用 p-fluid / p-grid / p-stack 语义组件')
      }
      if (/\b(width|screenWidth|containerWidth)\s*[<>]=?\s*\d+/.test(l) || /if\s*\(\s*(width|screenWidth|containerWidth)/.test(l)) {
        push('FLD008', block.startLine + i, '禁止手动判断宽度切换形态（if (width < N) showSheet()）——用 p-adaptive 声明式断点区间（铁律 G-22.5）')
      }
    }
  }

  return violations
}

export function runFluidCheck(target: string): FluidCheckResult {
  const files = walkVueFiles(path.resolve(target))
  const violations: FluidViolation[] = []
  for (const f of files) violations.push.apply(violations, checkFluidFile(f))
  return { ok: violations.length === 0, violations, fileCount: files.length }
}

export function formatFluidCheck(result: FluidCheckResult): string {
  const lines = [`[proteus-fluid] 柔性布局严格规则（FLD001-009/012-013）检查 ${result.fileCount} 个文件：${result.violations.length} 处违规`]
  for (const v of result.violations) {
    lines.push(`  [${v.rule}] ${v.file}:${v.line} ${v.message}`)
  }
  lines.push(result.ok ? '[proteus-fluid] ✅ fluid:check 通过（语义布局，无手写断点/死尺寸/无障碍风险）' : '[proteus-fluid] ✗ 请改用 p-fluid / p-grid / p-stack / p-scale / p-adaptive 语义（exit 1）')
  return lines.join('\n')
}
