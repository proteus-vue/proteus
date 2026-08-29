// packages/cli/src/component-audit.ts
// ★组件库 B8：proteus components:audit —— 组件层硬门禁（对齐 07/10 规划，DRY 复用 capabilities:check 的纯函数+CLI 模式）
// 规则（当前可静态判定项）：
//   no-platform-api（error）     组件内不得直接 wx.* / document.* / window.*（C1：走 L2 抽象）
//   no-sync-storage（error）     组件内禁止 wx.setStorageSync / localStorage（对齐 API A3 异步原则）
//   manifest-complete（error）   组件目录 <tag>/index.vue ↔ 聚合导出 index.ts 双向一致
import fs from 'node:fs'
import path from 'node:path'

export interface ComponentViolation {
  file: string
  rule: string
  message: string
}

export interface ComponentAuditResult {
  ok: boolean
  violations: ComponentViolation[]
  componentCount: number
}

const PLATFORM_API_RE = /\b(wx|document|window)\.\s*[A-Za-z_$][\w$]*/
const SYNC_STORAGE_RE = /\bwx\.setStorageSync\s*\(|\blocalStorage\.(setItem|getItem|removeItem)\s*\(/

/** 剥离注释（单行与块注释），保留代码行（防注释误报） */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

function checkComponentFile(abs: string, violations: ComponentViolation[]): void {
  const src = fs.readFileSync(abs, 'utf-8')
  const code = stripComments(src)
  const lines = code.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const pm = line.match(PLATFORM_API_RE)
    if (pm) {
      violations.push({
        file: `${path.relative(process.cwd(), abs)}:${i + 1}`,
        rule: 'no-platform-api',
        message: `组件内直接调用 ${pm[1]}.*（平台 API）——组件只允许走 L2 抽象（runtime/capability 等），跨端能力用 capability.has() 探测`,
      })
    }
    if (SYNC_STORAGE_RE.test(line)) {
      violations.push({
        file: `${path.relative(process.cwd(), abs)}:${i + 1}`,
        rule: 'no-sync-storage',
        message: '组件内禁止同步存储（wx.setStorageSync / localStorage）——异步原则走 @proteus/api 存储或 store 持久化',
      })
    }
  }
}

/**
 * 审计组件目录：扫描 <tag>/index.vue + 目录内 .ts，检查平台 API 直调与同步存储；
 * 核对聚合导出 index.ts ↔ 组件目录双向一致
 */
export function auditComponents(root: string): ComponentAuditResult {
  const violations: ComponentViolation[] = []
  const tagDirs = new Set<string>()
  if (!fs.existsSync(root)) {
    violations.push({ file: root, rule: 'manifest-complete', message: `组件目录不存在：${root}` })
    return { ok: false, violations, componentCount: 0 }
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const idx = path.join(root, entry.name, 'index.vue')
    if (!fs.existsSync(idx)) continue
    tagDirs.add(entry.name)
    checkComponentFile(idx, violations)
    // 组件目录内的共享 .ts（runtime 等）同样审计
    const dir = path.join(root, entry.name)
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.ts')) checkComponentFile(path.join(dir, f), violations)
    }
  }
  // 聚合导出一致性：index.ts 里每个组件都有目录；目录里每个组件都有导出
  const indexFile = path.join(root, 'index.ts')
  if (fs.existsSync(indexFile)) {
    const indexSrc = fs.readFileSync(indexFile, 'utf-8')
    for (const tag of tagDirs) {
      const pascal = tag.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('')
      if (!indexSrc.includes(pascal)) {
        violations.push({
          file: path.relative(process.cwd(), indexFile),
          rule: 'manifest-complete',
          message: `组件 ${tag}/index.vue 未在聚合导出 index.ts 导出 ${pascal}（Web 端 import 缺失）`,
        })
      }
    }
    for (const m of indexSrc.matchAll(/import\s+([A-Z]\w*)\s+from\s+'\.\/([\w-]+)\/index\.vue'/g)) {
      const [, pascal, tag] = m
      if (!tagDirs.has(tag)) {
        violations.push({
          file: path.relative(process.cwd(), indexFile),
          rule: 'manifest-complete',
          message: `聚合导出引用了不存在的组件目录 ${tag}/（${pascal}）`,
        })
      }
    }
  } else {
    violations.push({ file: root, rule: 'manifest-complete', message: '缺少聚合导出 index.ts（Web 端入口）' })
  }
  return { ok: violations.length === 0, violations, componentCount: tagDirs.size }
}

/** 渲染审计报告（纯函数，对齐 capabilities:check 输出风格） */
export function formatComponentAudit(result: ComponentAuditResult): string {
  const lines = [`[proteus-components] 组件审计：${result.componentCount} 个组件（${result.ok ? '✅ 全部通过' : `❌ ${result.violations.length} 处违规`}）`]
  for (const v of result.violations) {
    lines.push(`  [${v.rule}] ${v.file}: ${v.message}`)
  }
  return lines.join('\n')
}
