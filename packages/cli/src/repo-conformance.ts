// packages/cli/src/repo-conformance.ts
// ★G-42 B5（proteus-host-container-plan batches B5）：仓库治理 CLI——`proteus conformance --repo <dir>`
//   G-42.6 严禁 fork 机器化：扫描宿主仓库文件内容 → scanRepoForFork（源码指纹）→ 报告 + exit 判定
//   · 合规仓库 → 0 命中（PASS）；fork 仓库 → 列出文件+指纹（FAIL，CI 阻断）
//   · 与 container-conformance 的 C-08-03/04 同一指纹集（@proteus-vue/render-backend scanRepoForFork）
import fs from 'node:fs'
import path from 'node:path'
import { scanRepoForFork } from '@proteus-vue/render-backend'
import type { ForkHit } from '@proteus-vue/render-backend'

/** 扫描的源码扩展名白名单（node_modules/.git/dist 排除） */
const SCAN_EXTS = new Set(['.ts', '.js', '.mjs', '.cjs', '.vue', '.json', '.md'])
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.proteus', 'coverage'])

/** 递归收集目录内可扫描源码文件（跳过 node_modules/.git/dist 等） */
export function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) collectSourceFiles(full, out)
    else if (SCAN_EXTS.has(path.extname(e.name))) out.push(full)
  }
  return out
}

/** 扫描目录文件内容 → fork 命中清单（C-08-03/04 语义的目录级版本） */
export function scanRepoDirectory(dir: string): { files: number; hits: ForkHit[] } {
  const files = collectSourceFiles(dir)
  const contents: Record<string, string> = {}
  let readOk = 0
  for (const f of files) {
    try {
      contents[f] = fs.readFileSync(f, 'utf-8')
      readOk++
    } catch {
      // 二进制/不可读文件跳过（如字体/*.json 大文件）
    }
  }
  return { files: readOk, hits: scanRepoForFork(contents) }
}

/** 报告：合规 PASS / fork FAIL（列文件+指纹） */
export function formatRepoReport(dir: string, result: { files: number; hits: ForkHit[] }): { text: string; ok: boolean } {
  const lines: string[] = [`[G-42.6 仓库治理扫描] ${dir}`]
  lines.push(`  扫描 ${result.files} 个源码文件（跳过 node_modules/.git/dist 等）`)
  if (result.hits.length === 0) {
    lines.push('  ✅ 合规仓库：fork 命中 0 项')
    return { text: lines.join('\n'), ok: true }
  }
  for (const h of result.hits.slice(0, 20)) {
    lines.push(`  ❌ fork 命中：${h.filename}（指纹 ${h.pattern}）`)
  }
  if (result.hits.length > 20) lines.push(`  … 共 ${result.hits.length} 项`)
  lines.push(`  ⚠ 宿主仓库严禁 fork 框架源码（G-42.6）——详细内容前 20 项已列出`)
  return { text: lines.join('\n'), ok: false }
}