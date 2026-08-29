// packages/cli/src/module-duplicates.ts
// ★module-plan B7b（M7.2 共享依赖去重）：产物级重复检测——同一文件（hash 相同）出现在 ≥2 分包 → 报告
//   设计：读 dist/mp-weixin/app.json 的 subPackages[].root（产物自描述，零配置）；
//   主包 common（B0 共享模块独立产物 + require 同路径天然去重）不参与检测——只检测分包间拷贝重复
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export interface DuplicateEntry {
  hash: string
  size: number
  /** 出现在哪些分包（含文件相对分包路径） */
  files: Array<{ pkg: string; file: string }>
}

/** 从 app.json 读分包 roots（纯函数） */
export function readSubPackageRoots(distDir: string): string[] {
  const appJsonPath = path.join(distDir, 'app.json')
  if (!fs.existsSync(appJsonPath)) return []
  try {
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf-8')) as { subPackages?: Array<{ root: string }> }
    return (appJson.subPackages ?? []).map((sp) => sp.root)
  } catch {
    return []
  }
}

/** 扫描分包间重复文件（hash 去重；纯函数可测）——仅统计 .js/.wxml/.wxss/.json（四件套），忽略隐藏 */
export function scanDuplicateModules(distDir: string, subPackageRoots: string[]): DuplicateEntry[] {
  const seen = new Map<string, DuplicateEntry>()
  for (const root of subPackageRoots) {
    const dir = path.join(distDir, root)
    if (!fs.existsSync(dir)) continue
    const walk = (d: string): void => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue
        const full = path.join(d, entry.name)
        if (entry.isDirectory()) {
          walk(full)
          continue
        }
        if (!/\.(js|wxml|wxss|json)$/.test(entry.name)) continue
        const rel = path.relative(dir, full).replace(/\\/g, '/')
        const buf = fs.readFileSync(full)
        const hash = crypto.createHash('md5').update(buf).digest('hex')
        const entry2 = seen.get(hash) ?? { hash, size: buf.length, files: [] }
        entry2.files.push({ pkg: root, file: rel })
        seen.set(hash, entry2)
      }
    }
    walk(dir)
  }
  return [...seen.values()].filter((e) => e.files.length > 1).sort((a, b) => b.size - a.size)
}

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
