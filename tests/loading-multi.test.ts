// tests/loading-multi.test.ts —— ★★★GP4-b（2026-10-03）：**Loading 多实例与遮罩范围**语义回归锁
//
// 【这张卡补的是什么】《全局挂载点方案》GP4-b：
//   · `uni.showLoading` 是**全局单例**（连调 = 覆盖前一个）⇒ 本模块 = **活跃集合**（N 个同时存在）
//   · 三种遮罩范围：`global`（跨页存活）/ `page`（仅本页 + 卸载自动清理）/ `region`（组件就地，见组件测试）
//   · 交互拦截语义：mask:true 拦截；dismissible 缺省 false（结束由业务显式 hide）
//
// 【★与 Toast 的语义差异（本文件锁住的正是"别把两者混成一个"）】
//   Toast = **队列**（一条条来，后者排队）；Loading = **活跃集合**（同时存在，各自独立结束）
//
// 【判据设计（每条都可破坏性验证——改坏必红）】
//   ① 多实例共存（不同 id 同时在；uni 做不到）
//   ② 同名替换（同 id 再调 = 替换文案，**不叠出第二个**、**位置不变**）
//   ③ scope 语义（global 无 pageKey；page 绑当前页）
//   ④ 页面卸载清理（只清 page 级本页的；global 不动——这是 page 范围的核心安全收益）
//   ⑤ 交互拦截字段（mask/dismissible 如实透传）
//   ⑥ 渲染顺序 = seq 升序（后插入更靠后 ⇒ 层叠更高）
//   ⑦ 统计可观测（shown/hidden/swept——swept 是"业务忘了 hide"的指标）
//   ⑧ 事件序列（show/replace/hide/clear + 归因 reason）
//   ⑨ hideLoading 返回布尔（不存在 ⇒ false，不静默）
//
// ★页面上下文注入：`getCurrentPages` 在小程序外不存在——用 globalThis 打桩模拟"当前页"，
//   从而可在 Node 里测 page 范围的归属与清理（不需真机）。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  showLoading, hideLoading, clearLoadings, loadingSnapshot, loadingStats,
  subscribeLoading, sweepPageLoadings, __resetLoadingForTest,
} from '../packages/runtime/src/loading'
import type { LoadingEvent } from '../packages/runtime/src/loading'

/** 模拟"当前在小程序某页"（page 范围的归属判据） */
function stubPage(route: string): void {
  ;(globalThis as unknown as { getCurrentPages: () => Array<{ route: string }> }).getCurrentPages = () => [{ route }]
}

beforeEach(() => {
  __resetLoadingForTest()
  stubPage('pages/a')
})
afterEach(() => {
  __resetLoadingForTest()
  delete (globalThis as unknown as { getCurrentPages?: unknown }).getCurrentPages
})

describe('★GP4-b ① 多实例共存（与 Toast 的队列语义分道扬镳）', () => {
  it('两个不同 id 的 Loading 可同时存在（uni.showLoading 做不到）', () => {
    showLoading({ id: 'work-a', text: 'A' })
    showLoading({ id: 'work-b', text: 'B' })
    const items = loadingSnapshot()
    expect(items.map((i) => i.id), '两个同时活跃').toEqual(['work-a', 'work-b'])
    expect(items.map((i) => i.text)).toEqual(['A', 'B'])
  })

  it('结束其中一个，另一个不受影响', () => {
    showLoading({ id: 'a' })
    showLoading({ id: 'b' })
    hideLoading('a')
    expect(loadingSnapshot().map((i) => i.id), 'b 仍在').toEqual(['b'])
  })

  it('缺省 id = default（对齐 uni.hideLoading 的无参语义）', () => {
    showLoading({ text: 'x' })
    expect(loadingSnapshot()[0]!.id).toBe('default')
    expect(hideLoading(), '无参 hide 关 default').toBe(true)
    expect(loadingSnapshot()).toEqual([])
  })
})

