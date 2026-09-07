// packages/hmr/src/runtime.ts —— HMR Runtime（devtools-plus G-34 M1 核心）
// 接收增量 payload → 分派：
//   · vue/js   → applyModule 热替换（失败降级安全 reload，HMR003）
//   · native-binding → 自动安全 reload（HMR002）
//   · css/asset → 资源热替换（宿主处理）
// 状态保留（Flutter Hot Reload 体验）+ 严格规则 HMR001/HMR002/HMR003 + 可观测事件（原则 #3）
import type { HmrEvent, HmrPayload, SafeReload } from './types'

export interface HmrRuntimeOptions {
  /** 模块应用器：vue/js 新代码 → 是否应用成功（false/抛错 → 安全 reload 兜底） */
  applyModule: (file: string, code: string) => boolean
  /** 安全 reload（HMR002：native-binding 变更 / action=reload / 应用失败兜底） */
  reload: SafeReload['reload']
  /** 可观测回调（原则 #3：HMR 过程可见） */
  onEvent?: (event: HmrEvent) => void
  /** HMR001 规则开关（副作用未清理检测，默认开） */
  checkSideEffects?: boolean
  /** HMR003 规则开关（状态丢失检测，默认开） */
  checkStateLoss?: boolean
}

export interface HmrRuntime {
  /** 应用一个 payload（幂等；按 id 防乱序/重复） */
  apply(payload: HmrPayload): void
  /** 批量应用（★性能优化）：同文件合并只保留最终状态 + 按 id 排序后逐个 apply */
  applyBatch(payloads: HmrPayload[]): HmrBatchResult
  /** 模块替换前状态快照（dispose 回调中调用）；前一个实例未恢复时触发 HMR001 */
  snapshotState(file: string, state: Record<string, unknown>): void
  /** 新模块挂载时恢复状态（返回快照；无快照返回 undefined） */
  restoreState(file: string): Record<string, unknown> | undefined
  /** 已应用模块文件列表 */
  appliedFiles(): string[]
  /** 重置（断开连接/会话结束时） */
  reset(): void
  /** 最近应用 payload id */
  readonly lastAppliedId: number
}

/** 批量应用结果（★性能可观测） */
export interface HmrBatchResult {
  /** 输入 payload 总数 */
  total: number
  /** 同文件合并丢弃数（只保留最终状态） */
  merged: number
  /** 实际应用数 */
  applied: number
}

export function createHmrRuntime(options: HmrRuntimeOptions): HmrRuntime {
  const { applyModule, reload, onEvent } = options
  const checkSideEffects = options.checkSideEffects !== false
  const checkStateLoss = options.checkStateLoss !== false
  let lastId = -1
  const snapshots = new Map<string, Record<string, unknown>>()
  const applied = new Set<string>()

  function emit(event: HmrEvent): void {
    onEvent?.(event)
  }

  function apply(payload: HmrPayload): void {
    // 顺序保证：乱序/重复 payload 丢弃
    if (payload.id <= lastId) {
      emit({ type: 'apply', file: payload.file, result: 'skipped' })
      return
    }
    lastId = payload.id
    emit({ type: 'payload', payload })

    if (payload.action === 'reload') {
      if (checkStateLoss && snapshots.has(payload.file)) {
        emit({ type: 'rule', rule: 'HMR003', file: payload.file, message: 'reload 前存在未恢复状态快照——状态将丢失' })
      }
      emit({ type: 'apply', file: payload.file, result: 'reload' })
      reload()
      return
    }

    switch (payload.type) {
      case 'vue':
      case 'js': {
        if (!payload.code) {
          // 无新代码：无法热替换 → 安全 reload（HMR003 兜底）
          emit({ type: 'rule', rule: 'HMR003', file: payload.file, message: 'payload 缺 code——无法热替换，降级安全 reload' })
          emit({ type: 'apply', file: payload.file, result: 'reload' })
          reload()
          return
        }
        let ok = false
        try {
          ok = applyModule(payload.file, payload.code)
        } catch (err) {
          emit({ type: 'error', file: payload.file, message: `模块应用异常：${String(err)}` })
        }
        if (ok) {
          applied.add(payload.file)
          emit({ type: 'apply', file: payload.file, result: 'ok' })
        } else {
          emit({ type: 'rule', rule: 'HMR003', file: payload.file, message: '模块应用失败——状态无法保留，降级安全 reload' })
          emit({ type: 'apply', file: payload.file, result: 'reload' })
          reload()
        }
        return
      }
      case 'native-binding': {
        // HMR002：原生 binding 变更无法热替换 → 自动安全 reload
        emit({ type: 'rule', rule: 'HMR002', file: payload.file, message: '原生 binding 变更——触发安全 reload' })
        emit({ type: 'apply', file: payload.file, result: 'reload' })
        reload()
        return
      }
      case 'css':
      case 'asset': {
        // 资源热替换：宿主自行处理（<link> 替换 / 缓存失效）
        applied.add(payload.file)
        emit({ type: 'apply', file: payload.file, result: 'ok' })
        return
      }
      default: {
        emit({ type: 'apply', file: payload.file, result: 'skipped' })
      }
    }
  }

  function applyBatch(payloads: HmrPayload[]): HmrBatchResult {
    // ★性能优化 1：同文件合并——只保留 id 最大的最终状态（中间变更丢弃）
    const latest = new Map<string, HmrPayload>()
    let merged = 0
    for (const p of payloads) {
      if (latest.has(p.file)) merged += 1
      latest.set(p.file, p)
    }
    // ★性能优化 2：按 id 排序保证全局顺序（乱序 batch 也能正确应用）
    const ordered = Array.from(latest.values()).sort((a, b) => a.id - b.id)
    let appliedCount = 0
    for (const p of ordered) {
      const before = lastId
      apply(p)
      if (lastId !== before) appliedCount += 1
    }
    return { total: payloads.length, merged, applied: appliedCount }
  }

  function snapshotState(file: string, state: Record<string, unknown>): void {
    if (checkSideEffects && snapshots.has(file)) {
      emit({ type: 'rule', rule: 'HMR001', file, message: '替换前存在未清理的模块实例（副作用未 dispose）' })
    }
    snapshots.set(file, state)
  }

  function restoreState(file: string): Record<string, unknown> | undefined {
    const state = snapshots.get(file)
    // 消费快照：恢复后移除（重复 restore 返回 undefined）
    snapshots.delete(file)
    return state
  }

  function reset(): void {
    snapshots.clear()
    applied.clear()
    lastId = -1
  }

  return {
    apply,
    applyBatch,
    snapshotState,
    restoreState,
    appliedFiles: () => Array.from(applied),
    reset,
    get lastAppliedId() {
      return lastId
    },
  }
}
