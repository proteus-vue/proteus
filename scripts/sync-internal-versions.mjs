#!/usr/bin/env node
// scripts/sync-internal-versions.mjs —— ★把 workspace 实际版本同步到**changesets 管不到的两处**
//
// 为什么需要它（2026-09-19 发布事故的机械成因）：
//   changesets 只维护 `packages/*/package.json` 之间的精确依赖；下列两处的 `@proteus-vue/*`
//   依赖**由人工维护**，而它们恰恰是**用户侧直接消费**的声明：
//     · `packages/create-proteus/templates/package.json` —— 脚手架生成的工程用它装包
//     · `examples/package.json`                             —— 本仓示例工程（private，不入 changesets）
//   人工维护 = 每次发版都可能漏掉某一格。本次事故即模板里 `^0.2.1-beta.0`（cli）与 `^0.1.0`
//   （devtools-runtime）两格陈旧：prerelease 的 caret 范围够不到新元组 → 用户装到旧包 →
//   旧包 exact-pin 旧依赖 → npm 嵌套第二份副本 → **模块级单例被拆散（无报错）**。
//
// ★本脚本是「机械动作」：读 workspace 实际版本 → 写死到上述两处。发版流程里应紧跟 `changeset version`。
//   `--check` 模式只验证不改写（供门禁使用）。
//
// 用法：
//   node scripts/sync-internal-versions.mjs          # 同步（改写）
//   node scripts/sync-internal-versions.mjs --check  # 只校验（不一致 → exit 1）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')

/** workspace 实际版本表 */
function workspaceVersions() {
  const out = {}
  for (const e of fs.readdirSync(path.join(ROOT, 'packages'), { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const f = path.join(ROOT, 'packages', e.name, 'package.json')
    if (!fs.existsSync(f)) continue
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'))
      if (j.name) out[j.name] = j.version
    } catch {
      /* 非包目录 */
    }
  }
  return out
}

/**
 * 受管目标：文件路径 + 标签。
 * ★`workspace:*` 是 pnpm 协议（根包与 examples 的本地包用它指向工作区），**不动**。
 * ★根 package.json 也在列：2026-09-19 实测它的 `@proteus-vue/cli` 曾写死 `0.2.1-beta.0`
 *   （陈旧一个次版本）→ 根 `node_modules/@proteus-vue/cli` 实为 **npm 上的旧包**而非工作区包。
 *   根包对本仓内部依赖一律用 `workspace:*`（既有约定），故此处只**校验**不改写：
 *   非 `workspace:*` 且不等于 workspace 版本 → 报错（避免被静默同步成某个具体版本而偏离约定）。
 */
const TARGETS = [
  { file: 'packages/create-proteus/templates/package.json', label: '脚手架模板', requireWorkspaceProtocol: false },
  { file: 'examples/package.json', label: 'examples 示例工程', requireWorkspaceProtocol: false },
  { file: 'package.json', label: '根 package.json', requireWorkspaceProtocol: true },
]

const versions = workspaceVersions()
const changes = []
const stale = []

for (const t of TARGETS) {
  const abs = path.join(ROOT, t.file)
  if (!fs.existsSync(abs)) continue
  const raw = fs.readFileSync(abs, 'utf8')
  const json = JSON.parse(raw)
  let touched = false

  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = json[field]
    if (!deps) continue
    for (const [name, range] of Object.entries(deps)) {
      if (!name.startsWith('@proteus-vue/')) continue
      const actual = versions[name]
      if (!actual) continue
      // 根包：只接受 workspace:*（本仓约定），否则报错
      if (t.requireWorkspaceProtocol) {
        if (String(range).startsWith('workspace:')) continue
        stale.push(
          `${t.label}（${t.file}）${field}.${name}：声明 ${range}——根包对本仓内部依赖须用 "workspace:*"（否则会从 npm 装到旧包）`,
        )
        continue
      }
      if (String(range).startsWith('workspace:')) continue // pnpm 协议——非版本声明
      if (range === actual) continue
      if (CHECK) {
        stale.push(`${t.label}（${t.file}）${field}.${name}：声明 ${range}，workspace 实际 ${actual}`)
      } else {
        deps[name] = actual
        touched = true
        changes.push(`${t.label} ${name}: ${range} → ${actual}`)
      }
    }
  }

  if (touched) {
    // 保留原文件的 2 空格缩进 + 末尾换行（与仓库其余 package.json 一致）
    fs.writeFileSync(abs, JSON.stringify(json, null, 2) + '\n')
  }
}

if (CHECK) {
  if (stale.length) {
    console.log('[sync-internal] ✗ 内部依赖声明落后于 workspace（用户侧会装到旧包）：')
    for (const s of stale) console.log(`  - ${s}`)
    console.log('\n  → 修复：node scripts/sync-internal-versions.mjs')
    process.exit(1)
  }
  console.log('[sync-internal] ✅ 模板与 examples 的内部依赖均已对齐 workspace 实际版本')
  process.exit(0)
}

if (changes.length) {
  console.log(`[sync-internal] 已同步 ${changes.length} 处：`)
  for (const c of changes) console.log(`  · ${c}`)
} else {
  console.log('[sync-internal] 无需变更（两处声明已与 workspace 一致）')
}
