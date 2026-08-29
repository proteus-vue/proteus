// packages/cli/src/config-check.ts
// ★types-plan B5：proteus config:check —— 加载 proteus.config.ts（esbuild transform + Function 注入 eval）→ validateConfig → 报告
// 对齐 capabilities 描述文件加载模式（@proteus/plugin-vite import 剥离——配置为类型/纯数据，无运行时框架依赖）
import fs from 'node:fs'
import path from 'node:path'
import { transform } from 'esbuild'
import { validateConfig } from './config-validate'
import type { ConfigValidationResult } from './config-validate'

/** 加载 TS 配置：transform → CJS → 剥离 @proteus/plugin-vite require → Function eval → 取 .default */
export async function loadTsConfig(file: string): Promise<unknown> {
  const src = fs.readFileSync(file, 'utf-8')
  const { code } = await transform(src, { loader: 'ts', format: 'cjs', platform: 'node', logLevel: 'silent' })
  // 剥离 @proteus/plugin-vite require 行（config 文件只应类型引用；运行时无框架依赖）
  const finalCode = code
    .split('\n')
    .filter((l) => !l.includes("require('@proteus/plugin-vite')") && !l.includes('require("@proteus/plugin-vite")'))
    .join('\n')
  const mod: { exports: Record<string, unknown> } = { exports: {} }
  const fileRequire = (id: string): unknown => {
    // 相对路径 require（配置内如引本地 JSON）：基于文件目录解析
    if (id.startsWith('.')) return require(path.resolve(path.dirname(file), id))
    throw new Error(`配置引用了运行时依赖 ${id}（仅允许类型导入与本地相对导入）`)
  }
  new Function('module', 'exports', 'require', finalCode)(mod, mod.exports, fileRequire)
  return mod.exports.default
}

/** config:check 纯函数入口：加载 + 校验 + 报告 */
export async function checkConfigFile(file: string): Promise<{ result: ConfigValidationResult; text: string }> {
  if (!fs.existsSync(file)) throw new Error(`配置文件不存在：${file}`)
  const config = await loadTsConfig(file)
  const result = validateConfig(config)
  const lines = [`[proteus-config] 校验 ${file}：${result.ok ? '✅ 通过' : `❌ ${result.errors.length} 处错误`}`]
  if (!result.ok) {
    for (const e of result.errors) lines.push(`  [${e.code}] ${e.path || '(root)'}: ${e.message}`)
  }
  return { result, text: lines.join('\n') }
}
