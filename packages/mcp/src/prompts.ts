// packages/mcp/src/prompts.ts
// ★G-36 B1（proteus-ai-agent-plan 03-mcp-server §4）：MCP Prompts（可复用提示词模板）
export interface McpPrompt {
  readonly name: string
  readonly description: string
  /** 模板消息（role=user） */
  messages: ReadonlyArray<{ role: 'user'; content: string }>
}

const FLEX_LAYOUT_PROMPT = [
  '你在为 Proteus 框架构造柔性布局（G-22 Fluid System）。规则：',
  '1. 只使用 p-* 语义原语（p-grid/p-stack/p-split/p-fit/p-fluid），禁止手写 media query / 硬编码断点',
  '2. 尺寸一律经过 p-fluid 表达式（如 p-fluid="font-size(20, 32)"）或 p-* 约束属性（min-col-width 等）',
  '3. 颜色/间距/字号只用 design token（get_design_token 查询），禁止硬编码',
  '4. 断点判断交给容器（createContainerQuery），禁止 if (width > 768) 手动分支（铁律 G-22.5）',
  '5. 产出后用 validate_ir 自校验，再 run_conformance 过六端',
].join('\n')

const MIGRATE_WX_PROMPT = [
  '你在把微信小程序页面迁移到 Proteus（G-31 Layer 1 兼容层策略）。SOP：',
  '1. 先用 lookup_miniprogram 查询每个 wx API / 组件的 Proteus 对等物',
  '2. 1:1 组件（view/text/button…）自动替换为 p-* 原语（proteus migrate mp 可批量）',
  '3. 回调式 API（wx.request）改写为 Hook（useFetch/useStorage），无法自动的标注 [proteus-migrate:manual]',
  '4. 同步存储 wx.setStorageSync → useStorage().set',
  '5. 产出后 validate_ir + run_conformance 验证，人工只处理 manual 标注项',
].join('\n')

const TOKEN_ONLY_PROMPT = [
  '你在为 Proteus 页面赋样式值。强制规则：',
  '1. 所有颜色/字号/间距/圆角必须来自 get_design_token 返回的 token',
  '2. 生成代码中出现任何字面色值（#fff 等）即为违规——先查 token 再写',
  '3. 语义色（primary/danger/success）优先于裸色名',
].join('\n')

/** ★G-36 B1：3 个可复用提示词模板 */
export const MCP_PROMPTS: readonly McpPrompt[] = [
  { name: 'proteus-flex-layout', description: '柔性布局构造指引（G-22 原语 + 禁手动断点）', messages: [{ role: 'user', content: FLEX_LAYOUT_PROMPT }] },
  { name: 'proteus-migrate-wx', description: '小程序迁移 SOP（lookup_miniprogram + 自动/手动分层）', messages: [{ role: 'user', content: MIGRATE_WX_PROMPT }] },
  { name: 'proteus-token-only', description: '强制只用 Token 取色（禁硬编码色值）', messages: [{ role: 'user', content: TOKEN_ONLY_PROMPT }] },
]
