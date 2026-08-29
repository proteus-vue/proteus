// packages/cli/src/module-duplicates.ts
// ★module-plan B7b/B8：proteus module:duplicates —— 分包间共享依赖去重检测（薄壳：纯函数在 @proteus/module）
import { readSubPackageRoots, scanDuplicateModules } from '@proteus/module'
import type { DuplicateEntry } from '@proteus/module'

export { readSubPackageRoots, scanDuplicateModules }

/** 渲染去重报告（纯函数） */
export function formatDuplicateReport(duplicates: DuplicateEntry[]): string {
  if (!duplicates.length) return '[proteus-module] ★共享依赖去重：分包间零重复（B0 共享模块独立产物 + require 同路径天然去重）'
  const lines = ['[proteus-module] ★检测到分包间重复文件（同一内容打包 ≥2 次）：']
  for (const d of duplicates) {
    const kb = (d.size / 1024).toFixed(1)
    const where = d.files.map((f) => `${f.pkg}/${f.file}`).join(' / ')
    lines.push(`  ${kb.padStart(6)} KB  ${where}`)
  }
  lines.push('建议：将共享文件移入主包（B0 自动处理：页面 import 的相对路径共享模块编译到主包 + require 引用）')
  return lines.join('\n')
}
