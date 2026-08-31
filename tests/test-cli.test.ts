// tests/test-cli.test.ts
// ★test-framework：proteus test 入口（README 快速开始：unit / e2e:web / e2e:mp）
import { describe, expect, it } from 'vitest'
import { parseTestArgs, runTest } from '../packages/cli/src/test'

describe('proteus test（test-framework 入口）', () => {
  it('parseTestArgs：缺省 unit / 显式 scope / e2e:mp root / 非法报错', () => {
    expect(parseTestArgs([])).toEqual({ scope: 'unit' })
    expect(parseTestArgs(['e2e:web'])).toEqual({ scope: 'e2e:web' })
    expect(parseTestArgs(['e2e:mp'])).toEqual({ scope: 'e2e:mp' })
    // ★B5：e2e:mp 第二个位置参数 = 项目根目录
    expect(parseTestArgs(['e2e:mp', 'examples'])).toEqual({ scope: 'e2e:mp', root: 'examples' })
    expect(() => parseTestArgs(['e2e:wasm'])).toThrow(/未知 scope/)
    expect(() => parseTestArgs(['unit', 'e2e:web'])).toThrow(/多余参数/)
    expect(() => parseTestArgs(['e2e:mp', 'a', 'b'])).toThrow(/多余参数/)
  })

  it('runTest：unit → vitest run（L1-L3 + 快照，排除 e2e 通配）', () => {
    const plan = runTest({ scope: 'unit' })
    expect(plan.command).toBe('npx')
    expect(plan.args).toContain('--exclude')
    expect(plan.args).toContain('tests/e2e-*.test.ts')
  })

  it('runTest：e2e:web → Playwright 双文件串行（构建产物提示）', () => {
    const plan = runTest({ scope: 'e2e:web' })
    expect(plan.args).toContain('tests/e2e-web.test.ts')
    expect(plan.args).toContain('tests/e2e-web-keypaths.test.ts')
    expect(plan.args).toContain('--no-file-parallelism')
    expect(plan.note).toContain('build --target web')
  })

  it('runTest：e2e:mp → 仅提示（automator 需 IDE）', () => {
    const plan = runTest({ scope: 'e2e:mp' })
    expect(plan.command).toBe('')
    expect(plan.note).toContain('微信开发者工具')
  })
})
