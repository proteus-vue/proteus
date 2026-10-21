// packages/cli/src/knowledge/layering.ts
// ★★G-54 M0（决策 #1153）：**分层守护（能力② checkLayering）**
//
// 【规则来源】G-55 `06-kernel-daemon.md` §6（机器口径），与 00-architecture.md §1 的分层铁律同源：
//
//     diff = rank(被依赖方) - rank(依赖方)
//     diff >  1  → SKIP_LAYER（跨级向上依赖，如 L0 直连 L2）
//     diff == 1  → UPWARD    （相邻向上依赖）
//     diff <= 0  → OK        （依赖同层或更低层）
//
// 【为什么 diff<=0 算合法（含同层）】
//   文档 §1 原话是「L(n) 只能依赖 L(<n)」，但 G-55 §6 明确「向下依赖（含 L2 直连 L0）合法 ——
//   高层用低层是分层的本意；被禁止的是**向上**」。本实现按 G-55 口径：
//   同层返回 OK 并置 `sameLayer: true`（信息位），供后续"同层只许走 contracts"的更严规则收紧时使用，
//   **当前不据此判红**——否则一上来就会红掉一批合法的同层协作（如 runtime ↔ router）。
//
// 【UNKNOWN 不默认 L0（G-56.4 / G-51 INV-02 同族）】
//   未登记的包返回 UNKNOWN，调用方**必须**把它当"待登记"处理（测试直接判红），
//   不得静默当最低层——否则新增包永远不会被发现漏登记。

import { LAYER_RANK, PACKAGE_LAYERS, type ArchLayer } from './layer-map'
import type { PackageManifest, SpiGraph } from './graph'

/** 越层判定结果（四档，对齐 G-55 §6 + UNKNOWN） */
export type LayeringVerdict = 'OK' | 'UPWARD' | 'SKIP_LAYER' | 'UNKNOWN'

export interface LayeringResult {
  verdict: LayeringVerdict
  /** 依赖方所在层（未登记为 null） */
  fromLayer: ArchLayer | null
  /** 被依赖方所在层（未登记为 null） */
  toLayer: ArchLayer | null
  /** rank(to) - rank(from)（任一未知为 null） */
  diff: number | null
  /** 同层依赖（verdict=OK 且 diff===0）——信息位，当前不判红 */
  sameLayer: boolean
  /** 人类可读说明（诊断/IDE 内联用） */
  message: string
}

/** 查包所在层（未登记 → null，**不兜底 L0**） */
export function resolveLayer(pkg: string): ArchLayer | null {
  return PACKAGE_LAYERS[pkg] ?? null
}

/**
 * 判定「from 依赖 to」是否越层（纯函数）。
 *
 * ★契约：本函数**只按层判**，不知道也不该知道这条依赖是生产还是开发依赖
 *   （IDE 里光标落在任意 import 上都要求即时结论）。
 *   ⇒ 调用方负责口径：`diagnoseGraph()` 只传生产边；devDeps 走 `diagnoseDevDeps()`。
 *
 * @param from 依赖方（包目录名）
 * @param to   被依赖方（包目录名）
 */
