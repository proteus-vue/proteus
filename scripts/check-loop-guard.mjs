#!/usr/bin/env node
// scripts/check-loop-guard.mjs —— ★静态门禁：**命令机 while 循环必须有「推进兜底」**（2026-10-12 · 决策 #867）
//
// 【为什么需要（同类缺陷已实证 3 次）】手写「命令字母 + 数字 token」的解析循环（`while (i < tk.length)`
//   里一个 `switch` 分派命令）有一个反复出现的致命形态：**某个 `case` 既不消费 token 也不推进下标**
//   ⇒ 当输入让 `cmd` 停在该 case、下一个 token 又是数字时，循环**原地空转**。已实证两处真实缺陷：
//     · `packages/components/p-svg-canvas/path-parser.ts`（`case 'Z'`）——直绘线程卡死 / animateMotion 内存爆炸 OOM；
//     · `packages/icons/src/normalize.ts`（同款克隆）——实测 `FATAL ERROR: heap out of memory`。
//   两者的修复形态一致：**循环尾兜底推进**（记入口下标，`if (i === iBefore) i++`）。
//   本门禁把「命令机必须有推进兜底」变成**结构判据**——防止第三次发生。
//
// 【判据（低误报，故意收窄）】只扫 `while` **体内含 `switch`** 的循环（全仓仅 2 处，正是命令机形态；
//   正则 `while ((m = re.exec(...)))` 那类无 switch，天然排除）。该循环视为"有推进兜底"当满足任一：
//     A. 循环体**顶层**有无条件推进：`i++` / `++i` / `i--` / `i += …` / `i = …`（`i` ∈ while 条件里的标识符）；
//     B. 循环体**顶层**有**进度守卫**：`if (<cond-id> === <其它>) <then/else 里有推进>`（本仓修复形态）；
//     C. **每个** `case`/`default`（有语句体）都推进 `i` 或转出（continue/return/throw/break-out）。
//   三者皆无 ⇒ 违规（存在"状态零变化"的分支可让循环空转）。
//
// 【基线机制（棘轮）】存量违规在 `scripts/loop-guard-baseline.json` 里按 文件:行 钉住，**只减不增**。
//   ★当前全仓 **0 违规**（两处真实缺陷已修）⇒ 基线为空 ⇒ **新代码从今天起零容忍**。
//
// 用法：node scripts/check-loop-guard.mjs [--write|--list]
// 退出码：0 通过 / 1 命中
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = path.join(ROOT, 'scripts', 'loop-guard-baseline.json')
const require = createRequire(import.meta.url)
const ts = require('typescript')

