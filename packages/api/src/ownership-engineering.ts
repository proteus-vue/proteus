// packages/api/src/ownership-engineering.ts
// ★G-43 B5（proteus-ownership-plan batches B5）：Vue 响应式集成——useOwned / useBorrow（borrow-checker.md §6）
//   · CMP071：Owned<T> 默认禁止 ref/reactive 包装（Proxy 破坏所有权语义）——useOwned 提供响应式**元信息**替代
//   · useOwned(owned)：{ state: Ref<OwnedState>, byteSize: Ref<number>, borrow() }——不暴露实际资源引用
//   · useBorrow(owned)：Ref<BorrowLike | undefined>——所有者释放时自动变为 undefined（Owned.subscribe 驱动）
//   injectable 设计族（api 包零运行时依赖 vue，零硬依赖 render-backend——结构类型 OwnedLike/BorrowLike，
//   对齐 createEngineering/RouterLike 先例：消费方注入 reactivity，实例直接可传）
//   MP 产物安全（决策 #32/#36）：无 ?. / ??；无数组解构

/** 响应式底座（结构复用 @proteus-vue/api Reactivity——只依赖 ref） */
export interface OwnershipReactivity {
  ref<T>(initial: T): { value: T }
}

/** Owned 状态（与 render-backend OwnedState 同构） */
export type OwnedStateLike = 'alive' | 'moved' | 'dropped'

/** Owned 结构类型（render-backend Owned 实例直接可传——零硬依赖） */
export interface OwnedLike<T> {
  readonly id: string
  readonly byteSize: number
  readonly state: OwnedStateLike
  /** 状态变化订阅（G-43 B5——moved/dropped 时通知；返回解绑） */
  subscribe(cb: (state: OwnedStateLike) => void): () => void
  /** 借用（scopeName 缺省 'anonymous'） */
  borrow(scopeName?: string): BorrowLike<T>
  drop(opts?: { force?: boolean }): unknown
}

/** Borrow 结构类型（render-backend Borrow 实例直接可传） */
export interface BorrowLike<T> {
  readonly valid: boolean
  get(): T | undefined
  release(): void
}

/** 响应式所有权视图（只读元信息——borrow-checker.md §6.3 接口） */
export interface OwnedView<T> {
  /** 所有权状态（响应式——Move/Drop 时自动更新；CMP071：只暴露元信息不暴露资源引用） */
  readonly state: { value: OwnedStateLike }
  /** 资源字节量（恒定） */
  readonly byteSize: { value: number }
  /** 借用（返回的 Borrow 可安全响应式使用——借用不改变所有权） */
  borrow(): BorrowLike<T>
  /** 停止订阅（组件卸载时调用） */
  stop(): void
}

export interface OwnershipEngineering {
  /** 响应式所有权视图（CMP071 的 useOwned 替代） */
  useOwned<T>(owned: OwnedLike<T>): OwnedView<T>
  /** 响应式借用：所有者释放时自动变为 undefined（响应式更新） */
  useBorrow<T>(owned: OwnedLike<T>): { value: BorrowLike<T> | undefined }
}

export interface OwnershipEngineeringOptions {
  reactivity: OwnershipReactivity
}

/** ★G-43 B5：创建所有权响应式 Hook（useOwned/useBorrow——注入式零 vue 依赖） */
export function createOwnershipEngineering(options: OwnershipEngineeringOptions): OwnershipEngineering {
  const ref = options.reactivity.ref

  return {
    useOwned<T>(owned: OwnedLike<T>): OwnedView<T> {
      const state = ref<OwnedStateLike>(owned.state)
      const byteSize = ref<number>(owned.byteSize)
      const unsub = owned.subscribe(function (s) {
        state.value = s
      })
      void byteSize // 恒定元信息（Ref 形态对齐 §6.3 接口；当前无变化路径）
      return {
        state: state,
        byteSize: byteSize,
        borrow() {
          return owned.borrow('useOwned')
        },
        stop() {
          unsub()
        },
      }
    },

    useBorrow<T>(owned: OwnedLike<T>): { value: BorrowLike<T> | undefined } {
      const handle = ref<BorrowLike<T> | undefined>(undefined)
      if (owned.state === 'alive') {
        handle.value = owned.borrow('useBorrow')
      }
      // 所有者释放（含 move/drop）→ 自动变为 undefined（文档 §6.3「所有者释放时自动变为 undefined」）
      owned.subscribe(function (s) {
        if (s !== 'alive') {
          handle.value = undefined
        }
      })
      return handle
    },
  }
}
