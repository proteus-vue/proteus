// tests/screen-executor.test.ts
// ★★M5 虚拟栈宿主执行器 —— 编排判据（命令序 / 方向推导 / 销毁时机 / 空规格 / 并发串行）
//
// 【被测对象与端口】被测 = `createScreenExecutor`（编排层，零平台依赖）。
//   上游用**真栈**（`createAppStack`——真实命令流，不是手写命令），
//   规划器用**真 animation 包**（`routeTransitionBatches`——真实批次/镜像对），
//   端口用记录桩（记录调用序列与参数——本文件的主要断言对象）。
//   ⇒ 整条链 `push() → 命令流 → 执行器 → 树操作 + 转场批次` 都是真实现，
//     只有两个端口（树/动画）是桩——它们正是"宿主侧"的边界（真机由 Host ABI 实现）。
import { describe, it, expect } from 'vitest'
import { createAppStack } from '@proteus-vue/router/app-stack'
import { routeTransitionBatches } from '@proteus-vue/animation'
import { createScreenExecutor } from '@proteus-vue/render-backend'
import type { ScreenTreeHost, ScreenAnimHost, ScreenCommandLike, RouteTransitionPlanLike } from '@proteus-vue/render-backend'
import type { AppScreenSpec } from '@proteus-vue/router/app-stack'

const SPECS: Record<string, AppScreenSpec> = {
  home: { name: 'home', path: '/home', transition: 'slideUp' },
  detail: { name: 'detail', path: '/detail', transition: 'slideUp' },
  third: { name: 'third', path: '/third', transition: 'halfScreen' },
}

/** 记录桩：树操作端口（记录调用序 + 返回递增 nodeId） */
function makeTreeHost() {
  const log: string[] = []
  let nextNode = 100
  const nodes = new Map<string, number>()
  const visible = new Map<string, boolean>()
  const host: ScreenTreeHost = {
    mountScreen(s) {
      const node = nextNode++
      nodes.set(s.screenId, node)
      visible.set(s.screenId, false)
      log.push(`mount:${s.screenId}:rebuild=${s.rebuild}:node=${node}`)
      return node
    },
    setScreenVisible(screenId, v, root) {
      visible.set(screenId, v)
      log.push(`visible:${screenId}:${v}:node=${root}`)
    },
    destroyScreen(screenId, reason, root) {
      nodes.delete(screenId)
      log.push(`destroy:${screenId}:${reason}:node=${root}`)
    },
  }
  return { host, log, nodes, visible }
}

/** 记录桩：动画端口（记录批次；可手动控制"何时播完"——用于验证销毁时机） */
function makeAnimHost() {
  const plays: Array<{ plan: RouteTransitionPlanLike; direction: string; transition: string; done: () => void }> = []
  const log: string[] = []
  let manual = false
  const host: ScreenAnimHost = {
    playRouteTransition(plan, ctx) {
      log.push(`play:${ctx.direction}:${ctx.transition}:in=${plan.incoming.anims.length}:out=${plan.outgoing.anims.length}`)
      if (!manual) return // 同步完成
      return new Promise<void>((resolve) => {
        plays.push({ plan, direction: ctx.direction, transition: ctx.transition, done: resolve })
      })
    },
  }
  return {
    host,
    log,
    plays,
    setManual(v: boolean) {
      manual = v
    },
  }
}

function makeStack() {
  return createAppStack({ screens: SPECS, policy: { keepWindow: 3 } })
}

/** 建执行器（真栈 + 真规划器 + 记录桩） */
function build() {
  const stack = makeStack()
  const tree = makeTreeHost()
  const anim = makeAnimHost()
  const rebuilt: string[] = []
  const executor = createScreenExecutor({
    host: tree.host,
    anim: anim.host,
    plan: (t, targets, o) => routeTransitionBatches(t, targets, o),
    onScreenMounted: (id, rebuild) => {
      rebuilt.push(`${id}:${rebuild}`)
      stack.markRebuilt(id)
    },
  })
  stack.push('home') // ★栈从空开始（与 app-stack.test.ts 同法：首屏由 push 建立）
  return { stack, tree, anim, executor, rebuilt }
}

/** 跑一轮：栈操作 → drain → 执行器消费（与真实帧循环同形） */
async function pump(ctx: ReturnType<typeof build>) {
  await ctx.executor.applyCommands(ctx.stack.drainCommands() as ScreenCommandLike[])
}

/** manual 模式下启动一轮（不等待——转场挂起中）；调用方稍后 done() 再 await */
function pumpNoWait(ctx: ReturnType<typeof build>): Promise<void> {
  return ctx.executor.applyCommands(ctx.stack.drainCommands() as ScreenCommandLike[])
}

