// tests/capabilities.test.ts
// ★platform-plan B1（M1 Capability 契约）：defineCapability 校验 / 注册中心 / useCapability / manifest 扫描
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defineCapability, validateCapabilityDefinition, registerCapability, registerCapabilities, clearCapabilities, useCapability, getCapability, detectPlatform, CapabilityRegistry } from '@proteus-vue/capabilities'
import { walkCapabilityFiles, scanCapabilities } from '../packages/capabilities/src/scan'
import { runCapabilityScan } from '../packages/cli/src/capability-manifest'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-cap-'))

function write(rel: string, content: string): void {
  const full = path.join(TMP, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
}

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
})

describe('defineCapability / validateCapabilityDefinition', () => {
  it('合法描述文件 → 通过；useCapability 平台解析（web adapter）', () => {
    clearCapabilities()
    const def = defineCapability({
      meta: { id: 'clipboard', tier: 2, name: '剪贴板' },
      adapters: {
        web: () => ({ platform: 'web' as const, create: () => ({ isSupported: () => (true as boolean), write: () => 'ok' }) }),
        skyline: () => ({ platform: 'skyline' as const, create: () => ({ isSupported: () => false, write: () => 'ok' }) }),
      },
      fallback: 'share',
    })
    registerCapability(def)
    const cap = useCapability('clipboard', 'web')
    expect(cap.isSupported()).toBe(true)
    expect((cap.api as unknown as { write: () => string }).write()).toBe('ok')
  })

  it('缺失 id / tier / adapters / 未知平台 → 报错', () => {
    expect(validateCapabilityDefinition({ meta: { tier: 2 }, adapters: { web: () => ({}) } }).ok).toBe(false)
    expect(validateCapabilityDefinition({ meta: { id: 'x' }, adapters: { web: () => ({}) } }).ok).toBe(false)
    expect(validateCapabilityDefinition({ meta: { id: 'x', tier: 5 }, adapters: { web: () => ({}) } }).ok).toBe(false)
    expect(validateCapabilityDefinition({ meta: { id: 'x', tier: 2 }, adapters: {} }).ok).toBe(false)
    expect(validateCapabilityDefinition({ meta: { id: 'x', tier: 2 }, adapters: { ios: () => ({}) } }).ok).toBe(false)
  })

  it('重复注册 → 报错；useCapability 未注册/无 adapter → unsupported 降级；required → CapabilityError', () => {
    clearCapabilities()
    registerCapabilities([
      defineCapability({ meta: { id: 'a', tier: 1 }, adapters: { web: () => ({ platform: 'web' as const, create: () => ({ isSupported: () => true }) }) } }),
    ])
    expect(() => registerCapability(defineCapability({ meta: { id: 'a', tier: 1 }, adapters: { web: () => ({ platform: 'web' as const, create: () => ({ isSupported: () => true }) }) } }))).toThrow(/重复注册/)
    // ★B4：未注册/无 adapter → 非 required 返回 unsupported（isSupported false，不崩溃）；required → 抛 CapabilityError（阻断）
    expect(useCapability('ghost', 'web').isSupported()).toBe(false)
    expect(useCapability('a', 'skyline').isSupported()).toBe(false)
    clearCapabilities()
    registerCapabilities([
      defineCapability({ meta: { id: 'req', tier: 3, required: true }, adapters: { web: () => ({ platform: 'web' as const, create: () => ({ isSupported: () => true }) }) } }),
    ])
    expect(() => useCapability('req', 'skyline')).toThrow(/UNSUPPORTED/)
  })

  it('getCapability：无 adapter 平台 → undefined（探测降级）；fallback 解析', () => {
    clearCapabilities()
    registerCapabilities([
      defineCapability({ meta: { id: 'b', tier: 2 }, adapters: { web: () => ({ platform: 'web' as const, create: () => ({ isSupported: () => true }) }) } }),
      defineCapability({ meta: { id: 'c', tier: 2 }, adapters: { web: () => ({ platform: 'web' as const, create: () => ({ isSupported: () => true }) }) }, fallback: 'b' }),
    ])
    expect(getCapability('b', 'app')).toBeUndefined()
    const c = getCapability('c', 'web')
    expect(c?.fallback?.meta.id).toBe('b')
  })

  it('detectPlatform：无 wx/window 环境 → web', () => {
    expect(detectPlatform()).toBe('web')
  })
})

