// packages/cli/src/migrate-mp.ts
// ★G-31 B6（migration.md §4 Step 2）：proteus migrate:mp —— 旧小程序代码批量迁移 codemod
//   纯函数 migrateMpSource（@proteus-vue/compat-miniprogram）驱动：目录递归 / 单文件；--dry-run 只报告
import fs from 'node:fs'
import path from 'node:path'
import { migrateMpSource, countMigration, collectRouteTargets, buildRouteTable } from '@proteus-vue/compat-miniprogram'
import type { MigrationStats } from '@proteus-vue/compat-miniprogram'

export interface MigrateMpResult {
  ok: boolean
  files: Array<{ file: string; changed: boolean; stats: MigrationStats; dryRun: boolean }>
  text: string
}

function walk(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(vue|wxml|js)$/.test(e.name)) out.push(p)
  }
}

/** 迁移目录/文件（--dry-run 只报告不写回；幂等——重复跑结果一致） */
export function runMigrateMp(target: string, dryRun = false): MigrateMpResult {
  const files: string[] = fs.existsSync(target) && fs.statSync(target).isFile() ? [target] : []
  if (!files.length && fs.existsSync(target)) walk(target, files)
  const reports: MigrateMpResult['files'] = []
  const allSources: string[] = []
  const lines = ['[proteus-migrate] 小程序 → Proteus 语义迁移（G-31 B6 codemod）：']
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf-8')
    allSources.push(src)
    const migrated = migrateMpSource(src)
    const stats = countMigration(src, migrated)
    const changed = migrated !== src
    if (changed && !dryRun) fs.writeFileSync(f, migrated)
    reports.push({ file: path.relative(process.cwd(), f).replace(/\\/g, '/'), changed, stats, dryRun })
    const tag = changed ? (dryRun ? '🔍 待改' : '✅ 已改') : '—'
    lines.push(
      `  ${tag} ${path.relative(process.cwd(), f).replace(/\\/g, '/')}：标签 ${stats.tagsReplaced} · 存储 ${stats.storageReplaced} · manual ${stats.manualAnnotations}`,
    )
  }
  const totalTags = reports.reduce((a, r) => a + r.stats.tagsReplaced, 0)
  const totalManual = reports.reduce((a, r) => a + r.stats.manualAnnotations, 0)
  const changedFiles = reports.filter((r) => r.changed).length
  lines.push(
    `[proteus-migrate] 扫描 ${files.length} 文件 · ${changedFiles} 变更 · 自动替换标签 ${totalTags} 处 · manual 标注 ${totalManual} 处${dryRun ? '（dry-run 未写回）' : ''}`,
  )
  if (totalManual) {
    lines.push('提示：manual 标注项需人工处理（语义识别 scroll-view/swiper / 路由名表 / 能力提升）——详见 docs/proteus-component-semantics-plan/migration.md')
  }
  // ★G-32 B6：路由名表（wx.navigateTo → router.push({ name }) 语义化桥的 name 候选）
  const table = buildRouteTable(allSources)
  if (table.length) {
    const totalNav = allSources.reduce((a, src) => a + collectRouteTargets(src).length, 0)
    lines.push(`[proteus-migrate] 路由名表：扫描到 ${totalNav} 处导航（${table.length} 个去重目标）：`)
    for (const t of table) {
      lines.push(`  ${t.path} → name: '${t.name}'（${t.apis.join('/')} ≤ router.push({ name })）`)
    }
    lines.push('[proteus-migrate] 提示：若目标路径在 Proteus 工程 pagesDir 无对应页面，需在 gen-routes 的 scan 收录后补 name（约定式路由 derivePath）')
  }
  lines.push('[proteus-migrate] 迁移后建议：npm i @proteus-vue/compat-miniprogram + bindCompatPlatform(createPlatformAPI())（Step 1 兜底）')
  return { ok: true, files: reports, text: lines.join('\n') }
}