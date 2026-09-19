#!/usr/bin/env node
// scripts/release.mjs —— ★一条命令完成发布：自动版本提升 → 发布 → 核验
//
// 设计目标（用户明确要求）：发布就该是**一条命令**。
//   `changeset version` / 模板 pin 同步 / lockfile 更新这些**机械动作由脚本做**，
//   不该要求人记住步骤、更不该在出错时把人挡在门外（「我又改不了」）。
//
// 流程：
//   ① 凭据预检——快失败，避免 36 行 E404 噪声掩盖真正的 E401
//   ② 自动版本提升：
//        · 有未消费的 changeset → `changeset version`
//        · 有「改了源码但没 bump」的包 → **自动补 patch changeset 再 version**
//          （不补的话发布会被 npm 静默跳过：用户拿到的仍是旧包，这正是一次真实事故）
//        · 随后同步模板/examples/根包 pin + 更新 lockfile
//   ③ `changeset publish`
//   ④ 发布核验——本仓版本是否都已上架（未上架的包列出来）
//
// 用法：
//   pnpm release                    # 一条命令全自动
//   pnpm release --no-auto-version  # 不为漂移包自动补 bump（改为提示你决定）
//   pnpm release --dry-run          # 只体检（①+②的判定），不改动、不发布
//
// 说明：发布后的深度实测（干净目录跑脚手架全旅程）用 `pnpm publish:smoke`，
//       不放在本命令里——它会真的 npm create + install，耗时约 1~2 分钟。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const AUTO_VERSION = !argv.includes('--no-auto-version')
const DRY_RUN = argv.includes('--dry-run')

const step = (n, title) => console.log(`\n── ${n} ${title} ──`)
const die = (msg) => {
  console.log(`\n✗ ${msg}`)
  process.exit(1)
}

/** 执行命令；capture=false 时直通输出（给 publish 用，让人看到进度） */
function run(cmd, args, { capture = true } = {}) {
  if (!capture) {
    execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', timeout: 1_800_000, env: { ...process.env, CI: 'true' } })
    return ''
  }
  return execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 900_000,
    env: { ...process.env, CI: 'true' },
  })
}

/**
 * 未消费的 changeset 文件。
 * ★pre-release 模式下 changesets **不删除**已消费的 .md，而是记进 `.changeset/pre.json`
 *   的 `changesets` 数组——所以不能只看目录（否则每次都把 17 个历史 changeset 报成「未消费」）。
 */
function pendingChangesets() {
  const dir = path.join(ROOT, '.changeset')
  if (!fs.existsSync(dir)) return []
  const onDisk = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
  let consumed = []
  try {
    const pre = JSON.parse(fs.readFileSync(path.join(dir, 'pre.json'), 'utf8'))
    consumed = (pre.changesets ?? []).map((n) => `${n}.md`)
  } catch {
    /* 无 pre.json = 非 pre 模式，全部视为待消费 */
  }
  return onDisk.filter((f) => !consumed.includes(f))
}

/** 漂移包清单（改了源码但版本号未提升）；null = 无法判定 */
function driftedPackages() {
  try {
    const j = JSON.parse(run('node', ['scripts/check-publish-drift.mjs', '--json']))
    return (j.drift ?? []).map((d) => d.name)
  } catch (e) {
    console.log(`  （漂移检查未能执行：${String(e.message ?? e).slice(0, 100)}）`)
    return null
  }
}

/** commitsets pre 模式的 tag（用于提示，不影响发布行为） */
function preTag() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, '.changeset', 'pre.json'), 'utf8'))
    return j.mode === 'pre' ? j.tag : null
  } catch {
    return null
  }
}

console.log('[release] Proteus 发布流程')
const PRE = preTag()
console.log(PRE ? `  模式：pre-release（changesets tag = ${PRE}）` : '  模式：正式版')

// ── ① 凭据预检 ──
step('①', '凭据预检')
try {
  run('node', ['scripts/check-publish-auth.mjs'], { capture: false })
} catch {
  die('npm 凭据不可用——请先修复认证（见上方提示），再重跑 pnpm release')
}

