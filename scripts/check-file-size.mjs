#!/usr/bin/env node
// scripts/check-file-size.mjs —— ★静态门禁：禁止大文件巨型化（决策 #872）
//
// 【为什么需要（用户 2026-10-13 明令）】「把严禁大文件巨型化的规范也放到 AI 协作规范里，
//   防止后面 AI 写的代码又是一个几千行的大文件」。实测背景（外部审查点名 + 本仓现状）：
//   `packages/api/src/capability.ts` 曾达 8987 行（决策 #870 已拆为三层）；全仓当前仍有
//   ≥1500 行 29 个、≥1000 行 51 个源文件。**规则只写在 markdown 拦不住**（本仓反复验证的教训：
//   sleep 盲等 / 全量重复跑 / 提交不推 —— 都只有工具层门禁是结构性的）⇒ 配机器判据。
//
// 【判据（棘轮，与本仓 no-blind-wait / loop-guard 同款）】
//   · **新增文件硬上限 = 1000 行**：任何**不在基线里**的源文件 ≥ 1000 行 ⇒ 红（新代码从今天起零容忍）；
//   · **存量棘轮**：当前 ≥ 1000 行的文件写入 `scripts/file-size-baseline.json`（按**行数上限**钉住），
//     **只减不增**——增长 ⇒ 红；拆分降到 1000 以下 ⇒ 通过（提示 --write 降钉）；
//   · **具名豁免** `ALLOW`（path → 理由）：确有不可拆理由的文件整体豁免（默认空；加一项即等于登记一个例外）。
//
// 【扫描面（源码，排除生成物/产物/依赖/夹具 bundle）】roots = packages hosts scripts tests examples
//   showcase superapp website；扩展名 = .ts .tsx .vue .rs .java .kt .swift .ets .mjs .cjs .py .sh；
//   排除 = node_modules / dist / build / .proteus / generated / .tools / assets / rawfile /
//   __snapshots__ / *.generated.* / *.min.* / bundle-*.js。
//
// 用法：node scripts/check-file-size.mjs [--write|--list] [--cap N]
//   --write  把当前 ≥cap 的文件按行数写回基线（拆分/收缩后**显式重生成**）
//   --list   打印全部越线明细（行数排序）
// 退出码：0 通过 / 1 命中
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const baseArg = argv.indexOf('--baseline')
const BASELINE = baseArg >= 0 && argv[baseArg + 1] ? path.resolve(argv[baseArg + 1]) : path.join(ROOT, 'scripts', 'file-size-baseline.json')

const CAP = 1000
const ROOTS = ['packages', 'hosts', 'scripts', 'tests', 'examples', 'showcase', 'superapp', 'website']
// ★★#1137：补 .h / .cpp —— 此前完全漏掉（鸿蒙 C++ 宿主整个在棘轮外）。
//   实测：host_app_runtime_impl.h 1134 行、proteus_render.cpp 3701 行等 7 个 >=1000 行文件
//   从未被这份门禁看过（门禁报 51 个越线，实际源码面是 58 个）。
//   ★与 #1136「忽略规则写错后缀 ⇒ 静默失效」同族：判据的覆盖面必须跟着真实文件类型走。
const EXT = ['.ts', '.tsx', '.vue', '.rs', '.java', '.kt', '.swift', '.ets', '.mjs', '.cjs', '.py', '.sh', '.h', '.cpp', '.hpp', '.cc']
const SKIP_SEG = /(^|\/)(node_modules|dist|build|\.proteus|generated|\.tools|assets|rawfile|__snapshots__)(\/|$)/
const SKIP_NAME = /(\.generated\.|\.min\.|bundle-.*\.js$|\.d\.ts$)/

/** 具名豁免（path → 理由）。默认空；每一项 = 一个登记在案的例外（须写明不可拆理由）。 */
const ALLOW = {
  // ★#1129：能力 demo 页生成器 = 27 页的**数据表** + 一套固定骨架，职责单一、无分支可拆。
  //   已把「页→实现侧类型」映射抽到 lib/demo-page-type-ssot.mjs（那是本轮新增的最大一块）；
  //   剩下的是 27 组手写 API/compat 行，拆开只会让"改一页要跨两文件"，反而更容易漏。
  //   ★这不是"为过门禁而豁免"：文件确实只有 1 个职责（渲染能力详情页），且 1000 行来自**数据**不是逻辑。
  'scripts/gen-capability-demo-pages.mjs': '单职责（27 页数据表 + 固定骨架）；映射表已抽出，剩余为纯数据行',
}

