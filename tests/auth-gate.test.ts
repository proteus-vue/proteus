// tests/auth-gate.test.ts —— ★★★GP4-c（2026-10-03）：登录失效拦截**状态机**回归锁
//
// 【这张卡要补什么（任务卡 GP4-c）】"在任意页面任何请求返回 401 均可弹出"——
//   既有 `router.options.auth` 守卫**只在导航时**跑；用户停在页面上被 401 打中时没有导航
//   ⇒ 本模块补的是"非导航触发的失效"这一路输入。
//
// 【★硬约束："不得新建独立的全局拦截机制，必须复用路由守卫"——本文件锁住这条】
//   ① `createAuthChecker()` 直接喂给 `createRouter({ auth })` ⇒ **守卫与本模块读同一份事实**
//   ② `onAuthFail`（守卫拦截时）与 `notifyAuthExpired()`（401 时）**汇入同一状态**（不各说各话）
//   ③ 恢复走 `onRestored`（业务注入的既有导航）——本模块**不自己导航**（栈不异常）
//
// 【判据设计（每条可破坏性验证）】
//   ① 401 → expired 翻转（幂等：重复 401 不重复触发翻转）
//   ② checker 与状态**同源**（expired ⇒ checker() false；恢复 ⇒ true）
//   ③ 守卫路径合流：模拟守卫拦截（调 notifyAuthExpired 同款）与 401 走同一状态
//   ④ 恢复：markAuthRestored 清状态 + 触发 onRestored（业务收口）；返回"本次是否真恢复"
//   ⑤ 订阅/退订 + 落痕**退订也更新**（GP4-a 的教训：只在 add 侧写 ⇒ 读数恒定 ⇒ 排障误判）
//   ⑥ 订阅者抛错不影响状态（宿主渲染失败不拖垮逻辑层）
//   ⑦ 计数可观测（expiredCount 记"收到多少次 401"——反复 401 = token 刷新链路有问题）

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  notifyAuthExpired, markAuthRestored, isAuthExpired, authGateState,
  subscribeAuthGate, createAuthChecker, configureAuthGate,
  __resetAuthGateForTest,
} from '../packages/runtime/src/auth-gate'
import type { AuthGateState } from '../packages/runtime/src/auth-gate'

beforeEach(() => __resetAuthGateForTest())
afterEach(() => __resetAuthGateForTest())

describe('★GP4-c ① 401 → 失效态（幂等：并发 401 不重复触发）', () => {
  it('notifyAuthExpired ⇒ expired=true，返回 true（本次翻转）', () => {
    expect(isAuthExpired(), '初始未失效').toBe(false)
    expect(notifyAuthExpired(), '首次触发返回 true').toBe(true)
    expect(isAuthExpired()).toBe(true)
  })

  it('★幂等：已在失效态再收 401 ⇒ 返回 false（不重复触发翻转），但计数增长', () => {
    notifyAuthExpired()
    expect(notifyAuthExpired(), '第二次不再翻转').toBe(false)
    expect(notifyAuthExpired(), '第三次同').toBe(false)
    expect(authGateState().count, '★计数记了 3 次 401（可观测：反复 401 = 刷新链路有问题）').toBe(3)
  })

  it('可指定文案（请求拦截器按后端消息覆盖）', () => {
    notifyAuthExpired('凭证已过期')
    expect(authGateState().message).toBe('凭证已过期')
  })
})

describe('★GP4-c ②③ checker 与状态**同源**（"不是新机制"的核心判据）', () => {
  it('★createAuthChecker 读的就是本模块状态（守卫与弹窗同一事实）', () => {
    const checker = createAuthChecker()
    expect(checker(), '未失效 ⇒ 放行').toBe(true)
    notifyAuthExpired()
    expect(checker(), '★失效 ⇒ 守卫同步拦截（同一份状态，非两套判断）').toBe(false)
    markAuthRestored()
    expect(checker(), '恢复 ⇒ 守卫同步放行').toBe(true)
  })

  it('★两条路径合流：守卫拦截（onAuthFail）与 401（拦截器）都调 notifyAuthExpired ⇒ 同一状态', () => {
    // 模拟 createRouter({ auth, onAuthFail: () => notifyAuthExpired() }) 的守卫拦截路径
    const onAuthFail = (): void => {
      notifyAuthExpired()
    }
    onAuthFail() // 守卫拦截
    expect(isAuthExpired()).toBe(true)
    // 再从 401 路径进来（幂等，同一状态）
    expect(notifyAuthExpired()).toBe(false)
    expect(authGateState().count, '两条路径的触发都被记到同一计数').toBe(2)
  })

  it('★doc 用法可编译执行：createRouter 的 auth 选项直接吃 createAuthChecker()', () => {
    // 结构判据：checker 是零参函数，返回 boolean（RouterOptions.auth 的契约）
    const checker = createAuthChecker()
    expect(typeof checker).toBe('function')
    expect(typeof checker()).toBe('boolean')
  })
})

