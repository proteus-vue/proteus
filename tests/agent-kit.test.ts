// tests/agent-kit.test.ts
// ★G-36 B2/B3/B4（proteus-ai-agent-plan 04-agent-kit + 05-guardrails）：Agent Kit SDK 权威 TS 版
//   验收：「Agent Kit SDK 可独立运行（不绑 LLM 也能走 IRBuilder）」
//   + IRBuilder 链式构造（semantic→tag SSOT 反查）+ generateCode 规则引擎 + withProteusRules
//   + intent-to-flex / migrate-miniprogram Skills + 三层护栏 + 自修复循环
// @vitest-environment happy-dom（L3 六端 conformance 的 vue-dom 引擎需要 document）
import { describe, it, expect } from 'vitest'
import {
  AgentKit,
  IRBuilder,
  IRBuilderError,
  generateCode,
  withProteusRules,
  intentToFlex,
  matchBlocks,
  migrateMiniprogram,
  validateGuardrails,
  generateWithRetry,
  repairSource,
  detectBareColors,
  detectWxUsage,
  detectMpTags,
  enrichIntent,
} from '@proteus-vue/agent'
import { createMcpServer } from '@proteus-vue/mcp'
import { toComponentTree } from '@proteus-vue/component-ir'
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
    await expect(kit.generatePage({ intent: 'x', skills: ['adapt-device'] })).rejects.toThrow(/B3\/B5/)
  })
})

describe('G-36 B3 migrate-miniprogram Skill（G-31 B6 codemod 复用 + CMP019 日志 + 覆盖率）', () => {
  const MP_SOURCE = [
    '<template>',
    '  <view class="page">',
    '    <text>标题</text>',
    '    <scroll-view scroll-y>内容</scroll-view>',
    '    <swiper indicator-dots>轮播</swiper>',
    '  </view>',
    '</template>',
    '<script>',
    'export default {',
    '  methods: {',
    '    load() {',
    '      wx.setStorageSync("k", 1)',
    '      wx.request({ url: "/api" })',
    '      wx.getSystemInfoSync()',
    '      wx.navigateTo({ url: "/pages/next" })',
    '    },',
    '  },',
    '}',
    '</script>',
  ].join('\n')

  it('迁移替换生效（codemod 复用：标签 auto + 存储直改 + manual 标注）+ 幂等', async () => {
    const r = await migrateMiniprogram({ source: MP_SOURCE, name: 'legacy' }, { mcp: createMcpServer() })
    expect(r.name).toBe('legacy')
    expect(r.code).toContain('<p-box class="page">') // view → p-box
    expect(r.code).toContain('<p-text>标题</p-text>')
    expect(r.code).toContain('useStorage().set') // 同步存储直改
    expect(r.code).toContain('[proteus-migrate:manual]') // scroll-view/swiper 语义标注
    // 幂等：重复跑零变化
    const again = await migrateMiniprogram({ source: r.code }, { mcp: createMcpServer() })
    expect(again.code).toBe(r.code)
  })

  it('CMP019 映射日志：auto/manual 状态 + wx API → Hook 映射', async () => {
    const r = await migrateMiniprogram({ source: MP_SOURCE }, { mcp: createMcpServer() })
    const byFrom = new Map(r.log.map((e) => [e.from, e]))
    // tag auto
    expect(byFrom.get('<view>')?.status).toBe('auto')
    expect(byFrom.get('<view>')?.to).toBe('<p-box>')
    // tag manual（语义识别）
    expect(byFrom.get('<scroll-view>')?.status).toBe('manual')
    // 存储（codemod 直改）不入日志（auto 集中在 tag）
    expect(byFrom.get('wx.request')?.status).toBe('auto')
    expect(byFrom.get('wx.request')?.to).toBe('useFetch()')
    expect(byFrom.get('wx.navigateTo')?.to).toBe('router.push()')
    // 私有 API → useMiniProgram()
    expect(byFrom.get('wx.getSystemInfoSync')?.to).toBe('useMiniProgram()')
    expect(byFrom.get('wx.getSystemInfoSync')?.status).toBe('manual')
  })

  it('覆盖率统计（≥80% 目标口径）+ wx API 计数', async () => {
    const r = await migrateMiniprogram({ source: MP_SOURCE }, { mcp: createMcpServer() })
    expect(r.stats.tagsReplaced).toBeGreaterThanOrEqual(2) // view/text/button
    expect(r.stats.storageReplaced).toBeGreaterThanOrEqual(1)
    expect(r.stats.manualAnnotations).toBeGreaterThanOrEqual(2) // scroll-view + swiper
    expect(r.stats.wxApisFound).toBe(4) // setStorageSync/request/getSystemInfoSync/navigateTo
    expect(r.coverage).toBeGreaterThan(0)
    expect(r.coverage).toBeLessThanOrEqual(1)
  })

  it('useMiniProgram 接线声明（私有 API 检测头部指引）', async () => {
    const r = await migrateMiniprogram({ source: 'wx.getFileSystemManager()', name: 'p' }, { mcp: createMcpServer() })
    expect(r.code).toContain('useMiniProgram()')
    expect(r.code).toContain('wx.getFileSystemManager')
  })

  it('AgentKit.migrate 门面（skill 校验 + 同结果）', async () => {
    const kit = new AgentKit()
    const r = await kit.migrate('<view>x</view>', { name: 'mini' })
    expect(r.code).toContain('<p-box>')
    expect(r.coverage).toBe(1) // 全 auto
    await expect(kit.migrate('x', { skill: 'nope' })).rejects.toThrow(/未知迁移 Skill/)
  })

  it('空源码：coverage=1 + 空日志（除零防护）', async () => {
    const r = await migrateMiniprogram({ source: '' }, { mcp: createMcpServer() })
    expect(r.coverage).toBe(1)
    expect(r.log).toHaveLength(0)
  })
})

