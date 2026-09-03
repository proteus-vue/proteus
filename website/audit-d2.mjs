#!/usr/bin/env node
/**
 * audit-d2.mjs —— Website B4（决策 #376）：D-2 官网 dogfooding AST 审计
 *
 * 05-dogfooding-conformance.md D-2 的机器化 v1（对 .vue 源码做 @vue/compiler-sfc AST 扫描）：
 *   ✗ error  script/style 中 import 第三方 UI 库（element-plus/vant/antd/naive-ui/quasar…）
 *   ✗ error  手写 @media（W-6 柔性框架优先——响应式归 v-p-fluid + 柔性网格）
 *   ✗ error  平台 API 直调（wx.* / uni.*——D-2/平台铁律，官网无小程序分支）
 *   ℹ 统计   语义原语使用（v-p-fluid / v-p-hover / p-* 标签）→ 覆盖率报告（阈值随 B5 定）
 *
 * 用法：node website/audit-d2.mjs [dir]   （缺省 website/src）
 * 退出码：0 = 通过（CI 可挂），1 = 有 error
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as sfcParse } from '@vue/compiler-sfc'

const FORBIDDEN_UI = /from\s+['"](element-plus|vant|ant-design-vue|@arco-design|naive-ui|quasar|vuetify|antd)['"]/
const PLATFORM_API = /\b(wx|uni)\s*\.\s*(request|login|scanCode|getLocation|pay|navigateTo|createCameraContext)\b/
const MEDIA_RE = /@media\b/
const SEMANTIC_DIRECTIVES = new Set(['p-fluid', 'p-hover', 'p-shortcut', 'p-focus-trap', 'p-context-menu', 'gesture'])

/** 收集目录下全部 .vue 文件 */
function collectVue(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) collectVue(full, out)
    else if (e.name.endsWith('.vue')) out.push(full)
  }
  return out
}

/** 递归收集模板 AST 中的指令名与标签名 */
function walkTemplate(node, acc) {
  if (!node || typeof node !== 'object') return
  if (node.props && Array.isArray(node.props)) {
    for (const prop of node.props) {
      if (prop.name && prop.type === 7 /* DIRECTIVE */) acc.directives.add(prop.name)
      else if (prop.name && prop.type === 6) acc.attrs.add(prop.name)
    }
  }
  if (node.tag) acc.tags.add(node.tag)
  for (const key of ['children']) {
    const children = node[key]
    if (Array.isArray(children)) {
      for (const child of children) {
        if (child && typeof child === 'object') walkTemplate(child, acc)
      }
    }
  }
}

/** 提取 <style> 块内容并剥除注释（检查只针对真实样式代码，不误报注释/文案） */
function styleCodeOnly(src) {
  const blocks = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1])
  return blocks.join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1')
}

/** 审计单个 .vue 文件 */
export function auditVueFile(file) {
  const src = fs.readFileSync(file, 'utf8')
  const rel = path.relative(process.cwd(), file)
  const errors = []
  const stats = { directives: new Set(), attrs: new Set(), tags: new Set() }

  // ① 第三方 UI 库（D-2：禁引入 Element/Vant 等）
  if (FORBIDDEN_UI.test(src)) errors.push(`${rel} [D2-UI] 引入第三方 UI 库（官网必须用 p-* 语义组件 / 自有 tokens）`)

  // ② 手写 @media（W-6 柔性框架优先）——只扫 <style> 块内真实样式代码（排除注释）
  if (MEDIA_RE.test(styleCodeOnly(src))) errors.push(`${rel} [W-6/C8] 手写 @media 断点（响应式归 v-p-fluid clamp + 柔性网格）`)

  // ③ 平台 API 直调（官网为纯 Web——wx.*/uni.* 直调即违规）
  if (PLATFORM_API.test(src)) errors.push(`${rel} [D2-PLATFORM] 平台 API 直调（wx.*/uni.*——业务只走语义接口）`)

  // ④ 模板 AST：语义原语使用统计
  try {
    const { descriptor } = sfcParse(src, { filename: file })
    if (descriptor.template?.ast) walkTemplate(descriptor.template.ast, stats)
  } catch {
    // 解析失败不阻断（vue-tsc 已把关语法）——统计尽力而为
  }

  return { file: rel, errors, stats }
}

/** 审计目录 → 报告 */
export function auditWebsiteDir(dir) {
  const files = collectVue(dir)
  const results = files.map(auditVueFile)
  const errors = results.flatMap((r) => r.errors)

  // 语义原语使用统计（v1 报告——覆盖率阈值随 B5 定）
  const usage = {
    files: files.length,
    fluidDirectives: 0,
    semanticDirectives: 0,
    semanticTags: 0,
    totalTags: 0,
  }
  for (const r of results) {
    usage.fluidDirectives += r.stats.directives.has('p-fluid') ? 1 : 0
    for (const d of r.stats.directives) {
      if (SEMANTIC_DIRECTIVES.has(d)) usage.semanticDirectives++
    }
    for (const t of r.stats.tags) {
      if (t.startsWith('p-')) usage.semanticTags++
      usage.totalTags++
    }
  }

  return { dir, files: results, errors, usage, ok: errors.length === 0 }
}

/** 格式化报告 */
export function formatAuditReport(report) {
  const lines = []
  lines.push(`[proteus audit website · D-2] 目录：${report.dir} · ${report.usage.files} 个 .vue`)
  for (const e of report.errors) lines.push(`  ✗ ${e}`)
  lines.push(`  语义原语统计：v-p-fluid ${report.usage.fluidDirectives} 文件 · 语义指令 ${report.usage.semanticDirectives} 处 · p-* 标签 ${report.usage.semanticTags}/${report.usage.totalTags}`)
  if (report.ok) lines.push(`  ✅ PASS——D-2 dogfooding 审计通过（第三方 UI / @media / 平台 API 零违规）`)
  else lines.push(`  ❌ FAIL——${report.errors.length} 项违规（D-2 不可绕过）`)
  return lines
}

/* ---- CLI 入口 ---- */
const selfPath = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === selfPath) {
  const target = process.argv[2] ?? path.join(path.dirname(selfPath), 'src')
  const report = auditWebsiteDir(target)
  for (const line of formatAuditReport(report)) console.log(line)
  process.exitCode = report.ok ? 0 : 1
}
