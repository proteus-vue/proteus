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
