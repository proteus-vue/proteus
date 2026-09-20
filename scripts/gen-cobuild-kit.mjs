#!/usr/bin/env node
// scripts/gen-cobuild-kit.mjs —— ★由规范源生成 create-proteus 模板里的共建工具包
//
// 为什么需要它（2026-09-20）：共建机制必须**随脚手架自带**——新工程 `proteus create` 出来就该有，
// 而不是等人手动投递（那是 OPERATOR/web 一次性投递的老做法，换个项目就失效）。
//
// 规范源唯一：`packages/cli/src/cobuild-assets.ts`（随 @proteus-vue/cli 发布，任何工程 `proteus cobuild init` 都取自它）。
// 本脚本把同一份内容写进 create-proteus 模板，使新工程**开箱自带**；三者一致性由
// `scripts/check-cobuild-kit.mjs`（check:cobuild-kit）门禁校验——防「模板与规范源漂移」。
//
// 用法：node scripts/gen-cobuild-kit.mjs [--check]
//   （--check：只校验是否一致，不一致 → exit 1，不写盘）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TEMPLATE_DIR = path.join(ROOT, 'packages', 'create-proteus', 'templates')
const CHECK = process.argv.includes('--check')

// ★用**静态 import**（而非 await import(url)）：实测 tsx 下动态 import 本文件时，
//   `COBUILD_SKILL` 会是 undefined（其余 6 个导出正常）——静态 import 则全部正常。
//   与其追 tsx 的转译差异，不如用稳定的那条路径（本脚本本就是 ESM，静态 import TS 源由 tsx 处理）。
import { COBUILD_SKILL, LEDGER_CHECKER, ledgerSkeleton, reportTemplate, AGENTS_SECTION } from '../packages/cli/src/cobuild-assets.ts'

/** 从规范源取内容（静态 import——见上方注释） */
function loadCanonical() {
  return {
    skill: COBUILD_SKILL,
    checker: LEDGER_CHECKER,
    skeleton: ledgerSkeleton,
    report: reportTemplate,
    agentsSection: AGENTS_SECTION,
  }
}

/** 模板里要生成的文件（rel → 内容；`{{name}}` 由 copyTemplate 替换） */
function targets(c) {
  return {
    '.agents/skills/proteus-cobuild/SKILL.md': c.skill,
    'scripts/ledger_check.mjs': c.checker,
    'docs/框架问题台账.json': c.skeleton('{{name}}'),
    'docs/实战报告_proteus接入.md': c.report('{{name}}'),
    'AGENTS.md': `# AGENTS.md —— 本工程对 AI 会话的约定\n\n> 由 create-proteus 生成；接入 Proteus 框架共建机制。\n\n${c.agentsSection}`,
  }
}

const c = loadCanonical()
const files = targets(c)
let drift = 0
const lines = []

for (const [rel, content] of Object.entries(files)) {
  const abs = path.join(TEMPLATE_DIR, rel)
  const exists = fs.existsSync(abs)
  const same = exists && fs.readFileSync(abs, 'utf8') === content
  if (same) {
    lines.push(`  ✓ ${rel}`)
    continue
  }
  drift++
  if (CHECK) {
    lines.push(`  ✗ ${rel}（${exists ? '内容与规范源不一致' : '缺失'}）——跑 node scripts/gen-cobuild-kit.mjs 重新生成`)
  } else {
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
    lines.push(`  ${exists ? '↻ 更新' : '+ 新建'} ${rel}`)
  }
}

console.log(`[cobuild-kit] ${CHECK ? '校验' : '生成'} create-proteus 模板共建工具包（规范源：packages/cli/src/cobuild-assets.ts）`)
for (const l of lines) console.log(l)

if (CHECK && drift) {
  console.log(`\n✗ ${drift} 个文件与规范源不一致——共建机制在「模板」与「CLI」两处漂移了`)
  process.exit(1)
}
console.log(CHECK ? '\n✅ 模板与规范源一致' : `\n✅ 已生成 ${Object.keys(files).length} 个文件（新工程将自带共建机制）`)
