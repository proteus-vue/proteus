// packages/capabilities/src/scan.ts
// ★platform-plan B1（M1 §6 编译期契约）：扫描 capabilities/*.capability.ts → capability-manifest.json
// 描述文件可静态扫描（adapters 键 = 平台集合）；CLI capabilities:manifest 与测试共用
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { transform } from 'esbuild'
import { validateCapabilityDefinition, registerCapability, defineCapability as defineCapabilityFromIndex, hasCapability } from './index'
import type { CapabilityDefinition, CapabilityPlatform } from './types'

export interface ManifestCapabilityEntry {
  id: string
  tier: number
  name?: string
  platforms: CapabilityPlatform[]
  fallback?: string
  /** 描述文件路径（相对扫描根；产物可追溯铁律） */
  source: string
}

export interface CapabilityManifest {
  capabilities: ManifestCapabilityEntry[]
}

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.proteus', '.transform-debug', 'coverage'])

/** 递归收集 capabilities/*.capability.ts（跳过产物目录） */
export function walkCapabilityFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkCapabilityFiles(full, acc)
    else if (entry.name.endsWith('.capability.ts')) acc.push(full)
  }
  return acc
}

/**
 * 加载能力描述文件：esbuild transform 转 CJS → 去 @proteus-vue/capabilities require 行 →
 * eval（defineCapability 由 Function 参数注入，与 validate 同源；require 基目录 = 描述文件所在目录）
 */
export async function loadCapabilityFile(file: string): Promise<CapabilityDefinition> {
  const src = fs.readFileSync(file, 'utf-8')
  const { code } = await transform(src, { loader: 'ts', format: 'cjs', platform: 'node', logLevel: 'silent' })
  const finalCode = code
    .replace(/^[^\n]*require\(['"]@proteus-vue\/capabilities['"]\)[^\n]*$/gm, '')
    .replace(/\bimport_[a-zA-Z0-9_$]*\.defineCapability\b/g, 'defineCapability')
  const mod = { exports: {} as Record<string, unknown> }
  const fileRequire = createRequire(pathToFileURL(file))
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', 'defineCapability', finalCode)(mod, mod.exports, fileRequire, defineCapabilityFromIndex)
  const value = (mod.exports as { default?: unknown }).default ?? mod.exports
  const result = validateCapabilityDefinition(value)
  if (!result.ok) {
    const detail = result.errors.map((e) => `  - ${e.field}: ${e.message}`).join('\n')
    throw new Error(`[proteus-capabilities] 描述文件校验失败（${file}）：\n${detail}`)
  }
  return result.value
}

/** 扫描 + 汇总 manifest（纯 async 函数；注册进 registry 供后续批次使用） */
export async function scanCapabilities(root: string): Promise<{ manifest: CapabilityManifest; files: Array<{ file: string; ok: boolean; error?: string }> }> {
  const files = walkCapabilityFiles(root)
  const entries: ManifestCapabilityEntry[] = []
  const fileReports: Array<{ file: string; ok: boolean; error?: string }> = []
  for (const file of files) {
    try {
      const def = await loadCapabilityFile(file)
      // 幂等注册（scan 可重复执行；业务侧 registerCapability 仍保持全局唯一硬校验）
      if (!hasCapability(def.meta.id)) registerCapability(def)
      entries.push({
        id: def.meta.id,
        tier: def.meta.tier,
        name: def.meta.name,
        platforms: Object.keys(def.adapters) as CapabilityPlatform[],
        fallback: def.fallback,
        source: path.relative(root, file).replace(/\\/g, '/'),
      })
      fileReports.push({ file: path.relative(root, file).replace(/\\/g, '/'), ok: true })
    } catch (err) {
      fileReports.push({ file: path.relative(root, file).replace(/\\/g, '/'), ok: false, error: (err as Error).message })
    }
  }
  return { manifest: { capabilities: entries.sort((a, b) => a.id.localeCompare(b.id)) }, files: fileReports }
}
