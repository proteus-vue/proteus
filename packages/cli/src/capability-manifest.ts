// packages/cli/src/capability-manifest.ts
// ★platform-plan B1/B3：proteus capabilities:manifest —— 能力清单 + 平台缺失报告 + 业务引用检查（编译期分叉 §7）
import fs from 'node:fs'
import path from 'node:path'
import { scanCapabilities } from '@proteus-vue/capabilities/scan'
import type { CapabilityManifest, ManifestCapabilityEntry } from '@proteus-vue/capabilities/scan'
import { scanCapabilityUsage, checkCapabilityUsage, scanPlatformViolations } from '@proteus-vue/capabilities/check'
import type { PlatformViolation } from '@proteus-vue/capabilities/check'
import { AUTO_GENERATED_MARK, registerGeneratedFile } from './strict-cli'

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
  // ★CLI004 配套：纯 JSON 落盘（保持 JSON.parse 兼容）+ 指纹登记
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n')
  registerGeneratedFile(outPath)
  return { text, manifest, check }
}

/** ★B5 §7：平台原生模块静态检查（禁止清单）——业务目录禁 wx./window 平台 API，平台文件防 API 泄漏 */
export function runCapabilityCheck(root: string): { text: string; violations: PlatformViolation[] } {
  const violations = scanPlatformViolations(root)
  if (!violations.length) return { text: '[proteus-capabilities] 平台原生模块规范检查：✅ 通过（业务零平台 API，wx.* 仅在平台文件）', violations }
  const lines = [`[proteus-capabilities] ❌ 平台原生模块规范违规（${violations.length} 处，B5 §6 禁止清单）：`]
  for (const v of violations) lines.push(`  - ${v.file}: ${v.match}（${v.rule}）`)
  lines.push('修正：业务代码改用 capability/useCapability；平台 API 移到 adapters/*.skyline.ts / platforms/（见 docs/proteus-platform-plan/05-m5-platform-modules.md）')
  return { text: lines.join('\n'), violations }
}
