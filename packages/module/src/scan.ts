// packages/module/src/scan.ts
// ★module-plan B1：proteus-module.config.ts 扫描 + 校验汇总（纯函数，CLI module:check 与测试共用）
// 扫描约定：项目任意子目录（跳过 node_modules/dist/.git）下的 proteus-module.config.ts
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { transform } from 'esbuild'
import { validateModuleConfig, defineModule } from './contract'
import type { ModuleValidationIssue } from './contract'

/** 从本包位置解析 @proteus-vue/module（fixture 配置 eval 时 require 用；CLI/测试运行环境 node_modules 可达） */
const nodeRequire = createRequire(import.meta.url)

export interface ModuleScanEntry {
  file: string
  name: string | undefined
  version: string | undefined
  /** ★B3：模块依赖（构建依赖图/环检测用） */
  dependencies?: Record<string, string>
  /** ★B3：分包 chunk（对齐 Router M7.1） */
  chunk?: string
  /** ★B5：预加载声明（分包 preloadRule 的 packages） */
  preload?: string[]
  ok: boolean
  errors: ModuleValidationIssue[]
  warnings: ModuleValidationIssue[]
}

export interface ModuleScanResult {
  modules: ModuleScanEntry[]
  /** ★重名模块（全局唯一铁律违反） */
  duplicateNames: Array<{ name: string; files: string[] }>
}

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.transform-debug', 'coverage'])

/** 递归收集目录下全部 proteus-module.config.ts（跳过隐藏/产物目录） */
export function walkModuleConfigs(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkModuleConfigs(full, acc)
    else if (entry.name === 'proteus-module.config.ts') acc.push(full)
  }
  return acc
}

/** 加载 proteus-module.config.ts：esbuild transform 转 CJS → 去掉 @proteus-vue/module require 行 →
 * eval 时 defineModule 由作用域注入（与 validateModuleConfig 同源，零外部依赖加载，规避 ESM require/循环） */
export async function loadModuleConfig(file: string): Promise<unknown> {
  const src = fs.readFileSync(file, 'utf-8')
  const { code } = await transform(src, { loader: 'ts', format: 'cjs', platform: 'node', logLevel: 'silent' })
  // 去掉 @proteus-vue/module 的 require 行 + import_module.defineModule → defineModule（Function 参数注入，零外部依赖加载）
  const finalCode = code
    .replace(/^[^\n]*require\(['"]@proteus-vue\/module['"]\)[^\n]*$/gm, '')
    .replace(/\bimport_[a-zA-Z0-9_$]*\.defineModule\b/g, 'defineModule')
  const mod = { exports: {} as Record<string, unknown> }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', 'defineModule', finalCode)(mod, mod.exports, nodeRequire, defineModule)
  return (mod.exports as { default?: unknown }).default ?? mod.exports
}

/** 扫描 + 校验全部模块配置（纯函数，可单测） */
export async function scanModuleConfigs(root: string): Promise<ModuleScanResult> {
  const files = walkModuleConfigs(root)
  const modules: ModuleScanEntry[] = []
  for (const file of files) {
    let entry: ModuleScanEntry
    try {
      const value = await loadModuleConfig(file)
      const result = validateModuleConfig(value)
      const raw = (value ?? {}) as { name?: string; version?: string; dependencies?: Record<string, string>; chunk?: string; preload?: string[] }
      entry = {
        file: path.relative(root, file).replace(/\\/g, '/'),
        name: raw.name,
        version: raw.version,
        dependencies: raw.dependencies,
        chunk: raw.chunk,
        preload: raw.preload,
        ok: result.ok,
        errors: result.ok ? [] : result.errors,
        warnings: 'warnings' in result ? result.warnings : [],
      }
    } catch (err) {
      entry = {
        file: path.relative(root, file).replace(/\\/g, '/'),
        name: undefined,
        version: undefined,
        ok: false,
        errors: [{ field: '(加载)', message: (err as Error).message }],
        warnings: [],
      }
    }
    modules.push(entry)
  }
  // 重名检测（模块标识全局唯一）
  const byName = new Map<string, string[]>()
  for (const m of modules) {
    if (!m.name) continue
    const list = byName.get(m.name) ?? []
    list.push(m.file)
    byName.set(m.name, list)
  }
  const duplicateNames = [...byName.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([name, files]) => ({ name, files }))
  return { modules, duplicateNames }
}

/** CLI 输出格式化（透明化：每模块状态 + 字段级错误 + 汇总） */
export function formatModuleCheck(result: ModuleScanResult): string {
  const lines: string[] = []
  if (!result.modules.length) {
    lines.push('[proteus-module] 未找到 proteus-module.config.ts（项目根或子目录；模块声明见 docs/proteus-module-plan/01-m1-module-contract.md）')
    return lines.join('\n')
  }
  for (const m of result.modules) {
    lines.push(`${m.ok ? '✅' : '❌'} ${m.file}${m.name ? `（${m.name}@${m.version ?? '?'}）` : ''}`)
    for (const e of m.errors) lines.push(`     ✗ ${e.field}: ${e.message}`)
    for (const w of m.warnings) lines.push(`     ⚠ ${w.field}: ${w.message}`)
  }
  if (result.duplicateNames.length) {
    for (const d of result.duplicateNames) {
      lines.push(`❌ ★重名模块 "${d.name}"：${d.files.join(' / ')}（模块标识全局唯一）`)
    }
  }
  const okCount = result.modules.filter((m) => m.ok).length
  lines.push(`[proteus-module] 模块校验：${okCount}/${result.modules.length} 通过${result.duplicateNames.length ? `，${result.duplicateNames.length} 个重名` : ''}`)
  return lines.join('\n')
}
