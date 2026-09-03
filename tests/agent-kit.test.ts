// tests/agent-kit.test.ts
// ★G-36 B2（proteus-ai-agent-plan 04-agent-kit）：Agent Kit SDK 权威 TS 版
//   验收：「Agent Kit SDK 可独立运行（不绑 LLM 也能走 IRBuilder）」
//   + IRBuilder 链式构造（semantic→tag SSOT 反查）+ generateCode 规则引擎 + withProteusRules + intent-to-flex
import { describe, it, expect } from 'vitest'
import {
  AgentKit,
  IRBuilder,
  IRBuilderError,
  generateCode,
  withProteusRules,
  intentToFlex,
  matchBlocks,
} from '@proteus-vue/agent'
import { createMcpServer } from '@proteus-vue/mcp'
import type { BuiltPage } from '@proteus-vue/agent'
import { validateComponentIR } from '@proteus-vue/component-ir'

describe('G-36 B2 IRBuilder（不绑 LLM 构造 IR）', () => {
  it('链式构造：semantic→tag 反查（TAG_SEMANTIC_MAP 同源）+ 嵌套 children', () => {
    const page: BuiltPage = new IRBuilder('product-detail')
      .addNode({ semantic: 'layout.stack', props: { gap: 'md' } }, (stack) => {
        stack.addNode({ semantic: 'ui.media', props: { kind: 'image', src: '{{cover}}' } })
        stack.addNode({ semantic: 'ui.text', props: { variant: 'title', content: '{{name}}' } })
      })
      .build()
    expect(page.name).toBe('product-detail')
    expect(page.ir.tag).toBe('p-page')
    expect(page.ir.semantic).toBe('shell.page')
    const stack = page.ir.children[0]
    expect(stack.tag).toBe('p-stack') // semantic 反查（catalog tag）
    expect(stack.children[0].tag).toBe('p-media')
    expect(stack.children[1].props.content).toBe('{{name}}')
  })

  it('显式 tag 覆盖 + 能力引用（CMP006 degradation 强制）', () => {
    const page = new IRBuilder('scan')
      .addNode({
        semantic: 'ui.button',
        tag: 'p-button',
        props: { label: '扫码' },
        capabilities: [{ name: 'scan-qr', degradation: '手动输入降级' }],
      })
      .build()
    const node = page.ir.children[0]
    expect(node.tag).toBe('p-button')
    expect(node.capabilities).toEqual([{ name: 'scan-qr', degradation: '手动输入降级' }])
  })

  it('未知 semantic（无组件形态）→ 显式报错（SSOT 纪律——不臆造 tag）', () => {
    expect(() => new IRBuilder('x').addNode({ semantic: 'capability.payment' })).toThrow(IRBuilderError)
  })

  it('setDeviceAdaptation：CMP020 多端约束声明', () => {
    const page = new IRBuilder('adaptive')
      .addNode({ semantic: 'ui.text', props: {} })
      .setDeviceAdaptation({
        car: { cols: 1, 'nav.topology': 'focus-tree', hotspots: 'xl' },
        watch: { cols: 1, glance: true },
      })
      .build()
    expect(page.adaptation.car).toEqual({ cols: 1, 'nav.topology': 'focus-tree', hotspots: 'xl' })
    expect(page.adaptation.watch).toEqual({ cols: 1, glance: true })
  })

  it('产物过 G-31 契约：validateComponentIR 零诊断（CMP006 已声明）', () => {
    const page = new IRBuilder('valid')
      .addNode({ semantic: 'layout.stack', props: {} }, (stack) => {
        stack.addNode({ semantic: 'ui.button', props: {} })
      })
      .build()
    expect(validateComponentIR(page.ir)).toEqual([])
  })
})

describe('G-36 B2 generateCode（规则引擎，无需 LLM）', () => {
  it('sfc：p-* 模板 + props 序列化 + 嵌套闭合', () => {
    const page = new IRBuilder('sfc-demo')
      .addNode({ semantic: 'layout.stack', props: { gap: 'md' } }, (stack) => {
        stack.addNode({ semantic: 'ui.text', props: { content: '你好' } })
        stack.addNode({ semantic: 'ui.media', props: { kind: 'image' } })
      })
      .build()
    const code = generateCode(page, 'sfc')
    expect(code.startsWith('<template>')).toBe(true)
    expect(code).toContain('<p-stack gap="md">')
    expect(code).toContain('<p-text content="你好" />')
    expect(code).toContain('<p-media kind="image" />') // 自闭合
    expect(code.trimEnd().endsWith('</template>')).toBe(true)
  })

  it('ts：类型化 ComponentIR 模块 + 禁改注记', () => {
    const page = new IRBuilder('ts-demo').addNode({ semantic: 'ui.text', props: {} }).build()
    const code = generateCode(page, 'ts')
    expect(code).toContain('export const component')
    expect(code).toContain('禁止手改生成物')
  })
})

