// tests/app-stack.test.ts
// ★★M5（App 端路由）：虚拟路由栈核心 + App codegen
//
// 验收（对齐用户决策「吸取小程序和 uni-app 的路由栈数量限制的经验教训…必须高性能，
// 可以参考 Flutter」）：
//   ① **无层数上限**：100 层 push/pop 全成功（小程序第 11 层 navigateTo 直接失败 ⇒ 这是核心差异）
//   ② **内存有界靠预算而非层数**：超预算冻结最旧 hidden 屏（keepWindow 保护栈顶）；返回冻结屏 = 重建
//   ③ **退场屏树保留**：普通 push 不产生 unmount（栈内屏 display:none，返程保状态）
//   ④ **栈语义**（与 M7 三端指令表一致）：push / pop / replace / popTo / popToRoot / reset(tab)
//   ⑤ **声明式 navigate**：公共前缀 diff → 最小操作集（多端 stack-diff 同源模型）
//   ⑥ **命令流**：执行器契约（mount/enter/exit/unmount 配对 + freeze 重建标记）
//   ⑦ **codegen/app.ts**：RouteNode[] → 屏注册表 + 嵌套栈聚合 + 转场枚举原样携带
import { describe, it, expect } from 'vitest'
import { createAppStack } from '../packages/router/src/app-stack'
import type { AppScreenSpec, ScreenCommand } from '../packages/router/src/app-stack'
import { generateAppScreens, toScreenEntry, flattenScreenEntries, tabStacks } from '../packages/router/src/codegen/app'
import { computeRoutePatch, applyRoutePatch } from '../packages/router/src/stack-diff'
import type { RouteNode } from '../packages/router/src/types'

function node(partial: Partial<RouteNode> & { path: string }): RouteNode {
  return {
    loc: { file: 'x.vue', line: 1, column: 1 },
    meta: {},
    lazy: true,
    componentPath: `/abs${partial.path}.vue`,
    children: [],
    ...partial,
  }
}

const SPECS: Record<string, AppScreenSpec> = {
  home: { name: 'home', path: '/home', transition: 'slideUp' },
  user: { name: 'user', path: '/user' },
  detail: { name: 'detail', path: '/detail' },
  settings: { name: 'settings', path: '/settings' },
  profile: { name: 'profile', path: '/profile', budgetNodes: 100 },
}

/** 命令流断言辅助：取出某屏的命令序列 */
function opsFor(cmds: ScreenCommand[], screenId: string): string[] {
  return cmds.filter((c) => c.screenId === screenId).map((c) => c.op)
}

describe('① 无层数上限（★与小程序/uni-app 的核心差异）', () => {
  it('100 层 push 全部成功 + 栈深 = 100 + 无任何截断/拒绝', () => {
    const s = createAppStack({ screens: SPECS })
    s.push('home')
    for (let i = 0; i < 99; i++) s.push('detail', { i })
    expect(s.depth).toBe(100)
    expect(s.current()!.name).toBe('detail')
    // 栈内每屏都是同层（无嵌套包装），且都在栈里
    expect(s.stack).toHaveLength(100)
  })

  it('100 层后 pop 回根：逐层返回且栈深回归 1', () => {
    const s = createAppStack({ screens: SPECS })
    s.push('home')
    for (let i = 0; i < 99; i++) s.push('detail', { i })
    for (let i = 0; i < 99; i++) s.pop()
    expect(s.depth).toBe(1)
    expect(s.current()!.name).toBe('home')
  })

  it('popToRoot 在 100 层下一条命令完成（无 pop 循环成本）', () => {
    const s = createAppStack({ screens: SPECS })
    s.push('home')
    for (let i = 0; i < 99; i++) s.push('detail', { i })
    s.drainCommands()
    s.popToRoot()
    expect(s.depth).toBe(1)
    const cmds = s.drainCommands()
    // 仅一条 exit（原栈顶）+ 99 条 unmount + 1 条 enter（回到 root）
    expect(cmds.filter((c) => c.op === 'exit')).toHaveLength(1)
    expect(cmds.filter((c) => c.op === 'unmount')).toHaveLength(99)
    expect(cmds.filter((c) => c.op === 'enter')).toHaveLength(1)
  })
})

