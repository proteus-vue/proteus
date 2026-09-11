// tests/component-audit-exempt.test.ts
// ★Skyline 线收口批 6：components:audit 豁免模型 + 绕过检测（wx 别名 / globalThis.wx）+ 浏览器观察 API 检测
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { auditComponents } from '../packages/cli/src/component-audit'

let tmp: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-caudit-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

function writeComponent(tag: string, src: string): void {
  const dir = path.join(tmp, tag)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'index.vue'), src)
  // 聚合导出（manifest-complete 需要）
  const idx = path.join(tmp, 'index.ts')
  const prev = fs.existsSync(idx) ? fs.readFileSync(idx, 'utf-8') : ''
  const pascal = tag.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('')
  if (!prev.includes(pascal)) fs.writeFileSync(idx, prev + `import ${pascal} from './${tag}/index.vue'\nexport { ${pascal} }\n`)
}

describe('no-platform-api（含绕过检测）', () => {
  it('wx.* 直调 → 违规', () => {
    writeComponent('p-a', '<script>wx.showToast({})</script>')
    const r = auditComponents(tmp)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.rule === 'no-platform-api')).toBe(true)
  })

  it('★wx 别名变量绕过（const w = wx + w.foo）→ 违规', () => {
    writeComponent('p-b', '<script>const w = wx\nw.createSelectorQuery()</script>')
    const r = auditComponents(tmp)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.message.includes('别名'))).toBe(true)
  })

  it('★globalThis 访问 wx → 违规', () => {
    writeComponent('p-c', '<script>const g = globalThis as {wx?: unknown}\nif (g.wx) {}</script>')
    const r = auditComponents(tmp)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.message.includes('globalThis'))).toBe(true)
  })

  it('整文件豁免 components-allow-platform → 平台 API 不报（但 manifest 仍校验）', () => {
    writeComponent('p-d', '<!-- /* components-allow-platform: MP-only 运行时 */ -->\n<script>wx.createOffscreenCanvas()</script>')
    const r = auditComponents(tmp)
    expect(r.violations.filter((v) => v.rule === 'no-platform-api')).toHaveLength(0)
  })

  it('行内豁免 components-allow-platform（紧邻上一行）→ 该行不报', () => {
    writeComponent('p-e', '<script>\n// components-allow-platform: Web DOM rect\nel.getBoundingClientRect()\n</script>')
    const r = auditComponents(tmp)
    expect(r.violations.filter((v) => v.rule === 'no-browser-observer')).toHaveLength(0)
  })
})

describe('no-browser-observer（★Skyline 新增：MP 无这些 API → 静默失效）', () => {
  it('new ResizeObserver / matchMedia / getBoundingClientRect → 违规', () => {
    writeComponent('p-f', '<script>new ResizeObserver(() => {})\nconst m = matchMedia(\'(min-width:1px)\')</script>')
    const r = auditComponents(tmp)
    expect(r.ok).toBe(false)
    const obsv = r.violations.filter((v) => v.rule === 'no-browser-observer')
    expect(obsv.length).toBeGreaterThanOrEqual(2)
  })
})

describe('no-sync-storage（不受平台豁免影响）', () => {
  it('wx.setStorageSync → 违规（即便整文件平台豁免）', () => {
    writeComponent('p-g', '<!-- /* components-allow-platform: 示例 */ -->\n<script>wx.setStorageSync("k", 1)</script>')
    const r = auditComponents(tmp)
    expect(r.violations.some((v) => v.rule === 'no-sync-storage')).toBe(true)
  })
})

describe('manifest-complete（双向一致）', () => {
  it('组件目录未在 index.ts 导出 → 违规', () => {
    fs.mkdirSync(path.join(tmp, 'p-orphan'), { recursive: true })
    fs.writeFileSync(path.join(tmp, 'p-orphan/index.vue'), '<template><div/></template>')
    fs.writeFileSync(path.join(tmp, 'index.ts'), '// empty')
    const r = auditComponents(tmp)
    expect(r.violations.some((v) => v.rule === 'manifest-complete')).toBe(true)
  })
})
