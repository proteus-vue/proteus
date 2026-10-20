#!/usr/bin/env node
// scripts/check-repo-hygiene.mjs —— ★★★决策 #1136：**仓库卫生门禁**（构建产物不得被跟踪）
//
// 【为什么需要（这是"忽略规则写错"的结构性防线）】
//   2026-10-20 用户指出仓库里有 190MB 生成物被跟踪。取证后发现根因很朴素：
//     `spike/.gitignore` 写的是 `target/`，而实际 Cargo 目标目录叫 **`target-qjs/`**
//     （构建时 `CARGO_TARGET_DIR=spike/target-qjs`）⇒ **规则从未命中**，
//     576 个 .rlib/.rmeta/二进制（186 MB）全被跟踪；另有 `.cdp-shots/`（151 张调试截图，26 MB）。
//   ★与「红线写在 markdown 里拦不住」同源：忽略规则本身也需要判据。
//     否则下次 `CARGO_TARGET_DIR` 再改名，还会静默漏一遍——而**没有任何机制会提醒**。
//
// 【判据】`git ls-files` 里不得出现**构建产物形态**的路径：
//   · Cargo 目标目录（`target/` `target-qjs/` `target-*/`）、`*.rlib` / `*.rmeta`
//   · 编译中间物（`*.o` / `*.pyc` / `__pycache__/`）
//   · 调试截图输出目录（`.cdp-shots/`）、临时探针目录（`.tmp-probe/`）
//   · `node_modules/`、`dist/`、`build/`（顶层产物；★`hosts/*/build` 等白名单见下）
//
// 【★白名单必须"具名 + 写理由"】本仓有些**看起来像产物但必须入库**的东西：
//   · `packages/cli/templates-host/prebuilt/**` —— CLI 随包发布的预编译运行时（产品交付物）
//   · `hosts/*/results/**` —— 真机判据证据（项目纪律要求入库）
//   · `css-conformance/results/**` —— 一致性验收证据
//   · `.workbuddy/salvage/**` —— ai-tasks.json 里多条验证引用的"真值基准"截图
//   ⇒ 一律显式列在 `ALLOW`，**理由写在行内**（与 `check:file-size` 的 ALLOW 同款纪律）。
//
// 【诚实边界】本门禁只看**索引里的文件**（`git ls-files`），不管历史 ——
//   历史 bloat 只能用 `git filter-repo` 重写（见 docs/repo-size-runbook.md），本门禁不碰。
//
// 用法：node scripts/check-repo-hygiene.mjs
// 退出码：0 通过 / 1 有违规（列出路径 + 修法）/ 2 环境错误
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 违规模式（按"形态"判，不按"某个具体目录名"——避免改名后再次失效）。 */
const BAD = [
  { re: /(^|\/)target(-[a-z0-9]+)?\//, why: 'Cargo 目标目录（构建缓存）' },
  { re: /\.(rlib|rmeta)$/, why: 'Rust 编译产物' },
  { re: /\.o$/, why: 'C 编译中间物' },
  { re: /\.pyc$/, why: 'Python 字节码' },
  { re: /(^|\/)__pycache__\//, why: 'Python 缓存目录' },
  { re: /(^|\/)\.cdp-shots\//, why: 'CDP 调试截图（脚本产出，无消费方）' },
  { re: /(^|\/)\.tmp-probe\//, why: '临时探针目录' },
  { re: /(^|\/)node_modules\//, why: '依赖目录' },
  { re: /^dist\//, why: '顶层构建产物' },
  { re: /^build\//, why: '顶层构建产物' },
]

/**
 * 具名豁免：`{ re, why }`。
 * ★每条都必须写清"为什么它虽然像产物但必须入库"——这是 ALLOW 的唯一合法用法。
 */
const ALLOW = [
  { re: /^packages\/cli\/templates-host\/prebuilt\//, why: 'CLI 随包发布的预编译运行时（外部用户不 checkout 框架也能用）' },
  { re: /^hosts\/[a-z]+\/results\//, why: '真机判据证据（项目纪律：证据入库）' },
  { re: /^hosts\/[a-z]+\/build-selfdraw\//, why: 'iOS 自绘产物目录（含 .app，供真机安装脚本）' },
  { re: /^css-conformance\/results\//, why: '多端一致性验收证据' },
  { re: /^\.workbuddy\/salvage\//, why: 'ai-tasks.json 多条验证引用的「真值基准」真机截图' },
  { re: /^docs\/generated\//, why: '生成文档（gen:docs 产物，随源提交以便 review diff）' },
]

function tracked() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'buffer', maxBuffer: 1 << 28 })
  return out.toString('utf8').split('\0').filter(Boolean)
}

const files = tracked()
if (files.length === 0) {
  console.error('✗ 读不到被跟踪文件（git 不可用？）')
  process.exit(2)
}

const allowedHits = new Map()
const bad = []
for (const f of files) {
  const hitBad = BAD.find((b) => b.re.test(f))
  if (!hitBad) continue
  const allow = ALLOW.find((a) => a.re.test(f))
  if (allow) {
    allowedHits.set(allow.why, (allowedHits.get(allow.why) ?? 0) + 1)
    continue
  }
  bad.push({ f, why: hitBad.why })
}

console.log(`仓库卫生门禁（扫 ${files.length} 个被跟踪文件 · ${BAD.length} 类违规形态 · ${ALLOW.length} 条具名豁免）`)

if (allowedHits.size) {
  for (const [why, n] of allowedHits) console.log(`  ℹ 具名豁免：${why} —— ${n} 个文件`)
}

if (bad.length) {
  console.error(`\n❌ ${bad.length} 个构建/调试产物被跟踪（不该入库）：`)
  for (const b of bad.slice(0, 30)) console.error(`  - ${b.f}  （${b.why}）`)
  if (bad.length > 30) console.error(`  …另有 ${bad.length - 30} 个`)
  console.error('\n修法：')
  console.error('  ① 把它加进 .gitignore（★规则要写**真实目录名**——本轮根因就是 `target/` vs `target-qjs/`）')
  console.error('  ② git rm -r --cached <path>   # 只动索引，磁盘文件保留')
  console.error('  ③ 提交后跑本门禁确认清零')
  console.error('  ★历史里已有的副本不会被本条清掉（那需要 git filter-repo，见 docs/repo-size-runbook.md）')
  process.exit(1)
}

// 体积画像（不判红，只报告——让"又变大了"这件事可见）
try {
  const rows = []
  for (const f of files) {
    const abs = path.join(ROOT, f)
    try {
      const st = fs.statSync(abs)
      if (st.isFile() && st.size > 5 * 1024 * 1024) rows.push({ size: st.size, name: f })
    } catch {
      /* 跳过（可能刚被删） */
    }
  }
  rows.sort((a, b) => b.size - a.size)
  const total = rows.reduce((s, r) => s + r.size, 0)
  if (rows.length) {
    console.log(`  ℹ 被跟踪的 >5MB 文件：${rows.length} 个，合计 ${(total / 1048576).toFixed(1)} MB（前 5）`)
    for (const r of rows.slice(0, 5)) console.log(`      ${(r.size / 1048576).toFixed(1)} MB  ${r.name}`)
  }
} catch {
  /* 体积画像失败不影响判据 */
}

console.log('\n✅ 无构建产物被跟踪（具名豁免已逐条写明理由）')
process.exit(0)
