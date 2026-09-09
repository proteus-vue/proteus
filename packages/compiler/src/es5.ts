// packages/compiler/src/es5.ts
// ★#504 语言层转译交还 babel——方法论定案（用户拍板）：不自研成熟工具链，只自建语义层。
//   手写 ES2020→ES5 剥除器（stripEs5Nullish）在 p-segment 上产出新语法错误是活教训；babel 七年前就修完的课不再手写。
//   边界：仅 4 个表达式级 plugin（?? / ?. / 逻辑赋值 / 对象展开——微信开发者工具 babel 不解析的形态），
//   产物仍然零运行时依赖（babel 是编译期依赖，与 @vue/compiler-sfc 同一信任边界）。
//   inputSourceMap 组合：babel 接收 buildSourceMap 产物（产物行 → Vue 源行），输出转译后仍指向 Vue 源的合成 map。
import { transformSync } from '@babel/core'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import nullish from '@babel/plugin-transform-nullish-coalescing-operator'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import optionalChaining from '@babel/plugin-transform-optional-chaining'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import logicalAssignment from '@babel/plugin-transform-logical-assignment-operators'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import objectRestSpread from '@babel/plugin-transform-object-rest-spread'
// ★2026-09-09 真机预览实证缺口：数字分隔符（3600_000）——小程序 babel 不解析（Invalid or unexpected token）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import numericSeparator from '@babel/plugin-transform-numeric-separator'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PLUGINS: any[] = [nullish, optionalChaining, logicalAssignment, objectRestSpread, numericSeparator].map((p) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  typeof p === 'function' ? p : (p as any).default ?? p,
)

/** 快路径：产物是否残留微信编译器不解析的语法（?? ?. ??= ||= &&= 数字分隔符）——无则跳过 babel（大多数页面零开销） */
export function hasMpUnsafeSyntax(code: string): boolean {
  return (
    /\?\?|\?\./.test(code) ||
    /\|\|=/.test(code) ||
    /&&=/.test(code) ||
    /\?\?=/.test(code) ||
    // ★数字分隔符：`3600_000` / `0x1_2`（真机预览实证：Invalid or unexpected token）
    /\d_\d|\b0[xob][\da-fA-F_]+_/.test(code)
  )
}

export interface MpSafeResult {
  code: string
  /** babel 组合后的 sourcemap（输入 map 指向 Vue 源）；未转译 = undefined（沿用原 map） */
  sourcemap?: string
  changed: boolean
  /** babel 解析/转译失败时返回消息（原样保留代码 + 反黑盒警告——门禁 ES5 tripwire 会兜底报红） */
  error?: string
}

export function transpileMpSafe(code: string, inputSourceMap?: string): MpSafeResult {
  if (!hasMpUnsafeSyntax(code)) return { code, changed: false }
  try {
    const result = transformSync(code, {
      babelrc: false,
      configFile: false,
      sourceMaps: true,
      inputSourceMap: inputSourceMap ? JSON.parse(inputSourceMap) : undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      plugins: PLUGINS.map((p: any) => [p, {}]),
      compact: false,
      comments: true,
    })
    if (!result) return { code, changed: false }
    return {
      code: result.code ?? code,
      sourcemap: result.map ? JSON.stringify(result.map) : undefined,
      changed: true,
    }
  } catch (e) {
    return { code, changed: false, error: String((e as Error).message ?? e) }
  }
}
