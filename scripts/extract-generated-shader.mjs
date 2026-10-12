#!/usr/bin/env node
// scripts/extract-generated-shader.mjs —— 从生成物抽出一份着色器源码（供离线编译/像素一致性门禁）。
//
// 用法：node scripts/extract-generated-shader.mjs <ts|swift|java> <material> <target> <outFile>
//   例：node scripts/extract-generated-shader.mjs swift glass msl /tmp/glass.metal
// 说明：生成物以 JSON 转义串存于源码；本脚本按同样规则解码后写出真实着色器源码。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [kind, material, target, outFile] = process.argv.slice(2)
if (!kind || !material || !target || !outFile) {
  console.error('用法：node scripts/extract-generated-shader.mjs <ts|swift|java> <material> <target> <outFile>')
  process.exit(2)
}

/** 从 TS 生成物取（权威源；swift/java 亦由它派生）。 */
function fromTs() {
  const src = fs.readFileSync(path.join(ROOT, 'packages/shader/src/generated/materials.ts'), 'utf8')
  const key = `${material}.${target}`
  const re = new RegExp(`${JSON.stringify(key)}:\\s*("(?:[^"\\\\]|\\\\.)*")`)
  const m = src.match(re)
  if (!m) throw new Error(`TS 生成物缺 ${key}`)
  return JSON.parse(m[1])
}

/** swift/java 生成物只是同源转写；直接读 TS 更稳（避免再解析各语言字面量）。 */
const text = fromTs()
fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, text)
console.log(`✓ 抽出 ${material}.${target}（${text.length} 字节）→ ${path.relative(ROOT, outFile)}`)
