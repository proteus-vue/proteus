// packages/cli/src/d2-audit.ts
// ★#448：D-2 dogfooding 门禁引擎（05-dogfooding-conformance D-2 机器化）——从 website/audit-d2.mjs 收编进 CLI（`proteus audit d2`）
//   单引擎双场景：① 开发者工程 `proteus audit d2 [dir]`（读工程 proteus.config.ts 的 audit.rules）
//                 ② 官网门禁（website/src + website/proteus.config.ts audit 声明——验证场零容忍）
//   规则：第三方 UI 库 / 手写 @media / wx/uni 平台 API 直调 / Web 平台 API 裸调（window/document/navigator/location/history/fetch…）
//   级别：proteus.config `audit.rules`（off/warn/error，未列出的规则默认 error——fail-closed 防静默关闭）
//   豁免：逐行 `// d2-exempt: <原因>`（仅 Web 平台规则）· 整文件 `/* d2-exempt-file: <原因> */`（原生视觉资产页）——登记透明
import fs from 'node:fs'
import path from 'node:path'
import { AUDIT_RULE_IDS } from '@proteus-vue/types'
import { loadProjectConfig } from './config-loader'

export type D2Severity = 'error' | 'warn' | 'off'
export type D2Rules = Record<(typeof AUDIT_RULE_IDS)[number], D2Severity>

/** 缺省规则集：全部 error（fail-closed——未在 audit.rules 声明的规则一律拦截） */
export const D2_DEFAULT_RULES: D2Rules = Object.fromEntries(AUDIT_RULE_IDS.map((id) => [id, 'error'])) as D2Rules

/** 未知/非法值 → error（fail-closed；config:check 会单独拦拼写错误） */
export function normalizeD2Rules(raw: unknown): D2Rules {
  const sev = { ...D2_DEFAULT_RULES }
  if (raw && typeof raw === 'object') {
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!(id in D2_DEFAULT_RULES)) continue
      sev[id as keyof D2Rules] = v === 'off' || v === 'warn' ? v : 'error'
    }
  }
  return sev
}

const FORBIDDEN_UI = /from\s+['"](element-plus|vant|ant-design-vue|@arco-design|naive-ui|quasar|vuetify|antd)['"]/
const PLATFORM_API = /\b(wx|uni)\s*\.\s*(request|login|scanCode|getLocation|pay|navigateTo|createCameraContext)\b/
// ★#445 Web 平台 API 黑名单（封装只在框架包 @proteus-vue/* 内；页面裸调即违规）
const WEB_PLATFORM_RE = /\bwindow\.|\bdocument\.|\bnavigator\.|\blocation\.|\bhistory\.|\blocalStorage|\bsessionStorage|\bXMLHttpRequest|\bfetch\s*\(/
const MEDIA_RE = /@media\b/
// 逐行豁免（诚实登记非静默）：`// d2-exempt: <原因>`；仅作用于 Web 平台规则（@media/第三方 UI 不可豁免）
const EXEMPT_RE = /\/\/\s*d2-exempt:\s*([^\n]+)/
// 整文件豁免（原生视觉资产页）：文件头 `/* d2-exempt-file: <原因> */` → 平台 API 家族（wx/uni + Web）豁免、其余规则仍守
const FILE_EXEMPT_RE = /\/\*\s*d2-exempt-file:\s*([^*\n]+)/

/** 收集目录下全部 .vue 文件 */
function collectVue(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) collectVue(full, out)
    else if (e.name.endsWith('.vue')) out.push(full)
  }
  return out
}

/** 提取 <style> 块内容并剥除注释（@media 检查只针对真实样式代码） */
function styleCodeOnly(src: string): string {
  const blocks = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1])
  return blocks.join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1')
}

/** 规则④专用：剥注释后只剩真实代码（文档头注释常写「页面零裸 window.*」——非代码，不误报） */
function webCodeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // 块注释（含多行头注释）
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l)) // 整行行注释
    .join('\n')
}

export interface D2FileViolations {
  file: string
  errors: string[]
  warnings: string[]
  exemptions: string[]
}