// ★白名单（具名豁免，须写具体理由）——按 `相对路径:行` 精确匹配。
const ALLOW = {
  // 'packages/xxx/yyy.ts:123': '理由：……',
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

/** while 条件里出现的标识符名（推进对象候选） */
function condIdentifiers(cond) {
  const ids = new Set()
  const visit = (n) => {
    if (ts.isIdentifier(n)) ids.add(n.text)
    ts.forEachChild(n, visit)
  }
  visit(cond)
  return ids
}

/** 该语句是否推进（写 id ∈ condIds）：i++ / ++i / i-- / i += … / i = … */
function advances(stmt, condIds) {
  let hit = false
  const visit = (n) => {
    if (ts.isPostfixUnaryExpression(n) || ts.isPrefixUnaryExpression(n)) {
      const op = n.operator
      if (op === ts.SyntaxKind.PlusPlusToken || op === ts.SyntaxKind.MinusMinusToken) {
        if (ts.isIdentifier(n.operand) && condIds.has(n.operand.text)) hit = true
      }
    }
    if (ts.isBinaryExpression(n)) {
      const k = n.operatorToken.kind
      if (
        k === ts.SyntaxKind.EqualsToken ||
        k === ts.SyntaxKind.PlusEqualsToken ||
        k === ts.SyntaxKind.MinusEqualsToken ||
        k === ts.SyntaxKind.AsteriskEqualsToken
      ) {
        if (ts.isIdentifier(n.left) && condIds.has(n.left.text)) hit = true
      }
    }
    // 不下钻嵌套循环（内层自管）
    if (ts.isWhileStatement(n) || ts.isForStatement(n) || ts.isForOfStatement(n)) return
    ts.forEachChild(n, visit)
  }
  visit(stmt)
  return hit
}

/** 该语句是否"转出循环"（continue / return / throw）——注意 `break` 在 switch 里是 switch-break，不算 */
function transfers(stmt) {
  let hit = false
  const visit = (n) => {
    if (ts.isContinueStatement(n) || ts.isReturnStatement(n) || ts.isThrowStatement(n)) hit = true
    if (ts.isWhileStatement(n) || ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isFunctionLike(n)) return
    ts.forEachChild(n, visit)
  }
  visit(stmt)
  return hit
}

/** 循环体顶层语句列表（块则展开；单语句则单元素） */
function topStatements(loopBody) {
  if (ts.isBlock(loopBody)) return loopBody.statements
  return [loopBody]
}

/** 找循环体内的 switch（不下钻嵌套循环） */
function findSwitches(loopBody) {
  const found = []
  const visit = (n) => {
    if (ts.isSwitchStatement(n)) { found.push(n); return }
    if (ts.isWhileStatement(n) || ts.isForStatement(n) || ts.isForOfStatement(n)) return
    ts.forEachChild(n, visit)
  }
  ts.forEachChild(loopBody, visit)
  if (ts.isSwitchStatement(loopBody)) found.push(loopBody)
  return found
}

/** 是否是"进度守卫"：`if (<cond-id> ===/==/!==/!= <expr>) <then 推进>`（本仓修复形态 `if (i === iBefore) i++`） */
function isProgressGuard(stmt, condIds) {
  if (!ts.isIfStatement(stmt)) return false
  const c = stmt.expression
  if (!ts.isBinaryExpression(c)) return false
  const k = c.operatorToken.kind
  const isEqCompare =
    k === ts.SyntaxKind.EqualsEqualsEqualsToken || k === ts.SyntaxKind.EqualsEqualsToken ||
    k === ts.SyntaxKind.ExclamationEqualsEqualsToken || k === ts.SyntaxKind.ExclamationEqualsToken
  if (!isEqCompare) return false
  const touchesId =
    (ts.isIdentifier(c.left) && condIds.has(c.left.text)) ||
    (ts.isIdentifier(c.right) && condIds.has(c.right.text))
  if (!touchesId) return false
  return !!stmt.thenStatement && advances(stmt.thenStatement, condIds)
}

/** 判定一个 while+switch 循环是否有推进兜底 */
function isGuarded(loop, condIds) {
  const tops = topStatements(loop.statement)
  // A. 顶层无条件推进
  for (const s of tops) {
    if (ts.isExpressionStatement(s) && advances(s.expression, condIds)) return true
  }
  // B. 顶层**进度守卫**（`if (i === iBefore) i++`）——只认等号比较 `i` 的形态，避免把
  //    `if (typeof t0 === 'string') { cmd=t0; i++ }` 这类"单分支推进"误当成兜底（实测会漏报）。
  for (const s of tops) {
    if (isProgressGuard(s, condIds)) return true
  }
  // C. 每个 case（有语句体）都推进或转出
  const sws = findSwitches(loop.statement)
  let allCasesOk = sws.length > 0
  for (const sw of sws) {
    for (const c of sw.caseBlock.clauses) {
      const stmts = c.statements
      if (stmts.length === 0) continue   // 空 case 落到下一个（由下一个判定）
      const ok = stmts.some((st) => advances(st, condIds) || transfers(st))
      if (!ok) allCasesOk = false
    }
  }
  return allCasesOk
}

function main() {
  const files = walk(path.join(ROOT, 'packages'))
  const violations = []
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8')
    if (!/\bwhile\s*\(/.test(src) || !/\bswitch\s*\(/.test(src)) continue
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true)
    const rel = path.relative(ROOT, f)
    const visit = (node) => {
      if (ts.isWhileStatement(node)) {
        if (findSwitches(node.statement).length > 0) {
          const condIds = condIdentifiers(node.expression)
          if (!isGuarded(node, condIds)) {
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
            violations.push(`${rel}:${line + 1}`)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }

  if (process.argv.includes('--list')) {
    console.log(violations.length ? violations.join('\n') : '(无违规)')
  }

  // 读取基线与白名单
  const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : { violations: [] }
  const baseSet = new Set((baseline.violations || []).filter((k) => !ALLOW[k]))
  const currentSet = new Set(violations.filter((k) => !ALLOW[k]))

  if (process.argv.includes('--write')) {
    fs.writeFileSync(BASELINE, JSON.stringify({ note: '命令机 while 循环推进兜底门禁基线（只减不增）', violations: [...currentSet].sort() }, null, 2) + '\n')
    console.log(`✅ 已写基线：${currentSet.size} 条`)
    return
  }

  const added = [...currentSet].filter((k) => !baseSet.has(k))
  const removed = [...baseSet].filter((k) => !currentSet.has(k))
  if (added.length) {
    console.error('⛔ 命令机 while 循环缺少推进兜底（可能导致卡死/OOM）：')
    for (const k of added) console.error(`   ${k}`)
    console.error('')
    console.error('   修法：记入口下标，循环尾兜底推进 —— 见 packages/components/p-svg-canvas/path-parser.ts:283')
    console.error('         const iBefore = i …（循环体）… if (i === iBefore) i++')
    process.exit(1)
  }
  if (removed.length) {
    console.log(`ℹ 基线有 ${removed.length} 条已消失（违规减少）——建议跑 --write 降钉：`)
    for (const k of removed) console.log(`   ${k}`)
  }
  console.log(`✅ 命令机 while 循环推进兜底门禁通过（当前 ${currentSet.size} 违规，基线 ${baseSet.size}）`)
}

main()
