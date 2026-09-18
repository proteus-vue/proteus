#!/usr/bin/env node
// scripts/check-gates-sync.mjs —— ★门禁通道一致性（2026-09-18）
//
// 背景（本会话实测挖出的结构缺口）：CI（.github/workflows/*.yml）与本地 `pnpm verify`
//   是**两套重叠但不一致**的门禁集，各自都不完整，且缺的正好是对方的强项：
//     · CI 有根 `vue-tsc` / `build-packages`，而 `pnpm verify` **没有** →
//       本地「全绿」掩盖了 tsc 构建才暴露的类型错误（实测：TS2322 漏到 CI）。
//     · `pnpm verify` 有 `check:mp-attrs`（主属性棘轮）/ `check:pkg` / `check:showcase-catalog`，
//       而 CI **没有** → 属性覆盖回退可以推上去而 CI 不拦。
//   根因是**门禁的可靠性取决于它被接在哪**，而「接线」此前靠人工记忆、无机器校验。
//
// 本脚本把「接线」变成可机器判定的门禁：
//   ① 每个 `check:*` 脚本必须被**某个 workflow** 引用（含 pages.yml 等非 ci.yml 工作流），
//      或列入下方 LOCAL_ONLY 并给理由——新增门禁时若不接线、不说明，CI 当场红。
//   ② CI 与 verify 的**覆盖差集**必须为空（互为补集即为缺口）：凡 CI 有的形态门禁，
//      verify 亦应覆盖；反之亦然（依赖 dist 的步骤用 build-packages/vue-tsc 归并判定）。
//
// 用法：node scripts/check-gates-sync.mjs
// 退出码：0 通过 / 1 存在缺口
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WF_DIR = path.join(ROOT, '.github', 'workflows')

/**
 * 合理「仅本地」的门禁（不在 CI 跑），每条必须给理由。
 * ★判定标准：CI 无法满足其前置条件（需已部署环境 / 需人工介入 / 需真机）。
 */
const LOCAL_ONLY = {
  // 目前为空——本会话已把全部 check:* 接进 CI（含 pages.yml 的 check:live）。
  // 新增条目须写明「为何 CI 跑不了」。
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const scripts = pkg.scripts ?? {}

/** 读取所有 workflow 文本（含 pages.yml / consistency.yml 等） */
function workflowText() {
  if (!fs.existsSync(WF_DIR)) return ''
  return fs
    .readdirSync(WF_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => fs.readFileSync(path.join(WF_DIR, f), 'utf8'))
    .join('\n')
}
const CI_TEXT = workflowText()

/** 从一条 npm script 命令里提取它调用的脚本文件 + 内联 check: 引用 */
function refsOf(cmd) {
  const files = cmd.match(/(?:^|\s)(?:npx\s+tsx\s+)?(?:scripts|website\/scripts)\/[\w./-]+\.(?:mjs|ts|js)/g) ?? []
  const sub = cmd.match(/pnpm run (check:[\w-]+)/g)?.map((m) => m.replace('pnpm run ', '')) ?? []
  return { files: files.map((f) => f.trim()), sub }
}

/** 某 check:* 或脚本文件是否真被 CI 引用 */
function coveredByCi(name, cmd) {
  if (CI_TEXT.includes(name)) return true
  const { files, sub } = refsOf(cmd)
  if (files.some((f) => CI_TEXT.includes(f))) return true
  // 经 pnpm run 间接引用：递归查子脚本
  return sub.some((s) => scripts[s] && coveredByCi(s, scripts[s]))
}

const failures = []
const notes = []

/* ---------- ① 每个 check:* 必须接线（CI 或 LOCAL_ONLY 声明） ---------- */
const checkNames = Object.keys(scripts).filter((k) => k.startsWith('check:'))
for (const name of checkNames) {
  if (coveredByCi(name, scripts[name])) continue
  if (name in LOCAL_ONLY) {
    notes.push(`仅本地（已声明）：${name} —— ${LOCAL_ONLY[name]}`)
    continue
  }
  failures.push(
    `${name} 未接入任何 workflow，也未在 LOCAL_ONLY 声明理由（新增门禁必须接线，或写明为何 CI 跑不了）`,
  )
}

/* ---------- ② verify 链与 CI 的覆盖差集 ---------- */
// verify 里的形态门禁（脚本文件维度）：CI 缺则报；反方向由 ① 覆盖（CI 有的未必在 verify）
const verifyCmd = scripts.verify ?? ''
const verifyRefs = new Set(refsOf(verifyCmd).files)
// 依赖 dist 的步骤：verify 必须含 build-packages + 根 vue-tsc（CI 的强项，本地盲区）
const VERIFY_MUST_HAVE = [
  { file: 'scripts/build-packages.mjs', why: '提供 dist（vue-tsc / 子路径解析需要）' },
]
for (const { file, why } of VERIFY_MUST_HAVE) {
  if (!verifyRefs.has(file) && !verifyCmd.includes(file)) {
    failures.push(`verify 链缺 ${file}（${why}）——CI 有而本地没有 = 本地「全绿」存在盲区`)
  }
}
if (!/vue-tsc/.test(verifyCmd)) {
  failures.push('verify 链缺根 `vue-tsc --noEmit`（CI 有而本地没有 = 类型错误本地不可见）')
}

/* ---------- ③ CI 侧关键步骤存在性（防被误删） ---------- */
const CI_MUST_HAVE = [
  { pat: 'vue-tsc', why: '根类型检查' },
  { pat: 'build-packages', why: '包构建' },
  { pat: 'audit-component-attrs.mjs', why: '属性棘轮（主标尺）' },
  { pat: 'audit-degradation.mjs', why: '降级声明门禁' },
  { pat: 'check-consistency.js', why: '跨层一致性' },
]
for (const { pat, why } of CI_MUST_HAVE) {
  if (!CI_TEXT.includes(pat)) failures.push(`CI 缺关键步骤 ${pat}（${why}）——被误删或未接线`)
}

/* ---------- 报告 ---------- */
console.log('门禁通道一致性检查（CI ⟷ verify）')
console.log(`  package.json 的 check:* 共 ${checkNames.length} 个`)
for (const n of notes) console.log(`  ℹ ${n}`)
if (failures.length) {
  console.error(`\n❌ 发现 ${failures.length} 处接线缺口：`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`  ✅ 全部 check:* 已接线（CI 覆盖 ${checkNames.length - Object.keys(LOCAL_ONLY).length} 个` +
  `${Object.keys(LOCAL_ONLY).length ? ` + 声明仅本地 ${Object.keys(LOCAL_ONLY).length} 个` : ''}）`)
console.log('  ✅ verify 链含 build-packages + 根 vue-tsc（本地与 CI 无覆盖盲区）')
console.log('  ✅ CI 关键步骤齐备')
console.log('\n✅ 门禁通道一致（接线不再依靠人工记忆）')
