// packages/module/src/audit.ts
// ★module-plan B8（M8.6 CI 审计门禁）：综合审计——契约 + 图谱（环/重名/版本冲突）+ 可选产物（分包体积/重复）
//   全部硬卡（任一违规 → ok: false，CLI 退出码 1）；module-graph.json manifest 一并产出（M8.1/产物可审计铁律）
import { scanModuleConfigs } from './scan'
import type { ModuleScanEntry } from './scan'
import { DependencyGraph, buildModuleGraphManifest } from './graph'
import type { Cycle, VersionConflict } from './graph'
import { readSubPackageRoots, scanDuplicateModules } from './duplicates'
import type { DuplicateEntry } from './duplicates'
import { scanSubPackages, evaluateSubPackageSizes } from './size'
import type { SubPackageStat } from './size'

export interface ModuleAuditResult {
  ok: boolean
  modules: ModuleScanEntry[]
  cycles: Cycle[]
  conflicts: VersionConflict[]
  duplicateNames: Array<{ name: string; files: string[] }>
  /** 分包体积违规（distDir 提供时） */
  sizeIssues: string[]
  /** 分包间重复文件（distDir 提供时） */
  duplicateFiles: DuplicateEntry[]
  /** module-graph.json 内容（B3 manifest） */
  graphManifest: ReturnType<typeof buildModuleGraphManifest>
  /** 体积统计（distDir 提供时） */
  subPackageStats: SubPackageStat[]
}

/** ★B8：综合审计（纯 async 函数，CLI audit module 与测试共用） */
export async function auditModule(root: string, distDir?: string): Promise<ModuleAuditResult> {
  const result = await scanModuleConfigs(root)
  const graph = DependencyGraph.fromConfigs(
    result.modules
      .filter((m) => m.ok && m.name)
      .map((m) => ({ name: m.name!, version: m.version ?? '0.0.0', chunk: m.chunk, dependencies: m.dependencies })),
  )
  const cycles = graph.detectCycles()
  const conflicts = graph.versionConflicts()
  let sizeIssues: string[] = []
  let duplicateFiles: DuplicateEntry[] = []
  let subPackageStats: SubPackageStat[] = []
  if (distDir) {
    const roots = readSubPackageRoots(distDir)
    subPackageStats = scanSubPackages(distDir, roots)
    sizeIssues = evaluateSubPackageSizes(subPackageStats)
    duplicateFiles = scanDuplicateModules(distDir, roots)
  }
  const ok =
    result.modules.every((m) => m.ok) &&
    result.duplicateNames.length === 0 &&
    cycles.length === 0 &&
    conflicts.length === 0 &&
    sizeIssues.length === 0 &&
    duplicateFiles.length === 0
  return {
    ok,
    modules: result.modules,
    cycles,
    conflicts,
    duplicateNames: result.duplicateNames,
    sizeIssues,
    duplicateFiles,
    graphManifest: buildModuleGraphManifest(graph),
    subPackageStats,
  }
}
