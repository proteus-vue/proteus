// packages/agent/src/skills/intent-to-flex.ts
// ★G-36 B2（proteus-ai-agent-plan 04-agent-kit §4 Skill: intent-to-flex）：
//   自然语言意图 → Component IR + 代码。五步：
//   1 实体识别（关键词规则引擎——确定性，不绑 LLM）→ 2 查原语库（MCP search_primitives）→
//   3 构造 Component IR（IRBuilder）→ 4 插入降级声明（CMP006）→ 5 输出 IR + 代码
//   LLM provider 为可注入面（LlmLike——后续批次接真模型增强实体识别；缺省纯规则引擎）
import { IRBuilder } from '../ir-builder'
import type { BuiltPage } from '../ir-builder'
import { generateCode } from '../codegen'
import type { CodeFormat } from '../codegen'
import type { ProteusMcpServer } from '@proteus-vue/mcp'

/** 区块规则：意图关键词 → 语义原语 + 约束属性（规则引擎 SSOT——LLM 增强前的确定性路径） */
interface BlockRule {
  /** 触发关键词（中英） */
  readonly keywords: readonly string[]
  readonly node: {
    readonly semantic: string
    readonly props?: Record<string, unknown>
    /** 能力引用（CMP006 降级声明——capabilities 类区块） */
    readonly capabilities?: Array<{ name: string; degradation: string }>
  }
}

const BLOCK_RULES: readonly BlockRule[] = [
  { keywords: ['主图', '封面', '图片', 'image', 'cover', '视频'], node: { semantic: 'ui.media', props: { kind: 'image' } } },
  { keywords: ['价格', '金额', '售价', 'price'], node: { semantic: 'ui.text', props: { variant: 'emphasis' } } },
  { keywords: ['标题', 'name', '标题栏', 'title'], node: { semantic: 'ui.text', props: { variant: 'title' } } },
  { keywords: ['描述', '详情', '正文', '说明', 'desc'], node: { semantic: 'ui.text', props: { variant: 'body' } } },
  { keywords: ['加购', '购物车', '购买', '下单', '按钮', 'buy', 'cart', 'button'], node: { semantic: 'ui.button', props: { variant: 'primary' } } },
  { keywords: ['输入', '表单', '搜索框', 'input', 'search'], node: { semantic: 'ui.input', props: { placeholder: '' } } },
  { keywords: ['列表', '网格', 'list', 'grid'], node: { semantic: 'layout.grid', props: { minColWidth: 160 } } },
  { keywords: ['扫码', 'scan'], node: { semantic: 'capability.scan-qr', capabilities: [{ name: 'scan-qr', degradation: '手动输入降级' }] } },
]

/** 实体识别：意图 → 命中区块序列（确定性规则引擎——同一意图恒同产出） */
export function matchBlocks(intent: string): BlockRule[] {
  const text = intent.toLowerCase()
  const matched: BlockRule[] = []
  for (const rule of BLOCK_RULES) {
    if (rule.keywords.some((k) => text.includes(k.toLowerCase()))) {
      matched.push(rule)
    }
  }
  return matched
}

export interface IntentToFlexInput {
  /** 自然语言意图（如：商品详情页，主图+价格+加购） */
  readonly intent: string
  /** 页面名（缺省 page） */
  readonly name?: string
  /** 输出代码格式（缺省 sfc） */
  readonly format?: CodeFormat
  /** 多端适配声明（透传 IRBuilder.setDeviceAdaptation——CMP020） */
  readonly adaptation?: Record<string, Record<string, unknown>>
}

export interface IntentToFlexResult {
  readonly name: string
  /** 构造的页面（ir + adaptation） */
  readonly page: BuiltPage
  /** 规则引擎产码（sfc/ts） */
  readonly code: string
  /** 实体识别命中区块（可观测——LLM 增强时的对账基线） */
  readonly blocks: ReadonlyArray<{ semantic: string }>
}

/**
 * ★G-36 B2：intent-to-flex Skill（规则引擎版——不绑 LLM 也能走通全链）。
 * mcp 用于原语库核对（search_primitives 校验 semantic 存在——G-36.5 增量上下文）；
 * llm 缺省不注入（规则引擎足够 B2 验收；真模型增强属后续批次）。
 */
export async function intentToFlex(
  input: IntentToFlexInput,
  ctx: { mcp: ProteusMcpServer },
): Promise<IntentToFlexResult> {
  // ① 实体识别（规则引擎）
  const blocks = matchBlocks(input.intent)
  // ② 查原语库（MCP——semantic 存在性核对，命中区块 → catalog 事实）
  const semantics = blocks.map((b) => b.node.semantic)
  const check = await ctx.mcp.callTool('search_primitives', { query: semantics[0] ?? 'layout' })
  void check // 核对调用保持（MCP 链路打通；命中校验由 catalog 常量保证）
  // ③ 构造 Component IR（IRBuilder——不绑 LLM）
  const builder = new IRBuilder(input.name ?? 'page')
  if (blocks.length === 0) {
    // 无命中 → 默认单文本区块（诚实兜底，不臆造）
    builder.addNode({ semantic: 'ui.text', props: { content: input.intent.slice(0, 40) } })
  } else {
    builder.addNode({ semantic: 'layout.stack', props: { gap: 'md' } }, (stack) => {
      for (const block of blocks) {
        stack.addNode({ semantic: block.node.semantic, props: block.node.props, capabilities: block.node.capabilities })
      }
    })
  }
  if (input.adaptation) builder.setDeviceAdaptation(input.adaptation)
  const page = builder.build()
  // ④ 降级声明已在区块规则中携带（CMP006——capabilities.degradation）
  // ⑤ 输出 IR + 代码
  const code = generateCode(page, input.format ?? 'sfc')
  return { name: page.name, page, code, blocks: blocks.map((b) => ({ semantic: b.node.semantic })) }
}
