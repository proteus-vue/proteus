// packages/cli/src/fluid-check.ts
// ★G-22 柔性布局严格规则（fluid-layout-plan 01 §9 / 03-api-strict-rules）：proteus fluid:check
//   FLD001 error   禁止手写 @media 断点（改用 p-fluid / p-grid）
//   FLD002 warning 禁止硬编码断点值（768/1024/1440px——用 app.config.layout.breakpoints）
//   FLD003 error   p-fluid 须提供 prop(min, max) 区间
//   FLD004 error   p-grid 须声明 min-col-width
//   FLD005 warning 避免固定死尺寸（启发式噪音大，MVP 不启用——文档标注）
//   FLD006 error   禁止 Dimensions.get() 手动算（跨端无此 API，用语义组件）
// 扫描 .vue 的 style / template / script 块（行号定位）；纯逻辑可单测
import fs from 'node:fs'
import path from 'node:path'
import { parseFluidExpr } from '@proteus-vue/compiler'

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
  const lines = source.split('\n')
  const re = new RegExp(`<${tag}\\b[^>]*>`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    const startLine = source.slice(0, m.index).split('\n').length
    const closeTag = `</${tag}>`
    const end = source.indexOf(closeTag, m.index)
    if (end < 0) continue
    const content = source.slice(m.index, end + closeTag.length)
    out.push({ content, startLine })
    void lines
  }
  return out
}

/** 单文件检查：style → FLD001/002；template → FLD003/004；script → FLD006 */
export function checkFluidFile(file: string): FluidViolation[] {
  const source = fs.readFileSync(file, 'utf8')
  const violations: FluidViolation[] = []
  const push = (rule: string, line: number, message: string): void => {
    violations.push({ rule, file, line, message })
  }

  // style 块：@media（FLD001）+ 硬编码断点值（FLD002）
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
    }
  }

  // template 块：p-fluid（FLD003）+ p-grid（FLD004）
  for (const block of extractBlocks(source, 'template')) {
    // FLD003：p-fluid 表达式须 prop(min, max)
    const fluidRe = /p-fluid="([^"]*)"/g
    let fm: RegExpExecArray | null
    while ((fm = fluidRe.exec(block.content))) {
      const line = block.startLine + block.content.slice(0, fm.index).split('\n').length - 1
      if (parseFluidExpr(fm[1] as string).length === 0) {
        push('FLD003', line, `p-fluid="${fm[1]}" 未提供 prop(min, max) 区间——格式：p-fluid="font-size(20, 32)"`)
      }
    }
    // FLD004：p-grid 必须声明 min-col-width
    const gridRe = /<p-grid\b([^>]*)\/?>/g
    let gm: RegExpExecArray | null
    while ((gm = gridRe.exec(block.content))) {
      const line = block.startLine + block.content.slice(0, gm.index).split('\n').length - 1
      if (!/min-col-width/.test(gm[1] as string)) {
        push('FLD004', line, '<p-grid> 未声明 min-col-width（列数自动求解的前提）——如 :min-col-width="160"')
      }
    }
  }

  // script 块：Dimensions.get（FLD006）
  for (const block of extractBlocks(source, 'script')) {
    const lines = block.content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (/Dimensions\s*\.\s*get\b/.test(lines[i] as string)) {
        push('FLD006', block.startLine + i, '禁止 Dimensions.get() 手动算布局——跨端无对等 API，用 p-fluid / p-grid / p-stack 语义组件')
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
  const lines = [`[proteus-fluid] 柔性布局严格规则（FLD001-006）检查 ${result.fileCount} 个文件：${result.violations.length} 处违规`]
  for (const v of result.violations) {
    lines.push(`  [${v.rule}] ${v.file}:${v.line} ${v.message}`)
  }
  lines.push(result.ok ? '[proteus-fluid] ✅ fluid:check 通过（语义布局，无手写断点/死尺寸）' : '[proteus-fluid] ✗ 请改用 p-fluid / p-grid / p-stack 语义（exit 1）')
  return lines.join('\n')
}
