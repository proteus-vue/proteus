// tests/branch-navigator.test.ts
// ★★NB1/NB3/NB6（导航体系落地方案，2026-10-02）—— 多分支独立栈 / 保活三档 / 返回归属
//
// 【本文件证明什么（方案 §4 判据 1-7，每条一个 describe）】
//   ① 分支清单来自**统一产物**（`tabNames` + `screens`）——无第二配置源
//   ② 切分支**保留各栈**（切回栈深不变）——对照小程序"切 tab 清栈"
//   ③ 保活三档的卸载/保活行为（`none` 释放 / `active` 相邻保留 / `all` 全保活）
//   ④ `none` 档：视图销毁（unmount freeze）+ **栈状态可恢复**（frames 完整；切回重建）
//   ⑤ 返回只作用于当前分支；栈空 ⇒ 交外层（可观测信号，不静默吞掉）
//   ⑥ 深链直达分支内子页 + 序列化往返（frames 逐帧相同）
//   ⑦ 命令流按分支隔离（`branch` 标记）
import { describe, it, expect } from 'vitest'
import { createAppStack } from '../packages/router/src/app-stack'
import type { AppScreenSpec, ScreenCommand } from '../packages/router/src/app-stack'
import { createBranchNavigator, OUTER_BRANCH } from '../packages/router/src/branch-navigator'
import type { BranchCommand, BranchEvent } from '../packages/router/src/branch-navigator'

/** 屏注册表夹具（与统一产物同形：meta.isTab → tabNames；meta.branch.keepAlive → spec.keepAlive）
 *  ★模拟 auto-routes.ts 的三个投影：screens / screenNames / tabNames */
const SCREENS: Record<string, AppScreenSpec> = {
  home: { name: 'home', path: 'pages/home' },
  'home-feed': { name: 'home-feed', path: 'pages/home/feed' },
  'home-detail': { name: 'home-detail', path: 'pages/home/detail' },
  // ★mine 分支声明 keepAlive: 'none'（来自 router.pages['mine'].branch.keepAlive）
  mine: { name: 'mine', path: 'pages/mine', keepAlive: 'none' },
  'mine-settings': { name: 'mine-settings', path: 'pages/mine/settings' },
  // ★stay 分支声明 keepAlive: 'all'
  stay: { name: 'stay', path: 'pages/stay', keepAlive: 'all' },
  'stay-page': { name: 'stay-page', path: 'pages/stay/page' },
}
const TAB_NAMES = ['home', 'mine', 'stay']

function makeNav(opts?: { policy?: never }) {
  return createBranchNavigator({ screens: SCREENS, tabNames: TAB_NAMES, ...(opts ?? {}) })
}

/** 命令辅助：取出某分支的命令序列（含 op） */
function opsOf(cmds: BranchCommand[], branch: string): string[] {
  return cmds.filter((c) => c.branch === branch).map((c) => c.op)
}

describe('① 分支清单来自统一产物（tabNames + screens——无第二配置源）', () => {
  it('branches 顺序 = tabNames 顺序；keepAlive 物化（缺省 active）', () => {
    const nav = makeNav()
    expect(nav.branches.map((b) => b.name)).toEqual(['home', 'mine', 'stay'])
    expect(nav.branches.map((b) => b.keepAlive)).toEqual(['active', 'none', 'all'])
    expect(nav.branches[0]!.root).toBe('pages/home')
  })

  it('tabNames 指向未注册的屏 ⇒ 抛错（统一产物不同源 = 静默故障，必须暴露）', () => {
    expect(() => createBranchNavigator({ screens: SCREENS, tabNames: ['ghost'] })).toThrow(/不在屏注册表中/)
  })

  it('initial 不在分支清单 ⇒ 抛错（不静默回落第一个）', () => {
    expect(() => createBranchNavigator({ screens: SCREENS, tabNames: TAB_NAMES, initial: 'nope' })).toThrow(
      /不在分支清单/,
    )
  })

  it('keepAlive 非法值 ⇒ 抛错（值域是封闭集）', () => {
    expect(() =>
      createBranchNavigator({ screens: SCREENS, branches: [{ name: 'home', root: 'pages/home', keepAlive: 'forever' as never }] }),
    ).toThrow(/keepAlive/)
  })
})

