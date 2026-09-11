// packages/cli/src/component-audit.ts
// ★组件库 B8：proteus components:audit —— 组件层硬门禁（对齐 07/10 规划，DRY 复用 capabilities:check 的纯函数+CLI 模式）
// 规则（当前可静态判定项）：
//   no-platform-api（error）     组件内不得直接 wx.* / document.* / window.*（C1：走 L2 抽象）
//                                ★Skyline 线收口：含绕过检测——globalThis as {wx?}.wx / const w = wx / wxAlias.w
//   no-sync-storage（error）     组件内禁止 wx.setStorageSync / localStorage（对齐 API A3 异步原则）
//   no-browser-observer（error） 组件内不得直接 new ResizeObserver / matchMedia / getBoundingClientRect
//                                （★Skyline：MP 无这些 API → 静默失效；应走 @proteus-vue/fluid 尺寸观测原语 / L2 抽象）
//   manifest-complete（error）   组件目录 <tag>/index.vue ↔ 聚合导出 index.ts 双向一致
// 豁免（诚实登记，非静默）：整文件 `/* components-allow-platform: <原因> */`（仅平台 API 家族生效，
//   不豁免 manifest-complete / no-sync-storage）——用于确需直调 wx 的组件（须在注释写明 L2 缺失原因）
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
// ★Skyline 线收口：绕过检测（原正则只匹配 `wx.` 紧邻形态，`const w = wx` + `w.foo` 可逃逸）
const WX_ALIAS_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*wx\b/
const GLOBALTHIS_WX_RE = /globalThis[^\n]*\bwx\b/
// ★Skyline 线收口：浏览器专有观察/测量 API（MP 无 → 静默失效；应走 fluid 原语 / L2 抽象）
const BROWSER_OBSERVER_RE = /\bnew\s+ResizeObserver\b|\bmatchMedia\s*\(|\bgetBoundingClientRect\s*\(/
const SYNC_STORAGE_RE = /\bwx\.setStorageSync\s*\(|\blocalStorage\.(setItem|getItem|removeItem)\s*\(/
// 整文件豁免（诚实登记）：`/* components-allow-platform: <原因> */`——仅平台 API 家族生效
const FILE_EXEMPT_RE = /\/\*\s*components-allow-platform:\s*([^*\n]+)/
// 行内/紧邻上一行豁免：`// components-allow-platform: <原因>`
const LINE_EXEMPT_RE = /\/\/\s*components-allow-platform:\s*([^\n]+)/

/** 剥离注释（单行与块注释），★保留行结构（块注释按行替换为空白——行号与原文严格对齐，供豁免定位） */
function stripComments(src: string): string {
  // 块注释：逐行置空（保留 \n）——避免跨行块注释塌缩导致行号错位
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
  return noBlock.replace(/\/\/[^\n]*/g, '')
}

function checkComponentFile(abs: string, violations: ComponentViolation[]): void {
  const raw = fs.readFileSync(abs, 'utf-8')
  const fileExempt = FILE_EXEMPT_RE.test(raw) // 平台 API 家族整文件豁免（诚实登记）
  const code = stripComments(raw)
  const lines = code.split('\n')
  const rawLines = raw.split('\n') // ★豁免标记用原始行（注释已剥，须从 raw 读）
  // 收集 wx 别名变量（`const w = wx`）→ 后续 `w.foo` 也视为平台直调
  const wxAliases = new Set<string>()
  for (const line of lines) {
    const am = line.match(WX_ALIAS_RE)
    if (am) wxAliases.add(am[1])
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const loc = `${path.relative(process.cwd(), abs)}:${i + 1}`
    const rawLine = rawLines[i] ?? line
    const lineExemptEarly = LINE_EXEMPT_RE.test(rawLine) || (i > 0 && LINE_EXEMPT_RE.test(rawLines[i - 1] ?? ''))
    const pm = line.match(PLATFORM_API_RE)
    if (pm && !fileExempt && !lineExemptEarly) {
      violations.push({
        file: loc,
        rule: 'no-platform-api',
        message: `组件内直接调用 ${pm[1]}.*（平台 API）——组件只允许走 L2 抽象（runtime/capability 等），跨端能力用 capability.has() 探测`,
      })
    }
    // 行内/紧邻上一行豁免（仅作用于本行）
    const lineExempt = LINE_EXEMPT_RE.test(rawLine) || (i > 0 && LINE_EXEMPT_RE.test(rawLines[i - 1] ?? ''))
    // ★Skyline 线收口：绕过检测（globalThis.wx / wx 别名变量的成员访问）
    if (!fileExempt && !lineExempt) {
      const windowText = lines.slice(Math.max(0, i - 5), i + 1).join(' ') // ★多行窗口（globalThis 与 wx 跨行 cast 形态）
      if (GLOBALTHIS_WX_RE.test(line) || (/globalThis/.test(windowText) && /\bwx\b/.test(windowText))) {
        violations.push({
          file: loc,
          rule: 'no-platform-api',
          message: '组件内经 globalThis 访问 wx（绕过 L2 抽象）——改走 adapter/capability（或加 `/* components-allow-platform: 原因 */` 登记豁免）',
        })
      }
      for (const alias of wxAliases) {
        if (new RegExp(`\\b${alias}\\s*\\.\\s*[A-Za-z_$]`).test(line) && !new RegExp(`\\b${alias}\\s*=`).test(line)) {
          violations.push({
            file: loc,
            rule: 'no-platform-api',
            message: `wx 别名变量 "${alias}" 的成员访问（平台直调绕过）——改走 L2 抽象`,
          })
          break
        }
      }
    }
    // ★Skyline 线收口：浏览器专有观察/测量 API（MP 无 → 静默失效）
    if (BROWSER_OBSERVER_RE.test(line) && !lineExempt) {
      violations.push({
        file: loc,
        rule: 'no-browser-observer',
        message: '组件内直接使用 ResizeObserver/matchMedia/getBoundingClientRect（小程序无 → 静默失效）——走 @proteus-vue/fluid 尺寸观测原语或 L2 adapter',
      })
    }
    if (SYNC_STORAGE_RE.test(line)) {
      violations.push({
        file: loc,
        rule: 'no-sync-storage',
        message: '组件内禁止同步存储（wx.setStorageSync / localStorage）——异步原则走 @proteus-vue/api 存储或 store 持久化',
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
