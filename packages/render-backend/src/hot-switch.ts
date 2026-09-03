// packages/render-backend/src/hot-switch.ts
// ★G-41 B5（proteus-host-integration-plan batches B5）：switchBackend 生产级 —— 热切换三策略
//   · rebuild   ：销毁重建（开发期 DevTools 热切换——快、无副作用；旧树丢弃）
//   · rehydrate ：同一 IR 在新引擎重建（生产期路由切换——保业务状态；旧树由调用方/GC 回收）
//   · hybrid    ：同页面多引擎——区域路由是 G-27 B6 createHybridRenderer 的能力，本层把「切到 hybrid 面」作为策略表达
//   管理「活跃挂载点 + 当前 IR」——切换后返回新 root（调用方替换挂载引用）
import type { IRNode, NodeHandle, ProteusRenderBackend } from './spi'
import { renderIRTree } from './dispatcher'
import type { HotSwitchStrategy, ProteusNodeOpsDispatcher } from './dispatcher'

export interface HotSwitchOptions {
  strategy?: HotSwitchStrategy
  /** 切换前钩子（旧树清理/状态保存） */
  onBeforeSwitch?: (from: ProteusRenderBackend, to: ProteusRenderBackend) => void
  /** 切换后钩子（挂载引用替换/新树就绪通知） */
  onAfterSwitch?: (from: ProteusRenderBackend, to: ProteusRenderBackend, root: NodeHandle | null) => void
}

export interface BackendSwitcher {
  readonly dispatch: ProteusNodeOpsDispatcher
  /** 当前活跃 IR（业务状态载体——rehydrate 的「保状态」来源；null = 未挂载） */
  readonly currentIR: IRNode | null
  /** 当前渲染根（rehydrate 后为新后端重建的树；rebuild/hybrid 后为 null——由调用方处置） */
  readonly root: NodeHandle | null
  /** 首次挂载：在 dispatch.currentBackend 上建树 */
  mount(ir: IRNode): NodeHandle
  /** 生产级热切换：策略下处理已渲染节点；返回新 root（rehydrate）或 null（rebuild/hybrid） */
  switchBackend(next: ProteusRenderBackend, opts?: HotSwitchOptions): NodeHandle | null
  /** 清理活跃引用 */
  destroy(): void
}

/** ★G-41 B5：生产级热切换管理器 */
export function createBackendSwitcher(dispatch: ProteusNodeOpsDispatcher): BackendSwitcher {
  let currentIR: IRNode | null = null
  let root: NodeHandle | null = null

  return {
    get dispatch() {
      return dispatch
    },
    get currentIR() {
      return currentIR
    },
    get root() {
      return root
    },
    mount(ir) {
      currentIR = ir
      root = renderIRTree(dispatch.currentBackend, ir)
      return root
    },
    switchBackend(next, opts = {}) {
      const strategy: HotSwitchStrategy = opts.strategy ?? 'rebuild'
      const from = dispatch.currentBackend
      opts.onBeforeSwitch?.(from, next)
      dispatch.switchBackend(next, { strategy })
      if (strategy === 'rehydrate' && currentIR) {
        // 同一 IR 在新引擎重建（保业务状态）——旧树由调用方/GC 处置
        root = renderIRTree(next, currentIR)
      } else {
        root = null
      }
      opts.onAfterSwitch?.(from, next, root)
      return root
    },
    destroy() {
      currentIR = null
      root = null
    },
  }
}