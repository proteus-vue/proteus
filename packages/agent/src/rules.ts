// packages/agent/src/rules.ts
// ★G-36 B2（proteus-ai-agent-plan 04-agent-kit §2）：withProteusRules——系统约束注入
//   Agent 产码前注入 G-31/32 约束（SystemRule 形态对齐 plan；LLM system prompt / 规则引擎校验共用）
export interface SystemRule {
  readonly id: string
  readonly text: string
}

/** ★G-36 B2：Proteus 系统规则集（04-agent-kit §2 清单） */
export function withProteusRules(): SystemRule[] {
  return [
    { id: 'G-36.2', text: '禁止生成 <view>/<scroll-view> 等小程序组件，改用 G-32 原语' },
    { id: 'G-36.3', text: '禁止裸写 wx.* / uni.*，改用 use* Hook 或 useMiniProgram()' },
    { id: 'CMP017', text: '颜色仅限 design-tokens.json 登记值' },
    { id: 'G-31.1', text: '组件必须以 p- 前缀，语义命名' },
    { id: 'G-29', text: '输出须可序列化为 Component IR' },
  ]
}