/** 审计单个 .vue 文件（rules: 规则 id → severity；返回相对路径消息 + 逐文件豁免原因） */
export function scanD2VueFile(file: string, rules: D2Rules): D2FileViolations {
  const src = fs.readFileSync(file, 'utf8')
  const rel = path.relative(process.cwd(), file)
  const errors: string[] = []
  const warnings: string[] = []
  const exemptions: string[] = []

  const hit = (ruleId: keyof D2Rules, text: string): void => {
    const sev = rules[ruleId]
    if (sev === 'off') return
    ;(sev === 'warn' ? warnings : errors).push(text)
  }

  // 整文件豁免（原生视觉资产页）：平台 API 家族整体豁免 + 登记（不吞 @media/第三方 UI）
  const fileExempt = src.match(FILE_EXEMPT_RE)?.[1]?.trim() ?? null

  // 逐行豁免：抽走 d2-exempt 行（仅对 Web 平台规则生效）——原因随报告展示
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
  if (fileExempt) exemptions.push(`[整文件豁免] ${fileExempt}`)

  // ① 第三方 UI 库（D-2：禁引入 Element/Vant 等）
  if (FORBIDDEN_UI.test(src)) hit('no-third-party-ui', `${rel} [D2-UI] 引入第三方 UI 库（须用 p-* 语义组件 / 自有 tokens）`)

  // ② 手写 @media（W-6 柔性框架优先）——只扫 <style> 块内真实样式代码（不可豁免）
  if (MEDIA_RE.test(styleCodeOnly(src))) hit('no-media-query', `${rel} [W-6/C8] 手写 @media 断点（响应式归 v-p-fluid clamp + 柔性网格）`)

  // ③ 平台 API 直调（wx.*/uni.*——业务只走语义接口；d2-exempt-file 整文件豁免可放行）
  if (!fileExempt && PLATFORM_API.test(src)) hit('no-platform-api', `${rel} [D2-PLATFORM] 平台 API 直调（wx.*/uni.*——业务只走语义接口）`)

  // ④ Web 平台 API 裸调（封装只在框架包；注释剥除防文档头误报；行豁免需带原因）
  if (!fileExempt && WEB_PLATFORM_RE.test(webCodeOnly(scrubbed))) hit('no-web-platform-api', `${rel} [D2-PLATFORM-WEB] Web 平台 API 裸调（window./document./navigator./location./fetch 等——须走 @proteus-vue/* 原语；确无原语处逐行 // d2-exempt: <原因>）`)

  return { file: rel, errors, warnings, exemptions }
}