describe('★GP4-c ④ 恢复（业务走既有导航收口——本模块不自己导航）', () => {
  it('markAuthRestored ⇒ 清状态 + 触发 onRestored；返回"本次是否真恢复"', () => {
    let restoredCalls = 0
    configureAuthGate({ onRestored: () => restoredCalls++ })
    notifyAuthExpired()
    expect(markAuthRestored(), '从失效态恢复 ⇒ true').toBe(true)
    expect(isAuthExpired()).toBe(false)
    expect(restoredCalls, '★收口回调被调（业务在其中走既有导航 router.replace）').toBe(1)
  })

  it('★未失效时调恢复 ⇒ 返回 false 且**不**触发收口（不无故导航）', () => {
    let restoredCalls = 0
    configureAuthGate({ onRestored: () => restoredCalls++ })
    expect(markAuthRestored(), '本来就没失效').toBe(false)
    expect(restoredCalls, '★不该触发导航收口（否则会莫名其妙跳登录页）').toBe(0)
  })

  it('收口回调抛错不影响状态（业务导航失败不该把状态卡在失效态）', () => {
    configureAuthGate({
      onRestored: () => {
        throw new Error('导航炸了')
      },
    })
    notifyAuthExpired()
    expect(() => markAuthRestored()).not.toThrow()
    expect(isAuthExpired(), '状态已清（回调异常被吞）').toBe(false)
  })
})

describe('★GP4-c ⑤⑥ 订阅/退订/落痕', () => {
  it('订阅者收到状态变化（宿主据此显示/隐藏弹窗）', () => {
    const seen: boolean[] = []
    subscribeAuthGate((s: AuthGateState) => seen.push(s.expired))
    notifyAuthExpired()
    markAuthRestored()
    expect(seen, '收到 失效→恢复 两次翻转').toEqual([true, false])
  })

  it('★退订也更新落痕（GP4-a 的教训：只在 add 侧写 ⇒ 读数恒定 ⇒ 排障误判两轮）', () => {
    const unsub = subscribeAuthGate(() => {})
    const g = globalThis as unknown as { __PROTEUS_AUTH_GATE_SUBSCRIBERS__?: number }
    expect(g.__PROTEUS_AUTH_GATE_SUBSCRIBERS__).toBe(1)
    unsub()
    expect(g.__PROTEUS_AUTH_GATE_SUBSCRIBERS__, '★退订后应为 0（不是恒 1）').toBe(0)
  })

  it('订阅者抛错不影响状态推进（宿主渲染失败不拖垮逻辑层）', () => {
    subscribeAuthGate(() => {
      throw new Error('宿主炸了')
    })
    notifyAuthExpired()
    expect(isAuthExpired(), '状态照常推进').toBe(true)
  })

  it('状态落痕含 expired/message/count（真机排障第一手证据）', () => {
    notifyAuthExpired('测试文案')
    const g = globalThis as unknown as { __PROTEUS_AUTH_GATE__?: Record<string, unknown> }
    expect(g.__PROTEUS_AUTH_GATE__?.expired).toBe(true)
    expect(g.__PROTEUS_AUTH_GATE__?.message).toBe('测试文案')
    expect(g.__PROTEUS_AUTH_GATE__?.count).toBe(1)
  })
})

describe('★GP4-c ⑦ 配置与重置', () => {
  it('configureAuthGate 可改文案（装配期调用）', () => {
    configureAuthGate({ message: '请重新登录后继续' })
    expect(authGateState().message).toBe('请重新登录后继续')
  })

  it('__resetAuthGateForTest 清全部（含收口回调与落痕——测试隔离用）', () => {
    let calls = 0
    configureAuthGate({ onRestored: () => calls++ })
    notifyAuthExpired()
    __resetAuthGateForTest()
    expect(isAuthExpired()).toBe(false)
    expect(authGateState().count, '计数清零').toBe(0)
    const g = globalThis as unknown as { __PROTEUS_AUTH_GATE__?: unknown }
    expect(g.__PROTEUS_AUTH_GATE__, '落痕已清').toBeUndefined()
    markAuthRestored()
    expect(calls, '收口回调已被清（不会再触发）').toBe(0)
  })
})

describe('★GP4-c 组件契约（不可取消——像素级不开放"可关"配置）', () => {
  it('★组件**不提供** closable/maskClosable 等"可关"prop（不给误配置的机会）', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'packages/components/p-auth-gate/index.vue'), 'utf-8')
    const propsBlock = /defineProps\(\{([\s\S]*?)\n\}\)/.exec(src)?.[1] ?? ''
    expect(propsBlock, '★不得有 closable（否则可被配成可关 ⇒ 违背"不可取消"）').not.toContain('closable')
    expect(propsBlock, '★不得有 maskClosable（同上）').not.toContain('maskClosable')
    expect(propsBlock, '不得有 closeOnClickOverlay').not.toContain('closeOnClickOverlay')
  })

  it('★遮罩/根的点击**不关闭**（不可取消的机器判据：点击路径里没有 markAuthRestored）', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'packages/components/p-auth-gate/index.vue'), 'utf-8')
    const rootTap = /function onRootTap\(\)[\s\S]*?\n\}/.exec(src)?.[0] ?? ''
    const panelTap = /function onPanelTap\(\)[\s\S]*?\n\}/.exec(src)?.[0] ?? ''
    expect(rootTap, '★点根（遮罩）不得恢复登录态（否则可取消）').not.toContain('markAuthRestored')
    expect(panelTap, '★点面板不得关（同上）').not.toContain('markAuthRestored')
    // 唯一出口被显式记录在注释里
    expect(src, '文件头写明唯一出口是登录态恢复').toContain('唯一出口')
  })

  it('★动作按钮**不自己导航**（转达给业务 onAction——否则就是"新建拦截机制"）', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'packages/components/p-auth-gate/index.vue'), 'utf-8')
    const actionTap = /function onActionTap\(\)[\s\S]*?\n\}/.exec(src)?.[0] ?? ''
    expect(actionTap, '★组件内不得出现 navigateTo/reLaunch/switchTab（导航归业务/守卫）').not.toMatch(/navigateTo|reLaunch|switchTab/)
    expect(actionTap, '必须转达 props.onAction').toContain('onAction')
  })
})