describe('② 内存有界（预算冻结，替代层数上限）', () => {
  it('★性能回归判据：栈操作 O(1)（100k push < 3s；O(n²) 实现会是分钟级）', () => {
    const s = createAppStack({ screens: SPECS })
    const t0 = Date.now()
    for (let i = 0; i < 100_000; i++) s.push(i % 2 ? 'detail' : 'user', { i })
    const pushMs = Date.now() - t0
    expect(s.depth).toBe(100_000)
    // 3 秒上界：本机实测 ~60ms（10 倍余量）；退化为逐屏扫描（O(depth) 每次）会到分钟级 ⇒ 必红
    expect(pushMs).toBeLessThan(3000)
  })

  it('★性能回归判据：预算路径冻结也 O(1) 均摊（50k push 含近 5 万次冻结 < 1s）', () => {
    // 阈值标定（Node 22 实测）：O(1) = 33ms；退化为逐屏扫描 = 2748ms（82×）⇒ 1000ms 判据安全可判
    const s = createAppStack({ screens: SPECS, policy: { nodeBudget: 1000, keepWindow: 3, defaultScreenNodes: 64 } })
    const t0 = Date.now()
    for (let i = 0; i < 50_000; i++) s.push('detail', { i })
    const ms = Date.now() - t0
    const st = s.stats()
    expect(s.depth).toBe(50_000)
    expect(st.frozen).toBeGreaterThan(49_000) // 几乎全部被冻结
    expect(st.activeNodes).toBeLessThanOrEqual(1000) // 预算被守住
    expect(ms).toBeLessThan(1000)
  })
  it('超预算 → 冻结最旧 hidden 屏；栈顶 keepWindow 层不动', () => {
    // budget = 250；每屏默认 64（profile 100）
    const s = createAppStack({ screens: SPECS, policy: { nodeBudget: 250, keepWindow: 2, defaultScreenNodes: 64 } })
    s.push('home') // 64
    s.push('user') // 128
    s.push('detail') // 192
    s.push('settings') // 256 > 250 ⇒ 冻结栈底 home（剩余 192）
    const st = s.stats()
    expect(st.depth).toBe(4)
    expect(st.frozen).toBe(1)
    expect(st.activeNodes).toBe(192)
    expect(st.overBudget).toBe(false)
    // 冻结的是最旧的（栈底）
    expect(s.stack[0].state).toBe('frozen')
    expect(s.stack[0].name).toBe('home')
    // keepWindow=2 保护：栈顶两层（settings/detail）不被冻结
    expect(s.stack[2].state).toBe('hidden')
    expect(s.stack[3].state).toBe('mounted')
  })

  it('返回冻结屏 → 重建命令（mount rebuild=true + markRebuilt 清标记）', () => {
    const s = createAppStack({ screens: SPECS, policy: { nodeBudget: 100, keepWindow: 1, defaultScreenNodes: 64 } })
    s.push('home')
    s.push('user') // 128 > 100 ⇒ 冻结 home（栈底；keepWindow 只保护 user）
    expect(s.stack[0].state).toBe('frozen')
    s.drainCommands()
    s.pop() // 回 home → 重建
    const cmds = s.drainCommands()
    const mount = cmds.find((c) => c.op === 'mount')
    expect(mount).toBeDefined()
    expect(mount!.op === 'mount' && mount!.rebuild).toBe(true)
    expect(mount!.screenId).toBe(s.current()!.screenId)
    expect(s.current()!.needsRebuild).toBe(true)
    s.markRebuilt(s.current()!.screenId)
    expect(s.current()!.needsRebuild).toBe(false)
    expect(s.stats().rebuildCount).toBe(1)
  })

  it('冻结永不触及可见屏：持续 push 到超预算，当前屏始终 mounted', () => {
    const s = createAppStack({ screens: SPECS, policy: { nodeBudget: 128, keepWindow: 1, defaultScreenNodes: 64 } })
    for (let i = 0; i < 20; i++) {
      s.push('detail', { i })
      expect(s.current()!.state).toBe('mounted')
    }
    expect(s.stats().depth).toBe(20)
    // 预算 128 / 每屏 64 ⇒ 活跃 ≤ 128（栈顶 1 屏 + 最多 1 屏 hidden）
    expect(s.stats().activeNodes).toBeLessThanOrEqual(128)
    expect(s.stats().overBudget).toBe(false)
  })

  it('尽力冻结仍超预算 → overBudget 可观测（不静默）', () => {
    // 单屏 100 > 预算 50；栈顶永不动 ⇒ 必然 overBudget（诚实暴露）
    const s = createAppStack({ screens: { ...SPECS, huge: { name: 'huge', path: '/huge', budgetNodes: 100 } }, policy: { nodeBudget: 50, keepWindow: 1 } })
    const events: string[] = []
    s.on((e) => events.push(e.type))
    s.push('huge')
    expect(s.stats().overBudget).toBe(true)
    expect(events).toContain('over-budget')
  })

  it('缺省 nodeBudget=null ⇒ 不冻结（全栈保状态——对齐原生 App 预期）', () => {
    const s = createAppStack({ screens: SPECS })
    for (let i = 0; i < 30; i++) s.push('detail', { i })
    const st = s.stats()
    expect(st.frozen).toBe(0)
    expect(st.hidden).toBe(29)
    expect(st.nodeBudget).toBeNull()
  })
})

