#!/usr/bin/env node
// scripts/outline-code.mjs —— ★★★决策 #1142：**代码结构大纲**（函数/段的行号索引，不读全文）
//
// 【解决什么问题（本仓当前最大的通读成本）】
//   `check:file-size` 补上 `.h/.cpp` 后暴露 4 个 C++ 源文件超 1000 行（最大 3958 行），
//   而其中**最大的认知瓶颈不是文件行数，是单函数行数**：
//     · `proteus_render.cpp::renderCommandsImpl` = **836 行单函数**
//     · `proteus_host.cpp::AppScreenCommands`   = **571 行单函数**
//   ★拆文件不解决"单函数 836 行"——AI 要改其中一段仍须读整个函数。
//   ⇒ 本工具把"文件 → 顶层块 → 内部段落"的**行号索引**机器化：
//     改指定逻辑只需读该段（几十行），而不是 836 行或 3958 行。
//
// 【★为什么不直接重构拆函数（诚实边界）】
//   鸿蒙宿主的**行为判据只有真机**（hdc），而本机当前**无 hdc 设备** ⇒ 无法验证行为等价。
//   本仓纪律：**没有判据就不动行为**（"测得出才敢改"）。⇒ 本轮只做**索引**（零风险），
//   把"可安全拆分"留到有设备时（届时先用本工具定位，再拆 + 三端重跑）。
//
// 【判据（本工具自己的）】`tests/code-outline.test.ts`：
//   ① 每个块的行号真实（该行确实是声明）；② 块不重叠且有序；③ 行数守恒（0 行遗漏）。
//
// 用法：
//   node scripts/outline-code.mjs <file>              # 顶层块大纲
//   node scripts/outline-code.mjs <file> --fn <name>  # 指定函数内部段落
//   node scripts/outline-code.mjs --list-heavy        # 所有 >100 行的块（找通读成本）
// 退出码：0 成功 / 2 用法或文件错
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)

/** **超过这个行数的函数**就值得给内部段落索引（AI 读 800 行不现实）。 */
export const HEAVY_BLOCK_LINES = 100

/**
 * 抽顶层块（函数 / struct / class / namespace）。
 * ★判据：**行首无缩进**且以 `{` 结尾（或下一行是 `{`）——本仓 C++ 风格是 4 空格缩进，
 *   顶层声明一律从第 0 列开始 ⇒ 用"无缩进"就能可靠区分顶层与嵌套。
 * @returns {{lines: string[], blocks: Array<{name:string,start:number,end:number,kind:string}>}}
 */
/**
 * **遮罩注释与字符串**（等长空格，保留换行）——花括号配对的前提。
 *
 * ★★这是本工具实测抓出的缺陷（第 13 次同族）：首版直接对原文数花括号，
 *   而 `proteus_render.cpp` 里有一条注释写着「首版用第一个 '}' 截断」
 *   ⇒ 那个注释里的 `}` 把 `renderCommandsImpl` 的配对提前闭合，**836 行算成 6 行**。
 *   若按那份大纲去改代码，就会**只读 6 行**然后漏掉 830 行 —— 比不给大纲更糟。
 * ⇒ 与 `website/scripts/lib/ts-source-scan.mjs::maskNonCode` 同一思路（本仓已有一份，
 *   但那是 TS 语法；C/C++ 的 `//` 与字符字面量要单独处理，故在此实现最小版本）。
 */
function maskForBraces(src) {
  const lines = String(src).split('\n')
  let inBlock = false
  return lines
    .map((line) => {
      let out = ''
      let i = 0
      let inStr = false
      let quote = ''
      while (i < line.length) {
        const c = line[i]
        const n = line[i + 1]
        if (inBlock) {
          if (c === '*' && n === '/') { inBlock = false; out += '  '; i += 2; continue }
          out += ' '; i++; continue
        }
        if (inStr) {
          if (c === '\\') { out += '  '; i += 2; continue }
          if (c === quote) { inStr = false }
          out += ' '; i++; continue
        }
        if (c === '/' && n === '/') { out += ' '.repeat(line.length - i); break }
        if (c === '/' && n === '*') { inBlock = true; out += '  '; i += 2; continue }
        if (c === '"' || c === "\'") { inStr = true; quote = c; out += ' '; i++; continue }
        out += c; i++
      }
      return out
    })
    .join('\n')
}

