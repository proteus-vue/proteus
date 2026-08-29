// tests/cli.test.ts
// @proteus/cli 核心纯函数测试：参数解析 + explain 目标识别
// CLI 本身是薄壳（命令分发 + 打印），核心逻辑均为纯函数
import { describe, it, expect } from 'vitest'
import { parseBuildArgs, parseExplainArgs, parseRulesArgs } from '../packages/cli/src/args'
import { explainTarget } from '../packages/cli/src/explain'
import { listRules } from '../packages/cli/src/rules'

describe('parseBuildArgs', () => {
  it('默认值：输入 . / 输出 dist / px2rpx on / rpxRatio 2', () => {
    const args = parseBuildArgs([])
    expect(args.inputDir).toBe('.')
    expect(args.outDir).toBe('dist')
    expect(args.px2rpx).toBe(true)
    expect(args.rpxRatio).toBe(2)
    expect(args.debug).toBe(false)
  })

  it('位置参数 = 输入目录；--out / --debug / --no-px2rpx / --rpx-ratio 生效', () => {
    const args = parseBuildArgs(['examples/pages', '--out', '/tmp/out', '--debug', '--no-px2rpx', '--rpx-ratio', '1.5'])
    expect(args.inputDir).toBe('examples/pages')
    expect(args.outDir).toBe('/tmp/out')
    expect(args.debug).toBe(true)
    expect(args.px2rpx).toBe(false)
    expect(args.rpxRatio).toBe(1.5)
  })

  it('未知选项报错', () => {
    expect(() => parseBuildArgs(['--wat'])).toThrow(/未知选项/)
  })

  it('--rules 读取 JSON 规则覆盖', () => {
    const args = parseBuildArgs(['x', '--rules', 'tests/fixtures/rules-override.json'])
    expect(args.rules?.customTags).toEqual({ 'demo-box': 'view' })
  })
})

describe('parseExplainArgs / parseRulesArgs', () => {
  it('explain 缺参报错；多余参数报错', () => {
    expect(() => parseExplainArgs([])).toThrow(/需要一个参数/)
    expect(() => parseExplainArgs(['a', 'b'])).toThrow(/多余参数/)
  })

  it('rules 阶段白名单校验', () => {
    expect(parseRulesArgs(['template']).phase).toBe('template')
    expect(() => parseRulesArgs(['wat'])).toThrow(/未知阶段/)
  })
})

describe('explainTarget（智能识别：文件 vs 规则 ID）', () => {
  it('规则 ID → AI 说明书', () => {
    const text = explainTarget('tag/div-to-view')
    expect(text).toContain('## tag/div-to-view')
    expect(text).toContain('为什么：')
  })

  it('未知目标报错并提示 proteus rules', () => {
    expect(() => explainTarget('not/exist-anywhere')).toThrow(/proteus rules/)
  })
})

describe('listRules', () => {
  it('全量目录 + 按阶段过滤', () => {
    expect(listRules()).toContain('### template 阶段')
    const tpl = listRules('template')
    expect(tpl).toContain('`tag/div-to-view`')
    expect(tpl).not.toContain('script/')
  })
})
