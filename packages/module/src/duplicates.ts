// packages/module/src/duplicates.ts
// ★module-plan B7b/B8：分包间共享依赖去重检测（M7.2）——产物级 hash 检测（读 app.json 分包 roots，零配置）
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

/** 扫描分包间重复文件（hash 去重；纯函数可测）——仅统计四件套，忽略隐藏 */
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