describe('G-36 B4 三层护栏（L1 结构 / L2 风格 / L3 语义）', () => {
  const validIR = () => toComponentTree('p-grid', { minColWidth: 160 }, [{ tag: 'p-text', props: { content: 'A' } }]) as never

  it('L1：非法 IR（非 p- tag）→ schema 错误；合法 IR 零诊断', async () => {
    const mcp = createMcpServer()
    const bad = await validateGuardrails({ ir: { tag: 'div', semantic: 'layout.box', props: {}, children: [] } as never }, { mcp })
    expect(bad.layers[0].ok).toBe(false)
    expect(bad.errors.some((e) => e.category === 'schema' && e.layer === 'L1')).toBe(true)

    const good = await validateGuardrails({ ir: validIR() }, { mcp })
    expect(good.layers[0].ok).toBe(true)
    expect(good.errors.filter((e) => e.category === 'schema')).toHaveLength(0)
  })

  it('L2：裸色值（token）+ wx.*（capability）+ 小程序组件（naming）逐类检出', async () => {
    const mcp = createMcpServer()
    const source = [
      '<template>',
      '  <view style="color: #FFFFFF; border-color: #AABBCC">',
      '    <text>标题</text>',
      '  </view>',
      '</template>',
      '<script>',
      'wx.request({ url: "/api" })',
      '</script>',
    ].join('\n')
    const r = await validateGuardrails({ source }, { mcp })
    expect(r.layers[1].ok).toBe(false)
    const tokens = r.errors.filter((e) => e.category === 'token')
    expect(tokens.length).toBe(2)
    expect(tokens[0].repairable).toBe(true) // #FFFFFF 精确匹配 color.surface
    expect(tokens[1].repairable).toBe(false) // #AABBCC 未登记
    expect(r.errors.some((e) => e.category === 'capability' && e.message.includes('wx.request'))).toBe(true)
    expect(r.errors.some((e) => e.category === 'naming' && e.message.includes('<view>'))).toBe(true)
  })

  it('L3：六端 conformance（合法 IR 全过；经 MCP run_conformance 协议面）', async () => {
    const r = await validateGuardrails({ ir: validIR() }, { mcp: createMcpServer() })
    expect(r.layers[2].ok).toBe(true)
    expect(r.layers[2].detail).toContain('六端渲染一致')
  })

  it('单检测器：detectBareColors/detectWxUsage/detectMpTags + token 反查', () => {
    expect(detectBareColors('color:#fff;border:#4F7CFF')).toEqual([
      { raw: '#fff', tokenPath: null },
      { raw: '#4F7CFF', tokenPath: 'color.primary' },
    ])
    expect(detectWxUsage('const a = wx . request(); wx.showToast()')).toEqual(['wx.request', 'wx.showToast'])
    expect(detectMpTags('<view><text>x</text></view>')).toEqual(['view', 'text']) // text 也在 AUTO 集（text→p-text）
  })

  it('repairSource：token 精确匹配 → var(--p-*) 替换；未登记保留', () => {
    const source = 'color: #FFFFFF; border-color: #AABBCC;'
    const errors = [
      { layer: 'L2' as const, category: 'token' as const, message: '裸色值 #FFFFFF → 应使用 token color.surface', repairable: true },
      { layer: 'L2' as const, category: 'token' as const, message: '裸色值 #AABBCC 未登记于 design token' },
    ]
    const { code, repaired } = repairSource(source, errors)
    expect(repaired).toBe(1)
    expect(code).toContain('var(--p-color-surface)')
    expect(code).toContain('#AABBCC') // 未登记保留（诚实——不臆造 token）
  })

  it('enrichIntent：修正指令附加', () => {
    const enriched = enrichIntent('商品页', [{ layer: 'L2', category: 'token', message: '裸色值' }])
    expect(enriched).toContain('[fix:token]')
    expect(enriched.startsWith('商品页')).toBe(true)
  })
})