/** 从被审计目录向上找 proteus.config.ts（最多 6 层，防扫到无关目录） */
export function discoverD2ConfigFile(dir: string): string | null {
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

export interface D2AuditReport {
  dir: string
  configFile: string | null
  /** 生效规则集（报告明示——PASS = 启用规则集零 error） */
  rules: D2Rules
  /** 配置来源注记（未发现/加载失败/未声明 audit → fail-closed 说明） */
  notes: string[]
  /** 扫描 .vue 数量 */
  scanned: number
  files: D2FileViolations[]
  errors: string[]
  warnings: string[]
  exemptions: string[]
  ok: boolean
}

/**
 * 审计目录 → 报告。配置来源：
 *  · opts.configFile 省略 → 从 dir 向上发现 proteus.config.ts
 *  · 显式传 null → 禁用配置（纯默认全 error）
 * 加载失败 / 未声明 audit.rules → fail-closed 全 error + 原因入 notes
 */
export async function runD2Audit(dir: string, opts: { configFile?: string | null } = {}): Promise<D2AuditReport> {
  const configFile = opts.configFile === undefined ? discoverD2ConfigFile(dir) : opts.configFile || null
  const notes: string[] = []
  let rules = D2_DEFAULT_RULES
  if (configFile) {
    try {
      const cfg = (await loadProjectConfig(configFile)) as { audit?: { rules?: unknown } } | undefined
      const audit = cfg?.audit
      if (audit && typeof audit === 'object' && audit.rules && typeof audit.rules === 'object') rules = normalizeD2Rules(audit.rules)
      else notes.push(`⚠ ${path.relative(process.cwd(), configFile)} 未声明 audit.rules——四规则默认 error`)
    } catch (e) {
      notes.push(`⚠ audit 配置加载失败 ${configFile}——按默认全 error（fail-closed）：${e instanceof Error ? e.message : String(e)}`)
    }
  } else {
    notes.push('ℹ 未发现 proteus.config.ts——四规则默认 error（可在 audit.rules 自选级别）')
  }

  const files = collectVue(dir).map((f) => scanD2VueFile(f, rules))
  const errors = files.flatMap((f) => f.errors)
  const warnings = files.flatMap((f) => f.warnings)
  const exemptions = files.flatMap((f) => f.exemptions.map((reason) => `${f.file}: ${reason}`))

  return { dir, configFile, rules, notes, scanned: files.length, files, errors, warnings, exemptions, ok: errors.length === 0 }
}

/**
 * 解析 CLI 目标：显式 dir → 原样 + 向上发现配置；
 * 省略 dir → 从 cwd（或 opts.cwd，测试注入）向上找配置，审计目录 = 配置所在目录 + (audit.dir ?? 'src')
 */
export async function resolveD2Target(dirArg?: string, opts: { cwd?: string } = {}): Promise<{ scanDir: string; configFile: string | null }> {
  if (dirArg) {
    const scanDir = path.resolve(dirArg)
    return { scanDir, configFile: discoverD2ConfigFile(scanDir) }
  }
  const start = opts.cwd ?? process.cwd()
  const configFile = discoverD2ConfigFile(start)
  if (!configFile) {
    throw new Error('未找到 proteus.config.ts——proteus audit d2 需在工程内运行（读 audit.rules），或显式传目录：proteus audit d2 <dir>')
  }
  let auditDir = 'src'
  try {
    const cfg = (await loadProjectConfig(configFile)) as { audit?: { dir?: unknown } } | undefined
    if (typeof cfg?.audit?.dir === 'string') auditDir = cfg.audit.dir
  } catch {
    // 加载失败留给 runD2Audit 注记（dir 保持默认 src）
  }
  const scanDir = path.resolve(path.dirname(configFile), auditDir)
  if (!fs.existsSync(scanDir)) throw new Error(`审计目录不存在：${scanDir}（proteus.config 的 audit.dir 或默认 src）`)
  return { scanDir, configFile }
}

/** 格式化报告 */
export function formatD2Audit(report: D2AuditReport): string {
  const lines: string[] = []
  lines.push(`[proteus] audit d2 —— D-2 dogfooding 门禁 · 目录：${report.dir} · ${report.scanned} 个 .vue`)
  const active = AUDIT_RULE_IDS.map((id) => `${id}=${report.rules[id]}`).join(' · ')
  lines.push(`  规则：${active}${report.configFile ? `（来源 ${path.relative(process.cwd(), report.configFile)}）` : ''}`)
  for (const n of report.notes) lines.push(`  ${n}`)
  for (const e of report.errors) lines.push(`  ✗ ${e}`)
  for (const w of report.warnings) lines.push(`  ⚠ ${w}`)
  if (report.exemptions.length) {
    lines.push(`  ℹ Web 平台豁免 ${report.exemptions.length} 处（登记原因，缺口待补原语）：`)
    for (const ex of report.exemptions) lines.push(`    · ${ex}`)
  }
  const skip = AUDIT_RULE_IDS.filter((id) => report.rules[id] === 'off')
  const soft = report.warnings.length ? `（另 ${report.warnings.length} 项 warn 级）` : ''
  lines.push(report.ok ? `  ✅ PASS——启用规则集零 error${skip.length ? `（关闭：${skip.join(' / ')}）` : ''}${soft}` : `  ❌ FAIL——${report.errors.length} 项违规（D-2 不可绕过；warn 级 ${report.warnings.length} 项）`)
  return lines.join('\n')
}
