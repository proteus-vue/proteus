// packages/router/src/scan.ts
// <route> 块扫描（docs/proteus-router-plan M1）—— 从所有 .vue 提取 <route>{...}</route>，校验并输出 RouteBlock[]
// ★ 复用 @vue/compiler-sfc 的 parse（不重写 SFC 解析）；block.loc 天然给出文件:行号 → --trace-router 定位
// ★双管线统一（决策 #112）：derivePath 模式下 path 可从文件位置推导（pages/home.vue → pages/home）——
//   <route> 只需声明 meta（页面是路由唯一真相源，零样板），path/name 由扫描推导；显式声明优先
import fs from 'node:fs'
import path from 'node:path'
import { parse } from '@vue/compiler-sfc'
import type { RouteBlock } from './types'
import { RouteValidationError, validateSchema, checkDuplicates, validateParentRefs } from './schema'

/** 递归收集目录下所有 .vue 文件（跳过隐藏目录 / node_modules / dist） */
export function walkVueFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkVueFiles(full, acc)
    else if (entry.name.endsWith('.vue')) acc.push(full)
  }
  return acc
}

export interface ScanOptions {
  /** --trace-router：来源登记输出（文件:行 path=...） */
  verbose?: boolean
  /**
   * ★双管线统一：path 缺省时从文件位置推导（rootDir 相对路径去扩展名：pages/home.vue → pages/home）
   * 显式声明的 path 优先；false（默认）时 path 必填（M1 schema 严格模式）
   */
  derivePath?: boolean
  /**
   * ★决策 #113：无 <route> 块页面也收录（零声明零样板）——derivePath 推导 path/name，meta 为空
   * （meta 由 gen-routes 从 proteus.config router.meta 集中注入；页面 <route> 块完全可选）
   */
  includeNoRoute?: boolean
}

/** 从文件位置推导 path（rootDir 相对，去 .vue；index.vue → 目录路径：pages/user/index.vue → pages/user） */
function derivePathFromFile(rootDir: string, file: string): string {
  let rel = path.relative(rootDir, file).replace(/\\/g, '/').replace(/\.vue$/, '')
  if (rel.endsWith('/index')) rel = rel.slice(0, -'/index'.length)
  return rel
}

/** 从文件位置推导 name（kebab-case：pages/user/profile.vue → user-profile；index → 目录名：pages/user/index.vue → user） */
export function deriveNameFromFile(rootDir: string, file: string): string {
  const rel = path.relative(rootDir, file).replace(/\\/g, '/').replace(/\.vue$/, '')
  const base = rel.split('/').pop() ?? ''
  if (base === 'index') {
    const dir = rel.slice(0, rel.lastIndexOf('/'))
    const stripped = dir.replace(/^(pages|subpackages)(\/|$)/, '').replace(/\/$/, '')
    return stripped ? stripped.replace(/\//g, '-') : 'index'
  }
  const stripped = rel.replace(/^(pages|subpackages)\//, '')
  return stripped.replace(/\//g, '-')
}

/**
 * 扫描 rootDir 下所有 .vue 的 <route> 块，返回校验通过的 RouteBlock[]
 * - 页面无 <route> 块：跳过（兼容"页面级私有页"，verbose 时打印提示）
 * - 一个文件多个 <route> 块：报错
 * - verbose：--trace-router 模式的"来源登记"输出
 * - derivePath：path 缺省从文件位置推导（页面零样板——meta 是唯一声明）
 */
export function scanRoutes(rootDir: string, options: ScanOptions | boolean = {}): RouteBlock[] {
  const opts: ScanOptions = typeof options === 'boolean' ? { verbose: options } : options
  const routes: RouteBlock[] = []

  for (const file of walkVueFiles(rootDir)) {
    const { descriptor } = parse(fs.readFileSync(file, 'utf-8'))
    const blocks = descriptor.customBlocks.filter((b) => b.type === 'route')
    // ★includeNoRoute：无 <route> 块页面也收录（决策 #113——零声明零样板，meta 由 config 集中注入）
    if (blocks.length === 0) {
      if (!opts.includeNoRoute) continue
      if (!opts.derivePath) {
        throw new RouteValidationError('includeNoRoute 需搭配 derivePath（无 <route> 块页面需推导 path/name）', {
          file,
          line: 1,
          column: 1,
        })
      }
      const loc = { file, line: 1, column: 1 }
      routes.push({
        loc,
        path: derivePathFromFile(rootDir, file),
        name: deriveNameFromFile(rootDir, file),
        meta: {},
        componentPath: file,
      })
      if (opts.verbose) {
        console.log(`[route] ${file}:1  path="${derivePathFromFile(rootDir, file)}"（无 <route> 块，推导收录）`)
      }
      continue
    }
    if (blocks.length > 1) {
      const loc = { file, line: blocks[1].loc.start.line, column: blocks[1].loc.start.column }
      throw new RouteValidationError('一个 .vue 文件只允许一个 <route> 块', loc)
    }

    const block = blocks[0]
    const loc = { file, line: block.loc.start.line, column: block.loc.start.column }
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(block.content.trim())
    } catch (err) {
      throw new RouteValidationError(`<route> 块不是合法 JSON：${(err as Error).message}`, loc)
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new RouteValidationError('<route> 块顶层必须是 JSON 对象', loc)
    }

    // ★derivePath：path 缺省 → 从文件位置推导（显式声明优先）；同时推导 name（index 归并目录名）
    if (opts.derivePath && (parsed.path === undefined || parsed.path === null || parsed.path === '')) {
      parsed.path = derivePathFromFile(rootDir, file)
    }
    if (opts.derivePath && (parsed.name === undefined || parsed.name === null || parsed.name === '')) {
      parsed.name = deriveNameFromFile(rootDir, file)
    }

    const route = validateSchema(parsed, loc, { allowDerivedPath: opts.derivePath })
    routes.push({ ...route, componentPath: file })
    if (opts.verbose) {
      console.log(`[route] ${file}:${loc.line}  path="${route.path}"${route.name ? ` name="${route.name}"` : ''}`)
    }
  }

  // 收口校验：path/name 全局唯一 + parent 引用存在
  checkDuplicates(routes)
  validateParentRefs(routes)
  return routes
}
