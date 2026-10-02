// tests/screen-executor-host.test.ts
// ★★M5 执行器**生产端口**（宿主通道适配层）—— 协议翻译 / 完成回调 / 失败分档 / 与执行器合流
//
// 【被测对象】`createHostScreenPorts`（render-backend）：把执行器的两个端口翻译成宿主 `invoke`
//   请求，并把宿主的异步完成（`__proteusHostScreenAnimDone`）接回 promise。
// 【测试形态】通道用记录桩（返回可编程回执）；完成回调用**真全局键**（模拟宿主推入）。
//   最后一组把**真执行器**接上本适配层（全链：栈 → 执行器 → 适配层 → 桩通道 → 完成回调）。
import { describe, it, expect, beforeEach } from 'vitest'
import { createScreenExecutor, createHostScreenPorts, SCREEN_ANIM_DONE_KEY } from '@proteus-vue/render-backend'
import type { HostInvokeChannel } from '@proteus-vue/render-backend'
import { createAppStack } from '@proteus-vue/router/app-stack'
import { routeTransitionBatches } from '@proteus-vue/animation'
import type { AppScreenSpec } from '@proteus-vue/router/app-stack'

/** 记录桩通道：按方法名回可编程回执；记录 (method, args) 流 */
function makeChannel(replies: Record<string, unknown> = {}) {
  const log: Array<{ method: string; args: Record<string, unknown> }> = []
  let nextRoot = 500
  const channel: HostInvokeChannel = (method, argsJson) => {
    const args = JSON.parse(argsJson || 'null') as Record<string, unknown>
    log.push({ method, args })
    if (replies[method] !== undefined) {
      const r = replies[method]
      return typeof r === 'string' ? r : JSON.stringify(r)
    }
    // 默认合理回执（贴近真实宿主形态）
    if (method === 'screen.mount') return JSON.stringify({ ok: true, data: { rootNodeId: nextRoot++, nodes: 3 } })
    if (method === 'screen.visible') return JSON.stringify({ ok: true, data: { visible: args.visible, rects: args.visible ? 3 : 0 } })
    if (method === 'screen.destroy') return JSON.stringify({ ok: true, data: { removed: 3 } })
    if (method === 'screen.anim') return JSON.stringify({ ok: true, data: { started: 2 } }) // ★默认"非 immediate"⇒ 等回调
    return JSON.stringify({ ok: false, reason: `未知方法 ${method}`, missing: true })
  }
  return { channel, log }
}