describe('G-36 B2 withProteusRules（系统约束注入）', () => {
  it('5 条规则 id 与 plan 一致（G-36.2/G-36.3/CMP017/G-31.1/G-29）', () => {
    const rules = withProteusRules()
    expect(rules.map((r) => r.id)).toEqual(['G-36.2', 'G-36.3', 'CMP017', 'G-31.1', 'G-29'])
  })
})

describe('G-36 B2 intent-to-flex Skill（规则引擎）', () => {
  it('matchBlocks：中英关键词 → 区块序列（确定性——同意图恒同产出）', () => {
    const blocks = matchBlocks('商品详情页，主图+价格+加入购物车')
    expect(blocks.map((b) => b.node.semantic)).toEqual(['ui.media', 'ui.text', 'ui.text', 'ui.button'])
    // 价格与标题都命中 ui.text（variant 区分）——顺序 = 规则表序
    expect(matchBlocks('search input box').map((b) => b.node.semantic)).toEqual(['ui.input'])
    expect(matchBlocks(' nothing ')).toEqual([])
  })

  it('intentToFlex：意图 → IR + 代码（MCP 原语库核对链路打通）', async () => {
    const mcp = createMcpServer()
    const r = await intentToFlex({ intent: '商品详情页，主图+价格+加入购物车', name: 'product-detail' }, { mcp })
    expect(r.name).toBe('product-detail')
    expect(r.blocks).toEqual([
      { semantic: 'ui.media' },
      { semantic: 'ui.text' },
      { semantic: 'ui.text' },
      { semantic: 'ui.button' },
    ])
    // IR 结构：page → stack → [media, text(title), text(emphasis), button]
    const stack = r.page.ir.children[0]
    expect(stack.children.map((c) => c.semantic)).toEqual(['ui.media', 'ui.text', 'ui.text', 'ui.button'])
    // 代码可编译形态（sfc p-* 模板——childless 自闭合）
    expect(r.code).toContain('<p-media kind="image" />')
    expect(r.code).toContain('<p-button variant="primary" />')
  })

  it('空意图 → 默认单文本区块（诚实兜底不臆造）', async () => {
    const r = await intentToFlex({ intent: '……' }, { mcp: createMcpServer() })
    expect(r.blocks).toEqual([])
    expect(r.page.ir.children[0].semantic).toBe('ui.text')
  })

  it('能力区块携带 CMP006 降级声明（@conditional 降级节点）', async () => {
    const r = await intentToFlex({ intent: '扫码登录页' }, { mcp: createMcpServer() })
    const stack = r.page.ir.children[0]
    const scan = stack.children.find((c) => c.semantic === 'capability.scan-qr')
    expect(scan?.capabilities?.[0].degradation).toContain('降级')
  })
})

describe('G-36 B2 AgentKit 门面（不绑 LLM 独立运行）', () => {
  it('generatePage 端到端：意图 → { code, ir, adaptation, blocks }（无 LLM 注入）', async () => {
    const kit = new AgentKit({ provider: 'rule-engine' })
    const out = await kit.generatePage({
      intent: '商品详情页，主图+价格+加入购物车',
      name: 'product-detail',
      targetBackends: ['car', 'watch'],
    })
    expect(out.name).toBe('product-detail')
    expect(out.code).toContain('<p-page')
    expect(out.adaptation.car).toEqual({}) // targetBackends → 空档声明（CMP020 不臆造约束）
    expect(out.blocks.length).toBe(4)
    // 产物过 G-31 契约
    expect(validateComponentIR(out.ir as never)).toEqual([])
  })

  it('rules 缺省注入 + llm 未注入（降级策略：规则引擎路径）', () => {
    const kit = new AgentKit()
    expect(kit.rules).toHaveLength(5)
    expect(kit.llm).toBeUndefined()
    expect(kit.provider).toBe('rule-engine')
  })

  it('llm 可注入（LlmLike 契约——真模型接入属后续批次）', () => {
    const kit = new AgentKit({ provider: 'claude', llm: { complete: async (p) => `echo:${p}` } })
    expect(kit.llm).toBeDefined()
  })

  it('不支持 Skill 显式报错（B3/B5 未落地不静默）', async () => {
    const kit = new AgentKit()
    await expect(kit.generatePage({ intent: 'x', skills: ['migrate-miniprogram'] })).rejects.toThrow(/B3\/B5/)
  })
})
