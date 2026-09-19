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
step('③', '发布到 npm')
run('npx', ['changeset', 'publish'], { capture: false })

// ── ④ 发布核验 ──
step('④', '发布核验（本仓版本是否都已上架）')
let post = null
try {
  post = JSON.parse(run('node', ['scripts/check-publish-drift.mjs', '--json']))
} catch {
  console.log('  （核验命令执行失败，跳过——发布本身已完成）')
}
if (post) {
  const notPublished = post.unpublished ?? []
  const realDrift = post.drift ?? []
  if (notPublished.length === 0 && realDrift.length === 0) {
    console.log(`  ✅ 全部 ${post.checked} 个包的当前版本均已在 registry 上`)
  } else {
    if (notPublished.length) {
      console.log(`  ✗ 以下 ${notPublished.length} 个版本**未上架**（发布失败或被跳过）：`)
      for (const u of notPublished) console.log(`      - @proteus-vue/${u.name}@${u.version}`)
    }
    if (realDrift.length) {
      console.log(`  ✗ 以下 ${realDrift.length} 个包「同版本但内容不同」：`)
      for (const d of realDrift) console.log(`      - @proteus-vue/${d.name}@${d.version}`)
    }
    die('发布核验未通过（见上方清单）')
  }
}

console.log('\n✅ 发布完成')
console.log('   下一步：把版本提升的改动提交（package.json / CHANGELOG / pnpm-lock.yaml）：')
console.log('     git add -A && git commit -m "chore(release): 版本提升"')
if (PRE) {
  console.log(`   提示：dist-tag 若要指向新版本，用 \`pnpm publish:tags\` 查看（属包管理动作，不阻断发布）`)
}