/** 等一轮微任务（宿主回推后 promise 的 settle） */
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('M5 生产端口 · 协议翻译', () => {
  it('mountScreen：转发六字段并返回 rootNodeId（宿主未给 ⇒ 抛错不静默）', () => {
    const { channel, log } = makeChannel()
    const ports = createHostScreenPorts({ invoke: channel })
    const node = ports.tree.mountScreen({ screenId: 'home#1', name: 'home', path: '/home', params: { a: 1 }, rebuild: false })
    expect(node).toBe(500)
    expect(log[0].method).toBe('screen.mount')
    expect(log[0].args).toMatchObject({ screenId: 'home#1', name: 'home', path: '/home', params: { a: 1 }, rebuild: false })
    // 宿主未返回 rootNodeId ⇒ 抛（执行器会把 enter 归为编排错误——不静默）
    const bad = makeChannel({ 'screen.mount': { ok: true, data: { nodes: 3 } } })
    const p2 = createHostScreenPorts({ invoke: bad.channel, installAnimDoneHook: false })
    expect(() => p2.tree.mountScreen({ screenId: 'x', name: 'x', path: '/x', params: null, rebuild: false })).toThrow(/rootNodeId/)
  })

  it('setScreenVisible / destroyScreen：转发并解析（含 reason 透传）', () => {
    const { channel, log } = makeChannel()
    const ports = createHostScreenPorts({ invoke: channel, installAnimDoneHook: false })
    ports.tree.setScreenVisible('home#1', false, 500)
    ports.tree.destroyScreen('home#1', 'freeze', 500)
    expect(log.map((l) => l.method)).toEqual(['screen.visible', 'screen.destroy'])
    expect(log[0].args).toMatchObject({ screenId: 'home#1', visible: false, rootNodeId: 500 })
    expect(log[1].args).toMatchObject({ screenId: 'home#1', reason: 'freeze', rootNodeId: 500 })
  })

  it('ok:false 分档：missing ⇒ 提示"未实现"，否则列原因（都不静默）', () => {
    const { channel } = makeChannel({
      'screen.destroy': { ok: false, reason: '内核句柄失效', missing: false },
    })
    const ports = createHostScreenPorts({ invoke: channel, installAnimDoneHook: false })
    expect(() => ports.tree.destroyScreen('a', 'pop', 1)).toThrow(/内核句柄失效/)
    const miss = makeChannel({ 'screen.visible': { ok: false, reason: 'no screen host', missing: true } })
    const p2 = createHostScreenPorts({ invoke: miss.channel, installAnimDoneHook: false })
    expect(() => p2.tree.setScreenVisible('a', true, 1)).toThrow(/未实现/)
  })

  it('回执非 JSON ⇒ 抛错（不吞）', () => {
    const { channel } = makeChannel({ 'screen.visible': 'not-json{{' })
    const ports = createHostScreenPorts({ invoke: channel, installAnimDoneHook: false })
    expect(() => ports.tree.setScreenVisible('a', true, 1)).toThrow(/回执非 JSON/)
  })
})

describe('M5 生产端口 · 动画批次与完成回调', () => {
  it('空批次：不产生跨边界调用（none 转场零开销）', async () => {
    const { channel, log } = makeChannel()
    const ports = createHostScreenPorts({ invoke: channel, installAnimDoneHook: false })
    await ports.anim.playRouteTransition({ incoming: { anims: [] }, outgoing: { anims: [] }, durationMs: 0, opaque: true }, { direction: 'forward', transition: 'none' })
    expect(log).toEqual([])
  })

  it('非空批次：两页动画**合并一次**调用（批处理红线）+ token 透传', async () => {
    const { channel, log } = makeChannel()
    const ports = createHostScreenPorts({ invoke: channel })
    const p = ports.anim.playRouteTransition(
      { incoming: { anims: [{ nodeId: 1, from: 800, to: 0 }] }, outgoing: { anims: [{ nodeId: 2, from: 0, to: -240 }] }, durationMs: 300, opaque: true },
      { direction: 'forward', transition: 'slideUp' },
    )
    expect(log).toHaveLength(1) // 一次调用
    expect(log[0].method).toBe('screen.anim')
    expect((log[0].args.anims as unknown[]).length).toBe(2) // 两页合并
    expect(log[0].args.direction).toBe('forward')
    expect(typeof log[0].args.token).toBe('string')
    expect(ports.pendingAnimations).toBe(1) // 等宿主回推
    // 宿主回推完成（真全局键——与宿主 eval 的形态一致）
    const done = (globalThis as Record<string, unknown>)[SCREEN_ANIM_DONE_KEY] as (t: string, j?: unknown) => string
    expect(typeof done).toBe('function')
    expect(done(log[0].args.token as string, {})).toBe('ok')
    await p
    expect(ports.pendingAnimations).toBe(0)
    // 未知 token：返回可读回执（宿主可诊断），不影响在途项
    expect(done('no-such-token')).toBe('unknown-token')
  })

  it('immediate=true（宿主声明即刻完成）⇒ 不挂起、不等回调', async () => {
    const { channel } = makeChannel({ 'screen.anim': { ok: true, data: { started: 1, immediate: true } } })
    const ports = createHostScreenPorts({ invoke: channel })
    await ports.anim.playRouteTransition(
      { incoming: { anims: [{ nodeId: 1 }] }, outgoing: { anims: [] }, durationMs: 0, opaque: true },
      { direction: 'forward', transition: 'slideUp' },
    )
    expect(ports.pendingAnimations).toBe(0)
  })

  it('完成钩子未装（全局不可写）⇒ animDoneHookInstalled=false（判据可读——不静默）', () => {
    const { channel } = makeChannel()
    const ports = createHostScreenPorts({ invoke: channel, installAnimDoneHook: false })
    expect(ports.animDoneHookInstalled).toBe(false)
    const ports2 = createHostScreenPorts({ invoke: channel })
    expect(ports2.animDoneHookInstalled).toBe(true)
  })
})