// ── ② 自动版本提升 ──
step('②', '版本提升（自动）')
const pending = pendingChangesets()
let drifted = driftedPackages()
if (drifted === null) die('无法判定版本漂移（漂移检查执行失败）——请先修好该命令再发布')

console.log(`  未消费的 changeset：${pending.length} 个${pending.length ? `（${pending.join(', ')}）` : ''}`)
console.log(`  源码改动但未 bump 的包：${drifted.length} 个${drifted.length ? `（${drifted.map((s) => '@proteus-vue/' + s).join(', ')}）` : ''}`)

if (pending.length === 0 && drifted.length === 0) {
  console.log('  无需提升——直接进入发布')
} else if (DRY_RUN) {
  console.log('  （--dry-run：跳过实际提升）')
} else if (drifted.length > 0 && !AUTO_VERSION) {
  die(
    `有 ${drifted.length} 个包改了源码但版本未提升，不 bump 发布会把它们**静默跳过**（用户拿到的仍是旧包）。\n` +
      `  两个选择：\n` +
      `    a) 让脚本自动补 patch bump：重跑 \`pnpm release\`（去掉 --no-auto-version）\n` +
      `    b) 自行决定版本级别：\`npx changeset\` 交互式创建 changeset 后再发布`,
  )
} else {
  // 为漂移包补一个 patch changeset —— 交给 changesets 统一处理
  // （它会同时更新依赖这些包的内部精确 pin，并级联 bump 依赖方）
  if (drifted.length > 0) {
    const lines = drifted.map((s) => `'@proteus-vue/${s}': patch`)
    const body =
      `---\n${lines.join('\n')}\n---\n\n` +
      `自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，\n` +
      `不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。\n\n` +
      drifted.map((s) => `- \`@proteus-vue/${s}\``).join('\n') +
      `\n`
    fs.writeFileSync(path.join(ROOT, '.changeset', 'auto-release-bump.md'), body)
    console.log(`  已为 ${drifted.length} 个漂移包生成 patch changeset（.changeset/auto-release-bump.md）`)
  }
  run('npx', ['changeset', 'version'], { capture: false })
  // 模板 / examples / 根包的 pin（changesets 管不到）+ lockfile
  run('node', ['scripts/sync-internal-versions.mjs'], { capture: false })
  run('pnpm', ['install', '--lockfile-only', '--no-frozen-lockfile'], { capture: false })
  console.log('  版本提升完成')
}

if (DRY_RUN) {
  console.log('\n[release] --dry-run 结束（未改动、未发布）')
  process.exit(0)
}

// ── 提升后再核一次漂移，确保发出的确实是当前代码 ──
if (pending.length || drifted.length) {
  const after = driftedPackages()
  if (after === null) die('版本提升后无法复核漂移')
  if (after.length) {
    die(
      `版本提升后仍有 ${after.length} 个包漂移：${after.map((s) => '@proteus-vue/' + s).join(', ')}\n` +
        `  这通常意味着这些包没被任何 changeset 覆盖到——请检查 .changeset/ 或手动处理。`,
    )
  }
  console.log('  漂移复核：0（待发的都是新版本）')
}

// ── ③ 发布 ──
// ★`changeset publish` 退出码非 0 **不等于发布失败**：当某个版本此前已发布/已暂存，
//   npm 返回 E409（"Cannot publish over previously staged/published version"），
//   changesets 遂报 error 并在末尾以非零退出——但包其实**已经在线上**（实测踩到：
//   3 个包全部发布成功，重跑时却因 E409 让整条命令崩掉，用户误以为发布失败）。
//   故这里不立即判定失败，交由第 ④ 步按 **registry 实际状态**裁决（那才是用户视角的真相）。
step('③', '发布到 npm')
let publishExitNonZero = false
try {
  run('npx', ['changeset', 'publish'], { capture: false })
} catch {
  publishExitNonZero = true
  console.log('\n  ⚠ changeset publish 退出码非 0 —— 先不判定失败')
  console.log('     常见且无害的成因：该版本此前已发布/已暂存 → npm E409，changesets 重试发布所致。')
  console.log('     是否真失败，由第 ④ 步按 registry 实际状态裁决。')
}

