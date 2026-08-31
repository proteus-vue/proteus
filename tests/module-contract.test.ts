// tests/module-contract.test.ts
// ★module-plan B1（M1 模块契约）：defineModule + validateModuleConfig + scanModuleConfigs
//   校验：缺失字段报错（含模块名 + 字段 + 原因）/ 非法值 / 自环依赖 / 重名检测
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defineModule, validateModuleConfig, scanModuleConfigs, walkModuleConfigs } from '@proteus-vue/module'
import { checkModuleConfigs } from '../packages/cli/src/module-check'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-module-'))

function writeFixture(rel: string, content: string): void {
  const full = path.join(TMP, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
}

describe('defineModule / validateModuleConfig（契约校验）', () => {
  it('合法配置 → 通过（返回配置）', () => {
    const cfg = defineModule({
      name: 'trade',
      version: '1.2.0',
      dependencies: { user: '^1.0.0', payment: '~2.0.0' },
      exports: { types: ['./types', './models'], interfaces: ['./services/ITradeService'], events: ['./events'], configSchema: './config.schema.json' },
      chunk: 'trade',
      preload: ['user'],
      capabilities: ['payment', 'share'],
      lifecycle: { onInit: './lifecycle/init', onDestroy: './lifecycle/destroy' },
    })
    expect(cfg.name).toBe('trade')
    expect(validateModuleConfig(cfg).ok).toBe(true)
  })

  it('缺失 name / version → 报错（含字段与原因）', () => {
    const r = validateModuleConfig({ version: '1.0.0' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.some((e) => e.field === 'name' && e.message.includes('必填'))).toBe(true)
    }
    const r2 = validateModuleConfig({ name: 'trade' })
    expect(r2.ok).toBe(false)
    if (!r2.ok) {
      expect(r2.errors.some((e) => e.field === 'version')).toBe(true)
    }
  })

  it('非法 name（大写/非法字符）/ 非法 version → 报错', () => {
    expect(validateModuleConfig({ name: 'Trade', version: '1.0.0' }).ok).toBe(false)
    expect(validateModuleConfig({ name: 'trade', version: 'abc' }).ok).toBe(false)
    expect(validateModuleConfig({ name: 'trade', version: '1.0' }).ok).toBe(false)
  })

  it('★自环依赖（依赖自身）→ 报错', () => {
    const r = validateModuleConfig({ name: 'trade', version: '1.0.0', dependencies: { trade: '^1.0.0' } })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.some((e) => e.field === 'dependencies.trade' && e.message.includes('自环'))).toBe(true)
    }
  })

  it('preload 引用未声明依赖 → 警告（不阻断）', () => {
    const r = validateModuleConfig({ name: 'trade', version: '1.0.0', preload: ['user'] })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.warnings.some((w) => w.field === 'preload.user' && w.message.includes('未声明'))).toBe(true)
    }
  })

  it('defineModule 不合法 → 抛错（透明化：字段级信息）', () => {
    expect(() => defineModule({ version: '1.0.0' } as never)).toThrow(/模块契约校验失败/)
  })
})

describe('scanModuleConfigs / CLI module:check（扫描 + 汇总 + 重名检测）', () => {
  afterAll(() => {
    fs.rmSync(TMP, { recursive: true, force: true })
  })

  it('递归扫描全部 proteus-module.config.ts + 校验汇总', async () => {
    writeFixture('proteus-module.config.ts', `import { defineModule } from '@proteus-vue/module'\nexport default defineModule({ name: 'app', version: '1.0.0' })\n`)
    writeFixture('modules/trade/proteus-module.config.ts', `import { defineModule } from '@proteus-vue/module'\nexport default defineModule({ name: 'trade', version: '1.2.0', dependencies: { app: '^1.0.0' }, preload: ['user'] })\n`)
    writeFixture('modules/broken/proteus-module.config.ts', `import { defineModule } from '@proteus-vue/module'\nexport default defineModule({ version: '1.0.0' })\n`)
    const { result } = await checkModuleConfigs(TMP)
    expect(result.modules.length).toBe(3)
    const app = result.modules.find((m) => m.name === 'app')
    expect(app?.ok).toBe(true)
    const trade = result.modules.find((m) => m.name === 'trade')
    expect(trade?.ok).toBe(true)
    expect(trade?.warnings.some((w) => w.field === 'preload.user')).toBe(true)
    const broken = result.modules.find((m) => m.file.includes('broken'))
    expect(broken?.ok).toBe(false)
    // defineModule 校验在加载期抛错（field 为 (加载)，消息含字段与原因）
    if (broken && !broken.ok) expect(broken.errors[0].message).toContain('name')
  })

  it('★重名模块（全局唯一）→ duplicateNames 检出', async () => {
    writeFixture('dup-a/proteus-module.config.ts', `import { defineModule } from '@proteus-vue/module'\nexport default defineModule({ name: 'dup', version: '1.0.0' })\n`)
    writeFixture('dup-b/proteus-module.config.ts', `import { defineModule } from '@proteus-vue/module'\nexport default defineModule({ name: 'dup', version: '2.0.0' })\n`)
    const { result } = await checkModuleConfigs(TMP)
    expect(result.duplicateNames.some((d) => d.name === 'dup' && d.files.length === 2)).toBe(true)
  })

  it('walkModuleConfigs 跳过 node_modules/dist', async () => {
    writeFixture('node_modules/x/proteus-module.config.ts', 'export default {}\n')
    writeFixture('dist/proteus-module.config.ts', 'export default {}\n')
    const files = walkModuleConfigs(TMP)
    expect(files.some((f) => f.includes('node_modules'))).toBe(false)
    expect(files.some((f) => f.includes(`${path.sep}dist${path.sep}`))).toBe(false)
  })
})
