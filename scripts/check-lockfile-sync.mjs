#!/usr/bin/env node
// scripts/check-lockfile-sync.mjs —— ★lockfile ↔ workspace package.json 同步门禁（2026-10-08 立）
//
// 【背景（当轮实测挖出的**生产静默故障**）】
//   官网已连续多轮未真正上线：`.github/workflows/pages.yml` 的「安装」步固定
//   `pnpm install --frozen-lockfile` ⇒ lockfile 一旦与某个 workspace 的 package.json
//   失同步（实测：`packages/render-backend` 声明了 `@proteus-vue/slot-runtime`，而
//   `pnpm-lock.yaml` 的 importers 缺该 `link:` 项），安装**直接失败** ⇒ 后续所有部署
//   步骤 skipped ⇒ 线上停在 2026-10-06 的版本。
//   ★而这一故障**两头都看不见**：
//     · 本地：`pnpm install`（**非** frozen）会**静默把 lockfile 改对** ⇒ 开发机永远看不到漂移；
//     · CI/Pages：整条 run 的 conclusion 可能是 success，但**所有部署 step skipped**（"假绿"）。
//   ⇒ 与本仓既有红线同族（「提交 ≠ 交付」「含官网改动 ≠ 已上线」）：**只有工具层能兜住**。
//
// 【判据（对准消费方契约——跑的就是 CI/pages 用的那条命令）】
//   执行 `pnpm install --frozen-lockfile --ignore-scripts --lockfile-only --offline`：
//     · 退出 0 ⇒ lockfile 与全部 importer 的 package.json 一致（离线 · 只校验 · 不写盘 · ~0.3s）
//     · 非 0（`ERR_PNPM_OUTDATED_LOCKFILE`）⇒ 漂移，原样打印 pnpm 的归因（哪个包差哪个 spec）
//   ★为什么用 pnpm 子进程而非自写 YAML 比对：**判据必须对准消费方的契约**——
//     拦下我们的是这条命令本身；复刻一份 YAML 解析只会得到"看起来一样"的第二实现
//     （本仓既有教训："自测通过 ≠ 契约成立"，见 hook 输出契约那段）。
//
// 【接线】归 `LOCAL_ONLY`（见 check-gates-sync.mjs）：CI 的「安装」步（--frozen-lockfile）
//   已是同一判据；本条补的是**本地 pre-push 盲区**（本地非 frozen install 静默修正 ⇒ 从无提示）。
//
// 用法：node scripts/check-lockfile-sync.mjs
// 退出码：0 一致 / 1 漂移（附修复指引）/ 2 环境错误（pnpm 或 lockfile 缺失）
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOCK = path.join(ROOT, 'pnpm-lock.yaml')

if (!fs.existsSync(LOCK)) {
  console.error('[lockfile-sync] ✗ 缺 pnpm-lock.yaml——无法校验（仓库应有该文件）')
  process.exit(2)
}

const before = fs.readFileSync(LOCK)

// ★对 --frozen-lockfile 而言 pnpm **不会**写盘；仍做字节快照——万一日后 pnpm 行为变化，
//   本门禁必须保持"只读"，宁可自作恢复也不留下副作用（"能靠隔离消除的副作用，不要靠记得还原"）。
const res = spawnSync(
  'pnpm',
  ['install', '--frozen-lockfile', '--ignore-scripts', '--lockfile-only', '--offline'],
  { cwd: ROOT, encoding: 'utf8' },
)
const after = fs.readFileSync(LOCK)
if (!before.equals(after)) {
  fs.writeFileSync(LOCK, before)
  console.error('[lockfile-sync] ⚠ 门禁运行意外改动了 pnpm-lock.yaml——已还原（请核对 pnpm 版本行为）')
}

if (res.error) {
  console.error(`[lockfile-sync] ✗ 无法执行 pnpm：${res.error.message}`)
  console.error('  （本门禁依赖 pnpm CLI 复现 CI 的安装判据；请确认 pnpm 已安装并在 PATH）')
  process.exit(2)
}

if (res.status === 0) {
  console.log('lockfile 同步门禁（pnpm --frozen-lockfile 校验）')
  console.log('  ✅ pnpm-lock.yaml 与全部 workspace 的 package.json 一致（CI/Pages 安装步同判据）')
  process.exit(0)
}

// ── 漂移：打印机器的归因 + 修复指引 ──
const detail = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim()
const outdated = /ERR_PNPM_OUTDATED_LOCKFILE/.test(detail)
console.error('lockfile 同步门禁（pnpm --frozen-lockfile 校验）')
console.error(
  outdated
    ? '  ✗ pnpm-lock.yaml 与 workspace package.json **不同步**——CI 与 Pages 的「安装」步会直接失败'
    : '  ✗ pnpm 校验失败（非 OUTDATED——见下方原始输出）',
)
if (detail) {
  console.error('\n── pnpm 原始输出 ──')
  for (const l of detail.split('\n').slice(0, 24)) console.error(`  ${l}`)
}
console.error('\n修法：在本机跑 `pnpm install`（不带 --frozen-lockfile）重算 lockfile，然后提交 pnpm-lock.yaml。')
console.error('  ★典型根因：给某个 workspace 的 package.json 加了依赖，却只提交了 package.json（漏了 lockfile）。')
console.error('  ★验证：`pnpm install --frozen-lockfile --ignore-scripts`（即 CI 的安装步）应通过。')
process.exit(1)