function walk(dir, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue
    const p = path.join(dir, e.name)
    const rel = path.relative(ROOT, p)
    if (SKIP_SEG.test(rel) || SKIP_NAME.test(e.name)) continue
    if (e.isDirectory()) walk(p, out)
    else if (EXT.some((x) => e.name.endsWith(x))) out.push(p)
  }
  return out
}

const files = ROOTS.flatMap((r) => walk(path.join(ROOT, r)))

const sizes = [] // { rel, lines }
for (const f of files) {
  const rel = path.relative(ROOT, f)
  if (rel in ALLOW) continue
  let lines
  try { lines = fs.readFileSync(f, 'utf-8').split('\n').length } catch { continue }
  sizes.push({ rel, lines })
}
sizes.sort((a, b) => b.lines - a.lines)

const args = process.argv.slice(2)
const capFlag = args.indexOf('--cap')
const cap = capFlag >= 0 && args[capFlag + 1] ? Number(args[capFlag + 1]) : CAP

if (args.includes('--write')) {
  const data = Object.fromEntries(sizes.filter((s) => s.lines >= cap).map((s) => [s.rel, s.lines]))
  fs.writeFileSync(BASELINE, JSON.stringify(data, null, 2) + '\n')
  console.log(`✅ 基线已写入 scripts/file-size-baseline.json（${Object.keys(data).length} 个 ≥${cap} 行文件被钉住，只减不增）`)
  process.exit(0)
}

let baseline = {}
if (fs.existsSync(BASELINE)) baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))

const problems = []
const pending = []
for (const { rel, lines } of sizes) {
  const base = baseline[rel]
  if (base === undefined) {
    if (lines >= cap) problems.push({ rel, kind: '新增大文件', detail: `${lines} 行 ≥ 上限 ${cap}（新文件不得越线）` })
  } else if (lines > base) {
    problems.push({ rel, kind: '大文件增长', detail: `${base} → ${lines} 行（存量只减不增）` })
  } else if (lines < base) {
    pending.push({ rel, lines, base })
  }
}

console.log(`文件大小门禁（扫 ${files.length} 个源文件；硬上限 ${cap} 行；豁免 ${Object.keys(ALLOW).length} 个）`)

if (args.includes('--list')) {
  for (const s of sizes.filter((s) => s.lines >= cap)) console.log(`  · ${String(s.lines).padStart(6)}  ${s.rel}`)
}

if (problems.length) {
  console.error(`\n❌ 发现 ${problems.length} 个巨型文件问题（单文件应 < ${cap} 行）：\n`)
  for (const p of problems) console.error(`  ${p.rel}  [${p.kind}] ${p.detail}`)
  console.error('\n  正确做法（users 2026-10-13 明令「严禁大文件巨型化」）：')
  console.error('   ① **按职责拆文件**（类型/实现/平台桥/工厂各自成文件，见决策 #870 的 capability 三层拆分范例）；')
  console.error('   ② 拆完跑对应门禁（`pnpm test:coupled` / 定向测试）+ `--write` 更新本基线（只减不增）；')
  console.error('   ③ 确有不可拆理由 ⇒ 在 scripts/check-file-size.mjs 的 ALLOW 里**具名登记 + 写理由**（不要沉默越线）。')
  console.error('  ★文件头也须自问：这个文件有几个职责？> 1 就拆。')
  process.exit(1)
}

if (pending.length) {
  console.log(`  ⏳ 存量待继续拆 ${pending.length} 个文件（基线钉住，只减不增）：`)
  for (const p of pending) console.log(`     · ${p.rel}: ${p.base} → ${p.lines} 行（已收缩，可 --write 降钉）`)
}

console.log(`\n✅ 无新增巨型文件（存量 ≥${cap} 行已由基线钉住，只减不增）`)
