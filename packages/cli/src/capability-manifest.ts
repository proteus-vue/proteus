// packages/cli/src/capability-manifest.ts
// ★platform-plan B1：proteus capabilities:manifest —— 扫描 capabilities/*.capability.ts → capability-manifest.json
import fs from 'node:fs'
import path from 'node:path'
import { scanCapabilities } from '@proteus/capabilities/scan'
import type { CapabilityManifest } from '@proteus/capabilities/scan'

/** 渲染 manifest 报告（纯函数） */
export function formatCapabilityManifest(manifest: CapabilityManifest, fileReports: Array<{ file: string; ok: boolean; error?: string }>): string {
  if (!manifest.capabilities.length) return '[proteus-capabilities] 未找到 capabilities/*.capability.ts（描述文件规范见 docs/proteus-platform-plan/01-m1-capability-contract.md）'
  const lines = ['[proteus-capabilities] 能力清单：']
  for (const c of manifest.capabilities) {
    lines.push(`  ✅ ${c.id}（L${c.tier}${c.name ? ` · ${c.name}` : ''}）→ ${c.platforms.join('/')}${c.fallback ? `，降级 ${c.fallback}` : ''}`)
  }
  const failed = fileReports.filter((f) => !f.ok)
  for (const f of failed) {
    lines.push(`  ❌ ${f.file}: ${f.error}`)
  }
  lines.push(`[proteus-capabilities] 能力扫描：${manifest.capabilities.length} 个通过${failed.length ? `，${failed.length} 个失败` : ''}`)
  return lines.join('\n')
}

/** scan 主流程（CLI 与测试共用）：扫描 + 落盘 capability-manifest.json */
export async function runCapabilityScan(root: string, outFile?: string): Promise<{ text: string; manifest: CapabilityManifest }> {
  const { manifest, files } = await scanCapabilities(root)
  const text = formatCapabilityManifest(manifest, files)
  const outPath = path.resolve(root, outFile ?? '.proteus/capability-manifest.json')
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n')
  return { text, manifest }
}