describe('② 切分支保留各栈（★与小程序"切 tab 清栈"的本质差别）', () => {
  it('home push 2 层 → 切 mine → 切回 home ⇒ 栈深仍 3、栈顶不变', () => {
    const nav = makeNav()
    const home = nav.stackOf('home')
    home.push('home-feed')
    home.push('home-detail')
    expect(home.depth).toBe(3)

    nav.switchTo('mine')
    expect(nav.active()).toBe('mine')
    nav.switchTo('home')

    // ★核心断言：栈还在（小程序 switchTab 到这里会是 1）
    expect(home.depth).toBe(3)
    expect(home.current()!.name).toBe('home-detail')
    expect(nav.activeStack()).toBe(home)
  })

  it('切到未访问过的分支 ⇒ 懒建根（只有根屏，1 层）', () => {
    const nav = makeNav()
    nav.switchTo('stay')
    const stay = nav.stackOf('stay')
    expect(stay.depth).toBe(1)
    expect(stay.current()!.name).toBe('stay')
  })

  it('切到当前分支 = no-op（不发命令、seq 不动）', () => {
    const nav = makeNav()
    // ★装配后首次 drain 会拿到"初始分支建根"命令（mount+enter——执行器要靠它显示初始屏）
    nav.drainCommands()
    const events: BranchEvent[] = []
    nav.on((e) => events.push(e))
    const seq0 = nav.clock().seq
    nav.switchTo('home')
    expect(nav.clock().seq).toBe(seq0)
    expect(events).toEqual([{ type: 'switch-noop', branch: 'home' }])
    expect(nav.drainCommands()).toEqual([])
  })

  it('切换事务：旧分支 exit → 新分支 enter；clock.seq 单调递增', () => {
    const nav = makeNav()
    nav.switchTo('mine')
    const cmds = nav.drainCommands()
    // 旧分支挂起（exit），新分支可见（enter）
    expect(opsOf(cmds, 'home')).toContain('exit')
    expect(opsOf(cmds, 'mine')).toEqual(['mount', 'enter']) // 懒建根 = mount + enter
    expect(nav.clock().seq).toBe(1)
    expect(nav.clock().from).toBe('home')
    expect(nav.clock().to).toBe('mine')
  })

  it('非活跃分支栈的直接操作在下次 drain 按分支归并（命令不丢）', () => {
    const nav = makeNav()
    nav.stackOf('home').push('home-feed') // 直接操作非活跃分支的栈
    const cmds = nav.drainCommands()
    expect(opsOf(cmds, 'home')).toContain('mount') // 命令仍被收上来，带 branch 标记
    const mount = cmds.find((c) => c.op === 'mount')!
    expect(mount.branch).toBe('home')
  })
})

