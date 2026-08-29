// packages/router/src/scan.ts
// <route> 块扫描（docs/proteus-router-plan M1）—— 从所有 .vue 提取 <route>{...}</route>，校验并输出 RouteBlock[]
// ★ 复用 @vue/compiler-sfc 的 parse（不重写 SFC 解析）；block.loc 天然给出文件:行号 → --trace-router 定位
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

/**
 * 扫描 rootDir 下所有 .vue 的 <route> 块，返回校验通过的 RouteBlock[]
 * - 页面无 <route> 块：跳过（兼容"页面级私有页"，verbose 时打印提示）
 * - 一个文件多个 <route> 块：报错
 * - verbose：--trace-router 模式的"来源登记"输出
 */
export function scanRoutes(rootDir: string, verbose = false): RouteBlock[] {
  const routes: RouteBlock[] = []

  for (const file of walkVueFiles(rootDir)) {
    const { descriptor } = parse(fs.readFileSync(file, 'utf-8'))
    const blocks = descriptor.customBlocks.filter((b) => b.type === 'route')
    if (blocks.length === 0) continue
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

    const route = validateSchema(parsed, loc)
    routes.push({ ...route, componentPath: file })
    if (verbose) {
      console.log(`[route] ${file}:${loc.line}  path="${route.path}"${route.name ? ` name="${route.name}"` : ''}`)
    }
  }

  // 收口校验：path/name 全局唯一 + parent 引用存在
  checkDuplicates(routes)
  validateParentRefs(routes)
  return routes
}
