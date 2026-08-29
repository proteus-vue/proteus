// scripts/bundle-report.ts
// 主包体积预算仪表（v0.4）+ ★module-plan B7a：分包体积监控（M7.6）—— 构建期统计 + 阈值门禁
// 运行：tsx scripts/bundle-report.ts（build:mp 链尾）
// 反黑盒：体积报告结构化输出（Top N 大文件），超预算警告 / strict 失败；分包超限（微信单包 2MB）error 阻断
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import config from '../proteus.config'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'dist', 'mp-weixin')

/** ★M7.6 分包阈值（微信硬限制）：单分包 >1.5MB warn / >2MB error；总分包 >16MB error */
export const SUBPACKAGE_LIMITS = { warnKB: 1536, errorKB: 2048, totalErrorKB: 16384 }

export interface BundleStat {
  totalBytes: number
  files: Array<{ file: string; bytes: number }>
}

export interface SubPackageStat {
  root: string
  totalBytes: number
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

/** ★B7a：统计各分包体积（纯函数，可单测） */
export function scanSubPackages(outDir: string, roots: string[]): SubPackageStat[] {
  return roots.map((root) => {
    let total = 0
    const walk = (d: string): void => {
      if (!fs.existsSync(d)) return
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue
        const full = path.join(d, entry.name)
        if (entry.isDirectory()) walk(full)
        else total += fs.statSync(full).size
      }
    }
    walk(path.join(outDir, root))
    return { root, totalBytes: total }
  })
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
      const flag = skb > SUBPACKAGE_LIMITS.errorKB ? '❌超限' : skb > SUBPACKAGE_LIMITS.warnKB ? '⚠超阈值' : ''
      return `  ${skb.toFixed(0).padStart(6)} KB  分包 ${sp.root}${flag ? ` ${flag}` : ''}`
    })
    .join('\n')
  return [
    `[proteus] 主包体积：${kb.toFixed(0)} KB（${(kb / 1024).toFixed(2)} MB），预算 ${budgetKB} KB${strict ? '（strict，超限失败）' : ''}`,
    subLines ? `分包体积（阈值 ${SUBPACKAGE_LIMITS.warnKB}KB 警告 / ${SUBPACKAGE_LIMITS.errorKB}KB 微信硬限）：\n${subLines}` : '',
    top ? `Top 5 大文件：\n${top}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** ★B7a：分包体积门禁（超硬限 → error 退出码 1；超阈值 → 警告）——返回是否阻断 */
export function checkSubPackageLimits(subPackages: SubPackageStat[]): boolean {
  let blocked = false
  const totalKB = subPackages.reduce((n, sp) => n + sp.totalBytes, 0) / 1024
  if (totalKB > SUBPACKAGE_LIMITS.totalErrorKB) {
    console.error(`[proteus] ❌ 总分包 ${totalKB.toFixed(0)} KB 超过微信限制 ${SUBPACKAGE_LIMITS.totalErrorKB} KB`)
    blocked = true
  }
  for (const sp of subPackages) {
    const skb = sp.totalBytes / 1024
    if (skb > SUBPACKAGE_LIMITS.errorKB) {
      console.error(`[proteus] ❌ 分包 ${sp.root} ${skb.toFixed(0)} KB 超过微信单包限制 ${SUBPACKAGE_LIMITS.errorKB} KB——需拆分或压缩`)
      blocked = true
    } else if (skb > SUBPACKAGE_LIMITS.warnKB) {
      console.warn(`[proteus] ⚠ 分包 ${sp.root} ${skb.toFixed(0)} KB 超过阈值 ${SUBPACKAGE_LIMITS.warnKB} KB`)
    }
  }
  return blocked
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