// ── ④ 发布核验 ──
// ★必须带**有界重试**：npm 发布完成后 registry 有**传播窗口**（npm 自己会提示
//   "Your package is being processed and may take a few minutes to become available"）。
//   单次查询会把「刚发布成功、尚未传播完」误判为「发布失败」——实测踩到：
//   3 个包全部发布成功（changesets 明确 success），核验却立刻报「未上架」而 exit 1。
//   归因：只有「查不到」才重试；一旦查到即通过。有上限、有退避，非盲等。
step('④', '发布核验（本仓版本是否都已上架）')

/** registry 上是否存在该版本（查 packument——比版本专用端点更早可见） */
async function versionExists(short, version) {
  const url = 'https://registry.npmjs.org/' + encodeURIComponent('@proteus-vue/' + short)
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'proteus-release' }, signal: AbortSignal.timeout(20_000) })
    if (!r.ok) return { exists: false, error: `HTTP ${r.status}` }
    const d = await r.json()
    return { exists: Object.prototype.hasOwnProperty.call(d.versions ?? {}, version) }
  } catch (e) {
    return { exists: false, error: String(e).slice(0, 80) }
  }
}

/** 本仓所有包的 name/version（核验对象） */
function allLocalPackages() {
  const out = []
  const dir = path.join(ROOT, 'packages')
  for (const d of fs.readdirSync(dir)) {
    const f = path.join(dir, d, 'package.json')
    if (!fs.existsSync(f)) continue
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'))
      if (j.name?.startsWith('@proteus-vue/')) out.push({ short: j.name.replace('@proteus-vue/', ''), version: j.version })
    } catch {
      /* 非包目录 */
    }
  }
  return out
}

const targets = allLocalPackages()
const MAX_WAIT_MS = 180_000 // npm 提示「几分钟」——上限 3 分钟
const t0 = Date.now()
let attempt = 0
let missing = []
for (;;) {
  attempt++
  const results = await Promise.all(targets.map((t) => versionExists(t.short, t.version)))
  missing = targets.filter((_, i) => !results[i].exists)
  if (missing.length === 0) break
  const waited = Date.now() - t0
  if (waited >= MAX_WAIT_MS) break
  const waitMs = Math.min(15_000, 5_000 * attempt)
  console.log(
    `  ${missing.length} 个版本尚未可见（registry 传播窗口，第 ${attempt} 次查询）——${waitMs / 1000}s 后复查`,
  )
  await new Promise((r) => setTimeout(r, waitMs))
}

if (missing.length === 0) {
  console.log(`  ✅ 全部 ${targets.length} 个包的当前版本均已在 registry 上（用时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`)
  if (publishExitNonZero) {
    console.log('  （第 ③ 步的非零退出码确认为无害：版本此前已发布/已暂存，registry 状态正确）')
  }
  // 顺带报告「同版本内容不同」的真漂移（发布核验的另一半）
  try {
    const post = JSON.parse(run('node', ['scripts/check-publish-drift.mjs', '--json']))
    const realDrift = post.drift ?? []
    if (realDrift.length) {
      console.log(`  ✗ ${realDrift.length} 个包「同版本但内容不同」：`)
      for (const d of realDrift) console.log(`      - @proteus-vue/${d.name}@${d.version}`)
      die('存在真漂移（见上方清单）')
    }
  } catch {
    /* 漂移检查失败不影响发布已完成的结论 */
  }
} else {
  console.log(`  ✗ 等待 ${MAX_WAIT_MS / 1000}s 后以下 ${missing.length} 个版本仍不可见：`)
  for (const m of missing) console.log(`      - @proteus-vue/${m.short}@${m.version}`)
  console.log('  可能成因：① 该包未包含在任何待发 changeset 中（未参与本次发布）')
  console.log('            ② 发布确实失败（回看第 ③ 步输出中该包的 npm 错误）')
  die('发布核验未通过（见上方清单）')
}

console.log('\n✅ 发布完成')
console.log('   下一步：把版本提升的改动提交（package.json / CHANGELOG / pnpm-lock.yaml）：')
console.log('     git add -A && git commit -m "chore(release): 版本提升"')
if (PRE) {
  console.log(`   提示：dist-tag 若要指向新版本，用 \`pnpm publish:tags\` 查看（属包管理动作，不阻断发布）`)
}
