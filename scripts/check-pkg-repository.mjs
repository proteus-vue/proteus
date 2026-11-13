#!/usr/bin/env node
// scripts/check-pkg-repository.mjs —— 每个 workspace 包必须声明 repository（OIDC 发布硬要求）
//
// 为什么需要（2026-11-13）：
//   npm 的 **trusted publishing (OIDC)** 要求 `package.json` 的 `repository.url`
//   与 GitHub 仓库**逐字匹配**，否则 OIDC 换不到发布权。
//   本仓 49 个包长期**全部缺失**该字段（0/49），于是：
//     · `publish.yml`（OIDC）从来跑不起来
//     · 只能靠 ~/.npmrc 里的 granular token + 2FA OTP
//     · 而账号是 `auth-and-writes` 级 2FA 且**没有 OTP 设备** ⇒ 发布会卡死在 EOTP
//   补了字段之后还必须防「新增包又漏」——这条门禁就是那个防漏装置
//   （与 check:gates-sync「新门禁必须接线」同源：声明与事实必须互证）。
//
// 判据（三条）：
//   ① 每个包必须有 `repository.url`
//   ② url 必须与**根 package.json** 逐字一致（事实源唯一，避免各包各写一份分叉）
//   ③ 有 `directory` 时必须指向该包实际所在目录（monorepo 定位正确性）
//
// 用法：
//   node scripts/check-pkg-repository.mjs           # 报告
//   node scripts/check-pkg-repository.mjs --check   # 有缺口 → exit 1
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')

const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const canonical = rootPkg.repository?.url
if (!canonical) {
  console.error('✗ 根 package.json 没有 repository.url —— 无法作为事实源（先补根）')
  process.exit(2)
}

/** 收集 workspace 包（packages/* + 根级额外目录） */
const pkgPaths = []
for (const e of fs.readdirSync(path.join(ROOT, 'packages'), { withFileTypes: true })) {
  if (!e.isDirectory()) continue
  const p = path.join(ROOT, 'packages', e.name, 'package.json')
  if (fs.existsSync(p)) pkgPaths.push(p)
}
for (const extra of ['css-conformance']) {
  const p = path.join(ROOT, extra, 'package.json')
  if (fs.existsSync(p)) pkgPaths.push(p)
}

const problems = []
for (const p of pkgPaths) {
  const pkg = JSON.parse(fs.readFileSync(p, 'utf8'))
  const rel = path.relative(ROOT, p)
  const repo = pkg.repository
  if (!repo || !repo.url) {
    problems.push({ pkg: rel, name: pkg.name, kind: 'missing', detail: '缺 repository.url（OIDC trusted publishing 会失败）' })
    continue
  }
  if (repo.url !== canonical) {
    problems.push({ pkg: rel, name: pkg.name, kind: 'url-mismatch', detail: `url="${repo.url}" ≠ 根 "${canonical}"（OIDC 要求逐字匹配）` })
  }
  if (repo.directory !== undefined) {
    const dirAbs = path.resolve(ROOT, String(repo.directory))
    if (!fs.existsSync(dirAbs) || !fs.existsSync(path.join(dirAbs, 'package.json'))) {
      problems.push({ pkg: rel, name: pkg.name, kind: 'bad-directory', detail: `directory="${repo.directory}" 不是含 package.json 的目录` })
    } else {
      const actual = path.relative(ROOT, path.dirname(p)).split(path.sep).join('/')
      if (String(repo.directory) !== actual) {
        problems.push({ pkg: rel, name: pkg.name, kind: 'directory-mismatch', detail: `directory="${repo.directory}" 应為 "${actual}"` })
      }
    }
  }
}

console.log('[pkg-repository] 每个 workspace 包必须声明 repository（OIDC 发布硬要求）')
console.log(`  扫描 ${pkgPaths.length} 个包 · 事实源 ${canonical}`)

if (problems.length) {
  console.log(`\n❌ ${problems.length} 处缺口：`)
  for (const x of problems) console.log(`    · ${x.name ?? x.pkg}（${x.pkg}）[${x.kind}] ${x.detail}`)
  console.log('\n  修复：')
  console.log('    ① 根 package.json 的 repository.url 是唯一事实源')
  console.log('    ② 每个包补 {"type":"git","url":<同上>,"directory":"<该包相对路径>"}')
  console.log('    ★原因：npm trusted publishing（OIDC）要求 repository.url 与 GitHub 仓库逐字匹配，')
  console.log('      缺了就只能靠 granular token + OTP —— 而 auth-and-writes 级 2FA 无 OTP 设备时会卡死。')
  if (CHECK) process.exitCode = 1
} else {
  console.log(`\n✅ ${pkgPaths.length} 个包的 repository 全部齐备且与事实源一致`)
}
