// tests/bundle-report.test.ts
// v0.4 包体积预算仪表 + ★module-plan B7a（M7.6）：分包体积扫描 / 阈值门禁（纯函数）
import { describe, it, expect, vi, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scanMainPackage, formatBundleReport, scanSubPackages, checkSubPackageLimits } from '../examples/scripts/bundle-report'
// ★B8：体积阈值常量抽到 @proteus-vue/module（bundle-report 不再导出）
import { SUBPACKAGE_LIMITS } from '../packages/module/src'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-bundle-'))

function write(dir: string, rel: string, size: number): void {
  const full = path.join(dir, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, Buffer.alloc(size, 1))
}

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
})

describe('bundle-report（主包体积预算仪表）', () => {
  it('统计主包体积：排除分包与隐藏目录', () => {
    write(TMP, 'app.js', 100)
    write(TMP, 'pages/index.js', 500)
    write(TMP, 'pages/index.wxml', 100)
    write(TMP, 'subpackages/order/pages/list.js', 2000) // 分包
    write(TMP, '.transform-debug/pages/index.json', 999) // 调试目录
    const stat = scanMainPackage(TMP, ['subpackages/order'])
    expect(stat.totalBytes).toBe(700) // 100 + 500 + 100（分包与调试排除）
    expect(stat.files[0].file).toBe('pages/index.js')
  })

  it('报告渲染：体积汇总 + Top 大文件 + 预算标记', () => {
    const stat = { totalBytes: 1536, files: [{ file: 'a.js', bytes: 1024 }, { file: 'b.js', bytes: 512 }] }
    const text = formatBundleReport(stat, 1200, true)
    expect(text).toContain('主包体积：2 KB')
    expect(text).toContain('预算 1200 KB（strict，超限失败）')
    expect(text).toContain('Top 5 大文件')
    expect(text).toContain('a.js')
  })
})

describe('★module-plan B7a：分包体积监控（M7.6）', () => {
  it('扫描各分包体积', () => {
    write(TMP, 'subpackages/order/pages/list.js', 2000)
    write(TMP, 'subpackages/user/pages/profile.js', 1000)
    const stats = scanSubPackages(TMP, ['subpackages/order', 'subpackages/user'])
    expect(stats.find((s) => s.root === 'subpackages/order')?.totalBytes).toBe(2000)
    expect(stats.find((s) => s.root === 'subpackages/user')?.totalBytes).toBe(1000)
  })

  it('报告渲染：分包体积行 + 阈值标记', () => {
    const stat = { totalBytes: 0, files: [] }
    const text = formatBundleReport(stat, 1200, false, [
      { root: 'subpackages/order', totalBytes: SUBPACKAGE_LIMITS.errorKB * 1024 + 1 },
      { root: 'subpackages/user', totalBytes: 1024 },
    ])
    expect(text).toContain('分包体积')
    expect(text).toContain('❌超限')
  })

  it('门禁：单分包超微信硬限（2MB）→ 阻断；超阈值（1.5MB）→ 警告不阻断', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(checkSubPackageLimits([{ root: 'a', totalBytes: SUBPACKAGE_LIMITS.errorKB * 1024 + 1 }])).toBe(true)
      expect(errorSpy.mock.calls.some((c) => c[0].includes('超过微信单包限制'))).toBe(true)
      expect(checkSubPackageLimits([{ root: 'b', totalBytes: SUBPACKAGE_LIMITS.warnKB * 1024 + 1 }])).toBe(false)
      expect(warnSpy.mock.calls.some((c) => c[0].includes('超过阈值'))).toBe(true)
      expect(checkSubPackageLimits([{ root: 'c', totalBytes: 100 }])).toBe(false)
    } finally {
      errorSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })

  it('门禁：总分包超 16MB → 阻断', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(checkSubPackageLimits([{ root: 'a', totalBytes: SUBPACKAGE_LIMITS.totalErrorKB * 1024 }])).toBe(true)
    } finally {
      errorSpy.mockRestore()
    }
  })
})
