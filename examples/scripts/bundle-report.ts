// scripts/bundle-report.ts
// 主包体积预算仪表（v0.4）+ ★module-plan B7a：分包体积监控（M7.6）—— 构建期统计 + 阈值门禁
// 运行：tsx scripts/bundle-report.ts（build:mp 链尾）
// 反黑盒：体积报告结构化输出（Top N 大文件），超预算警告 / strict 失败；分包超限（微信单包 2MB）error 阻断
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import config from '../proteus.config'
// ★module-plan B7a/B8：分包体积统计/阈值评估抽到 @proteus/module（bundle-report 与 CLI audit 共用）
import { scanSubPackages, evaluateSubPackageSizes } from '@proteus/module'
import type { SubPackageStat } from '@proteus/module'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'dist', 'mp-weixin')

export interface BundleStat {
  totalBytes: number
  files: Array<{ file: string; bytes: number }>
}

export { scanSubPackages, evaluateSubPackageSizes }
export type { SubPackageStat }

/** ★B7a：分包体积门禁（console 渲染；超硬限 → error 退出码 1；超阈值 → 警告）——返回是否阻断 */
export function checkSubPackageLimits(subPackages: SubPackageStat[]): boolean {
  const issues = evaluateSubPackageSizes(subPackages)
  let blocked = false
  for (const msg of issues) {
    if (msg.includes('超过微信单包限制') || msg.includes('超过微信限制')) {
      console.error(`[proteus] ❌ ${msg}`)
      blocked = true
    } else {
      console.warn(`[proteus] ⚠ ${msg}`)
    }
  }
  return blocked
}

/** 统计主包文件体积（纯函数，可单测）：排除分包 root 前缀 + 隐藏调试目录 */
export function scanMainPackage(outDir: string, subPackageRoots: string[]): BundleStat {
  const files: Array<{ file: string; bytes: number }> = []
  let total = 0
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      const rel = path.relative(outDir, full).replace(/\\/g, '/')
      // 分包文件不属于主包
      if (subPackageRoots.some((r) => rel === r || rel.startsWith(`${r}/`))) continue
      if (entry.isDirectory()) walk(full)
      else {
        const bytes = fs.statSync(full).size
        files.push({ file: rel, bytes })
        total += bytes
      }
    }
  }
  walk(outDir)
  files.sort((a, b) => b.bytes - a.bytes)
  return { totalBytes: total, files }
}

/** 渲染体积报告（纯函数，可单测）——主包 + ★B7a 各分包行 */
export function formatBundleReport(stat: BundleStat, budgetKB: number, strict: boolean, subPackages: SubPackageStat[] = []): string {
  const kb = stat.totalBytes / 1024
  const top = stat.files
    .slice(0, 5)
    .map((f) => `  ${(f.bytes / 1024).toFixed(1).padStart(7)} KB  ${f.file}`)
    .join('\n')
  const subLines = subPackages
    .map((sp) => {
      const skb = sp.totalBytes / 1024
      const flag = skb > 2048 ? '❌超限' : skb > 1536 ? '⚠超阈值' : ''
      return `  ${skb.toFixed(0).padStart(6)} KB  分包 ${sp.root}${flag ? ` ${flag}` : ''}`
    })
    .join('\n')
  return [
    `[proteus] 主包体积：${kb.toFixed(0)} KB（${(kb / 1024).toFixed(2)} MB），预算 ${budgetKB} KB${strict ? '（strict，超限失败）' : ''}`,
    subLines ? `分包体积（阈值 1536KB 警告 / 2048KB 微信硬限）：\n${subLines}` : '',
    top ? `Top 5 大文件：\n${top}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function main(): void {
  // 分包产物路径：源码 root（examples/subpackages/order）去掉 appDir 前缀（examples/）→ subpackages/order
  const appDir = path.dirname(config.pagesDir)
  const roots = (config.subPackages ?? []).map((sp) => sp.root.replace(`${appDir}/`, ''))
  const stat = scanMainPackage(OUT_DIR, roots)
  const subPackages = scanSubPackages(OUT_DIR, roots)
  // budget 可选（拆包步骤 5：ProteusConfig 归包后为可选段，缺省走 roadmap 目标值）
  const budget = config.budget ?? { mainPackageKB: 1200, strict: false }
  console.log(formatBundleReport(stat, budget.mainPackageKB, budget.strict, subPackages))
  // ★B7a：分包体积门禁（微信硬限 error 阻断）
  if (checkSubPackageLimits(subPackages)) process.exitCode = 1
  const kb = stat.totalBytes / 1024
  if (kb > budget.mainPackageKB) {
    const msg = `⚠ 主包 ${kb.toFixed(0)} KB 超过预算 ${budget.mainPackageKB} KB（微信上限 2048 KB）——考虑分包 / 按需注入`
    if (budget.strict) {
      console.error(`[proteus] ${msg}`)
      process.exitCode = 1
    } else {
      console.warn(`[proteus] ${msg}`)
    }
  }
}

main()