/** 让微任务/队列推进（等待挂起 promise 之外的调度完成） */
const tick = () => new Promise((r) => setTimeout(r, 0))

/** 屏真实 screenId（形如 `home#1`——带实例序号；从栈取，不硬编码） */
function idOf(stack: ReturnType<typeof makeStack>, name: string): string {
  const r = stack.stack.find((x) => x.name === name)
  if (!r) throw new Error(`栈里没有屏 ${name}`)
  return r.screenId
}

describe('M5 执行器 · 命令序与树操作', () => {
  it('首屏：mount → enter ⇒ 先建子树、再置可见、无 outgoing 转场', async () => {
    const ctx = build()
    await pump(ctx) // 首屏 push 产生 mount+enter
    const home = idOf(ctx.stack, 'home')
    expect(ctx.tree.log).toEqual([`mount:${home}:rebuild=false:node=100`, `visible:${home}:true:node=100`])
    // 首屏是 forward（mount 新内容）且无 outgoing
    expect(ctx.anim.log).toEqual(['play:forward:slideUp:in=1:out=0'])
    expect(ctx.rebuilt).toEqual([`${home}:false`])
    const s = ctx.executor.stats()
    expect(s.transitions).toBe(1)
    expect(s.forward).toBe(1)
    expect(s.mounts).toEqual({ first: 1, rebuild: 0 })
  })

  it('push：exit(旧顶) → mount(新) → enter ⇒ 旧页转场后**隐藏**（树保留，不销毁）', async () => {
    const ctx = build()
    await pump(ctx)
    ctx.tree.log.length = 0
    ctx.anim.log.length = 0
    ctx.stack.push('detail')
    await pump(ctx)
    // 顺序：mount 新子树 → 新页可见 → play（两页批次）→ 旧页隐藏
    const home = idOf(ctx.stack, 'home')
    const detail = idOf(ctx.stack, 'detail')
    expect(ctx.tree.log).toEqual([
      `mount:${detail}:rebuild=false:node=101`,
      `visible:${detail}:true:node=101`,
      `visible:${home}:false:node=100`,
    ])
    expect(ctx.anim.log).toEqual(['play:forward:slideUp:in=1:out=2']) // slideUp 的 exit = 位移+淡出两条
    const s = ctx.executor.stats()
    expect(s.forward).toBe(2)
    expect(s.visibility).toEqual({ shown: 2, hidden: 1 })
  })

  it('pop：exit → unmount → enter ⇒ 方向 back、旧顶**转场播完后**销毁（不中途闪断）', async () => {
    const ctx = build()
    await pump(ctx)
    ctx.stack.push('detail')
    await pump(ctx)
    // 之后手动控制动画完成时机，验证销毁挂起到转场播完之后
    const detailId = idOf(ctx.stack, 'detail')
    ctx.anim.setManual(true)
    ctx.tree.log.length = 0
    ctx.stack.pop()
    const p1 = pumpNoWait(ctx)
    await tick()
    // 转场未播完：旧顶**不能**被销毁（此时只应有 incoming 可见 + 两次播放等待）
    expect(ctx.tree.log.filter((l) => l.startsWith('destroy'))).toEqual([])
    expect(ctx.anim.plays.length).toBe(1)
    expect(ctx.anim.plays[0].direction).toBe('back')
    // back：incoming = reverse(exit)（下层页视差复位，2 条）；outgoing = reverse(enter)（旧顶滑出，1 条）
    expect(ctx.anim.plays[0].plan.incoming.anims.length).toBe(2)
    expect(ctx.anim.plays[0].plan.outgoing.anims.length).toBe(1)
    // 关键：reverse(enter) 的 800→0 反向 = 0→800（旧顶向下滑出）
    const outAnim = ctx.anim.plays[0].plan.outgoing.anims[0] as { from: number; to: number }
    expect({ from: outAnim.from, to: outAnim.to }).toEqual({ from: 0, to: 800 })
    // 播完 → 旧顶销毁
    ctx.anim.plays[0].done()
    await p1
    expect(ctx.tree.log).toContain(`destroy:${detailId}:pop:node=101`)
    expect(ctx.executor.stats().back).toBe(1)
    expect(ctx.executor.stats().destroyed.pop).toBe(1)
  })

  it('replace：exit → unmount → mount → enter ⇒ forward（新内容到来）+ 旧顶销毁', async () => {
    const ctx = build()
    await pump(ctx)
    const homeId = idOf(ctx.stack, 'home')
    ctx.anim.log.length = 0 // ★清首屏的 play（否则断言混入上一轮）
    ctx.stack.replace('detail')
    await pump(ctx)
    expect(ctx.anim.log).toEqual(['play:forward:slideUp:in=1:out=2'])
    expect(ctx.tree.log).toContain(`destroy:${homeId}:pop:node=100`)
    expect(ctx.executor.stats().mounts.first).toBe(2)
  })

  it('reset（tab 语义）：静默销毁旧屏 → mount → enter ⇒ forward、无 outgoing', async () => {
    const ctx = build()
    await pump(ctx)
    ctx.stack.push('detail')
    await pump(ctx)
    const home = idOf(ctx.stack, 'home')
    const detail = idOf(ctx.stack, 'detail')
    ctx.anim.log.length = 0
    ctx.tree.log.length = 0
    ctx.stack.reset('third')
    await pump(ctx)
    const third = idOf(ctx.stack, 'third')
    // 旧屏销毁是"隐藏态静默销毁"（无 exit 标记 ⇒ 立即销毁，不走转场挂起）
    // ★顺序 = 栈顶优先（`resetTo` 的 `while (stack.length) pop()`——后进先出）
    expect(ctx.tree.log).toEqual([
      `destroy:${detail}:reset:node=101`,
      `destroy:${home}:reset:node=100`,
      `mount:${third}:rebuild=false:node=102`,
      `visible:${third}:true:node=102`,
    ])
    // halfScreen：只动进场页 ⇒ in=1:out=0
    expect(ctx.anim.log).toEqual(['play:forward:halfScreen:in=1:out=0'])
  })

  it('★冻结：push 后的 unmount(freeze) 立即销毁（不挂起、不参与转场）', async () => {
    const stack = createAppStack({ screens: SPECS, policy: { keepWindow: 1, nodeBudget: 10 } })
    const tree = makeTreeHost()
    const anim = makeAnimHost()
    const executor = createScreenExecutor({
      host: tree.host,
      anim: anim.host,
      plan: (t, targets, o) => routeTransitionBatches(t, targets, o),
      onScreenMounted: (id) => stack.markRebuilt(id),
    })
    stack.push('home') // ★栈从空开始（同 app-stack.test.ts 的用法）
    await executor.applyCommands(stack.drainCommands() as ScreenCommandLike[])
    tree.log.length = 0
    stack.push('detail')
    stack.push('third')
    await executor.applyCommands(stack.drainCommands() as ScreenCommandLike[])
    // 冻结命令（超出预算、keepWindow 保护下的最旧隐藏屏）走"立即销毁 + reason=freeze"
    // ★两次 push 各冻结一个（keepWindow=1、预算 10）：push detail 冻 home；push third 冻 detail
    //   ——与栈 stats().freezeCount=2 一致（执行器不重复计数、也不漏计）
    expect(tree.log.some((l) => l.startsWith('destroy:home#') && l.endsWith(':freeze:node=100'))).toBe(true)
    expect(tree.log.some((l) => l.startsWith('destroy:detail#') && l.endsWith(':freeze:node=101'))).toBe(true)
    expect(executor.stats().destroyed.freeze).toBe(2)
  })
})

