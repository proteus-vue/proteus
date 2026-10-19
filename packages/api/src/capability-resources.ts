// packages/api/src/capability-resources.ts
// ★★★决策 #1094（2026-10-19）：能力层的**边界资源登记表**（G-43 所有权治理在能力侧的第一个落点）。
//
// 【为什么需要（用户提问「G-43 现在能不能做了？能力里可能已经涉及所有权治理」——查证结论：确实涉及，且没被治理）】
//   G-43 的语义层 B1-B5 已落地，但它挂在 G-42 容器上，而**能力层完全没接**：
//     · `conns` / `happened`（WebSocket 连接表）——只有测试用 reset，生产无清理入口
//     · `keyboardSubs` / `sensorSubs` / `recordingSubs` / `userCaptureSubs`——只能靠订阅者自己 off
//     · `screenTrees`（元素索引）——有 `clearScreenElements()` 但**生产零调用**
//   这些都是 G-43 定义里的**边界资源**（GC 管不到的原生句柄/观察者/连接），
//   按铁律 G-43.1「边界资源必须归属某个 Owner……禁止无主资源」本该全部登记。
//
// 【本模块的职责（只做"资源账本"，不重写所有权语义）】
//   · `register()`：登记一条边界资源（类型/字节量/源码位置 + **确定性 release 钩子**）
//   · `release()` / `releaseAll()`：执行释放（**幂等**；单个释放抛错不阻断其余）
//   · `attachGraph()`：把账本接到 G-43 的 `OwnershipGraph`（结构类型，**零硬依赖 render-backend**）
//     ⇒ 登记/释放会出现在 DevTools 的 Ownership 视图（G-43.5 可观测）
//
// 【★为什么是"账本"而不是直接用 `Owned<T>`】
//   `Owned<T>` 的语义是「唯一所有权 + Move + Borrow」，而能力层的资源是**多个订阅者共享**的
//   （同一 WebSocket 连接可被多处 `on('message')`）——套 `Owned` 会迫使业务理解 Move/Borrow，
//   与 G-43.4「默认路径框架代管，业务零心智负担」相悖。
//   ⇒ 能力层用「框架代管 + 确定性释放」这一档（G-43.4 / G-43.6），把 Move/Borrow 留给真正需要的业务资源。
//
// 【诚实边界】
//   ① 本账本只保证「登记过的资源会被释放」；**没登记的就管不到**——
//      所以每个能力的构造点必须显式登记（判据 `tests/capability-resource-governance.test.ts` 守着）。
//   ② 字节量对多数能力是 0（socket/订阅器没有可靠的内存读数）——
//      不为了"看起来有账"而编造数字；配额治理仍以 G-46 资源池为准。

/** 资源状态（与 G-43 的 `GraphNode.state` 同构） */
export type ResourceState = 'alive' | 'dropped'

/** 一条已登记的资源。 */
export interface CapabilityResource {
  readonly id: string
  readonly type: string
  readonly owner: string
  readonly byteSize: number
  readonly state: ResourceState
  /** 确定性释放（幂等——重复调用返回 false） */
  release(): boolean
}

/**
 * G-43 `OwnershipGraph` 的**结构子集**（只需这两个方法就能进 DevTools 视图）。
 * ★不 import `render-backend`：api 包零硬依赖渲染包（与本仓 `OwnedLike` 同款做法）。
 */
export interface CapabilityOwnershipGraph {
  register(opts: {
    id: string
    type: string
    byteSize: number
    owner?: string | null
    sourceLocation?: string | null
  }): unknown
  setState(id: string, state: 'alive' | 'moved' | 'dropped'): void
}

export interface CapabilityResourceRegistry {
  /**
   * 登记一条边界资源。
   * @param opts.type 资源类型（如 `ws-connection` / `sensor-stream` / `element-index`）
   * @param opts.release **确定性释放钩子**（关连接/退订/清表）——必须真的把资源释放掉
   * @returns 资源句柄（`state` 随释放变化）
   */
  register(opts: {
    type: string
    release: () => void
    owner?: string
    byteSize?: number
    sourceLocation?: string | null
  }): CapabilityResource
  /** 按 id 释放（幂等；不存在或已释放 ⇒ false） */
  release(id: string): boolean
  /** 释放全部（返回本次释放的 id 列表——验收"归零"的数据源） */
  releaseAll(): { released: string[]; failed: Array<{ id: string; error: string }> }
  /** 当前存活资源数 */
  size(): number
  /** 存活资源 id（诊断/判据用） */
  ids(): string[]
  /** 按类型统计（诊断：确认某类资源真的被登记过） */
  countsByType(): Record<string, number>
  /** 接入 G-43 所有权图（传 null 断开） */
  attachGraph(graph: CapabilityOwnershipGraph | null): void
}

export interface CapabilityResourceRegistryOptions {
  /** 默认 owner 标签（缺省 'capability'） */
  owner?: string
}

/**
 * 创建资源账本。
 *
 * ★每个能力实例（或共享桥）一个——**不要全局单例**：账本本身是状态，
 *   全局单例会让"释放 A 页的资源"误伤 B 页（与 G-43「资源归属某个 Owner」直接冲突）。
 */
export function createCapabilityResourceRegistry(
  options: CapabilityResourceRegistryOptions = {},
): CapabilityResourceRegistry {
  const defaultOwner = options.owner ?? 'capability'
  let seq = 0
  let graph: CapabilityOwnershipGraph | null = null
  const live = new Map<string, { type: string; owner: string; byteSize: number; release: () => void; handle: CapabilityResource }>()

  function releaseOne(id: string): boolean {
    const rec = live.get(id)
    if (!rec) return false
    live.delete(id)
    // ★先改状态再跑钩子：即便钩子抛错，账本也不能留下"看似存活"的条目
    ;(rec.handle as { state: ResourceState }).state = 'dropped'
    try {
      graph?.setState(id, 'dropped')
    } catch {
      /* 图侧异常不阻断释放——释放是主职责 */
    }
    rec.release()
    return true
  }

  return {
    register(opts) {
      const id = `${defaultOwner}-${opts.type}-${++seq}`
      const owner = opts.owner ?? defaultOwner
      const byteSize = opts.byteSize ?? 0
      const handle: CapabilityResource = {
        id,
        type: opts.type,
        owner,
        byteSize,
        state: 'alive',
        release: () => releaseOne(id),
      }
      live.set(id, { type: opts.type, owner, byteSize, release: opts.release, handle })
      try {
        graph?.register({ id, type: opts.type, byteSize, owner, sourceLocation: opts.sourceLocation ?? null })
      } catch {
        /* 图侧异常不阻断登记——账本仍要能释放 */
      }
      return handle
    },

    release(id) {
      return releaseOne(id)
    },

    releaseAll() {
      const released: string[] = []
      const failed: Array<{ id: string; error: string }> = []
      // ★快照遍历：释放钩子里可能再次 release（重入），不能边遍历边改同一个 Map 迭代器
      for (const id of [...live.keys()]) {
        try {
          if (releaseOne(id)) released.push(id)
        } catch (e) {
          failed.push({ id, error: e instanceof Error ? e.message : String(e) })
        }
      }
      return { released, failed }
    },

    size() {
      return live.size
    },

    ids() {
      return [...live.keys()]
    },

    countsByType() {
      const out: Record<string, number> = {}
      for (const rec of live.values()) out[rec.type] = (out[rec.type] ?? 0) + 1
      return out
    },

    attachGraph(g) {
      graph = g
    },
  }
}
