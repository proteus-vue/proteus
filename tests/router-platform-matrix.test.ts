// tests/router-platform-matrix.test.ts
// 路由规划 B7 L4：跨端一致性矩阵 —— 同一份 <route>.meta.transition 三端语义一致（硬证明）
// Web: Vue Transition 名 / MP: routeType（运行时传参）/ App: 原生转场（v0.6 接入后补）
import { describe, it, expect } from 'vitest'
import { webTransitionName, mpRouteType, isTransition, WEB_TRANSITION_MAP, MP_ROUTE_TYPE_MAP } from '../packages/router/src/transforms/transform-transition'

const MATRIX = [
  { transition: 'slideUp', web: 'slide-up', mp: 'slideUp', app: 'presentModal' },
  { transition: 'slideDown', web: 'slide-down', mp: 'slideDown', app: 'dismissModal' },
  { transition: 'halfScreen', web: 'halfscreen', mp: 'halfScreen', app: 'pageSheet' },
  { transition: 'scaleDown', web: 'scale', mp: 'scaleDown', app: 'zoom' },
  { transition: 'none', web: 'fade', mp: undefined, app: 'default' },
] as const

describe('L4 跨端一致性矩阵（transition 枚举全覆盖）', () => {
  for (const c of MATRIX) {
    it(`transition=${c.transition} → Web ${c.web} / MP ${c.mp ?? '不声明'}（App ${c.app} 待 v0.6）`, () => {
      expect(isTransition(c.transition)).toBe(true)
      expect(webTransitionName(c.transition)).toBe(c.web)
      expect(mpRouteType(c.transition)).toBe(c.mp)
    })
  }

  it('非法值：Web 兜底 fade / MP 不声明（编译期 schema 已拦截，此处为运行时防御）', () => {
    expect(webTransitionName('weird' as never)).toBe('fade')
    expect(mpRouteType('weird' as never)).toBeUndefined()
    expect(isTransition('weird')).toBe(false)
  })

  it('共享表一致性：Web/MP 映射键集一致（同一枚举，防漂移）', () => {
    expect(Object.keys(WEB_TRANSITION_MAP).sort()).toEqual(Object.keys(MP_ROUTE_TYPE_MAP).sort())
  })
})
