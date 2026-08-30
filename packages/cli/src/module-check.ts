// packages/cli/src/module-check.ts
// ★module-plan B1/B3：proteus module:check —— 模块契约校验 + 依赖图（环检测 / 版本冲突 / --graph）
import { scanModuleConfigs, formatModuleCheck, DependencyGraph, moduleGraphToMermaid } from '@proteus-vue/module'
import type { ModuleScanResult, Cycle, VersionConflict } from '@proteus-vue/module'

export interface ModuleCheckOutput {
  text: string
  result: ModuleScanResult
  cycles: Cycle[]
  conflicts: VersionConflict[]
}

/** 校验指定根目录下的模块契约 + 构建依赖图（纯 async 函数，CLI 与测试共用） */
export async function checkModuleConfigs(root: string, withGraph = false): Promise<ModuleCheckOutput> {
  const result = await scanModuleConfigs(root)
  // ★B3：从通过校验的模块构建依赖图（环检测 / 版本冲突 / 拓扑序）
  const graph = DependencyGraph.fromConfigs(
    result.modules
      .filter((m) => m.ok && m.name)
      .map((m) => ({ name: m.name!, version: m.version ?? '0.0.0', chunk: m.chunk, dependencies: m.dependencies })),
  )
  const cycles = graph.detectCycles()
  const conflicts = graph.versionConflicts()
  const lines = formatModuleCheck(result).split('\n')
  // 环检测（透明化：环路径 + 建议）
  for (const c of cycles) {
    lines.push(`❌ ★循环依赖：${c.join(' → ')} → ${c[0]}`)
    lines.push(`     Suggestion: 抽取共享逻辑到公共模块，或改用事件通信（module-plan 铁律）`)
  }
  for (const cf of conflicts) {
    lines.push(`⚠ 版本冲突：模块 "${cf.module}" 被不同 range 声明（${cf.ranges.map((r) => `${r.from}@${r.range}`).join(' / ')}）——请统一版本`)
  }
  if (withGraph && result.modules.some((m) => m.ok && m.name)) {
    lines.push('', '依赖图（Mermaid）：', moduleGraphToMermaid(graph))
  }
  const initOrder = cycles.length ? '—（有环，无法拓扑）' : graph.topologicalSort().join(' → ') || '—'
  const chunkMap = result.modules.filter((m) => m.ok && m.name).map((m) => `${m.name} → ${m.chunk ?? m.name}`).join('，') || '—'
  lines.push(`分包映射：${chunkMap}（与 config.subPackages 的 name/root 匹配时生成 dependencies/preloadRule，module-plan B5）`)
  lines.push(`Web chunk：${result.modules.filter((m) => m.ok && m.name && m.chunk).map((m) => `${m.chunk} ← ${m.name}`).join('，') || '—（无 chunk 声明，Web 端按页面 code-split）'}（modules/ 目录下文件按 chunk manualChunks，module-plan B4）`)
  lines.push(`[proteus-module] 模块校验：${result.modules.filter((m) => m.ok).length}/${result.modules.length} 通过；拓扑序：${initOrder}`)
  return { text: lines.join('\n'), result, cycles, conflicts }
}
