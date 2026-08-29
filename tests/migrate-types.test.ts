// tests/migrate-types.test.ts
// ★types-plan B7：配置迁移 codemod（version 注入 / 重命名映射 / 幂等 / dry-run）
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { migrateConfigText, migrateTypesFile } from '../packages/cli/src/migrate-types'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-migrate-types-'))
afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
})

describe('migrateConfigText（codemod 规则集）', () => {
  it('无 version 配置 → 注入 version: 2（首行）', () => {
    const src = 'export default defineConfig({\n  platform: "mp-weixin",\n})\n'
    const out = migrateConfigText(src)
    expect(out).toContain('version: 2')
    expect(out.indexOf('version: 2')).toBeLessThan(out.indexOf('platform'))
  })

  it('幂等：跑两次结果一致', () => {
    const src = 'export default defineConfig({\n  platform: "mp-weixin",\n})\n'
    const once = migrateConfigText(src)
    expect(migrateConfigText(once)).toBe(once)
  })

  it('已有 version → 不重复注入', () => {
    const src = 'export default defineConfig({\n  version: 2,\n  platform: "mp-weixin",\n})\n'
    expect(migrateConfigText(src)).toBe(src)
  })

  it('重命名映射：router.transitions → router.animation', () => {
    const src = 'export default defineConfig({\n  router: {\n    transitions: ["slideUp"],\n  },\n})\n'
    const out = migrateConfigText(src)
    expect(out).not.toContain('transitions:')
    expect(out).toContain('animation:')
  })

  it('export default 对象形态（无 defineConfig）也能注入', () => {
    const src = 'export default {\n  platform: "web",\n}\n'
    expect(migrateConfigText(src)).toContain('version: 2')
  })
})

describe('migrateTypesFile（写回 + dry-run）', () => {
  it('写回文件 + changed 标记；dry-run 不写盘', () => {
    const f = path.join(TMP, 'config.ts')
    fs.writeFileSync(f, 'export default defineConfig({\n  platform: "mp-weixin",\n})\n')
    const r = migrateTypesFile(f, true) // dry-run
    expect(r.changed).toBe(true)
    expect(fs.readFileSync(f, 'utf-8')).not.toContain('version') // 未写盘
    const w = migrateTypesFile(f) // 写回
    expect(w.changed).toBe(true)
    expect(fs.readFileSync(f, 'utf-8')).toContain('version: 2')
    // 再次 → 无需迁移
    const again = migrateTypesFile(f)
    expect(again.changed).toBe(false)
  })
})
