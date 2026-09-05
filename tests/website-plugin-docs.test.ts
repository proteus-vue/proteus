/**
 * G-60 B1 —— 文档即契约基建：WIT 解析 / SPEC_LINT / 渲染 / 漂移门禁
 * 消费方：website/scripts/gen-plugin-docs.mjs（生成 + --check 漂移阻断）
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseWit, lintSpec, renderSpecMd, sourceHash, checkDrift } from '../website/scripts/lib/wit.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WIT = fs.readFileSync(path.join(root, 'website/api/wit/since_v0_1_0.wit'), 'utf8')

describe('G-60 B1 WIT 解析器', () => {
  const spec = parseWit(WIT)

  it('package 头与版本从 SSOT 提取', () => {
    expect(spec.package).toBe('proteus:plugin')
    expect(spec.version).toBe('0.1.0')
  })

  it('三个 interface 全部解析（manifest/contributions/host）', () => {
    expect(spec.interfaces.map((i: { name: string }) => i.name)).toEqual(['manifest', 'contributions', 'host'])
    expect(spec.interfaces.every((i: { doc: string }) => i.doc.length > 0)).toBe(true)
  })

  it('有返回值与无返回值的 func 都解析（activate 有 / suspend 无）', () => {
    const host = spec.interfaces.find((i: { name: string }) => i.name === 'host')
    const activate = host.items.find((x: { name: string }) => x.name === 'activate')
    const suspend = host.items.find((x: { name: string }) => x.name === 'suspend')
    expect(activate.kind).toBe('func')
    expect(activate.result).toBe('result<string, string>')
    expect(activate.params).toEqual([{ name: 'plugin-id', type: 'string' }])
    expect(suspend.result).toBe('')
    expect(suspend.doc).toContain('对称清理资源')
  })

  it('doc 注释精确归属：suspend 不吞 uninstall 的文档（G-55 坑继承）', () => {
    const host = spec.interfaces.find((i: { name: string }) => i.name === 'host')
    const suspend = host.items.find((x: { name: string }) => x.name === 'suspend')
    const uninstall = host.items.find((x: { name: string }) => x.name === 'uninstall')
    expect(suspend.doc).not.toContain('卸载')
    expect(uninstall.doc).toBe('卸载插件。')
  })

  it('record/enum/variant 类型块带字段解析', () => {
    const manifest = spec.interfaces.find((i: { name: string }) => i.name === 'manifest')
    const tier = manifest.items.find((x: { name: string }) => x.name === 'tier')
    expect(tier.kind).toBe('enum')
    expect(tier.fields.map((f: { name: string }) => f.name)).toEqual(['declarative', 'wasm', 'full'])
    const cap = manifest.items.find((x: { name: string }) => x.name === 'capability')
    expect(cap.kind).toBe('variant')
    expect(cap.fields.some((f: { name: string; type?: string }) => f.name === 'network' && f.type === 'list<string>')).toBe(true)
  })
})

describe('G-60 B1 SPEC_LINT', () => {
  it('SSOT 全量 lint 通过（每条声明都有 /// 文档）', () => {
    expect(lintSpec(parseWit(WIT))).toEqual([])
  })

  it('缺 doc 的 func 被抓出（interface 级 + 成员级）', () => {
    const bad = parseWit('package x:y@0.1.0;\ninterface a {\n  fn: func();\n}')
    expect(lintSpec(bad)).toEqual([
      'SPEC_LINT: interface a 缺 /// 文档',
      'SPEC_LINT: a.fn 缺 /// 文档',
    ])
  })
})

describe('G-60 B1 渲染与漂移门禁', () => {
  it('渲染页带 generated:true + source_hash 锚点', () => {
    const spec = parseWit(WIT)
    const md = renderSpecMd(spec, 'host', { sourceHash: sourceHash(WIT) })
    expect(md).toContain('generated: true')
    expect(md).toContain('source_hash: ' + sourceHash(WIT))
    expect(md).toContain('## supports')
    expect(md).toContain('请勿手工编辑')
  })

  it('漂移检测：一致 = fresh / 不一致 = stale', () => {
    expect(checkDrift('same', 'same').status).toBe('fresh')
    const d = checkDrift('committed-old', 'generated-new')
    expect(d.status).toBe('stale')
    expect(d.message).toContain('重新运行')
  })

  it('提交在库里的生成物与 WIT 实时重渲染零漂移（文档即契约的机器断言）', () => {
    const spec = parseWit(WIT)
    let order = 90
    for (const iface of spec.interfaces) {
      const outPath = path.join(root, 'website/content/plugins', `${iface.name}.md`)
      const committed = fs.readFileSync(outPath, 'utf8')
      const rendered = renderSpecMd(spec, iface.name, { sourceHash: sourceHash(WIT), order: order++ })
      expect(committed, `${iface.name}.md 漂移——运行 npm run gen:plugin-docs 并提交`).toBe(rendered)
    }
  })
})
