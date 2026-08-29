// packages/cli/src/i18n-check.ts
// ★i18n-plan B2：proteus i18n:check —— 消息引用审计（扫描级，对齐 capabilities:check 的纯函数+CLI 模式）
// 扫描目录下 .vue/.ts 中的 t('key') / $t('key') / i18n.t('key') 字符串字面量引用，
// 对比语言包 JSON（默认 <root>/locales/zh-CN.json，--catalog 可指定）→ 缺失（error）/ 多余未引用（warning）
import fs from 'node:fs'
import path from 'node:path'

export interface I18nCheckResult {
  ok: boolean
  catalogFile: string
  catalogKeys: string[]
  usedKeys: string[]
  missing: string[] // 使用了但语言包缺失（error）
  unused: string[] // 语言包存在但未引用（warning）
  scannedFiles: number
}

/** 消息引用正则：t('k') / $t('k') / i18n.t('k')（字符串字面量；变量 key 跳过——审计可见性有限） */
const KEY_RE = /(?:\$t|i18n\.t|\bt)\(\s*["']([^"']+)["']\s*[,)]/g

/** 剥离注释（防注释中的 t() 误报） */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkSourceFiles(full, out)
    else if (entry.name.endsWith('.vue') || entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

/**
 * 审计消息引用：root 下 .vue/.ts 的 t()/$t()/i18n.t() 引用 vs 语言包 JSON
 * 缺失 key（使用了但不在清单）→ error（exit 1）；多余 key（清单内未引用）→ warning
 */
export function checkI18nUsage(root: string, catalogPath?: string): I18nCheckResult {
  const catalogFile = path.resolve(catalogPath ?? path.join(root, 'locales', 'zh-CN.json'))
  if (!fs.existsSync(catalogFile)) {
    throw new Error(`未找到语言包清单：${catalogFile}（用 --catalog 指定，或建 locales/zh-CN.json）`)
  }
  const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf-8')) as Record<string, string>
  const catalogKeys = Object.keys(catalog)
  const used = new Set<string>()
  const files = walkSourceFiles(root)
  for (const f of files) {
    const code = stripComments(fs.readFileSync(f, 'utf-8'))
    KEY_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = KEY_RE.exec(code))) used.add(m[1])
  }
  const usedKeys = [...used]
  const missing = usedKeys.filter((k) => !catalogKeys.includes(k)).sort()
  const unused = catalogKeys.filter((k) => !used.has(k)).sort()
  return { ok: missing.length === 0, catalogFile, catalogKeys, usedKeys, missing, unused, scannedFiles: files.length }
}

/** 渲染审计报告（纯函数） */
export function formatI18nCheck(result: I18nCheckResult): string {
  const lines = [
    `[proteus-i18n] 消息审计：${result.scannedFiles} 个文件 / 清单 ${result.catalogKeys.length} 条 / 引用 ${result.usedKeys.length} 条（${result.ok ? '✅ 缺失为零' : `❌ 缺失 ${result.missing.length} 条`}）`,
  ]
  for (const k of result.missing) lines.push(`  [missing] ${k}：使用了但语言包缺失（请补 locales 或改引用）`)
  for (const k of result.unused) lines.push(`  [unused] ${k}：语言包内未引用（可清理）`)
  return lines.join('\n')
}