export function checkLayering(from: string, to: string): LayeringResult {
  const fromLayer = resolveLayer(from)
  const toLayer = resolveLayer(to)

  if (!fromLayer || !toLayer) {
    const missing = [!fromLayer ? from : null, !toLayer ? to : null].filter(Boolean).join(' / ')
    return {
      verdict: 'UNKNOWN',
      fromLayer,
      toLayer,
      diff: null,
      sameLayer: false,
      message: `未登记分层的包：${missing} —— 请在 packages/cli/src/knowledge/layer-map.ts 登记（不得静默当最低层）`,
    }
  }

  const diff = LAYER_RANK[toLayer] - LAYER_RANK[fromLayer]

  if (diff > 1) {
    return {
      verdict: 'SKIP_LAYER',
      fromLayer,
      toLayer,
      diff,
      sameLayer: false,
      message: `跨级向上依赖：${from}（${fromLayer}）→ ${to}（${toLayer}）跨越 ${diff} 层——中间层被绕过`,
    }
  }
  if (diff > 0) {
    return {
      verdict: 'UPWARD',
      fromLayer,
      toLayer,
      diff,
      sameLayer: false,
      message: `向上依赖：${from}（${fromLayer}）→ ${to}（${toLayer}）——低层依赖高层`,
    }
  }
  if (diff === 0) {
    return {
      verdict: 'OK',
      fromLayer,
      toLayer,
      diff,
      sameLayer: true,
      message: `同层依赖：${from} 与 ${to} 同为 ${fromLayer}（文档 §1 要求同层只经 contracts 通信，当前不判红）`,
    }
  }
  return {
    verdict: 'OK',
    fromLayer,
    toLayer,
    diff,
    sameLayer: false,
    message: `合法：${from}（${fromLayer}）依赖更低层 ${to}（${toLayer}）`,
  }
}

/** 图里的一条越层记录 */
export interface LayeringViolation {
  from: string
  to: string
  verdict: LayeringVerdict
  fromLayer: ArchLayer | null
  toLayer: ArchLayer | null
  diff: number | null
  message: string
  /** 依赖类型：prod（入图、判红）/ dev（只报告、不判红） */
  kind: 'prod' | 'dev'
}

/**
 * 全仓扫描（纯函数）：只返回**违规**（UPWARD / SKIP_LAYER / UNKNOWN）。
 * ★同层依赖不进结果（见文件头说明）。
 * ★只覆盖**生产依赖**（dependencies + peerDependencies）；devDeps 见 `diagnoseDevDeps`。
 */
export function diagnoseGraph(graph: SpiGraph): LayeringViolation[] {
  const out: LayeringViolation[] = []
  for (const e of graph.edges) {
    const r = checkLayering(e.from, e.to)
    if (r.verdict === 'OK') continue
    out.push({ from: e.from, to: e.to, verdict: r.verdict, fromLayer: r.fromLayer, toLayer: r.toLayer, diff: r.diff, message: r.message, kind: 'prod' })
  }
  return out.sort((a, b) => (b.diff ?? 99) - (a.diff ?? 99) || a.from.localeCompare(b.from))
}

/**
 * devDependencies 的向上依赖（**信息位，不判红**）。
 *
 * 【为什么单列（独立验证打回的口径盲区）】
 *   devDeps 不入图 ⇒ `diagnoseGraph` 对它**完全失明**：新增一条 `web(L2) →(dev) cli(L3)`
 *   全绿通过，而手工调 `checkLayering('web','cli')` 却是 UPWARD —— 同一问题两套答案。
 *   但 devDeps 本来就是"测试/构建临时用"，向上引用（测试框架引 CLI）是**正常**的
 *   ⇒ 正确处理是**显式报告为信息**，既不静默失明，也不误判成架构违规。
 */
export function diagnoseDevDeps(manifests: readonly PackageManifest[]): LayeringViolation[] {
  const out: LayeringViolation[] = []
  for (const m of manifests) {
    for (const dep of m.devDeps) {
      if (m.deps.includes(dep)) continue // 同时是生产依赖 ⇒ 已由 diagnoseGraph 覆盖
      const r = checkLayering(m.dir, dep)
      if (r.verdict === 'OK') continue
      out.push({
        from: m.dir,
        to: dep,
        verdict: r.verdict,
        fromLayer: r.fromLayer,
        toLayer: r.toLayer,
        diff: r.diff,
        message: `[dev] ${r.message}（devDeps 向上引用属正常，仅记录）`,
        kind: 'dev',
      })
    }
  }
  return out.sort((a, b) => (b.diff ?? 99) - (a.diff ?? 99) || a.from.localeCompare(b.from))
}

/** 违规的稳定指纹（基线棘轮用：`from>to`；不含层号，层调整不应导致基线失效） */
export function violationKey(v: Pick<LayeringViolation, 'from' | 'to'>): string {
  return `${v.from}>${v.to}`
}
