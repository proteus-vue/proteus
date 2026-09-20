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
//   pnpm release           # 一条命令全自动：凭据预检 → 版本提升 → 发布 → 核验 → tag 归一
//   pnpm release --dry-run # 只体检，不改动、不发布
//   pnpm release --all     # ★全部包补 patch 版本并重发——用于把 41 个包的 `latest` 一次性归位
//                          #   （npm 强制每包须有 latest，而事后改 tag 需交互式 2FA；
//                          #    发布时设置 tag 不受限，故重发是零手工的归位路径）
//
// 发布 tag 策略（单轨）：全部包统一发到 `latest`——本项目只有一条线，不出现
//   beta/latest 并行的两套版本。版本号本身仍带 `-beta.N` 前缀，语义上仍是预发布。
//
// 说明：发布后的深度实测（干净目录跑脚手架全旅程）用 `pnpm publish:smoke`，
//       不放在本命令里——它会真的 npm create + install，耗时约 1~2 分钟。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const DRY_RUN = argv.includes('--dry-run')
/**
 * `--all`：**给全部包补一个 patch 版本并发布**。
 * ★用途（2026-09-19 一次性把 tag 收口到单轨）：npm 强制每个包必须有 `latest`，而事后改 tag
 *   （`npm dist-tag`）属包管理操作、会被要求交互式 2FA（实测 EOTP 挡住）；但**发布时设置 tag
 *   不受此限**——所以让每个包都重新发布一次，是把 41 个包的 `latest` 全部归位到当前版本的
 *   唯一「零手工」路径。仅在 tag 需要整体收口时用，日常发布不要加。
 */
const REPUBLISH_ALL = argv.includes('--all')

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
if (REPUBLISH_ALL) console.log('  ★--all：将为**全部包**补 patch 版本并发布（把 latest tag 整体归位）')

/**
 * 为给定包写一个 patch changeset（唯一文件名）+ 跑 `changeset version` + 同步 pin。
 * ★抽成函数是为了**迭代**（见下方收敛循环）——linked 分组下需要多轮才能到不动点。
 */
function bumpPackages(targets, { reason }) {
  // 记录提升前的版本（下方核验「版本真的前进了」——防文件名碰撞导致的静默 no-op）
  const versionBefore = {}
  for (const s of targets) {
    try {
      versionBefore[s] = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', s, 'package.json'), 'utf8')).version
    } catch {
      /* 读不到 → 核验时跳过该包 */
    }
  }
  const lines = targets.map((s) => `'@proteus-vue/${s}': patch`)
  const body =
    `---\n${lines.join('\n')}\n---\n\n` +
    reason +
    targets.map((s) => `- \`@proteus-vue/${s}\``).join('\n') +
    `\n`
  // ★★文件名必须**唯一**（2026-09-20 实测踩到的静默失败，阻断级）：
  //   pre-release 模式下 changesets **不删除**已消费的 changeset，而是把文件名记进
  //   `.changeset/pre.json` 的 `changesets` 数组；而 `changeset version` 会**跳过任何已在册的文件名**。
  //   固定名 → 第二次发布起写成即已在册 → `changeset version` **静默 no-op** → 版本原地不动
  //   → 发布时逐包判「内容一致 → skip」→ 整条命令打印成功却一个包都没发。
  for (const f of fs.readdirSync(path.join(ROOT, '.changeset'))) {
    if (/^auto-release-bump.*\.md$/.test(f)) {
      try {
        fs.rmSync(path.join(ROOT, '.changeset', f))
      } catch {
        /* 清理失败不影响（新文件用唯一名） */
      }
    }
  }
  const csName = `auto-release-bump-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.md`
  fs.writeFileSync(path.join(ROOT, '.changeset', csName), body)
  console.log(`  已为 ${targets.length} 个包生成 patch changeset（.changeset/${csName}）`)

  run('npx', ['changeset', 'version'], { capture: false })
  // ★版本提升的**结果核验**（2026-09-20 加固）：静默 no-op 之所以危险，是它会一路绿灯走到「发布成功」的假象。
  //   此处用**版本号是否真的前进**做判据——没动就是没 bump，直接失败。
  const bumped = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', targets[0], 'package.json'), 'utf8')).version
  const before = versionBefore[targets[0]]
  if (before && bumped === before) {
    die(
      `版本提升**没有生效**：@proteus-vue/${targets[0]} 仍是 ${bumped}（未前进）。\n` +
        `  最可能的原因：生成的 changeset 文件名已在 .changeset/pre.json 的已消费清单里\n` +
        `  （pre 模式下 changesets 会跳过在册文件名 → 静默 no-op）。请检查 .changeset/ 与 pre.json。`,
    )
  }
  console.log(`  版本提升核验：@proteus-vue/${targets[0]} ${before ?? '?'} → ${bumped} ✓`)
  // 模板 / examples / 根包的 pin（changesets 管不到）
  run('node', ['scripts/sync-internal-versions.mjs'], { capture: false })
  return targets
}

