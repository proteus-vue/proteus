// packages/cli/src/conformance.ts
// ★G-38 B2 尾（compiler-backend-spi-plan 02「运行方式」/05-batches B2 DoD）：`proteus conformance` CLI
//   跑仓库内 42 项 conformance 套件（runG38Conformance——C-01~C-10，capability 不足 SKIP）
//   默认被测后端 = G-38 Node 参考实现（createG38NodeBackend）；--backend <spec> 加载外部后端
//   spec = 模块路径[#具名导出]（default/具名须为工厂函数或后端实例）——与 conformance-runner.js --backend 同契约
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createG38NodeBackend, createG38TerminalBackend, runG38Conformance, formatG38Conformance } from '@proteus-vue/compiler-backend'
import type { G38CompilerBackend, G38ConformanceSummary } from '@proteus-vue/compiler-backend'

export interface ConformanceArgs {
  backendSpec?: string
  only?: string
  repoDir?: string
}

/** 解析参数（纯函数可单测） */
export function parseConformanceArgs(argv: string[]): ConformanceArgs {
  const args: ConformanceArgs = {}
  let i = 0
  while (i < argv.length) {
    const a = argv[i]
    if (a === '--backend') {
      args.backendSpec = argv[++i]
      if (!args.backendSpec) throw new Error('--backend 需要模块路径[#具名导出]')
    } else if (a === '--only') {
      args.only = argv[++i]
      if (!args.only) throw new Error('--only 需要组号（如 C-03）')
    } else if (a === '--repo') {
      // ★G-42 B5：仓库治理扫描（G-42.6 严禁 fork）
      args.repoDir = argv[++i]
      if (!args.repoDir) throw new Error('--repo 需要目录（宿主仓库根）')
    } else if (a.startsWith('-')) {
      throw new Error(`未知选项：${a}（可用 --backend <spec>、--only <C-xx>、--repo <dir>）`)
    } else {
      throw new Error(`多余参数：${a}`)
    }
    i++
  }
  return args
}

/** 加载被测后端：默认 Node 参考实现；--backend spec → 模块 default/#具名 工厂或实例 */
export async function loadConformanceBackend(spec?: string): Promise<{ backend: G38CompilerBackend; name: string }> {
  if (!spec) return { backend: createG38NodeBackend(), name: 'node（G-38 参考实现）' }
  const [modPath, exportName] = spec.split('#')
  const mod = (await import(pathToFileURL(path.resolve(modPath)).href)) as Record<string, unknown>
  const factory = exportName ? mod[exportName] : (mod.default ?? mod.createBackend)
  if (typeof factory !== 'function') throw new Error(`--backend ${spec}：未找到后端工厂（需 default 或 #具名导出返回实例）`)
  let backend: unknown
  try {
    backend = await (factory as () => unknown)()
  } catch (e) {
    throw new Error(`--backend ${spec}：加载结果不是 G-38 编译后端（工厂调用失败：${(e as Error).message.slice(0, 120)}）`)
  }
  if (!backend || typeof (backend as G38CompilerBackend).parse !== 'function') throw new Error(`--backend ${spec}：加载结果不是 G-38 编译后端（缺 parse）`)
  return { backend: backend as G38CompilerBackend, name: `external:${(backend as G38CompilerBackend).id}` }
}

/** ★proteus conformance：跑套件 → 文本报告 + 通过/失败判定 */
export async function runConformance(args: ConformanceArgs): Promise<{ text: string; ok: boolean; summary: G38ConformanceSummary }> {
  const { backend, name } = await loadConformanceBackend(args.backendSpec)
  const summary = await runG38Conformance(backend, { only: args.only })
  return { text: formatG38Conformance(name, summary), ok: summary.fail === 0, summary }
}

/** CLI 附带演示：Terminal 参考 + Fallback 降级（可选 --demo 后缀由 index 控制） */
export async function runConformanceDemo(): Promise<{ text: string; ok: boolean }> {
  const lines: string[] = []
  // Terminal 参考（42/42 或仅 capability SKIP——套件自检）
  const term = await runG38Conformance(createG38TerminalBackend())
  lines.push(formatG38Conformance('terminal（最简参考）', term))
  lines.push('')
  // FallbackBackend 演示（C-07：rust 不可用 → 自动降级 node + 可观测日志）
  const { createG38FallbackBackend } = await import('@proteus-vue/compiler-backend')
  const fb = await createG38FallbackBackend({
    preferred: 'rust',
    onFallback: (log) => lines.push(`[FallbackBackend] ⚠ 降级事件：${JSON.stringify(log)}`),
  })
  lines.push(`[FallbackBackend] preferred=rust → 实际后端 ${fb.backend.id}（isDegraded=${fb.isDegraded}）`)
  const ok = term.fail === 0 && fb.backend.id === 'node'
  return { text: lines.join('\n'), ok }
}