export function outline(src) {
  const lines = String(src).split('\n')
  // ★配对用**遮罩后**的文本（注释/字符串里的花括号不算）；行号仍按原文取
  const masked = maskForBraces(src).split('\n')
  const decls = []
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]
    if (/^\s/.test(t)) continue // 有缩进 ⇒ 不是顶层
    if (/^\s*(\/\/|\/\*|\*|#|$)/.test(t)) continue // 注释/预处理/空行
    // struct / class / namespace
    const sc = /^(?:typedef\s+)?(struct|class|namespace)\s+(\w+)/.exec(t)
    if (sc && !t.trimEnd().endsWith(';')) {
      decls.push({ name: sc[2], start: i + 1, kind: sc[1] })
      continue
    }
    // 函数定义（同一行或下一行开始 `{`；排除声明 `;`）
    if (t.includes('(') && !t.trimEnd().endsWith(';')) {
      const nm = /(\w+)\s*\([^)]*\)\s*(?:const\s*)?(?:\{|$)/.exec(t)
      if (nm && !/^(if|for|while|switch|return)$/.test(nm[1])) {
        decls.push({ name: nm[1], start: i + 1, kind: 'fn' })
      }
    }
  }
  // 用花括号配对求每块的结束行（从 start 起找第一个顶层 `{`，再配对）
  const blocks = []
  for (let k = 0; k < decls.length; k++) {
    const d = decls[k]
    const nextStart = k + 1 < decls.length ? decls[k + 1].start : lines.length + 1
    let end = nextStart - 1
    // 收紧：从 start 行起找 `{`，配对到闭合行
    let depth = 0
    let seenOpen = false
    let j = d.start - 1
    for (; j < Math.min(nextStart, lines.length + 1); j++) {
      const line = masked[j] ?? ''
      for (const ch of line) {
        if (ch === '{') { depth++; seenOpen = true }
        else if (ch === '}') {
          depth--
          if (seenOpen && depth === 0) { end = j + 1; break }
        }
      }
      if (seenOpen && depth === 0) break
    }
    blocks.push({ name: d.name, kind: d.kind, start: d.start, end: Math.max(d.start, end) })
  }
  return { lines, blocks }
}

/**
 * 一个函数**内部的段落**（靠缩进注释分隔：本仓风格是 `    // ★…` / `    /* …`）。
 * ★为什么能用注释当段落边界：本仓把"为什么这么写"写在段首注释里（决策号/踩坑记录），
 *   这些注释天然就是逻辑段的分界——**注释密度高反而是这里的优势**。
 */
export function sectionsOf(lines, start, end) {
  const out = []
  const indentOf = (l) => (/^\s*/.exec(l)?.[0].length ?? 0)
  // ★求函数体的缩进基准：**跳过声明行本身**（它缩进为 0），从函数体内部取。
  //   ★首版从 start 起取 ⇒ 拿到声明行的 0 ⇒ 阈值变成 `<= 2`，而段注释缩进是 4
  //     ⇒ 834 行函数被判成"无段落"（假绿：看着成功，实际没索引）。
  let base = 4
  for (let i = start + 1; i < Math.min(start + 15, end); i++) {
    const l = lines[i] ?? ''
    if (!l.trim()) continue
    if (/^\s*[{}]\s*$/.test(l)) continue // 跳过裸花括号行
    base = indentOf(l)
    break
  }
  for (let i = start; i < end; i++) {
    const l = lines[i] ?? ''
    const t = l.trim()
    // 段落标记：与主体同缩进的注释行（`//` 或 `/*`），且带 ★ / ── / 决策号
    if (indentOf(l) <= base + 2 && /^(\/\/|\/\*)/.test(t)) {
      if (/★|──|决策 #|═══/.test(t)) {
        out.push({ line: i + 1, text: t.replace(/^\/\*+\s*|\*+\/$/g, '').slice(0, 82) })
      }
    }
  }
  return out
}