describe('M5 执行器 · 方向推导（镜像对）', () => {
  it('★push.forward.incoming 的 from/to 恰是 pop.back.outgoing 的 to/from（方向语义互逆）', async () => {
    const ctx = build()
    await pump(ctx)
    ctx.anim.setManual(true)
    ctx.stack.push('detail')
    const p1 = pumpNoWait(ctx)
    await tick()
    const fwdPlan = ctx.anim.plays[0].plan
    ctx.anim.plays[0].done()
    await p1
    ctx.stack.pop()
    const p2 = pumpNoWait(ctx)
    await tick()
    const backPlan = ctx.anim.plays[ctx.anim.plays.length - 1].plan
    ctx.anim.plays[ctx.anim.plays.length - 1].done()
    await p2
    const fe = fwdPlan.incoming.anims[0] as { nodeId: number; from: number; to: number }
    const bo = backPlan.outgoing.anims[0] as { nodeId: number; from: number; to: number }
    expect(fe.nodeId).toBe(bo.nodeId) // 同一个屏子树
    expect({ from: bo.from, to: bo.to }).toEqual({ from: fe.to, to: fe.from })
  })

  it('★into-frozen 回程（mount rebuild=true）⇒ back（回程语义，不是 push）', async () => {
    const stack = createAppStack({ screens: SPECS, policy: { keepWindow: 1, nodeBudget: 10 } })
    const tree = makeTreeHost()
    const anim = makeAnimHost()
    anim.setManual(true)
    const rebuiltFlags: boolean[] = []
    const executor = createScreenExecutor({
      host: tree.host,
      anim: anim.host,
      plan: (t, targets, o) => routeTransitionBatches(t, targets, o),
      onScreenMounted: (id, rebuild) => {
        rebuiltFlags.push(rebuild)
        stack.markRebuilt(id)
      },
    })
    stack.push('home')
    const run = () => executor.applyCommands(stack.drainCommands() as ScreenCommandLike[])
    let pending = run()
    await tick()
    anim.plays.at(-1)?.done()
    await pending
    stack.push('detail')
    pending = run()
    await tick()
    anim.plays.at(-1)?.done()
    await pending
    // 现在 home 已被冻结（budget 10、keepWindow 1、push detail 后 home 是最旧 hidden）
    expect([...tree.nodes.keys()].some((k) => k.startsWith('home#'))).toBe(false)
    stack.pop() // 回程 → activateTop 走 rebuild 分支
    pending = run()
    await tick()
    const last = anim.plays[anim.plays.length - 1]
    expect(last.direction).toBe('back')
    expect(rebuiltFlags[rebuiltFlags.length - 1]).toBe(true)
    expect(executor.stats().mounts.rebuild).toBe(1)
    last.done()
    await pending
  })
})

