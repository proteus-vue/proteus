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
//   node scripts/sync-dist-tags.mjs --fix      # 执行 npm dist-tag add 修复（需凭据；可能需要 OTP）
//   node scripts/sync-dist-tags.mjs --fix --otp <6位码>   # 带一次性密码
//   node scripts/sync-dist-tags.mjs --tag <t>  # 显式指定 canonical tag（覆盖 pre.json）
//   node scripts/sync-dist-tags.mjs --print    # 只打印待执行的 npm 命令（便于手工执行）
//
// ★为什么需要 OTP：`npm dist-tag` 属**包管理**类操作——按 npm 政策，bypass-2FA 的 granular
//   token 自 2026-07-31 起被限制用于此类操作，**必须**交互式 2FA（实测报 EOTP）。
//   （对照：`npm publish` 仍可用 token 直接完成，`npm access list` 读操作也可。）
//   若不便交互：在 npm 网页端 Packages → 该包 → Versions 里直接调整 dist-tag。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const CHECK = argv.includes('--check')
const FIX = argv.includes('--fix')
const PRINT = argv.includes('--print')
const tagIdx = argv.indexOf('--tag')
const TAG_OVERRIDE = tagIdx >= 0 ? argv[tagIdx + 1] : null
const otpIdx = argv.indexOf('--otp')
const OTP = otpIdx >= 0 ? argv[otpIdx + 1] : null
const UA = { 'user-agent': 'proteus-dist-tag-sync' }
/** registry 请求超时（毫秒）——避免网络挂起时脚本无限等待（效率规范：请求须带超时） */
const FETCH_TIMEOUT_MS = 15_000

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

/**
 * 需要「指向本仓版本」的**全部** tag。
 * ★pre 模式下除 canonical tag（beta）外，还要把 `latest` 一并拉齐（2026-09-19 用户要求：
 *   「实际只有 beta 一条线，不要出现正式版标签」）。
 *   · npm **强制**每个包必须存在 `latest`（删掉它 `npm i <pkg>` 会解析失败），无法真正移除；
 *   · 但可以让 `latest` 永远等于当前 beta 版本 → 就不存在「另一条正式版」被服务出去，
 *     也不会出现 `latest` 停在旧的崩溃版、而新版本只在 beta 的割裂状态。
 *   · 且 changesets 对「从未发过正式版」的包会**故意发到 latest**（publishedState==='only-pre'），
 *     不拉齐的话二者必然分叉——这正是今晚 cli/plugin-vite 落到 latest 的成因。
 *   非 pre 模式（正式发版）下只治理 `latest` 一个 tag。
 */
function managedTags(canonical) {
  const pre = path.join(ROOT, '.changeset', 'pre.json')
  let inPre = false
  try {
    inPre = JSON.parse(fs.readFileSync(pre, 'utf8')).mode === 'pre'
  } catch {
    /* 非 pre 模式 */
  }
  return inPre ? [canonical, 'latest'] : [canonical]
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
    // 注：signal 与 fetch 同一行——效率审计规则 R002 按行检测超时，多行写法会被误报
    const r = await fetch('https://registry.npmjs.org/' + encodeURIComponent(full), { headers: UA, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!r.ok) return { error: `HTTP ${r.status}` }
    const d = await r.json()
    return { tags: d['dist-tags'] ?? {}, versions: Object.keys(d.versions ?? {}) }
  } catch (e) {
    return { error: String(e).slice(0, 80) }
  }
}

const TAG = canonicalTag()
const TAGS = managedTags(TAG)
console.log(
  `[dist-tags] 受管 tag：${TAGS.join(' + ')}${TAG_OVERRIDE ? '（--tag 指定）' : TAGS.length > 1 ? '（canonical 来自 .changeset/pre.json；latest 一并拉齐——本项目只有 beta 一条线，不让 latest 成为另一条正式版）' : '（来自 .changeset/pre.json）'}`,
)

const pkgs = listPackages()
const rows = await Promise.all(
  pkgs.map(async (p) => {
    const d = await packument(p.full)
    if (d.error) return { ...p, err: d.error }
    // 每个受管 tag 的偏差（tag 不存在 / 指向其它版本）
    const offTags = TAGS.map((t) => ({ tag: t, current: d.tags[t] })).filter((x) => x.current !== p.version)
    return { ...p, current: d.tags[TAG], published: d.versions.includes(p.version), tags: d.tags, offTags }
  }),
)