/** 递归收集某目录下所有可 outline 的源文件。 */
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (!/(node_modules|dist|build|\.git|prebuilt)/.test(p)) walk(p, out)
    } else if (/\.(cpp|h|hpp|cc|ts|mjs|swift|java)$/.test(e.name)) out.push(p)
  }
  return out
}

// ── CLI（★只在**直接执行**时运行：本文件也被 tests/ 导入 ⇒ 无条件执行会在 import 时报"用法错误"）──
const isMain = (() => {
  try {
    return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
})()

if (isMain) {
  // ── CLI ──
  if (argv.includes('--list-heavy')) {
    const roots = ['hosts/harmony', 'packages/cli/templates-host/prebuilt/harmony']
    const rows = []
    for (const r of roots) {
      for (const f of walk(path.join(ROOT, r))) {
        if (f.includes('prebuilt')) continue // 副本跳过（真源已统计）
        const { blocks } = outline(fs.readFileSync(f, 'utf8'))
        for (const b of blocks) {
          const n = b.end - b.start + 1
          if (n > HEAVY_BLOCK_LINES) rows.push({ n, f: path.relative(ROOT, f), name: b.name, start: b.start })
        }
      }
    }
    rows.sort((a, b) => b.n - a.n)
    console.log(`重块大纲（>${HEAVY_BLOCK_LINES} 行的顶层块；这些是"AI 要通读"的真实来源）\n`)
    for (const r of rows.slice(0, 25)) {
      console.log(`  ${String(r.n).padStart(5)} 行  ${r.name.padEnd(28)} ${r.f}:${r.start}`)
    }
    console.log(`\n合计 ${rows.length} 个重块`)
    process.exit(0)
  }

  const file = argv[0]
  if (!file) {
    console.error('用法：node scripts/outline-code.mjs <file> [--fn <name>]')
    console.error('      node scripts/outline-code.mjs --list-heavy')
    process.exit(2)
  }
  const abs = path.isAbsolute(file) ? file : path.join(ROOT, file)
  if (!fs.existsSync(abs)) {
    console.error(`✗ 文件不存在：${abs}`)
    process.exit(2)
  }
  const src = fs.readFileSync(abs, 'utf8')
  const { lines, blocks } = outline(src)
  console.log(`${path.relative(ROOT, abs)}（${lines.length} 行 · ${blocks.length} 个顶层块）\n`)

  const fnIdx = argv.indexOf('--fn')
  if (fnIdx >= 0) {
    const want = argv[fnIdx + 1]
    const b = blocks.find((x) => x.name === want)
    if (!b) {
      console.error(`✗ 找不到顶层块 ${want}`)
      console.error(`  可用：${blocks.map((x) => x.name).join(', ').slice(0, 300)}`)
      process.exit(2)
    }
    const n = b.end - b.start + 1
    console.log(`═══ ${b.name}（${n} 行 @ L${b.start}-${b.end}）═══`)
    const secs = sectionsOf(lines, b.start - 1, b.end - 1)
    if (!secs.length) {
      console.log('  （无段落注释标记——本函数没有用 ★/──/决策号 分段）')
    } else {
      console.log('  内部段落（改哪段只读哪段）：')
      for (const s of secs) console.log(`    L${String(s.line).padStart(4)}  ${s.text}`)
      const first = secs[0].line
      console.log(`\n  ★若只改第一段：读 L${b.start}-${first - 1}（${first - b.start} 行），不是 ${n} 行`)
    }
    process.exit(0)
  }

  for (const b of blocks) {
    const n = b.end - b.start + 1
    const flag = n > HEAVY_BLOCK_LINES ? ' ★重块' : ''
    console.log(`  L${String(b.start).padStart(5)}-${String(b.end).padEnd(5)} ${String(n).padStart(5)} 行  ${b.kind.padEnd(9)} ${b.name}${flag}`)
  }
  console.log('\n★提示：>100 行的块用 `--fn <name>` 看内部段落（改一段只读一段）')
}
