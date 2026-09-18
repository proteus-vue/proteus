// packages/cli/src/api-hook-check.ts
// ★G-31 B7（no-callback-api lint）+ G-32.4（能力原语无回调/无全局对象）：proteus api-check
//   规则（CMP007）：
//     no-callback    回调式平台 API（wx.xxx({ success: ... })）——禁止，改 useXxx() Hook 返回 Promise/Result
//     sync-storage   wx.setStorageSync/getStorageSync 同步存储——禁止，改 useStorage()（响应式）
//     global-direct  wx.request/getLocation 等裸全局调用（业务代码）——禁止，改 useXxx 或 PlatformAPI 注入
//   平台适配文件（platforms/ adapters/ *.skyline.ts *.mp.ts main.mp.ts）豁免（平台桥合法使用 wx.*）
import fs from 'node:fs'
import path from 'node:path'

export interface ApiHookViolation {
  file: string
  rule: string
  match: string
}

export interface ApiHookCheckResult {
  ok: boolean
  violations: ApiHookViolation[]
  scannedFiles: number
}

/** 回调式 wx API：wx.xxx({ ... success:  ... })（G-32.4 铁律） */
const CALLBACK_STYLE_RE = /\bwx\s*\.\s*[A-Za-z_$][\w$]*\s*\(\s*\{[^}]*\b(success|fail|complete)\b\s*:/
/** 同步存储裸调（A3 异步原则 + no-sync-storage） */
const SYNC_STORAGE_RE = /\bwx\s*\.\s*(setStorageSync|getStorageSync|removeStorageSync|clearStorageSync)\s*\(/
/** 裸全局能力 API（业务代码应改 useXxx/PlatformAPI；平台桥文件豁免） */
const GLOBAL_DIRECT_RE = /\bwx\s*\.\s*(request|getLocation|setStorage|getStorage|getSystemInfo|setClipboardData|getClipboardData|vibrateShort|getBatteryInfo|getNetworkType)\s*\(/

/** 平台桥文件（wx.* 合法）——算 path 片段，任意命中即豁免 */
const PLATFORM_FILE_MARKS = ['platforms', 'adapters', '.skyline.', '.mp.', 'main.mp.', 'capabilities/']

function isPlatformFile(rel: string): boolean {
  return PLATFORM_FILE_MARKS.some((m) => rel.includes(m))
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

function walk(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(vue|ts|js)$/.test(e.name)) out.push(p)
  }
}

/** 文件级豁免：首部注释含 @proteus-api-check-ignore（刻意演示旧 wx API 的兼容层文档/演示页） */
function isFileExempt(src: string): boolean {
  const head = src.slice(0, 400)
  return head.includes('@proteus-api-check-ignore')
}

/** 扫描目录（缺省 '.'）→ CMP007 违规（回调式 API / 同步存储 / 裸全局调用） */
export function runApiHookCheck(root: string): ApiHookCheckResult {
  const violations: ApiHookViolation[] = []
  const files: string[] = []
  if (fs.existsSync(root)) walk(root, files)
  for (const f of files) {
    const rel = path.relative(process.cwd(), f).replace(/\\/g, '/')
    if (isPlatformFile(rel)) continue
    const src = stripComments(fs.readFileSync(f, 'utf-8'))
    if (isFileExempt(fs.readFileSync(f, 'utf-8'))) continue // 文件级豁免（兼容层演示）
    const lines = src.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const loc = `${rel}:${i + 1}`
      const cb = line.match(CALLBACK_STYLE_RE)
      if (cb) {
        violations.push({ file: loc, rule: 'no-callback', match: cb[0].slice(0, 60) })
        continue
      }
      const ss = line.match(SYNC_STORAGE_RE)
      if (ss) {
        violations.push({ file: loc, rule: 'sync-storage', match: ss[0].slice(0, 60) })
        continue
      }
      const gd = line.match(GLOBAL_DIRECT_RE)
      if (gd) {
        violations.push({ file: loc, rule: 'global-direct', match: gd[0].slice(0, 60) })
      }
    }
  }
  return { ok: violations.length === 0, violations, scannedFiles: files.length }
}

/** 渲染报告（对齐 capabilities:check 输出风格） */
export function formatApiHookCheck(result: ApiHookCheckResult): string {
  const head = `[proteus-api-hook] CMP007 门禁：扫描 ${result.scannedFiles} 文件（平台桥文件豁免）`
  if (result.ok) return `${head}：✅ 通过（无回调式/同步存储/裸全局 API）`
  const lines = [`${head}：❌ ${result.violations.length} 处违规（G-31 B7 / G-32.4：改 useXxx() Hook 或 PlatformAPI 注入）：`]
  for (const v of result.violations) {
    const hint = v.rule === 'no-callback' ? '改 useXxx() 返回 Promise/Result' : v.rule === 'sync-storage' ? '改 useStorage()（响应式异步）' : '改 useXxx 或 platform.request()'
    lines.push(`  [${v.rule}] ${v.file}: ${v.match}（${hint}）`)
  }
  return lines.join('\n')
}