describe('③ 退场屏树保留（display:none——返程保状态）', () => {
  it('push 不产生 unmount（栈内屏保留）；exit 携带新屏声明的转场', () => {
    const s = createAppStack({ screens: SPECS })
    s.push('home')
    s.drainCommands()
    s.push('user', undefined, { transition: 'halfScreen' })
    const cmds = s.drainCommands()
    expect(cmds.some((c) => c.op === 'unmount')).toBe(false) // ★树保留
    const exit = cmds.find((c) => c.op === 'exit')
    expect(exit!.op === 'exit' && exit!.transition).toBe('halfScreen')
    expect(s.stack[0].state).toBe('hidden') // 旧顶隐藏而非销毁
  })

  it('pop 时被弹屏 unmount（reason=pop）+ 新顶 enter', () => {
    const s = createAppStack({ screens: SPECS })
    s.push('home')
    s.push('user')
    s.drainCommands()
    s.pop()
    const cmds = s.drainCommands()
    const un = cmds.find((c) => c.op === 'unmount')
    expect(un!.op === 'unmount' && un!.reason).toBe('pop')
    expect(cmds.filter((c) => c.op === 'enter')).toHaveLength(1)
    expect(s.depth).toBe(1)
  })
})

describe('④ 栈语义（对齐 M7 三端指令表）', () => {
  it('replace：旧顶 unmount + 新屏 mount/enter，栈深不变', () => {
    const s = createAppStack({ screens: SPECS })
    s.push('home')
    s.push('user')
    s.drainCommands()
    s.replace('settings')
    const cmds = s.drainCommands()
    expect(cmds.filter((c) => c.op === 'unmount')).toHaveLength(1)
    expect(cmds.filter((c) => c.op === 'mount')).toHaveLength(1)
    expect(s.depth).toBe(2)
    expect(s.current()!.name).toBe('settings')
  })

  it('popTo(name)：回到指定屏并销毁其上层', () => {
    const s = createAppStack({ screens: SPECS })
    s.push('home')
    s.push('user')
    s.push('detail')
    s.push('settings')
    s.popTo('user')
    expect(s.depth).toBe(2)
    expect(s.current()!.name).toBe('user')
  })

  it('popTo 找不到目标 → 抛错（死引用不静默）', () => {
    const s = createAppStack({ screens: SPECS })
    s.push('home')
    expect(() => s.popTo('nope')).toThrow(/不存在该屏/)
  })

  it('reset/tab：清栈换根（全部 unmount + 新根 mount/enter）', () => {
    const s = createAppStack({ screens: SPECS })
    s.push('home')
    s.push('user')
    s.drainCommands()
    s.tab('settings')
    const cmds = s.drainCommands()
    expect(cmds.filter((c) => c.op === 'unmount')).toHaveLength(2)
    expect(cmds.filter((c) => c.op === 'mount')).toHaveLength(1)
    expect(s.depth).toBe(1)
    expect(s.current()!.name).toBe('settings')
  })

  it('pop 保底：栈只剩 1 屏时 pop 不产生任何命令（不弹空）', () => {
    const s = createAppStack({ screens: SPECS })
    s.push('home')
    s.drainCommands()
    s.pop()
    expect(s.depth).toBe(1)
    expect(s.drainCommands()).toHaveLength(0)
  })

  it('未注册屏 → 抛错且错误信息列出可用屏（可操作）', () => {
    const s = createAppStack({ screens: SPECS })
    expect(() => s.push('ghost')).toThrow(/未注册的屏 "ghost".*available|未注册的屏 "ghost"/)
    try {
      s.push('ghost')
    } catch (e) {
      expect(String(e)).toContain('home')
    }
  })
})

