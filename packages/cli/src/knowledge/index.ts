// packages/cli/src/knowledge/index.ts
// ★★G-54 M0（决策 #1153）：**FrameworkKnowledgeProvider 的 M0 门面**
//
// 【本批交付六方法中的两个】
//   ② checkLayering   —— 分层守护（layering.ts）
//   ④ buildGraph      —— SPI 拓扑 + 环检测（graph.ts）
//   其余四个（① resolveCall / ③ locateAssertion / ⑤ affectedDevices / ⑥ previewVariants）
//   的数据源尚未就绪（详见 docs/ai-tasks.json 的 T-knowledge-kernel-m0 note），**不在此占位**——
//   返回假数据比不返回更糟（G-56.4「unknown 不默认」同源）。
//
// 【为什么在 packages/cli 下而不是新建包（M0 取舍）】
//   · 内核最终应是独立包（G-54「内核唯一 + 宿主薄适配」），但那会牵动 check:pkg / 构建链 /
//     发布流程三条线；M0 的目的是**先证明语义与判据成立**，不是先立包。
//   · `packages/cli` 已是仓库静态分析的聚集地（`repo-conformance` / `module-audit` / `audit-all`），
//     语义同族；且它在依赖图最顶层（L3），放这里不可能造成新的越层。
//   · ★抽包时机 = 出现**第二个消费者**（Studio 或 VSCode 适配器）时，届时按 #870 机械搬迁范式提取。
//
// 【纯查询】provider 不持有 IO：`createKnowledgeProvider(manifests)` 接收已加载清单，
//   IO 由 `loadManifests()` 在宿主侧完成（CLI / 未来 daemon 各管各的加载策略）。

import { buildGraph, type PackageManifest, type SpiGraph } from './graph'
import {
  checkLayering as checkLayeringImpl,
  diagnoseDevDeps,
  diagnoseGraph,
  type LayeringResult,
  type LayeringViolation,
} from './layering'

/** G-54 `FrameworkKnowledgeProvider` 的 M0 子集（未实现的四方法**不声明**，避免假承诺） */
export interface FrameworkKnowledgeProvider {
  /** ② 分层守护：判定 from 依赖 to 是否越层 */
  checkLayering(from: string, to: string): LayeringResult
  /** ④ SPI 拓扑：节点 / 边 / 环 / 自环 / 反向依赖表 */
  buildGraph(): SpiGraph
  /** M0 便利方法：全仓**生产依赖**越层扫描（= diagnoseGraph(buildGraph())） */
  diagnoseLayering(): LayeringViolation[]
  /** M0 便利方法：devDeps 向上引用（信息位，**不判红**——口径显式化，见 layering.ts） */
  diagnoseDevLayering(): LayeringViolation[]
}

/**
 * 创建知识提供者。
 * @param manifests `loadManifests(packagesDir)` 的输出（测试可注入人造清单）
 */
export function createKnowledgeProvider(manifests: readonly PackageManifest[]): FrameworkKnowledgeProvider {
  // 图在创建时算一次（纯函数、幂等）；后续查询复用，避免每次重建 O(N+E)
  const graph = buildGraph(manifests)
  return {
    checkLayering: (from, to) => checkLayeringImpl(from, to),
    buildGraph: () => graph,
    diagnoseLayering: () => diagnoseGraph(graph),
    diagnoseDevLayering: () => diagnoseDevDeps(manifests),
  }
}

export { loadManifests, buildGraph, findCycles, analyzeCycles, tarjanSccs, isValidCycle } from './graph'
export type { PackageManifest, SpiEdge, SpiGraph, CycleAnalysis } from './graph'
export { checkLayering, resolveLayer, diagnoseGraph, diagnoseDevDeps, violationKey } from './layering'
export type { LayeringResult, LayeringVerdict, LayeringViolation } from './layering'
export { ARCH_LAYERS, LAYER_RANK, LAYER_LABEL, PACKAGE_LAYERS, packagesInLayer } from './layer-map'
export type { ArchLayer } from './layer-map'
