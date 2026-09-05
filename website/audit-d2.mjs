#!/usr/bin/env node
/**
 * audit-d2.mjs —— Website B4（决策 #376）：D-2 官网 dogfooding AST 审计
 *
 * 05-dogfooding-conformance.md D-2 的机器化 v1（对 .vue 源码做 @vue/compiler-sfc AST 扫描）：
 *   ✗ error  script/style 中 import 第三方 UI 库（element-plus/vant/antd/naive-ui/quasar…）
 *   ✗ error  手写 @media（W-6 柔性框架优先——响应式归 v-p-fluid + 柔性网格）
 *   ✗ error  平台 API 直调（wx.* / uni.*——D-2/平台铁律，官网无小程序分支）
 *   ✗ error  Web 平台 API 裸调（window./document./navigator./location./fetch 等——★#445：封装只在 @proteus-vue/* 框架包，页面零裸写）
 *   ℹ 豁免   逐行 `// d2-exempt: <原因>`（仅 Web 平台规则可豁免）· 整文件 d2-exempt-file 块注释标注（原生视觉资产页）——登记透明可审计
 *   ℹ 规则   四规则可配（★#447：proteus.config.ts 的 `audit.rules`，off/warn/error——缺省全 error，关/降级在报告明示）
 *   ℹ 统计   语义原语使用（v-p-fluid / v-p-hover / p-* 标签）→ 覆盖率报告（阈值随 B5 定）
 *
 * ★配置来源：从被审计目录向上找 proteus.config.ts（内置 esbuild TS 加载器求值——与 packages/cli
 *  config-loader 同构，独立工具零 cli 依赖）；配置缺失/未声明 audit → 全部默认 error（fail-closed）
 *
 * ★审计范围 = .vue SFC 页面语义；src/spirit 是独立多入口原生 iframe 资产页（spirit.html 直挂
 *  Three.js 入口 .ts——canvas/WebGL 原生实现不走框架 p-* 页面语义），由宿主组件逐行豁免 + 资产头声明
 *
 * 用法：node website/audit-d2.mjs [dir]   （缺省 website/src）
 * 退出码：0 = 通过（CI 可挂），1 = 有 error
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import esbuildPkg from 'esbuild'
import { parse as sfcParse } from '@vue/compiler-sfc'

const { transformSync } = esbuildPkg

// ★#447 D-2 规则元数据（id 与 @proteus-vue/types AUDIT_RULE_IDS 单一来源一致）
const RULE_ORDER = ['no-third-party-ui', 'no-media-query', 'no-platform-api', 'no-web-platform-api']
const DEFAULT_RULES = { 'no-third-party-ui': 'error', 'no-media-query': 'error', 'no-platform-api': 'error', 'no-web-platform-api': 'error' }
/** 未知/非法值 fail-closed（保持 error——config:check 会单独拦拼写错误） */
function normalizeRules(rawRules) {
  const sev = { ...DEFAULT_RULES }
  if (rawRules && typeof rawRules === 'object') {
    for (const [id, v] of Object.entries(rawRules)) {
      if (!(id in DEFAULT_RULES)) continue
      sev[id] = v === 'off' || v === 'warn' ? v : 'error'
    }
  }
  return sev
}

const FORBIDDEN_UI = /from\s+['"](element-plus|vant|ant-design-vue|@arco-design|naive-ui|quasar|vuetify|antd)['"]/
const PLATFORM_API = /\b(wx|uni)\s*\.\s*(request|login|scanCode|getLocation|pay|navigateTo|createCameraContext)\b/
// ★#445 Web 平台 API 黑名单（此前只拦 wx/uni——Web 侧 window./document./navigator. 等裸调用全漏网）：
//   框架原则「页面不裸写平台 API」——封装只在框架包（@proteus-vue/*）内部；页面裸调即违规
const WEB_PLATFORM_RE = /\bwindow\.|\bdocument\.|\bnavigator\.|\blocation\.|\bhistory\.|\blocalStorage|\bsessionStorage|\bXMLHttpRequest|\bfetch\s*\(/
const MEDIA_RE = /@media\b/
// ★#445 行豁免机制（诚实登记非静默——防扩散）：行尾 `// d2-exempt: <原因>`；仅作用于 Web 平台规则（@media/第三方 UI 不可豁免）
const EXEMPT_RE = /\/\/\s*d2-exempt:\s*([^\n]+)/
// ★#445 整文件豁免（原生视觉资产页——如独立 iframe/WebGL 资产 .vue）：文件头块注释 `/* d2-exempt-file: <原因> */` → 平台 API 家族（wx/uni + Web）豁免
const FILE_EXEMPT_RE = /\/\*\s*d2-exempt-file:\s*([^*\n]+)/
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

/** ★#445 规则④专用：剥注释后只剩真实代码（文档头注释常写「页面零裸 window.*」——非代码，不误报） */
function webCodeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // 块注释（含多行头注释）
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l)) // 整行行注释
    .join('\n')
}