describe('M5 生产端口 · 与执行器合流（全链：栈 → 执行器 → 适配层 → 宿主）', () => {
  const SPECS: Record<string, AppScreenSpec> = {
    home: { name: 'home', path: '/home', transition: 'slideUp' },
    detail: { name: 'detail', path: '/detail', transition: 'slideUp' },
  }

  beforeEach(() => {
    delete (globalThis as Record<string, unknown>)[SCREEN_ANIM_DONE_KEY]
  })

  it('push + pop 全链走宿主通道：两次 navigation = 两次 screen.anim（各等一次回调）', async () => {
    const { channel, log } = makeChannel()
    const ports = createHostScreenPorts({ invoke: channel })
    const stack = createAppStack({ screens: SPECS, policy: { keepWindow: 3 } })
    const executor = createScreenExecutor({
      host: ports.tree,
      anim: ports.anim,
      plan: (t, targets, o) => routeTransitionBatches(t, targets, o ?? {}),
      onScreenMounted: (id) => stack.markRebuilt(id),
    })
    const done = (globalThis as Record<string, unknown>)[SCREEN_ANIM_DONE_KEY] as (t: string, j?: unknown) => string

    stack.push('home')
    const p1 = executor.applyCommands(stack.drainCommands())
    await tick()
    // 首屏：mount → visible → anim（等回调）
    expect(log.map((l) => l.method)).toEqual(['screen.mount', 'screen.visible', 'screen.anim'])
    expect(ports.pendingAnimations).toBe(1)
    done(log[2].args.token as string)
    await p1

    log.length = 0
    stack.push('detail')
    const p2 = executor.applyCommands(stack.drainCommands())
    await tick()
    // push：mount(detail) → visible(detail,true) → anim → visible(home,false)
    expect(log.map((l) => l.method)).toEqual(['screen.mount', 'screen.visible', 'screen.anim'])
    done(log[2].args.token as string)
    await p2
    // 转场播完 ⇒ 旧屏隐藏（树保留）
    expect(log.map((l) => l.method)).toEqual(['screen.mount', 'screen.visible', 'screen.anim', 'screen.visible'])
    expect(log[3].args).toMatchObject({ screenId: 'home#1', visible: false })

    log.length = 0
    stack.pop()
    const p3 = executor.applyCommands(stack.drainCommands())
    await tick()
    // pop：visible(home,true) → anim（back）→ 播完后 destroy(detail)
    expect(log.map((l) => l.method)).toEqual(['screen.visible', 'screen.anim'])
    expect(log[1].args.direction).toBe('back')
    expect(log.some((l) => l.method === 'screen.destroy')).toBe(false) // ★销毁挂起中（转场未播完）
    done(log[1].args.token as string)
    await p3
    expect(log.map((l) => l.method)).toEqual(['screen.visible', 'screen.anim', 'screen.destroy'])
    expect(log[2].args).toMatchObject({ screenId: 'detail#2', reason: 'pop' })
    expect(ports.pendingAnimations).toBe(0)
  })
})

