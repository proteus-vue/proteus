#!/usr/bin/env node
// scripts/check-publish-auth.mjs —— ★发布前置认证检查（快失败 + 清晰诊断）
//
// 背景（2026-09-19 实战）：token 失效后直接跑 `changeset:publish`，输出是**36 个包的 E404 刷屏**
//   （`E404 Not Found - PUT https://registry.npmjs.org/@proteus-vue%2Fxxx`），而真正的根因只有一行：
//   `npm error code E401 ... your authentication token seems to be invalid`。
//   ★为什么是 E404 而不是 401/403：scoped 包在**未认证**视角下 registry 返回 404（避免泄露包是否存在）
//   ——极易被误读成「包不存在/scope 没权限」，实际只是没登进去。
//   本脚本把该诊断前置：认证不过就**立刻停**并给出修复指引，不让 36 行噪声掩盖一行根因。
//
// ★同时提示 npm 政策变化（影响未来，不影响当下）：
//   2026-07-31 起，bypass-2FA 的 granular token 已被限制用于「账号/包管理」类操作；
//   **计划 2027-01 起将同样失去「直接发布」能力** → 届时应迁移到 **trusted publishing (OIDC)**
//   或 staged publishing（维护者 2FA 批准）。当前（2027-01 前）bypass-2FA token 仍可直接 publish。
//   参考：https://github.blog/changelog/2026-07-31-restricting-npm-bypass-2fa-granular-access-tokens/
//
// 用法：node scripts/check-publish-auth.mjs
// 退出码：0 认证可用 / 1 认证不可用（发布流程应就此中止）
import { execFileSync } from 'node:child_process'

const REGISTRY = 'https://registry.npmjs.org'

function run(cmd, args) {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 })
    return { ok: true, out: out.trim() }
  } catch (e) {
    return { ok: false, out: String(e.stdout ?? '').trim(), err: String(e.stderr ?? '').trim() }
  }
}

const who = run('npm', ['whoami', '--registry', REGISTRY])
if (who.ok && who.out) {
  console.log(`[publish-auth] ✅ 已认证：${who.out}（registry: ${REGISTRY}）`)
  console.log('[publish-auth] 提示：bypass-2FA token 的「直接发布」能力计划于 2027-01 移除——')
  console.log('              届时请迁移到 trusted publishing (OIDC) 或 staged publishing。')
  process.exit(0)
}

const detail = (who.err || who.out || '').split('\n').filter(Boolean).slice(0, 4).join('\n  ')
console.error('[publish-auth] ❌ npm 认证不可用——发布中止（避免后续每个包都报一次 E404 噪声）')
console.error('')
console.error('  诊断：')
console.error(`  ${detail || '（无输出）'}`)
console.error('')
console.error('  ★注意：接下来若继续发布，各包会报 `E404 Not Found - PUT ...`——那是**未认证**的表现')
console.error('    （scoped 包在匿名视角返回 404），**不代表包不存在或 scope 没权限**。')
console.error('')
console.error('  修复：')
console.error('  ① 在 https://www.npmjs.com/settings/<你的用户名>/tokens 生成新 token')
console.error('     （Granular Access Token；权限：Read and write；Scope 限 @proteus-vue）')
console.error('  ② 写入 ~/.npmrc：  //registry.npmjs.org/:_authToken=<新 token>')
console.error('  ③ 复验：            npm whoami        # 应输出你的用户名')
console.error('  ④ 再发布：          npm run changeset:publish')
console.error('')
console.error('  ★若出现 403/OTP 相关错误：说明你需要用「不绕过 2FA」的 token 并在发布时提供 OTP：')
console.error('    npm publish --otp=<6 位码>（changesets 场景建议改用 trusted publishing / OIDC）')
process.exit(1)
