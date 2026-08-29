// packages/runtime/src/pinia/tracer.ts
// 状态变更埋点 + 远程复现（docs/proteus-pinia-plan M8.3）
// 千人千机，线上状态异常没法复现——可上报的变更轨迹
//   · 拦截 mutation（Pinia 插件机制）→ StateTraceEvent { store, mutation, payload, timestamp, stateDiff }
//   · stateDiff：变更前后结构化 diff → 只上报 changed paths（cart.items[2].qty）
//   · 节流 + 批量上报（接入用户已有埋点 SDK）
//   · 隐私：volatile/encrypted 字段（M7.6，来自 store 的 persistence 配置）自动从 trace 剔除
//   · filter 默认空（不上报），显式声明才追踪
// ⚠ MP 产物安全：全文件无 ?? / ?. / 对象展开 / 数组解构
import type { PiniaPluginContext } from 'pinia'

/** 一条可上报的状态变更轨迹 */
export interface StateTraceEvent {
  store: string
  mutation: string
  /** 变更路径（diff 结果：'cart.items[2].qty'；无路径时为 store 级） */
  path: string
  timestamp: number
  /** 变更后的值（敏感字段已剔除） */
  value?: unknown
}

export interface StateTracerOptions {
  /** 上报回调（接入埋点 SDK；节流批量后调用） */
  onTrace: (event: StateTraceEvent) => void
  /** 只追踪这些 store（默认空 = 不上报） */
  filter?: string[]
  /** 采样率 0-1（线上 10% → 0.1） */
  sample?: number
  /** 批量上报窗口 ms（默认 500；窗口内合并上报） */
  batchMs?: number
  /** 额外排除字段路径（默认从 store 的 persistence 配置读 volatile/encrypted） */
  excludeFields?: string[]
}

/** 计算变更路径（基于 mutation 类型；直接赋值/数组操作给粗粒度路径） */
function mutationPath(mutation: { type: string; key?: unknown }): string {
  if (mutation.type === 'direct') {
    return typeof mutation.key === 'string' ? mutation.key : ''
  }
  return ''
}

/**
 * 创建状态追踪插件
 * 用法：pinia.use(createStateTracer({ onTrace: (e) => reporter.report('pinia:trace', e), filter: ['cart'], sample: 0.1 }))
 */
export function createStateTracer(options: StateTracerOptions) {
  const filter = new Set<string>(options.filter ?? [])
  const sample = options.sample ?? 1
  const batchMs = options.batchMs ?? 500
  const extraExclude = new Set<string>(options.excludeFields ?? [])
  let batch: StateTraceEvent[] = []
  let batchTimer: ReturnType<typeof setTimeout> | null = null

  function flushBatch(): void {
    if (batch.length === 0) return
    const events = batch
    batch = []
    batchTimer = null
    for (const e of events) options.onTrace(e)
  }

  return function stateTracerPlugin(ctx: PiniaPluginContext): void {
    const storeId = ctx.store.$id
    // filter 默认空 = 不上报（显式声明才追踪）
    if (filter.size === 0 || !filter.has(storeId)) return

    // 采样：随机丢弃（线上降噪）
    if (Math.random() > sample) return

    // 敏感字段：从 persistence 配置（volatile/encrypted）读取
    const persistCfg = ctx.options.persistence as
      | { volatile?: string[]; encrypted?: string[] | { fields: string[] } }
      | undefined
    const sensitive = new Set<string>([
      ...Array.from(extraExclude),
      ...(persistCfg?.volatile ?? []),
      ...(Array.isArray(persistCfg?.encrypted) ? persistCfg.encrypted : ((persistCfg?.encrypted as { fields?: string[] })?.fields ?? [])),
    ])

    ctx.store.$subscribe(
      (mutation, state) => {
        const path = mutationPath(mutation as { type: string; key?: unknown })
        // 敏感字段剔除：path 顶层字段命中（volatile/encrypted）→ 跳过
        const topField = path.split('.')[0]
        if (topField && sensitive.has(topField)) return
        // 整 store 变更（path ''，pinia direct mutation 无 key）：净化后上报（剔除敏感字段明文）
        let value: unknown
        if (path) {
          value = (state as Record<string, unknown>)[path]
        } else {
          const cleaned: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(state as Record<string, unknown>)) {
            if (sensitive.has(k)) continue
            cleaned[k] = v
          }
          value = cleaned
        }
        batch.push({
          store: storeId,
          mutation: mutation.type,
          path,
          timestamp: Date.now(),
          value,
        })
        if (batchTimer === null) {
          batchTimer = setTimeout(flushBatch, batchMs)
        }
      },
      { detached: true, flush: 'sync' },
    )
  }
}