// ══════════════════════════════════════════════════════════════════
// ★★跨页面共享元素（2026-10-01 收诚实边界）：页面栈层的几何回传 + 跨树飞行
//
// 【要证明什么】边界原文"跨页面的稳态几何回传需页面栈层配合（未做）"。
//   本组证明该配合已接上：① `screen.rect` 真回几何（内核算）；② `screen.shared` 把
//   **源页矩形**（另一棵树）+ 目标节点送进内核；③ 完成走**同一条** token 回推链（与转场同构）。
//   ★不押宿主自报的 dx/dy/scale：几何由内核回，测试只断言"请求形态 + 完成链 + 失败冒泡"。
// ══════════════════════════════════════════════════════════════════
describe('M5 生产端口 · 跨页面共享元素', () => {
  it('rect：转发 screenId/nodeId 并解析内核几何（width/height → w/h）', async () => {
    const { channel, log } = makeChannel({
      'screen.rect': { ok: true, data: { x: 40, y: 600, width: 80, height: 80 } },
    })
    const ports = createHostScreenPorts({ invoke: channel })
    const r = await ports.shared.rect('home#1', 102)
    expect(r).toEqual({ x: 40, y: 600, w: 80, h: 80 })
    expect(log[0]).toMatchObject({ method: 'screen.rect', args: { screenId: 'home#1', nodeId: 102 } })
  })

  it('rect：内核回几何不全 ⇒ 抛错（不静默返回 0 几何）', async () => {
    const { channel } = makeChannel({ 'screen.rect': { ok: true, data: { y: 1 } } })
    const ports = createHostScreenPorts({ invoke: channel })
    await expect(ports.shared.rect('home#1', 102)).rejects.toThrow(/未返回几何/)
  })

  it('fly：源矩形 + 目标节点送进 screen.shared，完成靠 token 回推（与转场同一条链）', async () => {
    let captured: Record<string, unknown> | null = null
    const { channel, log } = makeChannel({
      'screen.shared': (() => {
        // 捕获请求后回"非 immediate"（等回推）；token 由本回执决定
        return { ok: true, data: { started: 1, fromRect: { x: 40, y: 600, w: 80, h: 80 }, toRect: { x: 0, y: 200, w: 1080, h: 200 } } }
      })(),
    })
    // 用包装通道捕获 args（makeChannel 的 log 已够——但它记录的是解析后的 args）
    const ports = createHostScreenPorts({ invoke: channel })
    const p = ports.shared.fly({
      targetScreenId: 'detail#2',
      targetNodeId: 114,
      sourceRect: { x: 40, y: 600, w: 80, h: 80 },
      durMs: 200,
      curve: 1,
      fadeIn: false,
    })
    await tick()
    // 请求形态：目标屏/节点/源矩形/时长全在
    const req = log.find((l) => l.method === 'screen.shared')
    expect(req).toBeTruthy()
    captured = req!.args
    expect(captured).toMatchObject({
      targetScreenId: 'detail#2',
      targetNodeId: 114,
      sourceRect: { x: 40, y: 600, w: 80, h: 80 },
      durMs: 200,
    })
    // 在途 1（等宿主回推）
    expect(ports.pendingAnimations).toBe(1)
    // 宿主回推（与转场共用 __proteusHostScreenAnimDone）
    const done = (globalThis as Record<string, unknown>)[SCREEN_ANIM_DONE_KEY] as (t: unknown, r?: unknown) => string
    const token = captured!.token as string
    expect(done(token, '{}')).toBe('ok')
    const out = await p
    // ★几何在同步回执、完成在回推 ⇒ 合并返回（fromRect/toRect 不被空 payload 覆盖）
    expect(out).toMatchObject({
      fromRect: { x: 40, y: 600, w: 80, h: 80 },
      toRect: { x: 0, y: 200, w: 1080, h: 200 },
    })
    expect(ports.pendingAnimations).toBe(0)
  })

  it('fly：宿主未启动（started=0）⇒ 抛错（不产生永不 resolve 的悬挂 promise）', async () => {
    const { channel } = makeChannel({ 'screen.shared': { ok: true, data: { started: 0 } } })
    const ports = createHostScreenPorts({ invoke: channel })
    await expect(
      ports.shared.fly({ targetScreenId: 'd#1', targetNodeId: 1, sourceRect: { x: 0, y: 0, w: 1, h: 1 } }),
    ).rejects.toThrow(/未启动/)
    expect(ports.pendingAnimations).toBe(0) // ★不许留悬挂
  })

  it('未知 token 回推 ⇒ 不崩（返回 unknown-token，与既有语义一致）', () => {
    const { channel } = makeChannel({})
    const ports = createHostScreenPorts({ invoke: channel })
    void ports // 仅需钩子装上
    const done = (globalThis as Record<string, unknown>)[SCREEN_ANIM_DONE_KEY] as (t: unknown) => string
    expect(done('nope')).toBe('unknown-token')
  })
})

