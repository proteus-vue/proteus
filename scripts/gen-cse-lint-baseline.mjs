#!/usr/bin/env node
// scripts/gen-cse-lint-baseline.mjs —— ★★★G-61 B4：**CSE lint 存量基线**（棘轮：只减不增）
//
// 【为什么需要（与 profile-boundary 同款动机 + 首次全仓构建的实测）】CSE lint 挂进构建链后，
//   首跑即抓出**存量真问题**（如 `p-popup` 的 `:class="computed 拼串"`——E-CSS-004 的正确判定，
//   但修它要动弹层动画状态机）。直接全拦 ⇒ 全仓构建红、机制上不了线；直接放过 ⇒ 存量永久噪音。
//   ⇒ 基线把存量**钉住**（构建放行 + 如实计数），**新增**当场红；**修一条从基线删一条**。
//
// 【与 profile-boundary-baseline 的关系】两者是**互补**的（字符串级 vs 语义级），各自有基线：
//   · `<proj>/profile-boundary-baseline.json`（VC2-b：CSS-PB-* 规则）
//   · `<proj>/cse-lint-baseline.json`（本脚本：E-CSS-*/W-CSS-* 规则）
//
// 【★键口径（必须与插件运行时一致）】插件里 `rel = relative(viteRoot, id)` ⇒ 键 = `${rel}:${code}`。
//   本脚本对每个 `.vue` 做**同样的提取 + lint**（复用 compiler 的 CSE 与 lintCse，同一实现——
//   否则"生成时的判据"与"运行时的判据"会漂移）。
//
// 用法：
//   node scripts/gen-cse-lint-baseline.mjs            # 生成/刷新（**新增条目必须人工确认理由**）
//   node scripts/gen-cse-lint-baseline.mjs --check    # 漂移检查（重算 vs 已提交；不一致 exit 1）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')

const compiler = await import(pathToFileURL(path.join(ROOT, 'packages/compiler/dist/index.js')).href)
const { extractFromSfc, buildDynamicClassPlans, lintCse } = compiler

/** 扫描面（与 profile-boundary 同款：examples/showcase/website 三工程 + 组件库） */
const PROJECTS = {
  examples: ['examples/pages', 'examples/components', 'examples/subpackages', 'packages/components'],
  showcase: ['showcase/pages', 'showcase/components', 'showcase/subpackages', 'packages/components'],
  website: ['website/src', 'packages/components'],
}

/** ★存量理由（逐条人工确认的登记；键 = `<rel>:<code>`，按项目分组）
 *  ★纪律：新出现的条目**不在表里** ⇒ 基线生成时用默认理由并**打印警告**（要求人工确认）。 */
const REASONS = {
  examples: {},
  showcase: {},
  website: {},
  // 组件库在三个项目下公共（路径前缀不同）——统一表
}
const DEFAULT_REASON = '存量待专项评估（B4 首次全仓扫描）——修一条从基线删一条（棘轮只减不增）'

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (!/^(node_modules|dist|\.)/.test(e.name)) walk(p, acc)
      continue
    }
    if (e.name.endsWith('.vue')) acc.push(p)
  }
  return acc
}

let drift = 0
const summary = []
let unregistered = 0
for (const [proj, dirs] of Object.entries(PROJECTS)) {
  const projRoot = path.join(ROOT, proj)
  const baseline = {}
  for (const d of dirs) {
    for (const file of walk(path.join(ROOT, d))) {
      const src = fs.readFileSync(file, 'utf-8')
      if (!src.includes('<style') && !src.includes(':class')) continue
      let diags
      try {
        const ex = extractFromSfc(src)
        let classPlans
        let dynamicErrors
        if (Object.keys(ex.classBindings).length > 0) {
          const built = buildDynamicClassPlans(ex.roots, ex.sheet, ex.classBindings)
          classPlans = built.plans
          const errs = built.diagnostics.filter((x) => x.level === 'error')
          if (errs.length > 0) {
            dynamicErrors = errs.map((x) => {
              const m = /^(\S+?)（:class="([^"]*)"）/.exec(x.message)
              return { nodeKey: m?.[1] ?? '?', expr: m?.[2] ?? '', reason: x.hint ?? x.message }
            })
          }
        }
        diags = lintCse(ex.sheet, ex.roots, {
          target: proj === 'website' ? 'web' : 'web',
          ...(classPlans ? { classPlans } : {}),
          ...(dynamicErrors ? { dynamicErrors } : {}),
        })
      } catch {
        continue // 解析失败（非本工具面——由其它门禁管）
      }
      const rel = path.relative(projRoot, file).replace(/\\/g, '/')
      for (const d of diags) {
        const key = `${rel}:${d.code}`
        if (!(key in baseline)) baseline[key] = REASONS[proj]?.[key] ?? DEFAULT_REASON
      }
    }
  }
  const file = path.join(projRoot, 'cse-lint-baseline.json')
  const json = JSON.stringify(Object.fromEntries(Object.entries(baseline).sort(([a], [b]) => a.localeCompare(b))), null, 2) + '\n'
  const n = Object.keys(baseline).length
  summary.push(`${proj}: ${n} 条`)
  if (CHECK) {
    const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : ''
    if (prev !== json) {
      drift++
      const prevKeys = new Set(Object.keys(JSON.parse(prev || '{}')))
      const newKeys = new Set(Object.keys(baseline))
      const added = [...newKeys].filter((k) => !prevKeys.has(k))
      const removed = [...prevKeys].filter((k) => !newKeys.has(k))
      console.error(`  ✗ ${proj} 基线漂移：新增 ${added.length} 条（新增违规必须修或**显式理解后**刷新基线）；已修 ${removed.length} 条（应从基线删除）`)
      for (const k of added.slice(0, 6)) console.error(`      + ${k}`)
      for (const k of removed.slice(0, 6)) console.error(`      - ${k}`)
    } else {
      console.log(`  ✅ ${proj} 基线一致（${n} 条）`)
    }
  } else {
    // ★未登记（默认理由）的**新增**条目提示人工确认（棘轮纪律：显式理解）
    const fresh = Object.entries(baseline).filter(([k, v]) => v === DEFAULT_REASON && REASONS[proj]?.[k] === undefined)
    if (fresh.length > 0 && fs.existsSync(file)) {
      const prevKeys = new Set(Object.keys(JSON.parse(fs.readFileSync(file, 'utf-8') || '{}')))
      const brandNew = fresh.filter(([k]) => !prevKeys.has(k))
      if (brandNew.length > 0) {
        unregistered += brandNew.length
        console.warn(`  ⚠ ${proj} 新登记 ${brandNew.length} 条（用默认理由）——请在 REASONS 里写明**逐条理由**：`)
        for (const [k] of brandNew.slice(0, 8)) console.warn(`      ${k}`)
      }
    }
    fs.writeFileSync(file, json)
    console.log(`[gen-cse-lint-baseline] ✅ ${path.relative(ROOT, file)}（${n} 条）`)
  }
}
if (CHECK) {
  console.log(`  ▸ ${summary.join(' · ')}`)
  if (drift) process.exit(1)
  console.log('✅ CSE lint 基线无漂移')
} else if (unregistered > 0) {
  console.log(`⚠ 共 ${unregistered} 条新登记——本轮已用默认理由写盘；请人工评审并补 REASONS（本仓"显式理解"纪律）`)
}
