// tests/bundle-report.test.ts
// v0.4 包体积预算仪表：主包扫描（排除分包/隐藏目录）+ 报告渲染（纯函数）
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scanMainPackage, formatBundleReport } from '../examples/scripts/bundle-report'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-bundle-'))

function write(dir: string, rel: string, size: number): void {
  const full = path.join(dir, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, Buffer.alloc(size, 1))
}

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
