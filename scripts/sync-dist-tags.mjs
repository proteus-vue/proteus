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
//   node scripts/sync-dist-tags.mjs --check    # canonical（latest）不一致 → exit 1（门禁用）
//   node scripts/sync-dist-tags.mjs --fix      # 执行 npm dist-tag add 修复（**需交互式 2FA/OTP**）
//   node scripts/sync-dist-tags.mjs --fix --otp <6位码>   # 带一次性密码
//   node scripts/sync-dist-tags.mjs --tag <t>  # 显式指定 canonical tag（默认 latest）
//   node scripts/sync-dist-tags.mjs --print    # 只打印待执行的 npm 命令（便于手工执行）
//
// ★★2026-09-20 重要变更：canonical tag 从 `beta`（pre.json）**改为恒为 `latest`**——
//   因为 `npm dist-tag` 属**受 2FA 保护**的操作（bypass-2FA 的 granular token 自 2026-07-31 起
//   被限制用于包管理类操作，实测报 **EOTP**），而本仓账号没有可用的 OTP → 该命令**根本执行不了**。
//   唯一能改 tag 的地方是**发布时设 tag**（`npm publish --tag <t>`，不受该限制；已实测可用），
//   所以「可维护的 tag」只有发布时写入的那个，即 `latest`。
//   · `latest`：canonical——发布时写入 + 每次 `pnpm release` 核验；
//   · `beta`：**历史遗留 tag**（changesets pre 模式时代的产物）——只报告、不参与判定、不尝试修复。
//     如需把它也归位：`pnpm realign:beta`（用**重发**实现，无需 OTP）。
//
// ★为什么需要 OTP（旧记录，保留）：`npm dist-tag` 属**包管理**类操作——按 npm 政策，bypass-2FA 的
//   granular token 自 2026-07-31 起被限制用于此类操作，**必须**交互式 2FA（实测报 EOTP）。
//   （对照：`npm publish --tag <t>` 仍可用 token 完成，`npm access list` 读操作也可。）
//   若确有 OTP：在 npm 网页端 Packages → 该包 → Versions 里直接调整 dist-tag 亦可。
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

/**
 * canonical tag：**恒为 `latest`**（2026-09-20 起；判定与修复都只针对它）。
 * ★为什么不再默认取 pre.json 的 `beta`：见文件头「重要变更」——`npm dist-tag` 需要交互式 2FA，
 *   本仓没有 OTP → 该命令执行不了；唯一可维护的 tag 是**发布时写入**的那个（latest）。
 * `--tag <t>` 仍可覆盖（发布链传入本次发布用的 tag 时用它）。
 */
function canonicalTag() {
  if (TAG_OVERRIDE) return TAG_OVERRIDE
  return 'latest'
}

/** 历史遗留 tag：只报告、不参与判定（pre 模式时代的 `beta`；归位用 `pnpm realign:beta` 重发实现） */
const LEGACY_TAGS = ['beta']

/** 受管 tag（= canonical 自身；判定与 --fix 都只作用于它） */
function managedTags(canonical) {
  return [canonical]
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
  `[dist-tags] canonical tag：${TAG}${TAG_OVERRIDE ? '（--tag 指定）' : '（默认——发布时写入的那个；npm dist-tag 需 2FA，本仓无 OTP）'}`,
)

const pkgs = listPackages()
const rows = await Promise.all(
  pkgs.map(async (p) => {
    const d = await packument(p.full)
    if (d.error) return { ...p, err: d.error }
    // canonical 偏差（判定项）
    const offTags = TAGS.map((t) => ({ tag: t, current: d.tags[t] })).filter((x) => x.current !== p.version)
    // 历史遗留 tag 偏差（信息项，不判定）
    const legacyOff = LEGACY_TAGS.filter((t) => t !== TAG)
      .map((t) => ({ tag: t, current: d.tags[t] }))
      .filter((x) => x.current !== p.version)
    return { ...p, current: d.tags[TAG], published: d.versions.includes(p.version), tags: d.tags, offTags, legacyOff }
  }),
)

const unpublished = rows.filter((r) => !r.err && !r.published)
const ok = rows.filter((r) => !r.err && r.published && r.offTags.length === 0)
const mismatch = rows.filter((r) => !r.err && r.published && r.offTags.length > 0)
const errors = rows.filter((r) => r.err)

// ── 历史遗留 tag（信息项，不判定、不修复）──
// `beta` 是 changesets pre 模式时代的 canonical tag；现在 canonical 是 `latest`。
// 归位它**不能用 npm dist-tag**（需交互式 2FA，本仓无 OTP）——唯一路径是**重发**：
//   pnpm realign:beta   （连续两次「提升 + 重发」：先发到 beta，再发到 latest）
const legacyRows = rows.filter((r) => !r.err && r.published && (r.legacyOff ?? []).length > 0)
if (legacyRows.length) {
  const byTag = new Map()
  for (const r of legacyRows)
    for (const x of r.legacyOff) {
      if (!byTag.has(x.tag)) byTag.set(x.tag, [])
      byTag.get(x.tag).push(`${r.short}(${x.current ?? '缺失'}→${r.version})`)
    }
  console.log(`\n· 历史遗留 tag 未指向当前版本：${legacyRows.length} 个包（**不影响最新版安装**，但按该 tag 装会拿到旧包）`)
  for (const [tag, items] of byTag) {
    console.log(`  · ${tag}：${items.length} 个包  ${items.slice(0, 4).join('，')}${items.length > 4 ? ` …等 ${items.length} 个` : ''}`)
  }
  console.log('  → 归位（无需 OTP，用重发实现）：pnpm realign:beta')
  console.log('     若有 OTP 也可直接改 tag：pnpm publish:tags --fix --otp <6位码>')
}

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
