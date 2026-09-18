// packages/cli/src/config-loader.ts
// ★#418 配置收敛完整性：proteus dev/build 的配置加载器（宽松版）——
//   proteus.config.ts 的 vite 透传字段需要承载真实 vite 插件（函数对象），配置必须允许运行时 import
//   （与 config:check 的严格纯数据沙箱分开：check 保留 strict 版禁运行时依赖；dev/build 用本宽松版）
// ★#420 dogfooding：支持相对 .ts/.mts 子模块（config 引用本地 TS 数据/逻辑，如 website 的 ends.ts）——
//   递归 esbuild 转 CJS 执行（缓存防重复）
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'

const tsCache = new Map<string, unknown>()

/** 相对 TS 子模块 → CJS 执行（递归 transformSync；缓存防重复） */
function loadTsModule(abs: string): unknown {
  if (tsCache.has(abs)) return tsCache.get(abs)
  const src = fs.readFileSync(abs, 'utf-8')
  const { code } = transformSync(src, { loader: 'ts', format: 'cjs', platform: 'node', logLevel: 'silent' })
  const mod: { exports: Record<string, unknown> } = { exports: {} }
  const dir = path.dirname(abs)
  const req = createRequire(path.join(dir, 'package.json'))
  const localRequire = (id: string): unknown => {
    if (id.startsWith('.')) {
      // 相对子模块：显式 .ts/.mts 或扩展名解析（ends.ts → ./ends）
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

/**
 * 加载 proteus.config.ts（宽松）：esbuild TS→CJS → Function 注入执行。
 * 相对导入（含 .ts）与包名导入均允许（resolve 自配置所在目录向上）；剥 @proteus-vue/plugin-vite 的
 * 类型引用 require 行（配置仅类型引用该包时无运行时依赖）。返回 default 导出。
 */
export async function loadProjectConfig(file: string): Promise<unknown> {
  const src = fs.readFileSync(file, 'utf-8')
  // esbuild cjs 转换：`import type` 引用自然消除（无 require 行）；真实运行时 import（插件等）保留为 require → fileRequire
  const { code } = transformSync(src, { loader: 'ts', format: 'cjs', platform: 'node', logLevel: 'silent' })
  const mod: { exports: Record<string, unknown> } = { exports: {} }
  const dir = path.dirname(file)
  const req = createRequire(path.join(dir, 'package.json'))
  const fileRequire = (id: string): unknown => {
    if (id === '@proteus-vue/app-config') return { defineAppConfig: (c: unknown) => c } // 纯 identity stub
    if (id.startsWith('.')) {
      // 相对子模块：优先真实模块解析（.cjs/.js 等）；失败按 .ts/.mts 子模块处理
      let resolved = ''
      try {
        resolved = req.resolve(id)
      } catch {
        const cand = [path.resolve(dir, id), path.resolve(dir, `${id}.ts`), path.resolve(dir, `${id}.mts`)]
        for (const c of cand) if (fs.existsSync(c)) { resolved = c; break }
      }
      if (!resolved) throw new Error(`相对子模块解析失败：${id}（自 ${dir}）`)
      if (/\.(ts|mts|tsx)$/.test(resolved)) return loadTsModule(resolved)
      const m = req(resolved)
      return m?.default ?? m
    }
    const resolved = req.resolve(id) // 包名（含 workspace/内部包）——自 dir 向上
    const m = req(resolved)
    return m?.default ?? m
  }
  new Function('module', 'exports', 'require', '__dirname', '__filename', code)(mod, mod.exports, fileRequire, dir, file)
  return mod.exports.default
}
