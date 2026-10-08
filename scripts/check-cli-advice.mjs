#!/usr/bin/env node
// scripts/check-cli-advice.mjs —— ★★CLI 建议「解耦框架源码」门禁（2026-10-09 · 决策 #688）
//
// 【为什么立（用户原话）】「项目里面执行诊断给的修复是**项目不存在的方式**（`bash hosts/ios/signing.sh …`）……
//   cli 输出的所有建议应该是**解耦框架源码单独可用**的才行」。
//   ——`hosts/`、`scripts/setup-*`、`build-runtime-aar.sh` 是**框架 checkout 才有**的东西；
//   真实用户（自己工程 + `npx proteus`）没有它们 ⇒ 这类"修复命令"对用户是**死链**（跑了报 not found）。
//   ★这是"体检器伪造安全感"的第二种形态：命令存在，但**在用户环境里不存在**。
//
// 【判据】扫 `packages/cli/src/**` 里**面向用户的建议字段**（fix.command / fix.description / suggestions[] /
//   hint / desc / 逃生：`hints:` DIAG_CODES），出现**框架专属路径**即红：
//     · `bash hosts/` / `hosts/<端>/…`（框架参考宿主脚本）
//     · `scripts/setup-` / `scripts/check-`（框架仓脚本）
//     · `build-runtime-aar.sh`（框架仓构建脚本）
//   合法例外：① 注释（`//`）与文档字段（`docs:` 指向框架 README 的路径）——`docs` 允许（是"另见"非"执行"）；
//   ② **check-id 命名空间**（如 `'hosts/ios'` 作为 id/title/checkId）——那是标识符不是路径，靠 `bash `/`./` 前缀区分。
//
// 用法：node scripts/check-cli-advice.mjs [--json]
// 退出码：0 通过 / 1 有框架专属建议 / 2 前置缺失
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'packages/cli/src')
const JSON_OUT = process.argv.includes('--json')

if (!fs.existsSync(SRC)) {
  console.error(`✗ 找不到 ${SRC}`)
  process.exit(2)
}

/** 框架专属路径指纹（出现在"要用户执行"的建议里 = 死链） */
const FRAMEWORK_PATTERNS = [
  { re: /\bbash\s+hosts\//, why: 'bash hosts/…（框架参考宿主脚本）' },
  { re: /\bnode\s+hosts\//, why: 'node hosts/…（框架脚本）' },
  { re: /\bbash\s+scripts\/(?:setup-|check-)/, why: 'bash scripts/{setup,check}-…（框架仓脚本）' },
  { re: /build-runtime-aar\.sh/, why: 'build-runtime-aar.sh（框架仓构建脚本）' },
  { re: /scripts\/setup-android-js-engine\.sh/, why: '框架 JS 引擎安装脚本' },
]

/** 建议字段的指纹（只挑"面向用户执行/指导"的键——避免误伤注释与 check-id） */
const ADVICE_KEY = /(fix\s*:\s*\{[^}]*|suggestions\s*:\s*\[[^\]]*\]|command\s*:\s*'[^']*'|description\s*:\s*'[^']*'|hints?\s*:\s*\[[^\]]*\]|desc\s*:\s*'[^']*')/g

const problems = []
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) { walk(full); continue }
    if (!/\.ts$/.test(e.name)) continue
    const src = fs.readFileSync(full, 'utf-8')
    const rel = path.relative(ROOT, full)
    // 逐行扫（保留行号）——只对该行里"建议片段"匹配（去掉注释行）
    src.split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '') // 去行尾注释
      if (/^\s*\/\//.test(line)) return // 纯注释行跳过
      ADVICE_KEY.lastIndex = 0
      const adviceChunks = [...line.matchAll(ADVICE_KEY)].map((m) => m[0]).join(' ')
      if (!adviceChunks) return
      for (const p of FRAMEWORK_PATTERNS) {
        if (p.re.test(adviceChunks)) {
          problems.push({ file: rel, line: i + 1, why: p.why, snippet: line.trim().slice(0, 120) })
        }
      }
    })
  }
}
walk(SRC)

if (JSON_OUT) {
  console.log(JSON.stringify({ ok: problems.length === 0, problems }, null, 2))
  process.exit(problems.length === 0 ? 0 : 1)
}

console.log('[check-cli-advice] CLI 建议「解耦框架源码」门禁')
if (problems.length) {
  for (const p of problems) console.log(`  ✗ ${p.file}:${p.line}  ${p.why}\n      ${p.snippet}`)
  console.log(`\n★修复：把"框架专属命令"换成 CLI 自带能力（如 \`proteus host signing ios --list\`）或通用安装命令/GUI 指引。`)
  process.exit(1)
}
console.log('  ✅ 全部面向用户的建议均解耦框架源码（无 hosts/ · scripts/setup- · build-runtime-aar.sh 死链）')
