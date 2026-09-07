// tests/platform-violation.test.ts
// ★platform-plan B5（M5 平台原生模块规范 §6/§7）：禁止清单静态检查——业务目录禁 wx.*/window.*，平台文件防 API 泄漏
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scanPlatformViolations } from '../packages/capabilities/src/check'
import { runCapabilityCheck } from '../packages/cli/src/capability-manifest'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-platcheck-'))

function write(rel: string, content: string): void {
  const full = path.join(TMP, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
}

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
})

describe('scanPlatformViolations（§6 禁止清单静态检查）', () => {
  it('业务目录（pages）含 wx.* 裸调用 → 违规（走 capability）', () => {
    write('pages/home.vue', '<script setup lang="ts">\nwx.setStorageSync("k", 1)\n</script>')
    write('pages/other.vue', '<script setup lang="ts">\nconst w = window.location.href\n</script>')
    const violations = scanPlatformViolations(TMP)
    expect(violations.some((v) => v.file.includes('home') && v.match.includes('wx.'))).toBe(true)
    expect(violations.some((v) => v.file.includes('other') && v.match.includes('window.'))).toBe(true)
  })

  it('平台文件：skyline 文件含 window. → 违规（web API 泄漏）；web 文件含 wx. → 违规', () => {
    write('adapters/clipboard.skyline.ts', 'export const a = window.location.href')
    write('adapters/clipboard.web.ts', 'export const b = wx.getStorageSync("k")')
    const violations = scanPlatformViolations(TMP)
    expect(violations.some((v) => v.file.includes('clipboard.skyline') && v.rule.includes('window.*'))).toBe(true)
    expect(violations.some((v) => v.file.includes('clipboard.web') && v.rule.includes('wx.*'))).toBe(true)
  })

  it('合规：业务零平台 API + 平台文件用本平台 API → 零违规', () => {
    const clean = path.join(TMP, 'clean')
    fs.mkdirSync(clean, { recursive: true })
    write('clean/pages/home.vue', '<script setup lang="ts">const a = ref(1)</script>')
    write('clean/adapters/clipboard.skyline.ts', 'export const c = wx.setClipboardData')
    write('clean/adapters/clipboard.web.ts', 'export const d = navigator.clipboard')
    write('clean/capabilities/x.capability.ts', 'export default {}\n')
    expect(scanPlatformViolations(clean)).toEqual([])
  })

  it('capabilities/adapters/platforms/shims 目录豁免（业务排除段）', () => {
    write('shims/mp.d.ts', 'declare const wx: any')
    const violations = scanPlatformViolations(TMP)
    expect(violations.some((v) => v.file.includes('shims'))).toBe(false)
  })
})

describe('runCapabilityCheck（CLI 输出 + 退出码语义）', () => {
  it('违规 → 输出清单；合规 → 通过', () => {
    const r1 = runCapabilityCheck(TMP)
    expect(r1.violations.length).toBeGreaterThan(0)
    expect(r1.text).toContain('平台原生模块规范违规')
    const clean = path.join(TMP, 'clean')
    const r2 = runCapabilityCheck(clean)
    expect(r2.violations).toEqual([])
    expect(r2.text).toContain('✅ 通过')
  })
})
