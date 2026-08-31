// tests/test-cli.test.ts
// ★test-framework：proteus test 入口（README 快速开始：unit / e2e:web / e2e:mp）
import { describe, expect, it } from 'vitest'
import { parseTestArgs, runTest } from '../packages/cli/src/test'
import { formatHelpText } from '../packages/cli/src/args'

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

  it('parseTestArgs：--debugger 适配模块（仅 e2e:mp；缺值/其他 scope 报错）', () => {
    expect(parseTestArgs(['e2e:mp', '--debugger', './e2e/mp-debugger.ts'])).toEqual({
      scope: 'e2e:mp',
      debugger: './e2e/mp-debugger.ts',
    })
    expect(parseTestArgs(['e2e:mp', 'examples', '--debugger', './dbg.ts', '--ide', '/x/cli', '--port', '9421'])).toEqual({
      scope: 'e2e:mp',
      root: 'examples',
      debugger: './dbg.ts',
      ide: '/x/cli',
      port: 9421,
    })
    expect(() => parseTestArgs(['e2e:mp', '--debugger'])).toThrow(/--debugger 缺少值/)
    expect(() => parseTestArgs(['unit', '--debugger', './dbg.ts'])).toThrow(/仅 e2e:mp/)
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

describe('proteus help 美化（分组 + ANSI 色彩开关）', () => {
  it('formatHelpText(false)：纯文本分组渲染（命令名/说明完整）', () => {
    const text = formatHelpText(false)
    // 分组标题
    expect(text).toContain('构建与开发')
    expect(text).toContain('检查与门禁')
    expect(text).toContain('测试')
    expect(text).toContain('生成与迁移')
    expect(text).toContain('诊断与工具')
    // 命令与说明完整保留
    expect(text).toContain('proteus check [dir]')
    expect(text).toContain('proteus health [dir]')
    expect(text).toContain('proteus test [unit|e2e:web|e2e:mp]')
    expect(text).toContain('★一键全量门禁')
    // 纯文本无 ANSI
    expect(text).not.toContain('\u001b[')
  })

  it('formatHelpText(true)：命令名 cyan + 分组标题 bold', () => {
    const text = formatHelpText(true)
    expect(text).toContain('\u001b[36mproteus check\u001b[0m') // 命令名 cyan
    expect(text).toContain('\u001b[1m检查与门禁\u001b[0m') // 分组标题 bold
  })
})
