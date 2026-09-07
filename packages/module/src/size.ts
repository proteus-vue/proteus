// packages/module/src/size.ts
// ★module-plan B7a/B8：分包体积统计 + 阈值评估（M7.6）——纯函数，bundle-report / audit 共用
import fs from 'node:fs'
import path from 'node:path'

export const SUBPACKAGE_LIMITS = { warnKB: 1536, errorKB: 2048, totalErrorKB: 16384 }

export interface SubPackageStat {
  root: string
  totalBytes: number
}

/** 统计各分包体积（纯函数） */
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

/** 分包体积违规评估（收集式，纯函数；audit/bundle-report 各自渲染）——返回违规描述 */
export function evaluateSubPackageSizes(subPackages: SubPackageStat[]): string[] {
  const issues: string[] = []
  const totalKB = subPackages.reduce((n, sp) => n + sp.totalBytes, 0) / 1024
  if (totalKB > SUBPACKAGE_LIMITS.totalErrorKB) {
    issues.push(`总分包 ${totalKB.toFixed(0)} KB 超过微信限制 ${SUBPACKAGE_LIMITS.totalErrorKB} KB`)
  }
  for (const sp of subPackages) {
    const skb = sp.totalBytes / 1024
    if (skb > SUBPACKAGE_LIMITS.errorKB) {
      issues.push(`分包 ${sp.root} ${skb.toFixed(0)} KB 超过微信单包限制 ${SUBPACKAGE_LIMITS.errorKB} KB——需拆分或压缩`)
    } else if (skb > SUBPACKAGE_LIMITS.warnKB) {
      issues.push(`分包 ${sp.root} ${skb.toFixed(0)} KB 超过阈值 ${SUBPACKAGE_LIMITS.warnKB} KB`)
    }
  }
  return issues
}
