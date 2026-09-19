#!/usr/bin/env node
// scripts/sync-dist-tags.mjs —— ★dist-tag 归一（发布后「装哪个 tag」必须指向本仓版本）
//
// 为什么需要它（2026-09-19 发布链取证发现的第三个缺口）：
//   发布链上的「幂等跳过」路径（版本已存在 → 跳过发布）**只跳过 publish，不会动 dist-tag**。
//   于是出现这种真实状态：
//     · devtools-runtime：`latest`=0.1.0（★**只有 8 个导出的崩溃版本**）、`beta`=0.1.1-beta.1（新版）
//       → 用户 `npm i @proteus-vue/devtools-runtime`（不带 tag）拿到的就是崩的那份。
//     · cli：`latest`=0.3.0-beta.5（新）、`beta`=0.2.1-beta.0（旧）
//       → 按本仓 pre-release 约定用 `@beta` 的人反而装到旧包。
//   根因：**「已发布」不等于「tag 指向它」**——两者是 registry 上独立的两件事。
//
// ★判据：canonical tag 必须指向本仓当前版本。
//   · 在 changesets pre 模式（`.changeset/pre.json` 存在）→ canonical = pre.json 的 `tag`（本仓 `beta`）；
//   · 否则 → canonical = `latest`。
//   只有「本仓版本**已发布**」时才要求 tag 指向它（本地领先未发布 = 正常状态，不报错、不改）。
//
// 用法：
//   node scripts/sync-dist-tags.mjs            # 报告
//   node scripts/sync-dist-tags.mjs --check    # 不一致 → exit 1（门禁用）
//   node scripts/sync-dist-tags.mjs --fix      # 执行 npm dist-tag add 修复
//   node scripts/sync-dist-tags.mjs --tag <t>  # 显式指定 canonical tag（覆盖 pre.json）
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const CHECK = argv.includes('--check')
const FIX = argv.includes('--fix')
const tagIdx = argv.indexOf('--tag')
const TAG_OVERRIDE = tagIdx >= 0 ? argv[tagIdx + 1] : null
const UA = { 'user-agent': 'proteus-dist-tag-sync' }

/** canonical tag：pre 模式取 pre.json 的 tag，否则 latest */
function canonicalTag() {
  if (TAG_OVERRIDE) return TAG_OVERRIDE
  const pre = path.join(ROOT, '.changeset', 'pre.json')
  if (fs.existsSync(pre)) {
    try {
      const j = JSON.parse(fs.readFileSync(pre, 'utf8'))
      if (j.mode === 'pre' && j.tag) return j.tag
    } catch {
      /* 解析失败退回 latest */
    }
  }
  return 'latest'
}

function listPackages() {
  const out = []
  for (const e of fs.readdirSync(path.join(ROOT, 'packages'), { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const f = path.join(ROOT, 'packages', e.name, 'package.json')
    if (!fs.existsSync(f)) continue
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'))
      if (j.name && j.name.startsWith('@proteus-vue/')) out.push({ short: j.name.replace('@proteus-vue/', ''), full: j.name, version: j.version })
    } catch {
      /* 非包目录 */
    }
  }
  return out.sort((a, b) => a.short.localeCompare(b.short))
}

async function packument(full) {
  try {
    const r = await fetch('https://registry.npmjs.org/' + encodeURIComponent(full), { headers: UA })
    if (!r.ok) return { error: `HTTP ${r.status}` }
    const d = await r.json()
    return { tags: d['dist-tags'] ?? {}, versions: Object.keys(d.versions ?? {}) }
  } catch (e) {
    return { error: String(e).slice(0, 80) }
  }
}

const TAG = canonicalTag()
console.log(`[dist-tags] canonical tag = ${TAG}${TAG_OVERRIDE ? '（--tag 指定）' : '（来自 .changeset/pre.json）'}`)

const pkgs = listPackages()
const rows = await Promise.all(
  pkgs.map(async (p) => {
    const d = await packument(p.full)
    if (d.error) return { ...p, err: d.error }
    return { ...p, current: d.tags[TAG], published: d.versions.includes(p.version), tags: d.tags }
  }),
)

const unpublished = rows.filter((r) => !r.err && !r.published)
const ok = rows.filter((r) => !r.err && r.published && r.current === r.version)
const mismatch = rows.filter((r) => !r.err && r.published && r.current !== r.version)
const errors = rows.filter((r) => r.err)

if (mismatch.length) {
  console.log(`\n★tag 未指向本仓版本（${mismatch.length} 个）——用户按 \`@${TAG}\` 装会拿到旧包：`)
  for (const m of mismatch) {
    const note = m.current === undefined ? `（${TAG} tag 不存在）` : `→ 指向 ${m.current}，本仓 ${m.version}`
    console.log(`  ✗ ${m.short.padEnd(22)} ${note}`)
  }
}
if (unpublished.length) console.log(`\n· 本地领先未发布（正常，tag 无从指向）：${unpublished.length} 个`)
if (errors.length) {
  console.log(`\n⚠ 未能判定 ${errors.length} 个：`)
  for (const e of errors) console.log(`  - ${e.short}: ${e.err}`)
}

if (FIX && mismatch.length) {
  console.log(`\n[dist-tags] 开始修复（npm dist-tag add <pkg>@<ver> ${TAG}）`)
  let failed = 0
  for (const m of mismatch) {
    const spec = `${m.full}@${m.version}`
    try {
      execFileSync('npm', ['dist-tag', 'add', spec, TAG], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 })
      console.log(`  ✅ ${spec} → ${TAG}`)
    } catch (e) {
      failed++
      console.log(`  ❌ ${spec}：${String(e.stderr ?? e).toString().slice(0, 160)}`)
    }
  }
  process.exitCode = failed ? 1 : 0
} else if (mismatch.length && CHECK) {
  console.log(`\n  → 修复：node scripts/sync-dist-tags.mjs --fix   （或在 npm 网页端调整 dist-tags）`)
  process.exitCode = 1
} else if (!mismatch.length && !errors.length) {
  console.log(`\n✅ 全部 ${ok.length} 个已发布包的 \`${TAG}\` tag 均指向本仓版本`)
}