describe('③ 保活三档（NB3 核心）', () => {
  it('keepAlivePolicy：活跃恒 keep；none=非活跃恒 false；all=恒 true；active=相邻 true', () => {
    const nav = makeNav()
    // 活跃 home（idx 0）：mine(none)→false；stay(all)→true
    expect(nav.keepAlivePolicy()).toEqual([
      { branch: 'home', keep: true },
      { branch: 'mine', keep: false },
      { branch: 'stay', keep: true },
    ])
    // 切到 mine（idx 1）：home(active, 相邻)→true；stay(all)→true
    nav.switchTo('mine')
    expect(nav.keepAlivePolicy()).toEqual([
      { branch: 'home', keep: true },
      { branch: 'mine', keep: true },
      { branch: 'stay', keep: true },
    ])
  })

  it('active 档：切到不相邻分支时，旧分支按 none 同款释放（离开邻域才卸载）', () => {
    const nav = createBranchNavigator({
      screens: { ...SCREENS, mid: { name: 'mid', path: 'pages/mid' } },
      tabNames: ['home', 'mine', 'stay', 'mid'],
    })
    // home 与 mid 不相邻（idx 0 vs 3）⇒ 切到 mid 后 home 被释放
    const home = nav.stackOf('home')
    nav.switchTo('mid')
    expect(home.stats().frozen).toBe(1)
  })

  it('all 档：即使不相邻也不释放', () => {
    const nav = createBranchNavigator({
      screens: { ...SCREENS, mid: { name: 'mid', path: 'pages/mid' } },
      tabNames: ['home', 'mine', 'stay', 'mid'],
      branches: [
        { name: 'home', root: 'pages/home', keepAlive: 'all' },
        { name: 'mine', root: 'pages/mine', keepAlive: 'none' },
        { name: 'stay', root: 'pages/stay', keepAlive: 'all' },
        { name: 'mid', root: 'pages/mid', keepAlive: 'active' },
      ],
    })
    const home = nav.stackOf('home')
    nav.switchTo('mid')
    expect(home.stats().frozen).toBe(0) // all ⇒ 永不释放
  })
})

describe('④ none 档：视图销毁 + 栈状态可恢复（对齐 Android saveBackStack）', () => {
  it('切走 mine（none）⇒ unmount(reason=freeze)；栈状态仍完整可读（frames 含全部）', () => {
    const nav = makeNav()
    nav.switchTo('mine')
    const mine = nav.stackOf('mine')
    mine.push('mine-settings')
    expect(mine.depth).toBe(2)

    nav.switchTo('home')
    const cmds = nav.drainCommands()
    // 视图销毁（freeze——执行器无需新 op；栈位保留）
    const unmounts = cmds.filter((c) => c.branch === 'mine' && c.op === 'unmount')
    expect(unmounts.length).toBe(2)
    for (const u of unmounts) expect((u as Extract<ScreenCommand, { op: 'unmount' }>).reason).toBe('freeze')
    // ★栈状态可恢复：深度/顺序/params 全在（这与"清栈"的本质区别）
    expect(mine.depth).toBe(2)
    expect(mine.frames()).toEqual([{ name: 'mine' }, { name: 'mine-settings' }])
    expect(mine.stats().frozen).toBe(2)
  })

  it('切回 mine ⇒ mount(rebuild=true) + enter（重建——内容从栈状态恢复）', () => {
    const nav = makeNav()
    nav.switchTo('mine')
    nav.stackOf('mine').push('mine-settings')
    nav.switchTo('home')
    nav.drainCommands() // 丢掉释放命令

    nav.switchTo('mine')
    const cmds = nav.drainCommands()
    const mounts = cmds.filter((c) => c.branch === 'mine' && c.op === 'mount')
    expect(mounts.length).toBe(1)
    const mount = mounts[0] as Extract<ScreenCommand, { op: 'mount' }>
    expect(mount.rebuild, '释放后切回 = 重建（rebuild=true）').toBe(true)
    expect(mount.name).toBe('mine-settings') // 恢复的是原栈顶，不是根屏
    expect(opsOf(cmds, 'mine')).toContain('enter')
    expect(nav.stackOf('mine').depth).toBe(2)
  })

  it('e2e：同一分支两轮"切走-切回"后栈帧逐帧相同（状态不丢）', () => {
    const nav = makeNav()
    nav.switchTo('mine')
    const mine = nav.stackOf('mine')
    mine.push('mine-settings', { tab: 'profile' })
    const before = mine.frames()

    nav.switchTo('home')
    nav.drainCommands()
    nav.switchTo('mine')
    nav.drainCommands()
    nav.switchTo('home')
    nav.drainCommands()
    nav.switchTo('mine')
    nav.drainCommands()

    expect(mine.frames()).toEqual(before)
  })
})

