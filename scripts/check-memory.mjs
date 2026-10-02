#!/usr/bin/env node
// scripts/check-memory.mjs —— ★《项目记忆收纳规范》门禁（2026-10-03 立）
//
// 【为什么立这个门禁（用户原话：「收下 PROJECT_MEMORY 规范，现在这个文件做得太大了」）】
//   立规前实测：`PROJECT_MEMORY.md` 达 **11,118 行 / 2.4 MB**——每轮里程碑的详细叙事都内联插
//   H3、状态速览逐条堆叠、决策链 455 条共 840 KB 内联在文末 ⇒「新会话先读顶部」的入口意义
//   被历史内容淹没（读取一次吞掉大量上下文）。
//   ⇒ 规范（见 `PROJECT_MEMORY.md` §《收纳规范》）：**主文件 = 当前态薄入口；历史与长表全文在
//     `docs/project-memory-archive/`**。
//   ★写入 markdown 的规则拦不住回归（本仓既有认识：sleep 红线写在 md 里失效 ⇒ 只有工具层门禁
//     是结构性的）⇒ 本门禁机器强制以下判据，防"文档又说一遍、文件又长回去"。
//
// 判据（全部机器可判，违任一即 exit 1）：
//   ① 体量上限：主文件 ≤ 300 行 且 ≤ 200 KB（当前 ~116 行 / 18 KB，留 10× 余量）；
//   ② 结构齐备（六类内容必须在场）：项目概览 / 当前状态速览 / 收纳规范 / 归档索引 /
//      关键决策指针（指向 decisions.md）/ 待办 / 会话恢复指引；
//   ③ 速览条数 ≤ 3（第 4 条起应移入当月归档——规范第 2 条）；
//   ④ 无 H3 泄漏（`### ` 出现即说明详细叙事又内联回主文件了——规范"新里程碑的写法"第 1 条）；
//   ⑤ 归档索引自洽：索引里提到的 `docs/project-memory-archive/*.md` 文件必须真实存在。
//
// 用法：node scripts/check-memory.mjs [--json]
// 退出码：0 通过 / 1 违规
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const JSON_OUT = process.argv.includes('--json')
const MEMORY = path.join(ROOT, 'PROJECT_MEMORY.md')
const ARCHIVE_DIR = 'docs/project-memory-archive'

/** 体量上限（写死在门禁里——调大上限必须改这里，改动可见、可评审） */
const LIMITS = { maxLines: 300, maxBytes: 200 * 1024, maxRecent: 3 }

const violations = []
const v = (code, message, hint) => violations.push({ code, message, hint })

// ── 读主文件 ────────────────────────────────────────────────────────────────
if (!fs.existsSync(MEMORY)) {
  console.error(`[memory] ✗ 缺 PROJECT_MEMORY.md`)
  process.exit(1)
}
const raw = fs.readFileSync(MEMORY, 'utf8')
const lines = raw.split('\n')
const bytes = Buffer.byteLength(raw)

// ① 体量上限
if (lines.length > LIMITS.maxLines) {
  v(
    'MEM_SIZE_LINES',
    `主文件 ${lines.length} 行 > 上限 ${LIMITS.maxLines} 行`,
    '详细叙事移入 docs/project-memory-archive/<YYYY-MM>.md；主文件只保留六类内容（见 §《收纳规范》）',
  )
}
if (bytes > LIMITS.maxBytes) {
  v(
    'MEM_SIZE_BYTES',
    `主文件 ${(bytes / 1024).toFixed(0)} KB > 上限 ${LIMITS.maxBytes / 1024} KB`,
    '同上——大头通常是决策链/叙事内联；决策链全文在 docs/project-memory-archive/decisions.md',
  )
}