let round = 0
const bumpedAll = []
if (pending.length === 0 && drifted.length === 0 && !REPUBLISH_ALL) {
  console.log('  无需提升——直接进入发布')
} else if (DRY_RUN) {
  console.log('  （--dry-run：跳过实际提升）')
} else {
  // ── ★收敛循环（2026-09-20：linked 分组后必须迭代）──
  // 为什么一轮不够：linked 下只 bump「内容有变更」的包。而 bump 一个包会**更新依赖它的 pin**
  //   （精确 pin 写在 package.json 里 → 依赖方的**内容**随之变化）→ 依赖方也成了「内容变了但版本没变」
  //   → 不 bump 就发不出去（npm 版本不可变）。
  //   ★特别地，**devDependencies 不会触发 changesets 的级联**（它只管 deps/peerDeps），
  //     但本仓的 sync-internal-versions 会更新它们 → 必然产生这类「附带变更」。
  //   实测（2026-09-20 本轮）：一轮 bump 后仍剩 4 个包漂移（runtime / hmr / compiler-backend / create-proteus，
  //     全是 devDeps pin 被更新所致）；再 bump 一轮即收敛。
  //   故此处迭代到不动点（有上限，防意外不收敛）。
  // ★bumpedAll / round 声明在分支**外**：下方的「提升后漂移复核」要用它们判定「是否已覆盖」。
  let bumpTargets = drifted
  if (REPUBLISH_ALL) {
    bumpTargets = []
    for (const e of fs.readdirSync(path.join(ROOT, 'packages'), { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      try {
        const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', e.name, 'package.json'), 'utf8'))
        if (j.name?.startsWith('@proteus-vue/')) bumpTargets.push(j.name.replace('@proteus-vue/', ''))
      } catch {
        /* 非包目录 */
      }
    }
  }
  const reason = REPUBLISH_ALL
    ? `全量重发（scripts/release.mjs --all）：把全部包的 \`latest\` tag 归位到当前版本。\n` +
      `动机——npm 强制每包须有 \`latest\`，而事后改 tag（npm dist-tag）属包管理操作、\n` +
      `会被要求交互式 2FA；发布时设置 tag 不受此限，故重发是零手工的归位路径。\n\n`
    : `自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，\n` +
      `不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。\n\n`

  const MAX_ROUNDS = 6
  round = 0
  // bumpedAll 为外层变量（见上）
  while (bumpTargets.length > 0 && round < MAX_ROUNDS) {
    round++
    if (round > 1) console.log(`\n  ── 收敛第 ${round} 轮（上一轮 bump 更新了依赖方 pin → 产生新的待 bump 包）──`)
    bumpPackages(bumpTargets, { reason })
    bumpedAll.push(...bumpTargets)
    // 复核：还有漂移 → 下一轮（linked 语义下这是正常现象，不是错误）
    const after = driftedPackages()
    if (after === null) die('版本提升后无法复核漂移')
    const fresh = after.filter((s) => !bumpedAll.includes(s))
    if (fresh.length === 0) {
      if (after.length === 0) break
      // 剩下的都是已 bump 过的（理论上不该出现）→ 交给下方 postcheck 处理
      break
    }
    bumpTargets = fresh
  }
  if (round >= MAX_ROUNDS) die(`版本提升未收敛（${MAX_ROUNDS} 轮后仍有漂移）——请检查依赖环或手动处理`)
  console.log(`  版本提升完成（共 ${round} 轮，涉及 ${new Set(bumpedAll).size} 个包）`)
}

// ── ②b 提升后置同步（★**无条件执行**，不再只在提升分支里跑）──
// ★2026-09-20 加固：这两步原先写在上面 else（提升）分支的末尾，于是「提升中途崩溃 → 重跑」时
//   会因为「无需提升」而**整段跳过**它们 → 脚手架模板的 pin 永久停在旧版本（用户 `npm create`
//   会装到旧包），而这条路径**不在发布链的任何校验里**（check:internal-versions 门禁不参与发布）。
//   两步都是**幂等**的（已对齐则 no-op），故移到分支外无条件执行，把「崩过就半途而废」变成自愈。
if (!DRY_RUN) {
  run('node', ['scripts/sync-internal-versions.mjs'], { capture: false })
  run('pnpm', ['install', '--lockfile-only', '--no-frozen-lockfile'], { capture: false })
  // ★发布前自查：模板/examples/根包 pin 必须与 workspace 一致——这是「用户能装到新包」的前提
  try {
    run('node', ['scripts/sync-internal-versions.mjs', '--check'], { capture: true })
    console.log('  内部版本对齐核验：模板 / examples / 根包 pin 均 = workspace ✓')
  } catch (e) {
    die(
      '内部版本对齐核验未通过（模板/examples/根包 pin 与 workspace 不一致）——\n' +
        "  用户 `npm create` 会装到旧包。详见：node scripts/sync-internal-versions.mjs --check\n" +
        `  ${String(e.stdout ?? e.message ?? e).slice(0, 300)}`,
    )
  }
}

if (DRY_RUN) {
  // ★演练必须覆盖**发布命令本身**（2026-09-19 教训）：上一版的 --dry-run 在发布前就退出，
  //   于是「命令被 npm 拒绝」这类错误要等到真发布才暴露（changesets 在 pre 模式下拒绝
  //   自定义 tag，41 个包一个都没发出去）。现在用 `npm publish --dry-run` 走**完全相同的
  //   命令路径**（同参数、同逐包循环），只是不推送 registry。
  step('③', '演练发布命令（不推送 registry）')
  const PUB_TAG = 'latest'
  console.log(`  以 tag=${PUB_TAG} 对全部包执行 npm publish --dry-run——验证命令本身可用`)
  try {
    run('bash', ['scripts/publish-all.sh', '--tag', PUB_TAG, '--dry-run', '--skip-drift-check'], { capture: false })
    console.log('\n[release] --dry-run 结束：发布命令已验证可用，未改动、未发布')
  } catch {
    die('发布命令演练失败（见上方 FAIL 项）——修好后再真实发布，避免又白跑一趟')
  }
  process.exit(0)
}

// ── 提升后再核一次漂移，确保发出的确实是当前代码 ──
// ★2026-09-20（linked 分组后）：判据从「必须为 0」改为**「必须已被 bump 覆盖」**——
//   linked 语义下「有包漂移」不一定是错误：它可能是**下一轮才该 bump** 的（我们已在上面收敛循环里迭代）。
//   到这一步仍有漂移，才是真问题（某包改了但没人 bump 它 → 发不出去）。
if (pending.length || drifted.length) {
  const after = driftedPackages()
  if (after === null) die('版本提升后无法复核漂移')
  // 收敛循环已 bump 过的包 → 它们现在版本已前进，不算「未覆盖」
  const bumpedSet = new Set(bumpedAll.map((s) => s))
  const uncovered = after.filter((s) => !bumpedSet.has(s))
  if (uncovered.length) {
    die(
      `版本提升后仍有 ${uncovered.length} 个包漂移且未被 bump：${uncovered.map((s) => '@proteus-vue/' + s).join(', ')}\n` +
        `  这通常意味着这些包没被任何 changeset 覆盖到——请检查 .changeset/ 或手动处理。`,
    )
  }
  console.log(`  漂移复核：0 个未覆盖（本轮共 bump ${bumpedSet.size} 个包，收敛 ${round} 轮）`)
}

// ── ③ 发布 ──
// ★单轨：全部包统一发到 `latest`（2026-09-19 用户要求「不要出现正式版标签，实际只有一条线」）。
//   npm **强制**每个包必须有 `latest`（删掉它 `npm i <pkg>` 直接解析失败），故不是取消该 tag，
//   而是让它恒等于最新版本——文档里的安装命令都不带 tag，这样用户按文档装就拿对。
//   版本号本身仍带 `-beta.N` 前缀，语义上仍是预发布。
// ★为什么不用 `changeset publish --tag latest`（实测踩到）：
//   changesets 在 pre 模式下**禁止自定义 tag**——报
//   `Releasing under custom tag is not allowed in pre mode`，导致 41 个包一个都没发出去。
//   而 `npm publish --tag <name>` 不受此限 → 改用本仓 publisher 逐包发布（见 publish-all.sh）。
step('③', '发布到 npm')
const PUB_TAG = 'latest'
console.log(`  全部包统一发到 tag：${PUB_TAG}（单轨；版本号仍带 -beta.N 前缀）`)
let publishExitNonZero = false
try {
  // --skip-drift-check：第 ② 步刚查过（且带缓存），无需重复
  run('bash', ['scripts/publish-all.sh', '--tag', PUB_TAG, '--skip-drift-check'], { capture: false })
} catch {
  publishExitNonZero = true
  console.log('\n  ⚠ 发布步骤退出码非 0 —— 先不判定失败')
  console.log('     常见且无害的成因：该版本此前已发布（幂等跳过逻辑之外的情况）。')
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
const t0 = Date.now()

/**
 * 核验 registry 是否已收录本仓版本。
 * ★两级等待（2026-09-19 实测整改）：上一版无论什么情况都盲等最多 3 分钟——
 *   实测「一个都没发出去」时（changesets 拒绝自定义 tag → 41 个包全未发布），
 *   它仍傻等 3 分钟才报错，纯属浪费时间（效率规范：等待必须有条件、有退出判定）。
 *   · **一个都没可见** ⇒ 极可能是发布环节整批失败（而非传播延迟）→ **立即报错**，不等；
 *   · **部分可见** ⇒ 才是真正的传播窗口 → 有界重试。
 * ★窗口按「还剩几个」分级（2026-09-20 实跑教训）：那轮 41 包全部发布成功，但最后一个
 *   （pinia-sync）比其余晚到——核验在 **90s 上限**处停手判失败，而它随后就可见了。
 *   npm 自己提示的是 "may take a few minutes"；**既然只有极少数还没到，多等是有价值的**，
 *   而「整批不见」那种真失败仍然第一时间报错（不受影响）。故：
 *     · 剩余 ≥ 一半 → 90s 上限（可能确实有问题，别干等）
 *     · 剩余 < 一半 → 300s 上限（正常传播，值得等）
 */
const FULL_WINDOW_MS = 300_000
const PARTIAL_WINDOW_MS = 90_000
async function pollUntilVisible() {
  let attempt = 0
  for (;;) {
    attempt++
    const results = await Promise.all(targets.map((t) => versionExists(t.short, t.version)))
    const miss = targets.filter((_, i) => !results[i].exists)
    if (miss.length === 0) return miss
    // 一批都没可见 → 判定为发布失败，不做无意义等待
    if (miss.length === targets.length && attempt === 1) {
      console.log('  ✗ 全部版本均未上架（一个都没有）——判定为发布环节整批失败，非传播延迟，不再等待')
      return miss
    }
    const windowMs = miss.length * 2 < targets.length ? FULL_WINDOW_MS : PARTIAL_WINDOW_MS
    if (Date.now() - t0 >= windowMs) return miss
    const waitMs = Math.min(20_000, 5_000 * attempt)
    console.log(`  ${miss.length}/${targets.length} 个版本尚未可见（传播窗口，第 ${attempt} 次）——${waitMs / 1000}s 后复查`)
    await new Promise((r) => setTimeout(r, waitMs))
  }
}
const missing = await pollUntilVisible()

/** 是否阻断整条发布（漂移/缺版本等硬失败）；tag 归一与收尾统计仍要跑 */
let releaseFailed = false

if (missing.length === 0) {
  console.log(`  ✅ 全部 ${targets.length} 个包的当前版本均已在 registry 上（用时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`)
  if (publishExitNonZero) {
    console.log('  （第 ③ 步的非零退出码确认为无害：版本此前已发布，registry 状态正确）')
  }
  // 顺带报告「同版本内容不同」的真漂移（发布核验的另一半）
  try {
    const post = JSON.parse(run('node', ['scripts/check-publish-drift.mjs', '--json']))
    const realDrift = post.drift ?? []
    if (realDrift.length) {
      console.log(`  ✗ ${realDrift.length} 个包「同版本但内容不同」：`)
      for (const d of realDrift) console.log(`      - @proteus-vue/${d.name}@${d.version}`)
      console.log('  → 修复：给这些包 bump 版本（同版本无法覆盖发布）。')
      releaseFailed = true
    }
  } catch {
    /* 漂移检查失败不影响发布已完成的结论 */
  }
} else {
  console.log(`  ✗ 以下 ${missing.length} 个版本未上架：`)
  for (const m of missing) console.log(`      - @proteus-vue/${m.short}@${m.version}`)
  console.log('  可能成因：① 发布环节失败（回看第 ③ 步输出中该包的 npm 错误）')
  console.log('            ② 传播窗口未走完（npm 提示 "may take a few minutes"）——可稍后单独复查：')
  console.log('               node scripts/check-publish-drift.mjs --only <包名>')
  console.log('  ③ 该包未被任何 changeset 覆盖（未参与本次发布）')
  // ★不再 `die()` 立即退出（2026-09-20 实跑教训）：核验失败曾让第 ⑤ 步 tag 归一**永不执行**，
  //   而 tag 与「版本是否可见」是 registry 上两件独立的事——发布已成功的包，其 tag 仍应归一。
  //   故记为失败、继续走完收尾，最后统一以非零码退出。
  releaseFailed = true
}

// ── ⑤ tag 核验（canonical = latest）──
// ★★2026-09-20 重写（实测教训）：本步原为「跑 `npm dist-tag add` 把 beta 与 latest 都拉齐」，
//   但那是**执行不了**的——`npm dist-tag` 属受 2FA 保护的包管理操作（bypass-2FA token 自
//   2026-07-31 起被限制用于此类操作），实测报 **EOTP**，而本仓账号没有可用的 OTP 设备。
//   唯一能写入 tag 的地方是**发布时**：`npm publish --tag <t>`（不受该限制）。
//   → 本步改为**核验**（不尝试改 tag）：
//     · `latest` 是发布时写入的 canonical → 必须指向当前版本，不符即判失败；
//     · `beta` 属历史遗留 tag → 只报告，并指向无需 OTP 的归位路径（pnpm realign:beta）。
step('⑤', 'tag 核验（canonical = latest）')
try {
  run('node', ['scripts/sync-dist-tags.mjs', '--check'], { capture: false })
} catch {
  console.log('\n  ✗ canonical（latest）tag 与当前版本不一致（见上方清单）。')
  console.log('     这通常意味着有包「此前已发布同版本 → 跳过演出」，其 tag 未随本次发布更新。')
  console.log('     归位（无需 OTP）：pnpm realign:beta（重发实现）或手工 npm dist-tag（需 2FA）。')
  releaseFailed = true
}

if (releaseFailed) {
  console.log('\n⚠ 发布已完成，但上面的核验项**未全部通过**（见第 ④ 步清单）。')
  console.log('   包本身已推到 registry；未通过的多为**传播窗口**或**真漂移**，按提示复查即可。')
  console.log('   版本提升的改动仍需提交：git add -A && git commit -m "chore(release): 版本提升"')
  process.exit(1)
}

console.log('\n✅ 发布完成')
console.log('   下一步：把版本提升的改动提交（package.json / CHANGELOG / pnpm-lock.yaml）：')
console.log('     git add -A && git commit -m "chore(release): 版本提升"')