describe('★GP4-b ② 同名替换（对齐 uni.showLoading 的覆盖语义，但保住层叠位置）', () => {
  it('同 id 再调 ⇒ 替换文案，不叠出第二个', () => {
    showLoading({ id: 'a', text: '第一版' })
    showLoading({ id: 'a', text: '第二版' })
    const items = loadingSnapshot()
    expect(items.length, '仍只有一个').toBe(1)
    expect(items[0]!.text).toBe('第二版')
  })

  it('★替换**保住原位置**（同 id 刷新文案不该改变层叠顺序）', () => {
    showLoading({ id: 'a' })
    showLoading({ id: 'b' })
    showLoading({ id: 'c' })
    // a 刷新文案（若"重新插入"，a 会跳到最上层）
    showLoading({ id: 'a', text: '刷新' })
    expect(loadingSnapshot().map((i) => i.id), 'a 仍在原位').toEqual(['a', 'b', 'c'])
  })
})

describe('★GP4-b ③ 遮罩范围语义（global / page）', () => {
  it('page（缺省）：绑定当前页 route', () => {
    showLoading({ id: 'p1' })
    expect(loadingSnapshot()[0]!.scope).toBe('page')
    expect(loadingSnapshot()[0]!.pageKey, 'page 级带页键').toBe('pages/a')
  })

  it('global：无页键（宿主据此不过滤 ⇒ 跨页可见）', () => {
    showLoading({ id: 'g1', scope: 'global' })
    expect(loadingSnapshot()[0]!.scope).toBe('global')
    expect(loadingSnapshot()[0]!.pageKey, 'global 不带页键').toBe('')
  })

  it('★缺省 scope = page（**更安全的默认**：忘了 hide 也不跨页泄漏）', () => {
    showLoading({ id: 'x' })
    expect(loadingSnapshot()[0]!.scope).toBe('page')
  })

  it('换页后新建的 page 级 Loading 归属新页（页键随上下文走）', () => {
    showLoading({ id: 'old' })
    stubPage('pages/b')
    showLoading({ id: 'new' })
    const byId = Object.fromEntries(loadingSnapshot().map((i) => [i.id, i.pageKey]))
    expect(byId.old).toBe('pages/a')
    expect(byId.new).toBe('pages/b')
  })
})

describe('★GP4-b ④ 页面卸载清理（page 范围的核心安全收益）', () => {
  it('sweepPageLoadings：只清**本页的 page 级**，global 不动', () => {
    showLoading({ id: 'p-a' }) // pages/a
    showLoading({ id: 'g', scope: 'global' })
    stubPage('pages/b')
    showLoading({ id: 'p-b' }) // pages/b

    const removed = sweepPageLoadings('pages/a')
    expect(removed, '只清 a 页那一个').toBe(1)
    const ids = loadingSnapshot().map((i) => i.id)
    expect(ids, 'global 与其他页的 page 级都保住').toEqual(['g', 'p-b'])
  })

  it('★不存在的页键 ⇒ 清 0（不误伤）', () => {
    showLoading({ id: 'p-a' })
    expect(sweepPageLoadings('pages/zzz')).toBe(0)
    expect(loadingSnapshot().length).toBe(1)
  })

  it('空页键 ⇒ 清 0（防御：无页面上下文时不误清 global）', () => {
    showLoading({ id: 'g', scope: 'global' })
    expect(sweepPageLoadings('')).toBe(0)
    expect(loadingSnapshot().length).toBe(1)
  })

  it('clearLoadings 无过滤 ⇒ 清全部（含 global——显式"全清"语义）', () => {
    showLoading({ id: 'a' })
    showLoading({ id: 'g', scope: 'global' })
    expect(clearLoadings()).toBe(2)
    expect(loadingSnapshot()).toEqual([])
  })
})

describe('★GP4-b ⑤ 交互拦截字段（如实透传——宿主据此决定是否拦）', () => {
  it('mask 缺省 true（默认拦截）；显式 false 可关', () => {
    showLoading({ id: 'a' })
    showLoading({ id: 'b', mask: false })
    const byId = Object.fromEntries(loadingSnapshot().map((i) => [i.id, i.mask]))
    expect(byId.a, '缺省拦截').toBe(true)
    expect(byId.b, '显式不拦截').toBe(false)
  })

  it('dismissible 缺省 false（结束由业务显式 hide——与 uni.showLoading 一致）', () => {
    showLoading({ id: 'a' })
    showLoading({ id: 'b', dismissible: true })
    const byId = Object.fromEntries(loadingSnapshot().map((i) => [i.id, i.dismissible]))
    expect(byId.a).toBe(false)
    expect(byId.b).toBe(true)
  })
})