describe('G-36 B4 自修复循环（G-36.6 上限 3 超限转人工）', () => {
  it('首次通过：干净产物 attempts=1 status=delivered', async () => {
    const mcp = createMcpServer()
    const r = await generateWithRetry(
      { intent: '商品详情页，主图+价格+加入购物车' },
      { construct: ({ intent }) => intentToFlex({ intent }, { mcp }), mcp },
    )
    expect(r.ok).toBe(true)
    expect(r.status).toBe('delivered')
    expect(r.attempts).toBe(1)
    expect(r.trail[0].ok).toBe(true)
  })

  it('token 错误循环内自动修复（修复不计 attempt）后交付', async () => {
    const mcp = createMcpServer()
    let called = 0
    const r = await generateWithRetry(
      { intent: 'x' },
      {
        construct: () => {
          called++
          const ir = toComponentTree('p-text', { content: 'x' }, []) as never
          return { intent: 'x', source: 'color: #FFFFFF;', ir }
        },
        mcp,
      },
    )
    expect(r.status).toBe('delivered')
    expect(called).toBe(1) // 修复内联完成——未重试构造
    expect(r.code).toContain('var(--p-color-surface)')
    expect(r.attempts).toBe(1)
  })

  it('不可修复错误重试至超限 → need-human-review（G-36.6）+ enrichIntent 递进', async () => {
    const mcp = createMcpServer()
    const intents: string[] = []
    const r = await generateWithRetry(
      { intent: 'bad page', max: 3 },
      {
        construct: ({ intent }) => {
          intents.push(intent)
          const ir = { tag: 'div', semantic: 'layout.box', props: {}, children: [] } as never
          return { intent, ir }
        },
        mcp,
      },
    )
    expect(r.status).toBe('need-human-review')
    expect(r.code).toBeNull()
    expect(r.attempts).toBe(3)
    expect(intents[1]).toContain('[fix:schema]')
    expect(intents[2]).toContain('[fix:schema]') // 规则引擎构造器不消费修正指令 → 同错误确定性 enrich（LLM 版构造器消费后错误才会变化）
    expect(r.errors.some((e) => e.category === 'schema')).toBe(true)
    expect(r.trail).toHaveLength(3)
  })

  it('max 可配（2 次即转人工）', async () => {
    const mcp = createMcpServer()
    const r = await generateWithRetry(
      { intent: 'x', max: 2 },
      {
        construct: ({ intent }) => ({ intent, ir: { tag: 'div', semantic: 'layout.box', props: {}, children: [] } as never }),
        mcp,
      },
    )
    expect(r.attempts).toBe(2)
    expect(r.status).toBe('need-human-review')
  })
})
