// scripts/lib/component-props.mjs —— 框架组件枚举与 props 抽取（共享工具）
//   ★SSOT：组件源码 defineProps 是「组件有哪些属性」的唯一来源。
//   被 scripts/audit-component-attrs.mjs（端对齐标尺）与 scripts/audit-degradation.mjs（EA-5 降级门禁）共用，
//   避免两处各写一份正则导致口径漂移。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
// ★组件库已拆包（2026-09-14）：@proteus-vue/components → packages/components（原仓库根 src/components）
export const COMPONENTS_DIR = path.join(ROOT, 'packages/components')

/** 全部框架组件目录名（p-*，按字母序） */
export function listComponentDirs() {
  if (!fs.existsSync(COMPONENTS_DIR)) return []
  return fs
    .readdirSync(COMPONENTS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('p-'))
    .map((e) => e.name)
    .sort()
}

/**
 * 从框架组件源码抽 props 名（defineProps 块内的 camelCase 键）。
 * @returns {string[] | null} null = 无 index.vue；[] = 有文件但无 defineProps
 */
export function propsOf(dir) {
  const f = path.join(COMPONENTS_DIR, dir, 'index.vue')
  if (!fs.existsSync(f)) return null
  const src = fs.readFileSync(f, 'utf8')
  const m = src.match(/defineProps\(\{([\s\S]*?)\n\}\)/)
  if (!m) return []
  const names = new Set()
  for (const km of m[1].matchAll(/^\s{2}([a-zA-Z][\w]*)\s*:/gm)) names.add(km[1])
  return [...names]
}

/** 全部组件的 {tag, props} 规格（供门禁遍历） */
export function componentSpecs() {
  const out = []
  for (const dir of listComponentDirs()) {
    const props = propsOf(dir)
    if (props) out.push({ tag: dir, props })
  }
  return out
}
