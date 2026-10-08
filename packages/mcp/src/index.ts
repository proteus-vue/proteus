// packages/mcp/src/index.ts —— @proteus-vue/mcp 公共入口（G-36 B1 MCP Server）
// 传输无关核心：11 工具 + 5 Resources + 3 Prompts + CMP021 鉴权策略 + **stdio 传输适配器**（决策 #681）
export { createMcpServer } from './server'
export type { McpServerOptions, ProteusMcpServer, McpCallResult } from './server'
export { MCP_TOOLS, validateToolArgs, capabilityMatrix, engineTier } from './tools'
export type { McpToolDef, McpToolDefWithHandler, McpToolSchemaProperty, ToolContext } from './tools'
export { MCP_RESOURCES } from './resources'
export type { McpResource } from './resources'
export { MCP_PROMPTS } from './prompts'
export type { McpPrompt } from './prompts'
export { DESIGN_TOKENS, designTokenAt } from './tokens'
export type { DesignTokenGroup } from './tokens'
// ★stdio 传输适配器（决策 #681）：MCP 客户端（Claude Desktop / Cursor…）直连入口
export { serveStdio, buildStdioServer, toJsonSchema, toProtocolTools, toProtocolCallResult } from './stdio'
export type { ServeStdioOptions } from './stdio'