describe('⑤ 声明式 navigate（公共前缀 diff → 最小操作集）', () => {
  it('深栈回退到中间层：仅 pop 差异，保留屏不重建', () => {
    const s = createAppStack({ screens: SPECS })
    s.push('home')
    s.push('user')
    s.push('detail')
    s.drainCommands()
    s.navigate([{ name: 'home' }, { name: 'user' }])
    expect(s.depth).toBe(2)
    expect(s.current()!.name).toBe('user')
    const cmds = s.drainCommands()
    // 仅 detail 被 unmount（保留的 home/user 无 mount——树保留）
    expect(cmds.filter((c) => c.op === 'unmount')).toHaveLength(1)
    expect(cmds.filter((c) => c.op === 'mount')).toHaveLength(0)
  })

  it('同栈不重放：navigate 到当前栈 → 零命令', () => {
    const s = createAppStack({ screens: SPECS })
    s.push('home')
    s.push('user', { id: '1' })
    s.drainCommands()
    s.navigate([{ name: 'home' }, { name: 'user', params: { id: '1' } }])
    expect(s.drainCommands()).toHaveLength(0)
  })

  it('params 不同 = 不同屏（对齐小程序/Flutter 语义）', () => {
    const s = createAppStack({ screens: SPECS })
    s.push('home')
    s.push('detail', { id: '1' })
    s.drainCommands()
    s.navigate([{ name: 'home' }, { name: 'detail', params: { id: '2' } }])
    const cmds = s.drainCommands()
    expect(cmds.filter((c) => c.op === 'mount')).toHaveLength(1) // 旧 detail 弹出 + 新 detail 入栈
    expect(s.depth).toBe(2)
  })

  it('navigate 含未注册屏 → 抛错且**不产生任何命令**（不部分执行）', () => {
    const s = createAppStack({ screens: SPECS })
    s.push('home')
    s.drainCommands()
    expect(() => s.navigate([{ name: 'home' }, { name: 'ghost' }])).toThrow(/未注册/)
    expect(s.depth).toBe(1) // 栈未变
    expect(s.drainCommands()).toHaveLength(0)
  })

  it('与 stack-diff 同源模型：computeRoutePatch 的补丁序列驱动等价栈（跨端一致性）', () => {
    const prev = ['/home', '/user', '/detail']
    const next = ['/home', '/settings']
    const patches = computeRoutePatch(prev, next)
    // 用 path 序列驱动（applyRoutePatch 是 Web/MP 的模拟器；App 栈是同一模型的另一实现）
    expect(applyRoutePatch(prev, patches)).toEqual(next)
    const s = createAppStack({ screens: { home: { name: 'home', path: '/home' }, user: { name: 'user', path: '/user' }, detail: { name: 'detail', path: '/detail' }, settings: { name: 'settings', path: '/settings' } } })
    s.navigate(prev.map((p) => ({ name: p.replace('/', '') })))
    s.navigate(next.map((p) => ({ name: p.replace('/', '') })))
    expect(s.stack.map((r) => r.path)).toEqual(next) // ★App 栈结果 == 通用 diff 模型结果
  })
})

describe('⑥ 命令流（执行器契约）', () => {
  it('push：exit(旧顶) → mount(新屏) → enter(新屏) 顺序正确', () => {
    const s = createAppStack({ screens: SPECS })
    s.push('home')
    const first = s.drainCommands()
    expect(first.map((c) => c.op)).toEqual(['mount', 'enter'])
    s.push('user')
    const cmds = s.drainCommands()
    expect(cmds.map((c) => c.op)).toEqual(['exit', 'mount', 'enter'])
  })

  it('drain 清空缓冲（执行器每帧消费一次）', () => {
    const s = createAppStack({ screens: SPECS })
    s.push('home')
    expect(s.drainCommands().length).toBeGreaterThan(0)
    expect(s.drainCommands()).toHaveLength(0)
  })

  it('mount 命令携带 params（执行器建屏数据面）', () => {
    const s = createAppStack({ screens: SPECS })
    s.push('home')
    s.drainCommands()
    s.push('detail', { id: 42, from: 'list' })
    const mount = s.drainCommands().find((c) => c.op === 'mount')!
    expect(mount.op === 'mount' && mount.params).toEqual({ id: 42, from: 'list' })
  })

  it('事件流可观测（push/pop/freeze/restore——devtools 回溯）', () => {
    const s = createAppStack({ screens: SPECS, policy: { nodeBudget: 100, keepWindow: 1, defaultScreenNodes: 64 } })
    const events: string[] = []
    s.on((e) => events.push(`${e.type}:${'name' in e ? e.name : ''}`))
    s.push('home')
    s.push('user')
    s.pop()
    expect(events.some((e) => e.startsWith('push:home'))).toBe(true)
    expect(events.some((e) => e.startsWith('freeze:home'))).toBe(true)
    expect(events.some((e) => e.startsWith('restore:home'))).toBe(true)
    expect(events.some((e) => e.startsWith('pop:'))).toBe(true)
  })
})