describe('M5 执行器 · 边界与并发', () => {
  it('none 转场：空批次 ⇒ 跳过 play（不浪费跨边界调用），但可见性照常切换', async () => {
    const noneSpecs: Record<string, AppScreenSpec> = {
      a: { name: 'a', path: '/a', transition: 'none' },
      b: { name: 'b', path: '/b', transition: 'none' },
    }
    const stack = createAppStack({ screens: noneSpecs, policy: { keepWindow: 1 } })
    const tree = makeTreeHost()
    const anim = makeAnimHost()
    const executor = createScreenExecutor({
      host: tree.host,
      anim: anim.host,
      plan: (t, targets, o) => routeTransitionBatches(t, targets, o),
      onScreenMounted: (id) => stack.markRebuilt(id),
    })
    stack.push('a')
    await executor.applyCommands(stack.drainCommands() as ScreenCommandLike[])
    stack.push('b')
    await executor.applyCommands(stack.drainCommands() as ScreenCommandLike[])
    expect(anim.log).toEqual([]) // 一次 play 都没有
    expect(executor.stats().skippedNone).toBe(2)
    void 0
    expect(tree.log).toContain(`visible:${idOf(stack, 'b')}:true:node=101`)
    expect(tree.log).toContain(`visible:${idOf(stack, 'a')}:false:node=100`)
  })

  it('并发 applyCommands：按调用序串行（不会两批命令交错）', async () => {
    const ctx = build()
    await pump(ctx)
    ctx.anim.setManual(true)
    ctx.tree.log.length = 0
    ctx.stack.push('detail')
    const detailId = idOf(ctx.stack, 'detail') // ★pop 之后栈里就没有它了——提前取
    const p1 = pumpNoWait(ctx)
    // 第二批在第一批转场未完成时到达
    ctx.stack.pop()
    const p2 = pumpNoWait(ctx)
    await tick()
    // 第一批仍在等转场 ⇒ 第二批的树操作还没开始（mount 不会插队）
    const beforeDone = ctx.tree.log.slice()
    expect(beforeDone).toEqual([
      `mount:${detailId}:rebuild=false:node=101`,
      `visible:${detailId}:true:node=101`,
    ])
    ctx.anim.plays[0].done()
    await p1
    await tick()
    // 第一批完成后第二批才开始播它自己的转场（串行语义的直接体现）——也要放行
    expect(ctx.anim.plays.length).toBe(2)
    expect(ctx.anim.plays[1].direction).toBe('back')
    ctx.anim.plays[1].done()
    await p2
    expect(ctx.executor.stats().commands).toBeGreaterThan(3)
  })

  it('enter 无子树 ⇒ 记为错误（不静默）', async () => {
    const tree = makeTreeHost()
    const anim = makeAnimHost()
    const executor = createScreenExecutor({
      host: tree.host,
      anim: anim.host,
      plan: (t, targets, o) => routeTransitionBatches(t, targets, o),
    })
    await executor.applyCommands([{ op: 'enter', screenId: 'ghost', transition: 'slideUp' }])
    expect(executor.stats().errors).toHaveLength(1)
    expect(executor.stats().errors[0]).toContain('ghost')
  })
})