// ② 结构齐备（六类内容）
const REQUIRED = [
  { key: '概览', re: /^## 项目概览/m },
  { key: '状态速览', re: /^## 当前状态速览/m },
  { key: '收纳规范', re: /^## ★《收纳规范》/m },
  { key: '归档索引', re: /^## 归档索引/m },
  { key: '决策指针', re: /^## 关键决策与文档偏差/m },
  { key: '待办', re: /^## 待办 \/ 注意事项/m },
  { key: '会话恢复指引', re: /^## 会话恢复指引/m },
]
for (const r of REQUIRED) {
  if (!r.re.test(raw)) {
    v('MEM_STRUCTURE', `缺结构：${r.key}（${r.re}）`, '对照 §《收纳规范》的六类内容补齐')
  }
}

// ③ 速览条数 ≤ 3
const recentCount = (raw.match(/^## 当前状态速览/mg) || []).length
if (recentCount > LIMITS.maxRecent) {
  v(
    'MEM_RECENT_OVERFLOW',
    `状态速览 ${recentCount} 条 > 上限 ${LIMITS.maxRecent} 条`,
    '把第 4 条起的速览移入当月归档（规范：主文件只留最近 3 条）',
  )
}
if (recentCount === 0) v('MEM_RECENT_MISSING', '没有状态速览', '新会话入口需要至少 1 条顶部速览')

// ④ 无 H3 泄漏
const h3 = lines.map((l, i) => ({ l, n: i + 1 })).filter((x) => /^### /.test(x.l))
if (h3.length > 0) {
  v(
    'MEM_H3_LEAK',
    `主文件出现 ${h3.length} 个 H3（首个在第 ${h3[0].n} 行：\`${h3[0].l.slice(0, 50)}…\`）`,
    '详细叙事不再内联——写进 docs/project-memory-archive/<YYYY-MM>.md，主文件只加一行速览',
  )
}

// ⑤ 归档索引自洽：索引提到的归档文件必须存在（且目录非空）
const mentioned = [...raw.matchAll(/docs\/project-memory-archive\/([\w.-]+\.md)/g)].map((m) => m[1])
const uniq = [...new Set(mentioned)]
if (uniq.length === 0) {
  v('MEM_INDEX_EMPTY', '归档索引未提到任何 docs/project-memory-archive/*.md', '补索引表（见 §归档索引）')
}
for (const f of uniq) {
  if (!fs.existsSync(path.join(ROOT, ARCHIVE_DIR, f))) {
    v('MEM_INDEX_DANGLING', `归档索引提到的 ${ARCHIVE_DIR}/${f} 不存在`, '修正索引或补文件')
  }
}
// 反向：归档目录里有 md 但索引没提（防"归了档但没人找得到"）
const onDisk = fs.existsSync(path.join(ROOT, ARCHIVE_DIR))
  ? fs.readdirSync(path.join(ROOT, ARCHIVE_DIR)).filter((f) => f.endsWith('.md'))
  : []
for (const f of onDisk) {
  if (!uniq.includes(f)) {
    v('MEM_INDEX_MISSING_ENTRY', `归档目录有 ${f} 但主文件索引未提到`, '在 §归档索引 表里补一行')
  }
}

// ── 输出 ────────────────────────────────────────────────────────────────────
if (JSON_OUT) {
  console.log(JSON.stringify({ ok: violations.length === 0, lines: lines.length, bytes, recentCount, archive: onDisk, violations }, null, 2))
} else {
  console.log('项目记忆收纳门禁（《收纳规范》· PROJECT_MEMORY.md 薄入口）')
  console.log(
    `  主文件 ${lines.length} 行 / ${(bytes / 1024).toFixed(1)} KB（上限 ${LIMITS.maxLines} 行 / ${LIMITS.maxBytes / 1024} KB）· 速览 ${recentCount} 条（上限 ${LIMITS.maxRecent}）· 归档 ${onDisk.length} 份`,
  )
  if (violations.length === 0) {
    console.log('  ✅ 合规（薄入口 + 结构齐备 + 归档索引自洽）')
  } else {
    console.error(`\n❌ ${violations.length} 处违规：`)
    for (const x of violations) {
      console.error(`\n  [${x.code}] ${x.message}`)
      console.error(`    修法：${x.hint}`)
    }
  }
}
process.exit(violations.length === 0 ? 0 : 1)