// ══════════════════════════════════════════════════════════════════
// ★★多实例同上下文（2026-10-02 真机抓到的缺陷回归锁）
//
// 【故障形态（真机 app-stack 场景 E+F 并行时现形）】两个 `createHostScreenPorts` 实例
//   各自装全局钩子 `__proteusHostScreenAnimDone` ⇒ 原实现**后装覆盖先装** ⇒ 先装侧
//   （E 场景）的动画完成回推永远到不了 ⇒ E/F 双双 pending ⇒ 执行器 10s 超时。
//   【为什么既有单测没抓到】本文件其余用例一次只建一个实例——覆盖问题只在"同上下文多实例"现形，
//   而那正是真机场景（E 手写装配 + F 统一 API 并行）的形态。
//   【修法】全局槽改**多实例注册表**（钩子遍历分发）+ token 加实例唯一前缀。
// ══════════════════════════════════════════════════════════════════
describe('M5 生产端口 · 多实例同上下文（真机 E+F 并行缺陷的回归锁）', () => {
  /** 模拟宿主回推（经**真全局键**——与真机同一条路） */
  const pushAnimDone = (token: string): void => {
    const g = globalThis as Record<string, unknown>
    const h = g[SCREEN_ANIM_DONE_KEY] as ((t: unknown, r?: unknown) => string) | undefined
    h?.(token, '{}')
  }

  it('两个实例的动画完成回推互不干扰（各自 token 各归其主）', async () => {
    const a = makeChannel()
    const b = makeChannel()
    const portsA = createHostScreenPorts({ invoke: a.channel })
    const portsB = createHostScreenPorts({ invoke: b.channel })

    const plan = {
      incoming: { anims: [{ nodeId: 1, from: 0, to: 100 }] },
      outgoing: { anims: [{ nodeId: 2, from: 0, to: -100 }] },
      durationMs: 200,
      opaque: false,
    } as never
    const ctx = { direction: 'forward', transition: 'slideUp' } as never

    // 两侧同时发起（真机并行形态）
    const pA = portsA.anim.playRouteTransition(plan, ctx)
    const pB = portsB.anim.playRouteTransition(plan, ctx)

    // 取出两侧各自的 token（来自各自通道的调用记录）
    const tokenA = (a.log.find((l) => l.method === 'screen.anim')!.args as { token: string }).token
    const tokenB = (b.log.find((l) => l.method === 'screen.anim')!.args as { token: string }).token
    expect(tokenA, '两实例 token 必须不同（实例前缀）').not.toBe(tokenB)

    // ★先回推 B 的（若是"后装覆盖先装"的旧实现，A 的 handler 已被覆盖 ⇒ 回推 A 无效）
    pushAnimDone(tokenB)
    pushAnimDone(tokenA)
    await Promise.all([pA, pB]) // 两侧都必须 settle（旧实现：其中一个永远 pending）
    expect(portsA.pendingAnimations).toBe(0)
    expect(portsB.pendingAnimations).toBe(0)
  })

  it('回推未知 token ⇒ 返回 unknown-token（不误伤其它实例）', () => {
    const { channel } = makeChannel()
    createHostScreenPorts({ invoke: channel })
    const g = globalThis as Record<string, unknown>
    const h = g[SCREEN_ANIM_DONE_KEY] as (t: unknown, r?: unknown) => string
    expect(h('no-such-token', '{}')).toBe('unknown-token')
    expect(h(123 as never)).toBe('bad-token')
  })
})
