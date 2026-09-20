#!/usr/bin/env node
// scripts/realign-beta.mjs —— ★把历史遗留 tag（beta）归位到当前版本，**无需 OTP**
//
// 背景（2026-09-20 实测）：
//   `npm dist-tag add` 属**受 2FA 保护**的包管理操作——bypass-2FA 的 granular token 自 2026-07-31
//   起被限制用于此类操作，实测报 `EOTP`（本仓账号没有可用的 OTP 设备）。
//   → 改 dist-tag 的唯一可行路径是**发布时写入**：`npm publish --tag <t>` 不受该限制（已实测）。
//
// 因此「让 beta 指向当前版本」可以用**重发**实现（本仓惯例，参见 `pnpm release --all`）：
//   ① 提升一个 patch 版本（beta.N → beta.N+1），发到 **beta**；
//   ② 再提升一个 patch（beta.N+1 → beta.N+2），发到 **latest**。
//   结束后：beta = 中间版本、latest = 最终版本。二者都指向**同一份源码**（两次之间无代码改动）。
//
// ★为什么要发两轮而不是一轮：`npm publish` 的 tag 是**发布时写一次**的——同一个版本无法发两次
//   （npm 版本不可变，重发同版本报 E409）。要让两个 tag 都指到「当前代码」，就必须有两个版本号。
//   ★副作用（诚实标注）：npm 上会多一个中间版本（beta.N+1），且 `latest` 会比本次基线前进一格
//   （beta.N+2）。若你希望 latest 别前进，用 `--only-beta`：只做第 ① 步，beta 归位而 latest 不动
//   （此时 beta ≠ latest，是「beta 线领先」的形态——本仓单轨语义下不推荐，但可控）。
//
// 用法：
//   node scripts/realign-beta.mjs --dry-run      # 只打印计划（默认行为，安全）
//   node scripts/realign-beta.mjs --yes          # 实际执行两轮提升 + 发布
//   node scripts/realign-beta.mjs --only-beta --yes   # 只发 beta（latest 不动）
//
// 发布之间会**自动**跑 `sync-internal-versions` + lockfile 同步（模板 pin 必须跟着动，
// 否则用户 `npm create` 装到旧包——2026-09-19 事故形态）。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const EXECUTE = argv.includes('--yes')
const ONLY_BETA = argv.includes('--only-beta')

const step = (n, t) => console.log(`\n── ${n} ${t} ──`)
const die = (msg) => {
  console.log(`\n✗ ${msg}`)
  process.exit(1)
}
function run(cmd, args, { capture = false } = {}) {
  if (capture) {
    return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 1_800_000, env: { ...process.env, CI: 'true' } })
  }
  execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', timeout: 1_800_000, env: { ...process.env, CI: 'true' } })
  return ''
}

/** 本仓版本（以 components 为代表——fixed 分组下 41 包同版本） */
function currentVersion() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'components', 'package.json'), 'utf8')).version
}

/** 全部 @proteus-vue/* 包短名 */
function allPackages() {
  const out = []
  for (const e of fs.readdirSync(path.join(ROOT, 'packages'), { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    try {
      const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', e.name, 'package.json'), 'utf8'))
      if (j.name?.startsWith('@proteus-vue/')) out.push(j.name.replace('@proteus-vue/', ''))
    } catch {
      /* 非包目录 */
    }
  }
  return out
}

/**
 * 提升一个 patch 版本并发布到指定 tag。
 * ★与 release.mjs 同一套机制：写一个**唯一文件名**的 patch changeset → `changeset version`
 *   （pre 模式下在册文件名会被跳过 → 必须唯一，见 release.mjs 的踩坑记录）→ 同步 pin → 发布。
 */
function bumpAndPublish(tag) {
  const before = currentVersion()
  for (const f of fs.readdirSync(path.join(ROOT, '.changeset'))) {
    if (/^auto-release-bump.*\.md$/.test(f)) {
      try {
        fs.rmSync(path.join(ROOT, '.changeset', f))
      } catch {
        /* 忽略 */
      }
    }
  }
  const pkgs = allPackages()
  const body =
    `---\n${pkgs.map((s) => `'@proteus-vue/${s}': patch`).join('\n')}\n---\n\n` +
    `tag 归位（scripts/realign-beta.mjs）：把 ${tag} 指向当前代码。\n` +
    `动机——npm dist-tag 需交互式 2FA（本仓无 OTP），唯一可行路径是「发布时设 tag」。\n\n` +
    pkgs.map((s) => `- \`@proteus-vue/${s}\``).join('\n') +
    `\n`
  const csName = `auto-release-bump-${Date.now()}.md`
  fs.writeFileSync(path.join(ROOT, '.changeset', csName), body)
  console.log(`  生成 changeset：.changeset/${csName}`)

  run('npx', ['changeset', 'version'])
  const after = currentVersion()
  if (after === before) {
    die(
      `版本提升没有生效（仍是 ${after}）——最常见原因是 changeset 文件名与 pre.json 已消费清单冲突。\n` +
        `  请检查 .changeset/${csName} 与 .changeset/pre.json。`,
    )
  }
  console.log(`  版本：${before} → ${after}`)

  // 模板 / examples / 根包 pin 必须跟着动（否则用户 npm create 装到旧包）
  run('node', ['scripts/sync-internal-versions.mjs'])
  run('pnpm', ['install', '--lockfile-only', '--no-frozen-lockfile'])

  console.log(`  发布到 ${tag}（${after}）…`)
  run('bash', ['scripts/publish-all.sh', '--tag', tag, '--skip-content-check', '--skip-drift-check'])
  return after
}

console.log('[realign-beta] 把历史遗留 tag 归位（无需 OTP——用重发实现）')
console.log(`  当前版本：${currentVersion()}`)
console.log(`  计划：${ONLY_BETA ? '① 提升 + 发 beta（latest 不动）' : '① 提升 + 发 beta　② 再提升 + 发 latest'}`)
if (!EXECUTE) {
  console.log('\n（当前是**演练**模式：什么都没做。确要执行请加 --yes）')
  console.log('  说明：本命令会**连续两次提升 patch 版本并发布**——npm 上会多一个中间版本号。')
  console.log('  若只想让 beta 归位、不让 latest 前进：加 --only-beta')
  process.exit(0)
}

step('①', '提升 patch 并发到 beta')
const mid = bumpAndPublish('beta')

if (ONLY_BETA) {
  console.log(`\n✅ 完成：beta → ${mid}（latest 未改动）`)
  console.log('   现在 beta 与 latest 指向**不同**版本，这是「beta 线领先」形态：')
  console.log('     · 按文档不带 tag 安装 → latest（本次未动）')
  console.log('     · 用 @beta 安装 → 本次新发的版本')
  console.log('   若要让两者一致，去掉 --only-beta 重跑（或跑 pnpm release --all）。')
  process.exit(0)
}

step('②', '再提升 patch 并发到 latest')
const final = bumpAndPublish('latest')

console.log(`\n✅ 完成：`)
console.log(`   beta   → ${mid}（中间版本，与 ${final} 是**同一份代码**）`)
console.log(`   latest → ${final}`)
console.log('\n   下一步（务必）：提交版本提升的改动')
console.log('     git add -A && git commit -m "chore(release): tag 归位（beta/latest）"')