describe('⑤ 返回归属（NB6：只作用于活跃分支；到根交外层——不静默）', () => {
  it('back() 在 home 上 pop，不影响 mine 的栈（机器可验证）', () => {
    const nav = makeNav()
    nav.stackOf('home').push('home-feed')
    nav.switchTo('mine')
    nav.stackOf('mine').push('mine-settings')

    nav.switchTo('home')
    const depthMineBefore = nav.stackOf('mine').depth
    const out = nav.back()
    expect(out).toMatchObject({ action: 'pop', branch: 'home' })
    expect(nav.stackOf('home').depth).toBe(1)
    expect(nav.stackOf('mine').depth).toBe(depthMineBefore) // ← 另一分支分毫未动
  })

  it('分支到根后 back() ⇒ { action: "system" }（无外层）——可观测，不静默吞掉', () => {
    const nav = makeNav()
    const events: BranchEvent[] = []
    nav.on((e) => events.push(e))
    const out = nav.back()
    expect(out).toEqual({ action: 'system' })
    expect(events.map((e) => e.type)).toEqual(['back-outer', 'back-system'])
  })

  it('给了 parent（外层 RootStack）：到根 back() ⇒ pop 外层一层 + action="outer"', () => {
    const parent = createAppStack({ screens: SCREENS })
    parent.push('home-feed') // 外层 1 层（栈深 1——pop 保底不弹空；此时 depth=1 表示"还有 1 层"）
    parent.push('home-detail') // 外层 2 层
    const nav = createBranchNavigator({ screens: SCREENS, tabNames: TAB_NAMES, parent })
    const out = nav.back() // home 分支仅根屏
    expect(out).toEqual({ action: 'outer', branch: 'home' })
    expect(parent.depth).toBe(1) // 外层被 pop 了一层
    const cmds = nav.drainCommands()
    expect(opsOf(cmds, OUTER_BRANCH).length).toBeGreaterThan(0) // 外层命令带独立标签
  })

  it('parent 传某分支的栈 = 调用方错误（本层不拦截；正确用法是独立实例——文档化边界）', () => {
    // ★设计取舍（写进用例防误读）：构造期无法区分"parent 是别的 navigator 的栈"还是"本 navigator 的栈"
    //   （栈实例由本函数内部创建）——与其做只能拦住一部分的假校验，不如在选项文档里写明"应当是独立实例"。
    //   本用例证明：传了某种栈也不会崩（行为可解释：到根时按 parent.depth 决定 outer/system）。
    const nav0 = createBranchNavigator({ screens: SCREENS, tabNames: TAB_NAMES })
    const nav1 = createBranchNavigator({ screens: SCREENS, tabNames: TAB_NAMES, parent: nav0.stackOf('home') })
    expect(nav1.back()).toEqual({ action: 'system' }) // nav0 的 home 只有根 1 层 ⇒ 交系统（不硬 pop）
  })

  it('back(delta>1) 夹在分支内（弹到根为止）；再次 back() 才交外层', () => {
    const nav = makeNav()
    nav.stackOf('home').push('home-feed')
    nav.stackOf('home').push('home-detail')
    const out = nav.back(5) // 一次调用不"穿透"到外层——弹到根就停
    expect(out).toMatchObject({ action: 'pop', popped: 'home-detail' })
    expect(nav.stackOf('home').depth).toBe(1) // 夹到根（不会弹空）
    expect(nav.back()).toEqual({ action: 'system' }) // 再次 back ⇒ 到根，交外层
  })
})

