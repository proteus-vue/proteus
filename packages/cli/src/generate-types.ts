// packages/cli/src/generate-types.ts
// ★types-plan B3：proteus generate types —— JSON Schema 产物落盘（单一来源 config-schema.ts）
// --check：校验已生成文件与当前 schema 一致（CI 防漂移，exit 1）——铁律 #5 自动化
import fs from 'node:fs'
import path from 'node:path'
import { proteusConfigSchemaJson } from '@proteus/types/config-schema'

export interface GenerateTypesOptions {
  out?: string
  check?: boolean
}

export interface GenerateTypesResult {
  ok: boolean
  outFile: string
  written: boolean // check 模式下为 false（不写盘）
  drifted: boolean // check 模式：文件与 schema 不一致
  check: boolean // 是否 check 模式（format 分支判断）
}

/** 生成 JSON Schema 产物（默认 .proteus/proteus.config.schema.json） */
export function generateTypes(options: GenerateTypesOptions = {}): GenerateTypesResult {
  const outFile = path.resolve(options.out ?? path.join('.proteus', 'proteus.config.schema.json'))
  const content = proteusConfigSchemaJson()
  if (options.check) {
    const drifted = !fs.existsSync(outFile) || fs.readFileSync(outFile, 'utf-8') !== content
    return { ok: !drifted, outFile, written: false, drifted, check: true }
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, content)
  return { ok: true, outFile, written: true, drifted: false, check: false }
}

/** 渲染报告（纯函数） */
export function formatGenerateTypes(result: GenerateTypesResult): string {
  if (result.check) {
    return result.drifted
      ? `[proteus-types] ❌ ${result.outFile} 与当前 schema 不一致（运行 proteus generate types 重新生成；勿手动改 generated）`
      : `[proteus-types] ✅ ${result.outFile} 与当前 schema 一致`
  }
  return `[proteus-types] ✅ 已生成 JSON Schema：${result.outFile}`
}
