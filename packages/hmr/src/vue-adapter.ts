// packages/hmr/src/vue-adapter.ts —— Vue import.meta.hot 适配（devtools-plus G-34 M1）
// 把 import.meta.hot 的语义面（accept/dispose/invalidate）接进 HMR Runtime：
// 组件替换保持状态（dispose 快照 → 新模块恢复，Flutter Hot Reload 体验）。
// 无 hot 环境（非 dev / 非 Vite / 小程序产物）安全降级 no-op。
import type { HmrRuntime } from './runtime'

/** import.meta.hot 的形状（Vite 注入；结构类型，可注入 mock 单测） */
export interface VueHotApiLike {
  accept(deps?: string[] | ((mod: unknown) => void), cb?: (mod: unknown) => void): void
  dispose(cb: (data: Record<string, unknown>) => void): void
  invalidate(): void
}

export interface VueHotAdapterOptions {
  /** HMR Runtime（snapshot/restore 状态保留） */
  runtime: HmrRuntime
  /** 当前模块文件路径（相对工程根） */
  file: string
  /** import.meta.hot 提供者（Vite 中传 import.meta.hot；缺省 no-op——非 dev 环境安全降级） */
  getHot?: () => VueHotApiLike | undefined
}

export interface VueHotAdapter {
  /** 是否存在 hot 环境（Vite dev） */
  readonly enabled: boolean
  /** accept：注册组件更新回调（新模块应用后触发） */
  accept(cb?: () => void): void
  /** dispose：组件替换前状态快照（Flutter Hot Reload 体验） */
  dispose(snapshot: () => Record<string, unknown>): void
  /** 组合：dispose 快照 + accept 恢复（状态保留一键式） */
  applyWithState(snapshot: () => Record<string, unknown>, restore: (state: Record<string, unknown>) => void): void
  /** invalidate：声明不可热替换 → 触发整页刷新 */
  invalidate(): void
}

export function createVueHotAdapter(options: VueHotAdapterOptions): VueHotAdapter {
  const getHot = options.getHot ?? (() => undefined)
  const { runtime, file } = options

  return {
    get enabled() {
      return getHot() !== undefined
    },
    accept(cb?: () => void): void {
      const hot = getHot()
      if (!hot) return
      hot.accept(() => {
        cb?.()
      })
    },
    dispose(snapshot: () => Record<string, unknown>): void {
      const hot = getHot()
      if (!hot) return
      hot.dispose(() => {
        runtime.snapshotState(file, snapshot())
      })
    },
    applyWithState(snapshot: () => Record<string, unknown>, restore: (state: Record<string, unknown>) => void): void {
      const hot = getHot()
      if (!hot) return
      hot.dispose(() => {
        runtime.snapshotState(file, snapshot())
      })
      hot.accept(() => {
        const state = runtime.restoreState(file)
        restore(state ?? {})
      })
    },
    invalidate(): void {
      const hot = getHot()
      if (!hot) return
      hot.invalidate()
    },
  }
}