describe('⑥ 深链直达分支内子页 + 序列化往返（NB2 核心，判据 6/7）', () => {
  it('navigate(branch, frames)：重建该分支栈（分支根在栈底）', () => {
    const nav = makeNav()
    nav.navigate('home', [{ name: 'home' }, { name: 'home-feed' }, { name: 'home-detail', params: { id: '9' } }])
    const home = nav.stackOf('home')
    expect(home.depth).toBe(3)
    expect(home.frames()).toEqual([
      { name: 'home' },
      { name: 'home-feed' },
      { name: 'home-detail', params: { id: '9' } },
    ])
    // ★不改变活跃分支（home 本来就是活跃；换个分支试）
    nav.navigate('mine', [{ name: 'mine' }, { name: 'mine-settings' }])
    expect(nav.active()).toBe('home')
  })

  it('深链 frames 缺分支根 ⇒ 自动补根（分支不变式：根永远在栈底）', () => {
    const nav = makeNav()
    nav.navigate('home', [{ name: 'home-detail' }])
    expect(nav.stackOf('home').frames()[0]).toEqual({ name: 'home' })
  })

  it('深链 frames 为空 ⇒ 单根（不是空栈）', () => {
    const nav = makeNav()
    nav.navigate('mine', [])
    expect(nav.stackOf('mine').frames()).toEqual([{ name: 'mine' }])
  })

  it('快照往返：snapshot() → 新 navigator 的 navigate() ⇒ 帧逐帧相同', () => {
    const nav = makeNav()
    nav.navigate('home', [{ name: 'home' }, { name: 'home-feed' }, { name: 'home-detail', params: { id: '3' } }])
    const snap = nav.snapshot()
    expect(snap.active).toBe('home')

    const nav2 = makeNav()
    nav2.navigate(snap.active, snap.frames)
    expect(nav2.snapshot()).toEqual(snap)
  })

  it('深链直达 mine 子页后：back 回 mine-settings→mine；到根交外层（该分支自己的栈）', () => {
    const nav = makeNav()
    nav.navigate('mine', [{ name: 'mine' }, { name: 'mine-settings' }])
    nav.switchTo('mine')
    expect(nav.back()).toMatchObject({ action: 'pop', popped: 'mine-settings' })
    expect(nav.back()).toEqual({ action: 'system' }) // mine 到根（无外层）
  })
})

describe('⑦ 命令流按分支隔离 + 事件账（判据：执行器无需猜）', () => {
  it('每条命令都有 branch 字段；外层命令标 OUTER_BRANCH', () => {
    const parent = createAppStack({ screens: SCREENS })
    parent.push('home-feed')
    const nav = createBranchNavigator({ screens: SCREENS, tabNames: TAB_NAMES, parent })
    nav.switchTo('mine')
    nav.back() // 交外层时 parent pop
    const cmds = nav.drainCommands()
    for (const c of cmds) expect(typeof c.branch).toBe('string')
    expect(cmds.some((c) => c.branch === OUTER_BRANCH)).toBe(true)
  })

  it('switch 事件带 seq；back-system 只在无外层（或外层也到根）时出现', () => {
    const withParent = createBranchNavigator({
      screens: SCREENS,
      tabNames: TAB_NAMES,
      parent: (() => {
        const p = createAppStack({ screens: SCREENS })
        p.push('home-feed')
        p.push('home-detail') // 外层 2 层（可被 pop）
        return p
      })(),
    })
    const ev1: BranchEvent[] = []
    withParent.on((e) => ev1.push(e))
    withParent.back()
    expect(ev1.some((e) => e.type === 'back-outer')).toBe(true)
    expect(ev1.some((e) => e.type === 'back-system')).toBe(false) // 有外层可退 ⇒ 不报 system

    const noParent = makeNav()
    const ev2: BranchEvent[] = []
    noParent.on((e) => ev2.push(e))
    noParent.switchTo('mine')
    const s = ev2.find((e) => e.type === 'switch') as Extract<BranchEvent, { type: 'switch' }>
    expect(s.seq).toBe(1)
    noParent.back()
    expect(ev2.some((e) => e.type === 'back-system')).toBe(true)
  })

  it('activeStack()/stackOf() 指向同一实例；未知分支抛错（不静默返回空栈）', () => {
    const nav = makeNav()
    expect(nav.activeStack()).toBe(nav.stackOf('home'))
    expect(() => nav.stackOf('ghost')).toThrow(/未知分支/)
  })
})
