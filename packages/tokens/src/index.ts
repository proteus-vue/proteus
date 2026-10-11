// packages/tokens/src/index.ts
// @proteus-vue/tokens —— ★★★Proteus UI 宪法（Charites Design Tokens）
//   单一真源：`--sa-*` 视觉 token（浅/深两套）+ 汇总 `--pf-*` 环境变量契约；
//   提供：token 表 + CSS 生成 + WCAG 对比度审计（门禁 check:tokens 的判据核心）。零依赖。
//
// 【宪法三套命名空间收口（OS级组件库方案 §5）】`--sa-*`（视觉，本包）∪ `--pf-*`（环境，
//   contracts/env-vars）∪ 组件字面值（禁裸值，靠 lint 棘轮）。
export type { TokenDef, TokenGroup } from './tokens'
export { SA_TOKENS, darkOverrides, tokensByGroup } from './tokens'

export { emitLightCss, emitDarkCss, extractTokenDecls } from './css'

export { parseColor, wcagRatio, CONTRAST_PAIRS, auditTokenContrast } from './audit'
