// packages/cli/src/migrate-types.ts
// ★types-plan B7：存量配置迁移 codemod（对齐 06 的 migration 数组——文本级规则集，幂等）
// 规则集：① 注入 version 字段（缺省时）② 字段重命名映射（transitions → animation 示例）
// 幂等保证：version 已存在 / 字段已重命名 → 跳过
import fs from 'node:fs'

/** 字段重命名映射（未来版本变更在此登记；禁止修改历史映射） */
const RENAME_MAP: Array<[RegExp, string]> = [
  // 示例：router.transitions → router.animation（若历史配置使用旧字段名）
  [/router\s*:\s*\{\s*transitions\s*:/g, 'router: {\n    animation:'],
]

/** 迁移配置文本（纯函数，幂等：跑两次结果一致） */
export function migrateConfigText(text: string): string {
  let out = text
  // ① 注入 version 字段（缺省且未声明时；幂等：已有 version 跳过）
  if (!/\bversion\s*:/.test(out)) {
    out = out.replace(/export\s+default\s+(?:defineConfig\s*\(\s*)?\{/, 'export default defineConfig({\n  version: 2,')
  }
  // ② 字段重命名映射
  for (const [re, to] of RENAME_MAP) {
    if (re.test(out)) {
      out = out.replace(re, to)
    }
  }
  return out
}

/** proteus migrate types <file>：读取 → 迁移 → 写回 + 报告 */
export function migrateTypesFile(file: string, dryRun = false): { changed: boolean; text: string } {
  const src = fs.readFileSync(file, 'utf-8')
  const migrated = migrateConfigText(src)
  const changed = migrated !== src
  if (changed && !dryRun) fs.writeFileSync(file, migrated)
  return { changed, text: migrated }
}

/** 渲染报告（纯函数） */
export function formatMigrateTypes(file: string, changed: boolean, dryRun: boolean): string {
  if (!changed) return `[proteus-types] ${file}：无需迁移（已是最新配置形态）`
  return dryRun
    ? `[proteus-types] ⚠ ${file} 需要迁移（--dry-run 预览，未写盘）`
    : `[proteus-types] ✅ ${file} 已迁移到最新配置形态（version: ${2}）`
}