/* ============ ★#447 配置来源：proteus.config.ts 的 audit 字段（向上发现 + esbuild TS 加载） ============ */
// 与 packages/cli/src/config-loader.ts 同构（独立工具零 cli 依赖——配置里可能 import 相对 TS 子模块/包，如官网 ends.ts）
const tsCache = new Map()
function loadTsModule(abs) {
  if (tsCache.has(abs)) return tsCache.get(abs)
  const src = fs.readFileSync(abs, 'utf-8')
  const { code } = transformSync(src, { loader: 'ts', format: 'cjs', platform: 'node', logLevel: 'silent' })
  const mod = { exports: {} }
  const dir = path.dirname(abs)
  const req = createRequire(path.join(dir, 'package.json'))
  const localRequire = (id) => {
    if (id.startsWith('.')) {
      let resolved = ''
      try {
        resolved = req.resolve(id)
      } catch {
        const cand = [id, `${id}.ts`, `${id}.mts`, path.join(id, 'index.ts')]
        for (const c of cand) if (fs.existsSync(c)) { resolved = c; break }
      }
      if (!resolved) throw new Error(`相对子模块解析失败：${id}`)
      if (/\.(ts|mts|tsx)$/.test(resolved)) return loadTsModule(resolved)
      const m = req(resolved)
      return m?.default ?? m
    }
    return req(id)
  }
  new Function('module', 'exports', 'require', code)(mod, mod.exports, localRequire)
  const value = mod.exports.default ?? mod.exports
  tsCache.set(abs, value)
  return value
}

function loadAuditConfig(file) {
  const src = fs.readFileSync(file, 'utf-8')
  const { code } = transformSync(src, { loader: 'ts', format: 'cjs', platform: 'node', logLevel: 'silent' })
  const mod = { exports: {} }
  const dir = path.dirname(file)
  const req = createRequire(path.join(dir, 'package.json'))
  const fileRequire = (id) => {
    if (id.startsWith('.')) {
      let resolved = ''
      try {
        resolved = req.resolve(id)
      } catch {
        const cand = [path.resolve(dir, id), path.resolve(dir, `${id}.ts`), path.resolve(dir, `${id}.mts`)]
        for (const c of cand) if (fs.existsSync(c)) { resolved = c; break }
      }
      if (!resolved) throw new Error(`相对子模块解析失败：${id}`)
      if (/\.(ts|mts|tsx)$/.test(resolved)) return loadTsModule(resolved)
      const m = req(resolved)
      return m?.default ?? m
    }
    const resolved = req.resolve(id)
    const m = req(resolved)
    return m?.default ?? m
  }
  new Function('module', 'exports', 'require', '__dirname', '__filename', code)(mod, mod.exports, fileRequire, dir, file)
  return mod.exports.default
}

/** 从被审计目录向上找 proteus.config.ts（最多 6 层，防扫到无关目录） */
function discoverConfigFile(dir) {
  let cur = path.resolve(dir)
  for (let i = 0; i < 6; i++) {
    const cand = path.join(cur, 'proteus.config.ts')
    if (fs.existsSync(cand)) return cand
    const next = path.dirname(cur)
    if (next === cur) break
    cur = next
  }
  return null
}

/** 审计单个 .vue 文件（rules: 规则 id → 'error' | 'warn' | 'off'，缺省全 error） */
export function auditVueFile(file, rules = DEFAULT_RULES) {
  const src = fs.readFileSync(file, 'utf8')
  const rel = path.relative(process.cwd(), file)
  const errors = []
  const warnings = []
  const stats = { directives: new Set(), attrs: new Set(), tags: new Set() }

  // 违规上报按规则级别分流：error → 阻断（errors）/ warn → 报告不阻断（warnings）/ off → 跳过
  const hit = (ruleId, text) => {
    const sev = rules[ruleId]
    if (sev === 'off') return
    ;(sev === 'warn' ? warnings : errors).push(text)
  }

  // ★#445 整文件豁免（原生视觉资产页——文件头 `/* d2-exempt-file: <原因> */`）：平台 API 家族整体豁免，登记透明
  const fileExempt = src.match(FILE_EXEMPT_RE)?.[1]?.trim() ?? null

  // ★#445 行豁免：抽走 d2-exempt 行（仅对 Web 平台规则生效——见下方检查源）——原因随报告展示（透明）
  const exemptions = fileExempt ? [`[整文件豁免] ${fileExempt}`] : []
  const scrubbed = fileExempt
    ? src
    : src
        .split('\n')
        .map((line) => {
          const m = line.match(EXEMPT_RE)
          if (m && WEB_PLATFORM_RE.test(line)) {
            exemptions.push(m[1].trim())
            return ''
          }
          return line
        })
        .join('\n')

  // ① 第三方 UI 库（D-2：禁引入 Element/Vant 等）
  if (FORBIDDEN_UI.test(src)) hit('no-third-party-ui', `${rel} [D2-UI] 引入第三方 UI 库（官网必须用 p-* 语义组件 / 自有 tokens）`)

  // ② 手写 @media（W-6 柔性框架优先）——只扫 <style> 块内真实样式代码（排除注释；不可豁免）
  if (MEDIA_RE.test(styleCodeOnly(src))) hit('no-media-query', `${rel} [W-6/C8] 手写 @media 断点（响应式归 v-p-fluid clamp + 柔性网格）`)

  // ③ 平台 API 直调（wx.*/uni.*——业务只走语义接口；d2-exempt-file 整文件豁免可放行——原生资产页）
  if (!fileExempt && PLATFORM_API.test(src)) hit('no-platform-api', `${rel} [D2-PLATFORM] 平台 API 直调（wx.*/uni.*——业务只走语义接口）`)

  // ④ ★#445 Web 平台 API 裸调（window./document./navigator./location./fetch/localStorage…——封装只在框架包；注释剥除防文档头误报；行豁免需带原因）
  if (!fileExempt && WEB_PLATFORM_RE.test(webCodeOnly(scrubbed))) hit('no-web-platform-api', `${rel} [D2-PLATFORM-WEB] Web 平台 API 裸调（window./document./navigator./location./fetch 等——须走 @proteus-vue/* 原语；确无原语处逐行 // d2-exempt: <原因>）`)

  // ⑤ 模板 AST：语义原语使用统计
  try {
    const { descriptor } = sfcParse(src, { filename: file })
    if (descriptor.template?.ast) walkTemplate(descriptor.template.ast, stats)
  } catch {
    // 解析失败不阻断（vue-tsc 已把关语法）——统计尽力而为
  }

  return { file: rel, errors, warnings, stats, exemptions }
}

