#!/usr/bin/env node
// scripts/check-scroll-safety.mjs —— ★★SC2 静态门禁：可停靠滚动容器的声明面
//   （《Proteus_可停靠滚动容器与滚动编排能力方案》§6.1 封闭集 / §6.2 五条硬约束 / §6.3 逃生口）
//
// 【它补的是什么（编译器校验之外的第二个防线）】与 `layer-safety` 同源理由：
//   `compileVueSfc` 里的校验只覆盖**被构建的页面**；本门禁直接扫全部 .vue 源文件
//   （不依赖构建）——"全量 + 构建"两道，任一道都能拦。
//
// 【为什么必须机器强制（方案 §6.2）】五条约束里最要命的是 **SC002**：
//   iOS 默认"扩展"、Android 默认"不扩展"——依赖默认值 = **跨端静默差异**（方案 §5.2）；
//   以及 **SC001**（鸿蒙最多 3 档，超出会失败）——不报错就会在鸿蒙端静默降级。
//
// 判据（与 compiler/scroll-safety.ts **同一实现**——单一来源，不复制规则）：
//   SC001 档位 ≤3 且递增 · SC002 nested 必填 · SC003 initial ∈ detents ·
//   SC004 system 回弹（警告级，登记提示）· SC005 逃生口
//
// 用法：node scripts/check-scroll-safety.mjs [--json]
// 退出码：0 通过 / 1 存在 error 级违规 / 2 前置缺失（dist 未构建）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const JSON_OUT = process.argv.includes('--json')

const distPath = path.join(ROOT, 'packages/compiler/dist/scroll-safety.js')
if (!fs.existsSync(distPath)) {
  console.error(`[scroll] ✗ 缺 ${path.relative(ROOT, distPath)}——先构建：node scripts/build-packages.mjs`)
  process.exit(2)
}
const { validateScrollUsage } = await import(distPath)

/**
 * 扫描面：**跨端应用代码**（与 check-layers.mjs 同口径——website/ 是单端纯 Web 产物，
 * 不参与跨端声明面校验）。★若未来官网接入 Proteus 编译链（成为"第六端"），届时纳回。
 */
const SCAN_DIRS = ['examples/pages', 'examples/subpackages', 'examples/components', 'showcase/src']
const SKIP_DIR = /(?:^|[/\\])(?:node_modules|dist|\.proteus|generated)(?:[/\\]|$)/

function* walkVue(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return // 目录不存在（如 showcase 未安装）——不算错
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (SKIP_DIR.test(p)) continue
    if (e.isDirectory()) yield* walkVue(p)
    else if (e.name.endsWith('.vue')) yield p
  }
}

const findings = []
let scanned = 0
for (const rel of SCAN_DIRS) {
  for (const file of walkVue(path.join(ROOT, rel))) {
    scanned++
    const src = fs.readFileSync(file, 'utf-8')
    const m = /<template[^>]*>([\s\S]*)<\/template>/.exec(src)
    const tpl = m ? m[1] : src
    for (const v of validateScrollUsage(tpl)) {
      findings.push({ file: path.relative(ROOT, file), ...v })
    }
  }
}

// SC004 是警告级（方案 §3.4：警告 + 登记允许差异清单——不阻断构建）
const errors = findings.filter((f) => f.code !== 'SC004')
const warnings = findings.filter((f) => f.code === 'SC004')

if (JSON_OUT) {
  console.log(JSON.stringify({ scanned, errors, warnings }, null, 2))
} else {
  console.log(`可停靠滚动容器门禁（SC2 · 方案 §6.2/§6.3）`)
  console.log(`  扫描 ${scanned} 个 .vue（${SCAN_DIRS.join(' · ')}）`)
  if (warnings.length) {
    // ★警告级要显式打出来（方案 §3.4"不得静默"）
    console.warn(`\\n⚠ ${warnings.length} 处警告级（overscroll: system——各端手感必然不一致）：`)
    for (const w of warnings) {
      console.warn(`  ${w.file}${w.line ? `:${w.line}` : ''}`)
      console.warn(`    [${w.code}] ${w.message}`)
      console.warn(`    修法：${w.hint}`)
    }
  }
  if (errors.length === 0) {
    console.log('  ✅ 无 error 级违规（档位 ≤3 递增 / nested 必填 / initial ∈ detents / 无逃生口）')
  } else {
    console.error(`\\n❌ 发现 ${errors.length} 处 error 级违规：`)
    for (const f of errors) {
      console.error(`\\n  ${f.file}${f.line ? `:${f.line}` : ''}`)
      console.error(`    [${f.code}] ${f.message}`)
      console.error(`    规则：${f.rule}`)
      console.error(`    修法：${f.hint}`)
    }
    console.error('\\n  ⇒ 声明式封闭集见 docs/Proteus_可停靠滚动容器与滚动编排能力方案.md §6')
  }
}

process.exit(errors.length === 0 ? 0 : 1)
