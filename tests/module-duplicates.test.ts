// tests/module-duplicates.test.ts
// ★module-plan B7b（M7.2 共享依赖去重）：分包间重复文件检测（hash 去重，产物级）
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readSubPackageRoots, scanDuplicateModules, formatDuplicateReport } from '../packages/cli/src/module-duplicates'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-dup-'))

function write(rel: string, content: string): void {
  const full = path.join(TMP, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
}

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
})

describe('module:duplicates（分包间去重检测）', () => {
  it('readSubPackageRoots：从 app.json 读分包 roots（零配置）', () => {
    write('app.json', JSON.stringify({ pages: ['pages/index'], subPackages: [{ root: 'subpackages/order', name: 'order' }, { root: 'subpackages/user' }] }))
    expect(readSubPackageRoots(TMP)).toEqual(['subpackages/order', 'subpackages/user'])
    expect(readSubPackageRoots(path.join(TMP, 'nope'))).toEqual([])
  })

  it('同一内容出现在 ≥2 分包 → 检出（含文件与分包归属）', () => {
    write('subpackages/order/pages/list.js', 'const a = 1')
    write('subpackages/user/pages/profile.js', 'const a = 1') // 相同内容
    write('subpackages/order/utils.js', 'const b = 2')
    const dups = scanDuplicateModules(TMP, ['subpackages/order', 'subpackages/user'])
    expect(dups.length).toBe(1)
    expect(dups[0].files.some((f) => f.pkg === 'subpackages/order' && f.file === 'pages/list.js')).toBe(true)
    expect(dups[0].files.some((f) => f.pkg === 'subpackages/user' && f.file === 'pages/profile.js')).toBe(true)
  })

  it('不同内容 / 单分包出现 → 零重复', () => {
    const sub = path.join(TMP, 'sub3')
    fs.mkdirSync(sub, { recursive: true })
    write('sub3/subpackages/order/pages/list.js', 'const a = 1')
    write('sub3/subpackages/user/pages/profile.js', 'const b = 2')
    expect(scanDuplicateModules(sub, ['subpackages/order', 'subpackages/user'])).toEqual([])
    write('sub3/subpackages/user2/pages/x.js', 'const a = 1')
    expect(scanDuplicateModules(sub, ['subpackages/order'])).toEqual([])
  })

  it('报告渲染：零重复 / 有重复（含建议）', () => {
    expect(formatDuplicateReport([])).toContain('零重复')
    const text = formatDuplicateReport([{ hash: 'h', size: 1024, files: [{ pkg: 'a', file: 'x.js' }, { pkg: 'b', file: 'x.js' }] }])
    expect(text).toContain('分包间重复文件')
    expect(text).toContain('a/x.js / b/x.js')
    expect(text).toContain('移入主包')
  })
})