/** 审计目录 → 报告（自动发现并加载目录所属 proteus.config.ts 的 audit 字段；opts.configFile 可显式指定/禁用手动） */
export function auditWebsiteDir(dir, opts = {}) {
  const configFile = opts.configFile === undefined ? discoverConfigFile(dir) : opts.configFile || null
  // 配置来源处理：加载成功 → 取 audit.rules；失败/缺失 → fail-closed 全 error + 原因入报告
  const notes = []
  let rules = DEFAULT_RULES
  if (configFile) {
    try {
      const cfg = loadAuditConfig(configFile)
      const audit = cfg?.audit
      if (audit && typeof audit === 'object' && audit.rules && typeof audit.rules === 'object') rules = normalizeRules(audit.rules)
      else notes.push(`⚠ ${path.relative(process.cwd(), configFile)} 未声明 audit.rules——四规则默认 error`)
    } catch (e) {
      notes.push(`⚠ audit 配置加载失败 ${configFile}——按默认全 error（fail-closed）：${e?.message ?? e}`)
    }
  } else {
    notes.push('ℹ 未发现 proteus.config.ts——四规则默认 error（可在 audit.rules 自选级别）')
  }

  const files = collectVue(dir)
  const results = files.map((f) => auditVueFile(f, rules))
  const errors = results.flatMap((r) => r.errors)
  const warnings = results.flatMap((r) => r.warnings)
  const exemptions = results.flatMap((r) => r.exemptions.map((reason) => `${r.file}: ${reason}`))

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

  return { dir, configFile, rules, notes, files: results, errors, warnings, usage, exemptions, ok: errors.length === 0 }
}

/** 格式化报告 */
export function formatAuditReport(report) {
  const lines = []
  lines.push(`[proteus audit website · D-2] 目录：${report.dir} · ${report.usage.files} 个 .vue`)
  const active = RULE_ORDER.map((id) => `${id}=${report.rules[id]}`).join(' · ')
  lines.push(`  规则：${active}${report.configFile ? `（来源 ${path.relative(process.cwd(), report.configFile)}）` : ''}`)
  for (const n of report.notes) lines.push(`  ${n}`)
  for (const e of report.errors) lines.push(`  ✗ ${e}`)
  for (const w of report.warnings) lines.push(`  ⚠ ${w}`)
  lines.push(`  语义原语统计：v-p-fluid ${report.usage.fluidDirectives} 文件 · 语义指令 ${report.usage.semanticDirectives} 处 · p-* 标签 ${report.usage.semanticTags}/${report.usage.totalTags}`)
  if (report.exemptions?.length) {
    lines.push(`  ℹ Web 平台豁免 ${report.exemptions.length} 处（登记原因，缺口待补原语）：`)
    for (const ex of report.exemptions) lines.push(`    · ${ex}`)
  }
  const skip = RULE_ORDER.filter((id) => report.rules[id] === 'off')
  const soft = report.warnings.length ? `（另 ${report.warnings.length} 项 warn 级）` : ''
  if (report.ok) lines.push(`  ✅ PASS——启用规则集零 error${skip.length ? `（关闭：${skip.join(' / ')}）` : ''}${soft}`)
  else lines.push(`  ❌ FAIL——${report.errors.length} 项违规（D-2 不可绕过；warn 级 ${report.warnings.length} 项）`)
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