describe('★GP4-b ⑥ 渲染顺序 = 插入顺序（seq 升序；树序即 z-order）', () => {
  it('后插入的在后（⇒ 层叠更高）', () => {
    showLoading({ id: '1' })
    showLoading({ id: '2' })
    showLoading({ id: '3' })
    const seqs = loadingSnapshot().map((i) => i.seq)
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1]!)
  })
})

describe('★GP4-b ⑦⑧ 统计与事件（可观测——不静默）', () => {
  it('shown/hidden/swept 各记各的', () => {
    showLoading({ id: 'a' })
    hideLoading('a') // hidden=1
    showLoading({ id: 'b' }) // shown=2
    sweepPageLoadings('pages/a') // swept=1
    const st = loadingStats()
    expect(st.shown).toBe(2)
    expect(st.hidden).toBe(1)
    expect(st.swept, '页面卸载清掉的单列（"忘了 hide"的指标）').toBe(1)
  })

  it('★swept 与 hidden 分离（清理与主动关闭是两种行为，混一起就看不出泄漏习惯）', () => {
    showLoading({ id: 'a' })
    sweepPageLoadings('pages/a')
    expect(loadingStats().hidden, '卸载清理不计入 hidden').toBe(0)
    expect(loadingStats().swept).toBe(1)
  })

  it('事件序列含归因（show / replace / hide(manual) / clear(page-unload)）', () => {
    const events: LoadingEvent[] = []
    subscribeLoading((_s, e) => events.push(e))
    showLoading({ id: 'a' })
    showLoading({ id: 'a' }) // replace
    hideLoading('a') // hide:manual
    showLoading({ id: 'b' })
    sweepPageLoadings('pages/a') // clear:page-unload
    expect(events.map((e) => `${e.kind}${e.reason ? ':' + e.reason : ''}`)).toEqual([
      'show', 'replace:replaced', 'hide:manual', 'show', 'clear:page-unload',
    ])
  })

  it('★hideLoading 返回布尔（不存在 ⇒ false——不静默，调用方可据此诊断）', () => {
    expect(hideLoading('nope'), '不存在的 id').toBe(false)
    showLoading({ id: 'a' })
    expect(hideLoading('a')).toBe(true)
    expect(hideLoading('a'), '第二次已不存在').toBe(false)
  })

  it('订阅者可退订（宿主 onUnmounted 用）', () => {
    let n = 0
    const unsub = subscribeLoading(() => {
      n++
    })
    showLoading({ id: 'a' })
    const after = n
    unsub()
    showLoading({ id: 'b' })
    expect(n, '退订后不再增加').toBe(after)
  })

  it('订阅者抛错不影响状态推进（宿主渲染失败不拖垮逻辑层）', () => {
    subscribeLoading(() => {
      throw new Error('宿主炸了')
    })
    showLoading({ id: 'a' })
    expect(loadingSnapshot().length, '状态照常推进').toBe(1)
  })
})

describe('★GP4-b 全局可观测落痕（真机排障通道）', () => {
  it('最近事件落痕含 kind/count/ids（排障"现在为什么有个遮罩"）', () => {
    showLoading({ id: 'x', text: '加载中' })
    const g = globalThis as unknown as { __PROTEUS_LOADING_LAST_EVENT__?: Record<string, unknown> }
    expect(g.__PROTEUS_LOADING_LAST_EVENT__?.kind).toBe('show')
    expect(g.__PROTEUS_LOADING_LAST_EVENT__?.ids).toEqual(['x'])
  })

  it('订阅数落痕（宿主数量与订阅数不一致 = 注入/生命周期异常的信号）', () => {
    const unsub = subscribeLoading(() => {})
    const g = globalThis as unknown as { __PROTEUS_LOADING_SUBSCRIBERS__?: number }
    expect(g.__PROTEUS_LOADING_SUBSCRIBERS__).toBe(1)
    unsub()
    expect(g.__PROTEUS_LOADING_SUBSCRIBERS__).toBe(0)
  })
})