describe('CapabilityRegistry.snapshot（★M8 设备面板能力表数据源）', () => {
  it('按当前平台逐项探测：supported/required/fallback/priority/runsInWorklet/platforms + 字母序', () => {
    const registry = new CapabilityRegistry()
    registry.register({ capability: 'clipboard', platform: 'web', priority: 1, runsInWorklet: true, isSupported: () => true, create: () => ({ isSupported: () => true }) })
    registry.register({ capability: 'clipboard', platform: 'skyline', isSupported: () => false, create: () => ({ isSupported: () => false }) })
    registry.register({ capability: 'worklet-anim', platform: 'skyline', isSupported: () => true, create: () => ({ isSupported: () => true }) })
    registry.registerFallback('clipboard', 'share')
    registry.registerRequired('clipboard', true)
    const snap = registry.snapshot('web')
    const clip = snap.find((s) => s.capability === 'clipboard')
    expect(clip?.supported).toBe(true)
    expect(clip?.required).toBe(true)
    expect(clip?.fallback).toBe('share')
    expect(clip?.priority).toBe(1)
    expect(clip?.runsInWorklet).toBe(true)
    expect(clip?.platforms).toEqual(['web', 'skyline'])
    // skyline-only 能力在当前平台（web）→ supported false
    expect(snap.find((s) => s.capability === 'worklet-anim')?.supported).toBe(false)
    // 字母序
    expect(snap.map((s) => s.capability)).toEqual(['clipboard', 'worklet-anim'])
  })
})

describe('capabilities:manifest（描述文件扫描）', () => {
  it('扫描 capabilities/*.capability.ts → manifest（id/tier/platforms/fallback）', async () => {
    write('capabilities/clipboard.capability.ts', `import { defineCapability } from '@proteus-vue/capabilities'\nexport default defineCapability({ meta: { id: 'clipboard', tier: 2, name: '剪贴板' }, adapters: { web: () => ({ platform: 'web', create: () => ({ isSupported: () => true }) }), skyline: () => ({ platform: 'skyline', create: () => ({ isSupported: () => false }) }) }, fallback: 'share' })\n`)
    write('capabilities/broken.capability.ts', `import { defineCapability } from '@proteus-vue/capabilities'\nexport default defineCapability({ meta: { tier: 2 }, adapters: {} })\n`)
    const { manifest, files } = await scanCapabilities(TMP)
    expect(files.some((f) => f.file.includes('clipboard') && f.ok)).toBe(true)
    expect(files.some((f) => f.file.includes('broken') && !f.ok)).toBe(true)
    const clip = manifest.capabilities.find((c) => c.id === 'clipboard')
    expect(clip?.tier).toBe(2)
    expect(clip?.platforms).toEqual(['web', 'skyline'])
    expect(clip?.fallback).toBe('share')
  })

  it('walkCapabilityFiles 跳过产物目录', async () => {
    write('node_modules/x/x.capability.ts', 'export default {}\n')
    const files = walkCapabilityFiles(TMP)
    expect(files.some((f) => f.includes('node_modules'))).toBe(false)
  })

  it('runCapabilityScan：落盘 capability-manifest.json', async () => {
    const { manifest, text } = await runCapabilityScan(TMP)
    expect(manifest.capabilities.length).toBeGreaterThan(0)
    expect(text).toContain('能力清单')
    const manifestJson = JSON.parse(fs.readFileSync(path.join(TMP, '.proteus/capability-manifest.json'), 'utf-8'))
    expect(manifestJson.capabilities.some((c: { id: string }) => c.id === 'clipboard')).toBe(true)
  })
})