const unpublished = rows.filter((r) => !r.err && !r.published)
const ok = rows.filter((r) => !r.err && r.published && r.offTags.length === 0)
const mismatch = rows.filter((r) => !r.err && r.published && r.offTags.length > 0)
const errors = rows.filter((r) => r.err)

if (mismatch.length) {
  // ★紧凑报告：41 行「✗」既吓人又难读——按 tag 分组，每组给出「受影响包数 + 前几个例子」，
  //   完整清单始终可用 --print 取得。判据是「用户按该 tag 装会拿到什么」。
  const byTag = new Map()
  for (const m of mismatch) for (const x of m.offTags) {
    if (!byTag.has(x.tag)) byTag.set(x.tag, [])
    byTag.get(x.tag).push(`${m.short}(${x.current ?? '缺失'}→${m.version})`)
  }
  console.log(`\n★tag 未指向本仓版本：${mismatch.length} 个包受影响`)
  for (const [tag, items] of byTag) {
    const sample = items.slice(0, 4).join('，')
    console.log(`  · ${tag}：${items.length} 个包  ${sample}${items.length > 4 ? ` …等 ${items.length} 个` : ''}`)
  }
  console.log(`  → 完整清单：node scripts/sync-dist-tags.mjs --print`)
}
if (unpublished.length) console.log(`\n· 本地领先未发布（正常，tag 无从指向）：${unpublished.length} 个`)
if (errors.length) {
  console.log(`\n⚠ 未能判定 ${errors.length} 个：`)
  for (const e of errors) console.log(`  - ${e.short}: ${e.err}`)
}

/** 待执行的 dist-tag 命令（每个偏差 tag 一条） */
function fixCommands() {
  const cmds = []
  for (const m of mismatch) for (const x of m.offTags) cmds.push(`npm dist-tag add ${m.full}@${m.version} ${x.tag}`)
  return cmds
}

if (PRINT && mismatch.length) {
  console.log(`\n[dist-tags] 待执行的命令（需已登录且能通过 2FA；逐条执行）\n`)
  for (const c of fixCommands()) console.log(c)
} else if (FIX && mismatch.length) {
  console.log(`\n[dist-tags] 开始修复${OTP ? '（--otp ***）' : ''}`)
  let failed = 0
  for (const m of mismatch) {
    for (const x of m.offTags) {
      const spec = `${m.full}@${m.version}`
      const args = ['dist-tag', 'add', spec, x.tag]
      if (OTP) args.push('--otp', OTP)
      try {
        execFileSync('npm', args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 })
        console.log(`  ✅ ${spec} → ${x.tag}`)
      } catch (e) {
        failed++
        const msg = String(e.stderr ?? e).toString()
        // EOTP 是「需要人工 2FA」而非脚本缺陷——单独给出可执行指引，避免误判为失败
        if (/EOTP|one-time password/i.test(msg)) {
          console.log(`  ⚠ ${spec} → ${x.tag}：需要一次性密码（2FA）`)
          console.log(`      改用：npm dist-tag add ${spec} ${x.tag} --otp <6位码>`)
          console.log(`      或本脚本带 --otp：node scripts/sync-dist-tags.mjs --fix --otp <6位码>`)
        } else {
          console.log(`  ❌ ${spec} → ${x.tag}：${msg.slice(0, 160)}`)
        }
      }
    }
  }
  if (failed) console.log(`\n[dist-tags] ${failed} 个未能完成（见上方逐条指引）`)
  process.exitCode = failed ? 1 : 0
} else if (mismatch.length && CHECK) {
  console.log(`\n  → 修复：node scripts/sync-dist-tags.mjs --fix   （或在 npm 网页端调整 dist-tags）`)
  console.log(`     打印命令而不执行：node scripts/sync-dist-tags.mjs --print`)
  process.exitCode = 1
} else if (!mismatch.length && !errors.length) {
  console.log(`\n✅ 全部 ${ok.length} 个已发布包的 ${TAGS.map((t) => `\`${t}\``).join(' + ')} tag 均指向本仓版本`)
}
