// tests/ownership-engineering.test.ts
// ★G-43 B5（proteus-ownership-plan batches B5）：useOwned/useBorrow 响应式集成（borrow-checker.md §6）
//   验收：① useOwned 响应式元信息（CMP071 替代——不暴露资源引用）
//        ② useBorrow 所有者释放时自动变为 undefined
//        ③ drop/move 后 state 响应式更新（Owned.subscribe 驱动）
//   注入式 mock reactivity（api 包零 vue 依赖先例——决策 #319）
import { describe, it, expect } from 'vitest'
import { createOwnershipEngineering } from '@proteus-vue/api'
import type { OwnedLike, BorrowLike } from '@proteus-vue/api'
import { Owned, OwnershipGraph } from '@proteus-vue/render-backend'

/** mock reactivity（对齐 engineering 测试先例——ref 返回 { value } 可写） */
function mockReactivity() {
  return {
    ref<T>(initial: T): { value: T } {
      return { value: initial }
    },
  }
}

function makeOwned(byteSize = 1024): { graph: OwnershipGraph; owned: Owned<ArrayBuffer> } {
  const graph = new OwnershipGraph()
  const owned = new Owned<ArrayBuffer>({
    id: 'buf-1',
    resourceType: 'array-buffer',
    byteSize,
    owner: 'PageA',
    value: new ArrayBuffer(8),
    graph,
    sourceLocation: 'Player.vue:12',
  })
  return { graph, owned }
}

describe('G-43 B5 useOwned（CMP071 响应式替代）', () => {
  it('初始元信息：state=alive + byteSize；不暴露资源引用（结构面只有 state/byteSize/borrow/stop）', () => {
    const own = createOwnershipEngineering({ reactivity: mockReactivity() })
    const { owned } = makeOwned(8 * 1024 * 1024)
    const view = own.useOwned(owned)
    expect(view.state.value).toBe('alive')
    expect(view.byteSize.value).toBe(8 * 1024 * 1024)
    // CMP071 语义：视图不含资源本身（read/get 不在接口面）
    expect('value' in view).toBe(false)
    expect(typeof (view as unknown as Record<string, unknown>).read).toBe('undefined')
    view.stop()
  })

  it('drop 后 state 响应式更新为 dropped（Owned.subscribe 驱动）', () => {
    const own = createOwnershipEngineering({ reactivity: mockReactivity() })
    const { owned } = makeOwned()
    const view = own.useOwned(owned)
    expect(view.state.value).toBe('alive')
    owned.drop()
    expect(view.state.value).toBe('dropped') // 响应式更新
    view.stop()
  })

  it('transferTo 后 state → moved（use-after-move 前的响应式可见）+ stop 后不再更新', () => {
    const own = createOwnershipEngineering({ reactivity: mockReactivity() })
    const { owned } = makeOwned()
    const view = own.useOwned(owned)
    const target = owned.transferTo('PageB')
    expect(view.state.value).toBe('moved')
    view.stop()
    target.drop()
    expect(view.state.value).toBe('moved') // stop 后订阅解除
  })

  it('borrow() 委托：返回 Borrow 且 drop 后 valid=false', () => {
    const own = createOwnershipEngineering({ reactivity: mockReactivity() })
    const { owned } = makeOwned()
    const view = own.useOwned(owned)
    const b = view.borrow()
    expect(b.valid).toBe(true)
    expect(b.get()).toBeInstanceOf(ArrayBuffer)
    owned.drop({ force: true })
    expect(b.valid).toBe(false)
  })
})

describe('G-43 B5 useBorrow（响应式借用）', () => {
  it('alive 时立即借用；drop 后自动变 undefined（文档 §6.3 语义）', () => {
    const own = createOwnershipEngineering({ reactivity: mockReactivity() })
    const { owned } = makeOwned()
    const handle = own.useBorrow(owned)
    expect(handle.value).not.toBeUndefined()
    expect(handle.value?.valid).toBe(true)
    expect(handle.value?.get()).toBeInstanceOf(ArrayBuffer)

    owned.drop({ force: true })
    expect(handle.value).toBeUndefined() // 所有者释放 → 自动 undefined
  })

  it('已 dropped 的 owned → useBorrow 返回 undefined（不抛错）', () => {
    const own = createOwnershipEngineering({ reactivity: mockReactivity() })
    const { owned } = makeOwned()
    owned.drop()
    const handle = own.useBorrow(owned)
    expect(handle.value).toBeUndefined()
  })

  it('诚实边界：活跃借用下 transferTo 被拒（B1 has_active_borrows——useBorrow 长持借用会阻止 Move，B-05 运行时表现）', () => {
    const own = createOwnershipEngineering({ reactivity: mockReactivity() })
    const { owned } = makeOwned()
    const handle = own.useBorrow(owned)
    expect(handle.value).not.toBeUndefined()
    let code = ''
    try {
      owned.transferTo('PageB')
    } catch (e) {
      code = (e as { code: string }).code
    }
    expect(code).toBe('has_active_borrows') // 借用未释放 → Move 被拒（正确语义，测试固化）
    expect(handle.value?.valid).toBe(true)
  })
})

describe('G-43 B5 结构类型兼容（真实 Owned 实例直接可传）', () => {
  it('OwnedLike/BorrowLike 结构匹配 render-backend 实例（零硬依赖验证）', () => {
    const own = createOwnershipEngineering({ reactivity: mockReactivity() })
    const { owned } = makeOwned()
    // 类型层面：Owned<T> 满足 OwnedLike<T>（TS 编译通过即验证）；行为层面完整链路
    const like = owned as unknown as OwnedLike<ArrayBuffer>
    const view = own.useOwned(like)
    const b: BorrowLike<ArrayBuffer> | undefined = own.useBorrow(like).value
    expect(view.state.value).toBe('alive')
    expect(b).not.toBeUndefined()
    like.drop({ force: true })
    expect(view.state.value).toBe('dropped')
  })
})
