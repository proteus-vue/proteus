// packages/cli/src/config-loader.ts
// ★#418 配置收敛完整性：proteus dev/build 的配置加载器（宽松版）——
//   proteus.config.ts 的 vite 透传字段需要承载真实 vite 插件（函数对象），配置必须允许运行时 import
//   （与 config:check 的严格纯数据沙箱分开：check 保留 strict 版禁运行时依赖；dev/build 用本宽松版）
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { transform } from 'esbuild'

/**
 * 加载 proteus.config.ts（宽松）：esbuild TS→CJS → Function 注入执行。
 * 相对导入与包名导入均允许（resolve 自配置所在目录向上）；剥 @proteus-vue/plugin-vite 的
 * 类型引用 require 行（配置仅类型引用该包时无运行时依赖）。返回 default 导出。
 */
export async function loadProjectConfig(file: string): Promise<unknown> {
  const src = fs.readFileSync(file, 'utf-8')
  const { code } = await transform(src, { loader: 'ts', format: 'cjs', platform: 'node', logLevel: 'silent' })
  // 剥离纯类型引用（config 里 `import type { ProteusConfig } from '@proteus-vue/plugin-vite'` 的产物 require 行）
  const finalCode = code
    .split('\n')
    .filter((l) => !l.includes("require('@proteus-vue/plugin-vite')") && !l.includes('require(\"@proteus-vue/plugin-vite\")'))
    .join('\n')
  const mod: { exports: Record<string, unknown> } = { exports: {} }
  const dir = path.dirname(file)
  const req = createRequire(path.join(dir, 'package.json'))
  const fileRequire = (id: string): unknown => {
    if (id === '@proteus-vue/app-config') return { defineAppConfig: (c: unknown) => c } // 纯 identity stub
    const resolved = req.resolve(id) // 包名（含 workspace/内部包）或相对路径均可——自 dir 向上
    const m = req(resolved)
    return m?.default ?? m
  }
  new Function('module', 'exports', 'require', finalCode)(mod, mod.exports, fileRequire)
  return mod.exports.default
}
