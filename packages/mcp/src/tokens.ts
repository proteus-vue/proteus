// packages/mcp/src/tokens.ts
// ★G-36 B1（proteus-ai-agent-plan 03-mcp-server §2 get_design_token）：design token 初版 SSOT
//   Agent 强制只用 Token 取色/取值（G-36 铁律——禁硬编码色值/尺寸）；后续可外接真实 tokens.json
//   结构对齐 03-mcp-server：颜色 / 字号 / 间距 / 后端色（语义色 → 各端原生值由 Backend 消费）

export interface DesignTokenGroup {
  readonly [name: string]: string | DesignTokenGroup
}

/** ★G-36 B1：design token 树（初版 SSOT——语义命名，业务禁绕过 Token 直写值） */
export const DESIGN_TOKENS: DesignTokenGroup = {
  color: {
    primary: '#4f7cff',
    onPrimary: '#ffffff',
    surface: '#ffffff',
    background: '#f5f6f8',
    textPrimary: '#1a1a1a',
    textSecondary: '#666a73',
    textFaint: '#9aa0aa',
    border: '#e3e6eb',
    danger: '#e5484d',
    success: '#30a46c',
    warning: '#f5a623',
  },
  font: {
    size: {
      xs: '11px',
      sm: '12px',
      md: '14px',
      lg: '17px',
      xl: '20px',
      xxl: '24px',
    },
    weight: {
      regular: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
    },
  },
  space: {
    xxs: '4px',
    xs: '8px',
    sm: '12px',
    md: '16px',
    lg: '24px',
    xl: '32px',
    xxl: '48px',
  },
  radius: {
    sm: '4px',
    md: '8px',
    lg: '12px',
    round: '999px',
  },
}

/** 按点路径取 token（`color.primary` / `font.size.md`；未命中 → undefined） */
export function designTokenAt(path: string): string | DesignTokenGroup | undefined {
  let node: string | DesignTokenGroup = DESIGN_TOKENS
  for (const seg of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    const next: string | DesignTokenGroup | undefined = (node as DesignTokenGroup)[seg]
    if (next === undefined) return undefined
    node = next
  }
  return node
}
