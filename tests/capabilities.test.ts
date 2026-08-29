// tests/capabilities.test.ts
// ★platform-plan B1（M1 Capability 契约）：defineCapability 校验 / 注册中心 / useCapability / manifest 扫描
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defineCapability, validateCapabilityDefinition, registerCapability, registerCapabilities, clearCapabilities, useCapability, getCapability, detectPlatform } from '../packages/capabilities/src'
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
        web: () => ({ platform: 'web' as const, create: () => ({ isSupported: () => true, write: () => 'ok' }) }),
        skyline: () => ({ platform: 'skyline' as const, create: () => ({ isSupported: () => false }) }),
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

  it('重复注册 → 报错；useCapability 未注册/无 adapter → 显式失败', () => {
    clearCapabilities()
    registerCapabilities([
      defineCapability({ meta: { id: 'a', tier: 1 }, adapters: { web: () => ({ platform: 'web' as const, create: () => ({ isSupported: () => true }) }) } }),
    ])
    expect(() => registerCapability(defineCapability({ meta: { id: 'a', tier: 1 }, adapters: { web: () => ({ platform: 'web' as const, create: () => ({ isSupported: () => true }) }) } }))).toThrow(/重复注册/)
    expect(() => useCapability('ghost', 'web')).toThrow(/不可用/)
    // skyline 无 adapter → 显式失败
    expect(() => useCapability('a', 'skyline')).toThrow(/不可用/)
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

describe('capabilities:manifest（描述文件扫描）', () => {
  it('扫描 capabilities/*.capability.ts → manifest（id/tier/platforms/fallback）', async () => {
    write('capabilities/clipboard.capability.ts', `import { defineCapability } from '@proteus/capabilities'\nexport default defineCapability({ meta: { id: 'clipboard', tier: 2, name: '剪贴板' }, adapters: { web: () => ({ platform: 'web', create: () => ({ isSupported: () => true }) }), skyline: () => ({ platform: 'skyline', create: () => ({ isSupported: () => false }) }) }, fallback: 'share' })\n`)
    write('capabilities/broken.capability.ts', `import { defineCapability } from '@proteus/capabilities'\nexport default defineCapability({ meta: { tier: 2 }, adapters: {} })\n`)
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
