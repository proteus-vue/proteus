// packages/agent/src/agent.ts
// ★G-36 B2（proteus-ai-agent-plan 04-agent-kit §1）：AgentKit 核心 API
//   · provider/mcp/rules 注入面（provider 为 LlmLike 可注入——缺省规则引擎路径）
//   · generatePage：意图 → 标准页面（intent-to-flex Skill 驱动）
//   · G-36 降级策略：LLM 不可用时走 IR 模板（规则引擎），不绑 LLM 也能走 IRBuilder
import { withProteusRules } from './rules'
import type { SystemRule } from './rules'
import { intentToFlex } from './skills/intent-to-flex'
import type { IntentToFlexInput, IntentToFlexResult } from './skills/intent-to-flex'
import { migrateMiniprogram } from './skills/migrate-miniprogram'
import type { MigrateMiniprogramInput, MigrateMiniprogramResult } from './skills/migrate-miniprogram'
import { createMcpServer } from '@proteus-vue/mcp'
import type { ProteusMcpServer } from '@proteus-vue/mcp'

/** LLM provider 可注入面（B2 定义契约；真模型接入属后续批次——缺省规则引擎路径） */
export interface LlmLike {
  /** 提示词 → 生成文本 */
  complete(prompt: string): Promise<string>
}

export interface AgentKitOptions {
  /** Agent 提供方标识（'claude' | 'gpt' | …——遥测/路由用，不影响规则引擎路径） */
  provider?: string
  /** MCP Server（查原语库/validate_ir/run_conformance 的知识面；缺省内存 createMcpServer()） */
  mcp?: ProteusMcpServer
  /** 系统规则注入（缺省 withProteusRules()——G-31/32 约束） */
  rules?: SystemRule[]
  /** LLM provider（缺省不注入——规则引擎路径，G-36 降级策略） */
  llm?: LlmLike
}

export interface GeneratePageInput extends Omit<IntentToFlexInput, 'intent'> {
  /** 自然语言意图（如：商品详情页，主图+价格+加购，适配车机和手表） */
  intent: string
  /** skills 列表（B2 支持 'intent-to-flex'；migrate-miniprogram/adapt-device 属 B3/B5） */
  skills?: readonly string[]
  /** 目标端（G-30 接入侧声明——B2 仅置空档透传，深层约束由 adapt-device B5 细化） */
  targetBackends?: readonly string[]
}

export interface GeneratedPage {
  readonly name: string
  readonly code: string
  readonly ir: unknown
  readonly adaptation: Readonly<Record<string, Record<string, unknown>>>
  readonly blocks: ReadonlyArray<{ semantic: string }>
}

/** ★G-36 B2：Agent Kit——意图 → 标准页面的 SDK 门面（不绑 LLM 也能走 IRBuilder） */
export class AgentKit {
  readonly provider: string
  readonly rules: readonly SystemRule[]
  private readonly _mcp: ProteusMcpServer
  private readonly _llm: LlmLike | undefined

  constructor(options: AgentKitOptions = {}) {
    this.provider = options.provider ?? 'rule-engine'
    // 缺省内存 MCP（proteus-mcp 核心同源——查原语库/校验即可用，无需外部进程）
    this._mcp = options.mcp ?? createMcpServer()
    this.rules = options.rules ?? withProteusRules()
    this._llm = options.llm
  }

  /** 知识面（查原语库/validate_ir/run_conformance——skill 步骤经此走 MCP 协议） */
  get mcp(): ProteusMcpServer {
    return this._mcp
  }

  get llm(): LlmLike | undefined {
    return this._llm
  }

  /** 意图 → 标准页面（B2：intent-to-flex Skill；B3 起 migrate/adapt-device 并入） */
  async generatePage(input: GeneratePageInput): Promise<GeneratedPage> {
    const skills = input.skills ?? ['intent-to-flex']
    if (!skills.includes('intent-to-flex')) {
      throw new Error(`G-36 B2 仅支持 intent-to-flex Skill（收到：${skills.join(',')}——migrate/adapt-device 属 B3/B5）`)
    }
    // targetBackends → adaptation 空档声明（CMP020：不臆造约束——深层适配由 adapt-device B5 细化）
    const adaptation: Record<string, Record<string, unknown>> = { ...(input.adaptation ?? {}) }
    if (input.targetBackends) {
      for (const b of input.targetBackends) {
        if (!adaptation[b]) adaptation[b] = {}
      }
    }
    const result: IntentToFlexResult = await intentToFlex(
      { intent: input.intent, name: input.name, format: input.format, adaptation },
      { mcp: this._mcp },
    )
    return { name: result.name, code: result.code, ir: result.page.ir, adaptation: result.page.adaptation, blocks: result.blocks }
  }

  /** ★G-36 B3：小程序迁移（migrate-miniprogram Skill——G-31 B6 codemod 复用 + CMP019 映射日志 + 覆盖率） */
  async migrate(code: string, options: { skill?: string; name?: string } = {}): Promise<MigrateMiniprogramResult> {
    const skill = options.skill ?? 'migrate-miniprogram'
    if (skill !== 'migrate-miniprogram') {
      throw new Error(`未知迁移 Skill：${skill}（B3 支持 migrate-miniprogram）`)
    }
    return migrateMiniprogram({ source: code, name: options.name }, { mcp: this._mcp })
  }
}
