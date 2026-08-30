// tests/capability-check.test.ts
// ★platform-plan B3（M3 编译期分叉 §7）：业务 useCapability 引用扫描 + 平台缺失报告（编译期可见）
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scanCapabilityUsage, checkCapabilityUsage } from '../packages/capabilities/src/check'
import type { CapabilityManifest } from '../packages/capabilities/src/scan'
import { runCapabilityScan } from '../packages/cli/src/capability-manifest'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-capcheck-'))

function write(rel: string, content: string): void {
  const full = path.join(TMP, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
}

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
})

describe('scanCapabilityUsage（业务引用扫描）', () => {
  it('扫描 .vue/.ts 的 useCapability/resolveCapability 调用（含泛型形态）', () => {
    write('pages/home.vue', '<script setup lang="ts">\nconst share = useCapability("share")\nconst bio = resolveCapability<BioAPI>("bio")\n</script>')
    write('utils/x.ts', 'const clip = useCapability(\'clipboard\')')
    write('pages/other.vue', '<script setup lang="ts">const a = ref(1)</script>')
    const usages = scanCapabilityUsage(TMP)
    expect(usages.length).toBe(2)
    const home = usages.find((u) => u.file.includes('home'))
    expect(home?.ids).toEqual(['share', 'bio'])
    const util = usages.find((u) => u.file.includes('utils/x.ts'))
    expect(util?.ids).toEqual(['clipboard'])
  })
})

describe('checkCapabilityUsage / runCapabilityScan（平台缺失报告）', () => {
  const manifest: CapabilityManifest = {
    capabilities: [
      { id: 'share', tier: 2, platforms: ['web', 'skyline'], source: 'capabilities/share.capability.ts' },
      { id: 'bio', tier: 3, platforms: ['web'], source: 'capabilities/bio.capability.ts' },
    ],
  }

  it('业务引用缺失：当前平台无 adapter → missing 检出（含使用方）', () => {
    const usages = [{ file: 'pages/home.vue', ids: ['share', 'bio'] }]
    const r = checkCapabilityUsage(manifest, usages, 'skyline')
    expect(r.missing).toEqual([{ id: 'bio', usedBy: ['pages/home.vue'] }])
    expect(r.gaps.map((g) => g.id)).toEqual(['bio'])
  })

  it('全覆盖 → missing 空', () => {
    const usages = [{ file: 'pages/home.vue', ids: ['share'] }]
    const r = checkCapabilityUsage(manifest, usages, 'web')
    expect(r.missing).toEqual([])
    expect(r.gaps).toEqual([])
  })

  it('runCapabilityScan --platform：缺失报告入输出 + manifest 含 source', async () => {
    write('capabilities/share.capability.ts', `import { defineCapability } from '@proteus-vue/capabilities'\nexport default defineCapability({ meta: { id: 'share', tier: 2 }, adapters: { web: () => ({ platform: 'web', create: () => ({ isSupported: () => true }) }), skyline: () => ({ platform: 'skyline', create: () => ({ isSupported: () => true }) }) } })\n`)
    write('capabilities/bio.capability.ts', `import { defineCapability } from '@proteus-vue/capabilities'\nexport default defineCapability({ meta: { id: 'bio', tier: 3 }, adapters: { web: () => ({ platform: 'web', create: () => ({ isSupported: () => true }) }) } })\n`)
    write('pages/home.vue', '<script setup lang="ts">\nconst bio = useCapability("bio")\n</script>')
    const { text, manifest: m, check } = await runCapabilityScan(TMP, undefined, 'skyline')
    expect(m.capabilities.every((c) => c.source)).toBe(true)
    expect(check?.missing.some((x) => x.id === 'bio')).toBe(true)
    expect(text).toContain('能力缺失报告（skyline）')
    expect(text).toContain('业务引用 "bio" 在 skyline 不可用')
  })
})
