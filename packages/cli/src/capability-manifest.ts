// packages/cli/src/capability-manifest.ts
// ★platform-plan B1/B3：proteus capabilities:manifest —— 能力清单 + 平台缺失报告 + 业务引用检查（编译期分叉 §7）
import fs from 'node:fs'
import path from 'node:path'
import { scanCapabilities } from '@proteus/capabilities/scan'
import type { CapabilityManifest, ManifestCapabilityEntry } from '@proteus/capabilities/scan'
import { scanCapabilityUsage, checkCapabilityUsage } from '@proteus/capabilities/check'

/** 渲染 manifest 报告（纯函数；--platform 时追加缺失报告） */
export function formatCapabilityManifest(
  manifest: CapabilityManifest,
  fileReports: Array<{ file: string; ok: boolean; error?: string }>,
  check?: { platform: 'web' | 'skyline' | 'app'; missing: Array<{ id: string; usedBy: string[] }>; gaps: ManifestCapabilityEntry[] },
): string {
  if (!manifest.capabilities.length) return '[proteus-capabilities] 未找到 capabilities/*.capability.ts（描述文件规范见 docs/proteus-platform-plan/01-m1-capability-contract.md）'
  const lines = ['[proteus-capabilities] 能力清单：']
  for (const c of manifest.capabilities) {
    lines.push(`  ✅ ${c.id}（L${c.tier}${c.name ? ` · ${c.name}` : ''}）→ ${c.platforms.join('/')}${c.fallback ? `，降级 ${c.fallback}` : ''}（${c.source}）`)
  }
  const failed = fileReports.filter((f) => !f.ok)
  for (const f of failed) {
    lines.push(`  ❌ ${f.file}: ${f.error}`)
  }
  if (check) {
    // ★B3：平台缺失报告（编译期可见）
    if (check.gaps.length) {
      lines.push(`\n[proteus-capabilities] ★能力缺失报告（${check.platform}）：${check.gaps.map((g) => g.id).join('、') || '—'}（该平台无 adapter——业务引用将编译期警告）`)
    }
    if (check.missing.length) {
      for (const m of check.missing) {
        lines.push(`  ⚠ 业务引用 "${m.id}" 在 ${check.platform} 不可用：${m.usedBy.join('、')}（请降级/改用可用能力）`)
      }
    } else if (check.gaps.length === 0) {
      lines.push(`\n[proteus-capabilities] ${check.platform} 能力全覆盖：业务引用全部可用 ✅`)
    }
  }
  lines.push(`[proteus-capabilities] 能力扫描：${manifest.capabilities.length} 个通过${failed.length ? `，${failed.length} 个失败` : ''}`)
  return lines.join('\n')
}

/** scan 主流程（CLI 与测试共用）：扫描 + 可选平台检查 + 落盘 capability-manifest.json */
export async function runCapabilityScan(root: string, outFile?: string, platform?: 'web' | 'skyline' | 'app'): Promise<{ text: string; manifest: CapabilityManifest; check?: { platform: 'web' | 'skyline' | 'app'; missing: Array<{ id: string; usedBy: string[] }>; gaps: ManifestCapabilityEntry[] } }> {
  const { manifest, files } = await scanCapabilities(root)
  let check: { platform: 'web' | 'skyline' | 'app'; missing: Array<{ id: string; usedBy: string[] }>; gaps: ManifestCapabilityEntry[] } | undefined
  if (platform) {
    const usages = scanCapabilityUsage(root)
    const result = checkCapabilityUsage(manifest, usages, platform)
    check = { platform, missing: result.missing, gaps: result.gaps }
  }
  const text = formatCapabilityManifest(manifest, files, check)
  const outPath = path.resolve(root, outFile ?? '.proteus/capability-manifest.json')
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n')
  return { text, manifest, check }
}
