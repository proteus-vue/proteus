// packages/tokens/src/css.ts —— 由 token 表生成 CSS 变量块（浅色 `:root` + 深色覆盖）。
//   ★用途：① 门禁 `check:tokens` 校验工程样式表与本表一致（防双写漂移）；
//           ② 未来工程样式表可直接由此生成（单一真源 → 产物）。
import type { TokenDef } from './tokens'
import { SA_TOKENS, darkOverrides } from './tokens'

/** 生成 `:root { … }` 浅色块（token 定义；缩进/格式对齐 global.css 惯例）。 */
export function emitLightCss(tokens: Record<string, TokenDef> = SA_TOKENS): string {
  const lines = Object.entries(tokens).map(([k, v]) => `  ${k}: ${v.value};`)
  return `:root {\n${lines.join('\n')}\n}`
}

/** 生成深色覆盖块（选择器与 global.css 同：`:root.sa-dark, page.sa-dark, .sa-dark`）。 */
export function emitDarkCss(tokens: Record<string, TokenDef> = SA_TOKENS): string {
  const dark = darkOverrides(tokens)
  const lines = Object.entries(dark).map(([k, v]) => `  ${k}: ${v};`)
  return `:root.sa-dark,\npage.sa-dark,\n.sa-dark {\n${lines.join('\n')}\n}`
}

/**
 * 从一段 CSS 文本里抽取 `--sa-*` / `--p-*` 变量的 `name → value` 映射（用于门禁比对）。
 * ★只抽**声明**（`name: value;`），不做 CSS 解析——本仓 token 块格式规整（顶层 `name: value;`）。
 */
export function extractTokenDecls(cssText: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /(--(?:sa|p)-[\w-]+)\s*:\s*([^;]+);/g
  let m: RegExpExecArray | null
  while ((m = re.exec(cssText)) !== null) out[m[1]!] = m[2]!.trim()
  return out
}