describe('⑦ codegen/app.ts（RouteNode[] → 屏注册表）', () => {
  it('toScreenEntry：name/path/children/isTab/transition 正确提取', () => {
    const n = node({ path: '/home', name: 'home', meta: { transition: 'slideUp', isTab: true } })
    n.children = [node({ path: '/home/profile', name: 'homeProfile' })]
    const e = toScreenEntry(n)
    expect(e.name).toBe('home')
    expect(e.path).toBe('/home')
    expect(e.transition).toBe('slideUp')
    expect(e.isTab).toBe(true)
    expect(e.children).toEqual(['homeProfile'])
  })

  it('无 name 的节点用 path 推导（/user/profile → user-profile）', () => {
    const e = toScreenEntry(node({ path: '/user/profile' }))
    expect(e.name).toBe('user-profile')
  })

  it('budgetNodes：meta.budgetNodes 数值 > 0 时携带（内存治理数据面）', () => {
    const e = toScreenEntry(node({ path: '/x', name: 'x', meta: { budgetNodes: 128 } }))
    expect(e.budgetNodes).toBe(128)
    const e2 = toScreenEntry(node({ path: '/y', name: 'y', meta: { budgetNodes: 0 } }))
    expect(e2.budgetNodes).toBeUndefined()
  })

  it('flattenScreenEntries：嵌套树平铺（含全部后代）', () => {
    const tree = [node({ path: '/home', name: 'home' })]
    tree[0].children = [node({ path: '/home/profile', name: 'homeProfile' })]
    tree[0].children[0].children = [node({ path: '/home/profile/edit', name: 'homeProfileEdit' })]
    expect(flattenScreenEntries(tree).map((e) => e.name)).toEqual(['home', 'homeProfile', 'homeProfileEdit'])
  })

  it('tabStacks：tab 根 → 其整棵子树名单（嵌套栈聚合 §3.3）', () => {
    const home = node({ path: '/home', name: 'home', meta: { isTab: true } })
    home.children = [node({ path: '/home/profile', name: 'homeProfile' })]
    const me = node({ path: '/me', name: 'me', meta: { isTab: true } })
    const hidden = node({ path: '/hidden', name: 'hidden' })
    expect(tabStacks([home, me, hidden])).toEqual({ home: ['home', 'homeProfile'], me: ['me'] })
  })

  it('generateAppScreens：产物含 AUTO-GENERATED 头 + 屏条目 + 转场枚举 + children 名单', () => {
    const tree = [node({ path: '/home', name: 'home', meta: { transition: 'slideUp', isTab: true } })]
    tree[0].children = [node({ path: '/home/profile', name: 'homeProfile', meta: { transition: 'halfScreen' } })]
    const code = generateAppScreens(tree)
    expect(code).toContain('AUTO-GENERATED')
    expect(code).toContain('"home"')
    expect(code).toContain('"slideUp"')
    expect(code).toContain('"halfScreen"')
    expect(code).toContain('() => import("/abs/home/profile.vue")')
    expect(code).toContain('export const tabStacks')
  })

  it('generateAppScreens 产物可执行（eval 后 screens 形态正确——产物可用性判据）', () => {
    const tree = [node({ path: '/home', name: 'home', meta: { transition: 'slideUp' } })]
    const code = generateAppScreens(tree)
    // 去掉 ESM 关键字与 import 工厂（运行时求值判据只验结构——生成物是 ESM 源码，此处剥壳执行）
    const executable = code
      .replace(/^export /gm, '')
      .replace(/component: \(\) => import\([^)]*\)/g, 'component: function () {}')
    const mod = new Function(`${executable}\nreturn { screens, tabStacks: typeof tabStacks !== 'undefined' ? tabStacks : null }`)()
    expect(Object.keys(mod.screens)).toEqual(['home'])
    expect(mod.screens.home.path).toBe('/home')
    expect(mod.screens.home.transition).toBe('slideUp')
    expect(mod.screens.home.children).toEqual([])
    // ★生成的屏注册表可直接喂 createAppStack（两半接口咬合）
    const s = createAppStack({ screens: mod.screens })
    s.push('home')
    expect(s.current()!.name).toBe('home')
  })
})
