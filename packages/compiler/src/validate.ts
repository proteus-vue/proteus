// src/compiler/validate.ts
// 产物自校验 —— 反编译黑盒的核心机制
// 编译器如果产出坏产物（js 语法错误 / wxml 标签不配对），必须当场抛错并指明文件，
// 绝不静默输出不可用的产物（对比 uni-app 编译产物无法定位问题）。
import type { CompileResult } from './types'

/** 编译产物校验错误（携带源文件名，便于定位） */
export class CompilerError extends Error {
  constructor(
    public filename: string,
    message: string,
  ) {
    super(`[proteus-compiler] ${filename}: ${message}`)
    this.name = 'CompilerError'
  }
}

/** JS 语法校验：new Function 仅解析不执行（产物为 Page()/Component() 调用，无 import/export） */
export function validateJs(js: string): { ok: boolean; error?: string } {
  try {
    // eslint-disable-next-line no-new-func
    new Function(js)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** WXML 标签配对校验（先剥离注释，避免行号注释中的标签文本干扰） */
export function validateWxml(wxml: string): { ok: boolean; error?: string } {
  const withoutComments = wxml.replace(/<!--[\s\S]*?-->/g, '')
  const tagRe = /<\/?([a-zA-Z][\w-]*)(?:"[^"]*"|'[^']*'|[^>"'])*\/?>/g
  const stack: string[] = []
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(withoutComments))) {
    const full = m[0]
    const name = m[1]
    if (full.startsWith('</')) {
      const top = stack.pop()
      if (top !== name) {
        return { ok: false, error: `</${name}> 与 <${top ?? '(无)'}> 不匹配（位置 ${m.index}）` }
      }
    } else if (!full.endsWith('/>')) {
      stack.push(name)
    }
  }
  if (stack.length) {
    return { ok: false, error: `<${stack[stack.length - 1]}> 未闭合` }
  }
  return { ok: true }
}

/** 校验整包编译结果，失败抛 CompilerError */
export function assertValidResult(result: CompileResult, filename: string): void {
  const jsCheck = validateJs(result.js)
  if (!jsCheck.ok) {
    throw new CompilerError(filename, `js 产物语法错误：${jsCheck.error}`)
  }
  const wxmlCheck = validateWxml(result.wxml)
  if (!wxmlCheck.ok) {
    throw new CompilerError(filename, `wxml 产物结构错误：${wxmlCheck.error}`)
  }
}
