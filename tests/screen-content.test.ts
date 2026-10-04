// tests/screen-content.test.ts —— ★★★App 三端对齐 · 阶段 1（B1+B2）：
//   **屏内容契约**——`screen.mount` 携带**真实页面渲染产物**（不再是无内容的空壳容器）（2026-10-04）
//
// 【这张测试锁什么（缺口 B2）】此前 `ScreenHost.mount` 建的是**空壳屏**（宿主塞 3 个占位几何节点）
//   ⇒「路由在走、页面没渲染」。本契约把**页面内容**（由页面渲染器产出的内核节点描述）经执行器
//   送到宿主建树路径。判据锁的是**契约层**（内容被下发且形状正确）；宿主侧"真建树"由设备读数证明。
//
// 【判据】
//   ① 提供者注入 ⇒ `host.mountScreen` 收到 `content`（节点数/父子关系与提供者一致）
//   ② **向后兼容**：未注入提供者 ⇒ 不带 `content`（老宿主/老装置零行为变化）
//   ③ 提供者按**屏名/路径**解析（不同屏得到不同内容——不是"一份内容套所有屏"）
//   ④ `content.viewport` 透传
//   ⑤ 执行器读数 `contentNodes` 与提供者一致（诊断可查——不静默）

import { describe, it, expect } from 'vitest'
import { createAppStack } from '@proteus-vue/router/app-stack'
import { routeTransitionBatches } from '@proteus-vue/animation'
import { createScreenExecutor } from '@proteus-vue/render-backend'
import type { ScreenTreeHost, ScreenAnimHost, RouteTransitionPlanLike, ScreenContent } from '@proteus-vue/render-backend'
import type { AppScreenSpec } from '@proteus-vue/router/app-stack'

const SPECS: Record<string, AppScreenSpec> = {
  home: { name: 'home', path: '/home', transition: 'slideUp' },
  detail: { name: 'detail', path: '/detail', transition: 'slideUp' },
}

/** 记录桩：树端口（捕获每次 mount 的 content） */
function makeTreeHost() {
  const mounts: Array<{ screenId: string; content?: ScreenContent }> = []
  let nextNode = 100
  const host: ScreenTreeHost = {
    mountScreen(s) {
      mounts.push({ screenId: s.screenId, content: s.content })
      return nextNode++
    },
    setScreenVisible() {},
    destroyScreen() {},
  }
  return { host, mounts }
}

const animHost: ScreenAnimHost = { playRouteTransition: () => {} }
const plan = (transition: unknown, targets: { incoming?: number; outgoing?: number }) =>
  routeTransitionBatches(transition as never, targets as never) as RouteTransitionPlanLike

/** 造一段页面内容（两节点：根容器 + 一行文本） */
const pageContent = (label: string): ScreenContent => ({
  viewport: { width: 390, height: 844 },
  nodes: [
    { id: 1, parentId: null, width: 390, height: 120, flexDirection: 'column' },
    { id: 2, parentId: 1, height: 40, text: label },
  ],
})

/** 跑一次导航（push 到 detail），返回树桩捕获 */
async function runOnce(opts: { contentOf?: (s: { name: string; path: string }) => ScreenContent | undefined }) {
  const { host, mounts } = makeTreeHost()
  const executor = createScreenExecutor({
    host,
    anim: animHost,
    plan,
    ...(opts.contentOf ? { contentOf: opts.contentOf } : {}),
  })
  const stack = createAppStack({ screens: SPECS })
  stack.push('home')
  await executor.applyCommands(stack.drainCommands())
  stack.push('detail')
  await executor.applyCommands(stack.drainCommands())
  return { mounts, executor }
}

describe('★阶段 1 · 屏内容契约（B2：屏不再是无内容的空壳）', () => {
  it('① 注入提供者 ⇒ mount 带 content（节点数/父子/文本与提供者一致）', async () => {
    const { mounts } = await runOnce({
      contentOf: (s) => pageContent(s.name === 'home' ? '首页' : '详情'),
    })
    const homeMount = mounts.find((m) => m.screenId.startsWith('home'))
    expect(homeMount?.content, 'home 屏应携带内容').toBeTruthy()
    expect(homeMount!.content!.nodes.length, '内容节点数').toBe(2)
    expect(homeMount!.content!.nodes[0]!.parentId, '根节点 parentId=null').toBeNull()
    expect(homeMount!.content!.nodes[1]!.parentId, '子节点指向根').toBe(1)
    expect((homeMount!.content!.nodes[1] as { text?: string }).text, '文本节点携带字面量').toBe('首页')
    expect(homeMount!.content!.viewport, 'viewport 透传').toEqual({ width: 390, height: 844 })
  })

  it('② ★向后兼容：未注入提供者 ⇒ 不带 content（老宿主/老装置零行为变化）', async () => {
    const { mounts } = await runOnce({})
    expect(mounts.length, '两屏都 mount 了').toBe(2)
    for (const m of mounts) expect(m.content, `${m.screenId} 无内容（缺省）`).toBeUndefined()
  })

  it('③ 提供者按屏解析（不同屏得不同内容——不是"一份套所有屏"）', async () => {
    const { mounts } = await runOnce({
      contentOf: (s) => pageContent(s.name === 'home' ? '首页' : '详情'),
    })
    const home = mounts.find((m) => m.screenId.startsWith('home'))!
    const detail = mounts.find((m) => m.screenId.startsWith('detail'))!
    const textOf = (c?: ScreenContent) => (c!.nodes[1] as { text?: string }).text
    expect(textOf(home.content)).toBe('首页')
    expect(textOf(detail.content)).toBe('详情')
  })

  it('④ 路径也传给提供者（可按键名或路径解析）', async () => {
    const seen: string[] = []
    await runOnce({
      contentOf: (s) => {
        seen.push(`${s.name}@${s.path}`)
        return undefined
      },
    })
    expect(seen, '提供者收到屏名+路径').toContain('home@/home')
    expect(seen, '提供者收到屏名+路径').toContain('detail@/detail')
  })

  it('⑤ 执行器 mount 事件读数含 contentNodes（诊断可查——不静默）', async () => {
    const events: Array<{ type: string; detail?: unknown }> = []
    const { host } = makeTreeHost()
    const executor = createScreenExecutor({
      host,
      anim: animHost,
      plan,
      contentOf: (s) => pageContent(s.name),
      onEvent: (e) => events.push({ type: e.type, detail: e.detail }),
    })
    const stack = createAppStack({ screens: SPECS })
    stack.push('home')
    await executor.applyCommands(stack.drainCommands())
    const mountEvent = events.find((e) => e.type === 'mount')!
    expect((mountEvent.detail as { contentNodes: number }).contentNodes, '读数=2 节点').toBe(2)
  })
})
