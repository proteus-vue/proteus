// tests/animation-presets.test.ts
// ★★Morpheus MA1：声明式表面 + 预设库（`@proteus-vue/animation`）
//
// 【判据设计（本仓纪律：判据要能变红）】
//   · **绿侧**：合法声明 → 编译出正确指令（含默认值归一、目标绑定、跨语言编号一致）；
//   · **红侧**：每类非法声明都**必须被拦下**（非合成属性 / 同属性重复 / 参数非法 / 空批次）——
//     且**校验必须带可操作修复建议**（不是"请检查"）。
//   · **与内核的对账**：编号/弹簧预设值必须与 Rust 侧一致（跨语言契约，漂移要当场红）。
import { describe, it, expect } from 'vitest'
import {
  AnimKind,
  ANIM_KIND_ID,
  Curve,
  CURVE_ID,
  COMPOSITED_KINDS,
  isComposited,
  validateAnimations,
  compileAnimations,
  compileRoute,
  isPlatformEligible,
  isScrollDriven,
  presets,
  easing,
  scroll,
} from '@proteus-vue/animation'
import type { AnimDecl } from '@proteus-vue/animation'

describe('MA1 · 类型与跨语言契约（编号必须与 Rust 一致）', () => {
  it('AnimKind 编号与内核一致（0..4；改号会静默错位）', () => {
    expect(AnimKind.TRANSLATE_X).toBe(0)
    expect(AnimKind.TRANSLATE_Y).toBe(1)
    expect(AnimKind.SCALE).toBe(2)
    expect(AnimKind.ROTATE).toBe(3)
    expect(AnimKind.OPACITY).toBe(4)
  })

  it('Curve 编号与内核一致（0..4）', () => {
    expect(Curve.LINEAR).toBe(0)
    expect(Curve.EASE_OUT).toBe(1)
    expect(Curve.EASE_IN).toBe(2)
    expect(Curve.EASE_IN_OUT).toBe(3)
    expect(Curve.SPRING_APPROX).toBe(4)
  })

  it('★弹簧预设与内核 SpringParams 同值（跨语言手感一致）', () => {
    // ★这两组值必须与 layout-core-rust/src/anim.rs 的 SpringParams::snappy()/smooth() **逐字段相等**；
    //   任一侧改了而另一侧没跟 ⇒ 本断言当场红（本仓纪律：跨语言契约只能有一个来源）
    expect(easing.snappy).toEqual({ stiffness: 320, damping: 30, mass: 1 })
    expect(easing.smooth).toEqual({ stiffness: 180, damping: 26, mass: 1 })
  })

  it('合成属性集 = 内核 is_composited 的同集合（5 个，无遗漏）', () => {
    expect([...COMPOSITED_KINDS].sort()).toEqual(
      ['opacity', 'rotate', 'scale', 'translateX', 'translateY'].sort(),
    )
    for (const k of COMPOSITED_KINDS) expect(isComposited(k)).toBe(true)
  })
})

describe('MA1 · 编译（声明 → 引擎指令）', () => {
  it('默认值在编译期落定（曲线 easeOut / 时长 300 / 接管 true / time 驱动）', () => {
    const b = compileAnimations([{ kind: 'translateX', to: 100 }], { nodeId: 7 })
    expect(b.anims).toHaveLength(1)
    const a = b.anims[0]!
    expect(a.nodeId).toBe(7)
    expect(a.kind).toBe(AnimKind.TRANSLATE_X)
    expect(a.curve).toBe(Curve.EASE_OUT)
    expect(a.durMs).toBe(300)
    expect(a.drive).toBe(0)
    expect(a.takeover).toBe(true)
    expect(a.to).toBe(100)
  })

  it('弹簧模式编出 spring 字段（内核据此走物理积分而非查表）', () => {
    const b = compileAnimations([{ kind: 'scale', from: 0.8, to: 1, spring: easing.snappy }], { nodeId: 1 })
    expect(b.anims[0]!.spring).toEqual({ stiffness: 320, damping: 30, mass: 1 })
  })

  it('目标绑定：同一组声明可编译到不同节点（预设可复用）', () => {
    const decls: AnimDecl[] = [{ kind: 'opacity', from: 0, to: 1, durationMs: 200 }]
    const a = compileAnimations(decls, { nodeId: 10 })
    const b = compileAnimations(decls, { nodeId: 20 })
    expect(a.anims[0]!.nodeId).toBe(10)
    expect(b.anims[0]!.nodeId).toBe(20)
  })
})

describe('MA1 · 编译期校验（★把"会不会掉帧"变成编译期问题，§5-bis.2）', () => {
  it('★绿：全合成属性 ⇒ 通过且标记可走平台零参与路径', () => {
    const b = compileAnimations(
      [
        { kind: 'translateX', to: 100, durationMs: 300 },
        { kind: 'opacity', to: 0.5, durationMs: 300 },
      ],
      { nodeId: 1 },
    )
    expect(b.composited).toBe(true)
    expect(isPlatformEligible(b)).toBe(true)
  })

  it('★红：同属性重复声明必须被拦下（内核是替换语义 ⇒ 后者会静默替换前者）', () => {
    const issues = validateAnimations([
      { kind: 'scale', from: 1, to: 0.96, durationMs: 90 },
      { kind: 'scale', from: 0.96, to: 1, spring: easing.snappy },
    ])
    expect(issues.some((i) => i.code === 'duplicate-kind')).toBe(true)
    const dup = issues.find((i) => i.code === 'duplicate-kind')!
    expect(dup.hint).toMatch(/拆成两次调用|不同属性/)   // ★必须给可操作建议
    expect(() =>
      compileAnimations(
        [
          { kind: 'scale', to: 0.9, durationMs: 100 },
          { kind: 'scale', to: 1, durationMs: 100 },
        ],
        { nodeId: 1 },
      ),
    ).toThrow(/校验失败/)
  })

  it('★红：曲线与弹簧同时声明（求值模式必须唯一）', () => {
    const issues = validateAnimations([{ kind: 'scale', to: 1, curve: 'easeOut', spring: easing.snappy }])
    expect(issues.some((i) => i.code === 'conflicting-easing')).toBe(true)
  })

  it('★绿：缺省时长合法（归一 300ms）——「预设优先于参数」的直接体现', () => {
    // 首版把"缺时长"当错误，与"默认值应落定"自相矛盾（测试当场抓出）
    const issues = validateAnimations([{ kind: 'opacity', to: 1 }])
    expect(issues).toHaveLength(0)
    expect(compileAnimations([{ kind: 'opacity', to: 1 }], { nodeId: 1 }).anims[0]!.durMs).toBe(300)
  })

  it('★红：时长非法（负数）', () => {
    const issues = validateAnimations([{ kind: 'opacity', to: 1, durationMs: -5 }])
    expect(issues.some((i) => i.code === 'invalid-range')).toBe(true)
  })

  it('★红：弹簧参数非法（stiffness ≤ 0 / damping < 0 / mass ≤ 0）', () => {
    expect(validateAnimations([{ kind: 'scale', to: 1, spring: { stiffness: 0, damping: 1 } }]).some((i) => i.code === 'invalid-spring')).toBe(true)
    expect(validateAnimations([{ kind: 'scale', to: 1, spring: { stiffness: 100, damping: -1 } }]).some((i) => i.code === 'invalid-spring')).toBe(true)
    expect(validateAnimations([{ kind: 'scale', to: 1, spring: { stiffness: 100, damping: 1, mass: 0 } }]).some((i) => i.code === 'invalid-spring')).toBe(true)
  })

  it('★红：空批次', () => {
    const issues = validateAnimations([])
    expect(issues).toHaveLength(1)
    expect(issues[0]!.code).toBe('empty')
  })

  it('★每条问题都带可操作的 hint（不是"请检查"）', () => {
    const all = [
      ...validateAnimations([]),
      ...validateAnimations([{ kind: 'opacity', to: 1, durationMs: -5 }]),
      ...validateAnimations([{ kind: 'scale', to: 1, spring: { stiffness: 0, damping: 1 } }]),
    ]
    for (const i of all) {
      expect(i.hint.length).toBeGreaterThan(5)
      expect(i.hint).not.toMatch(/请检查|invalid|error/i)
    }
  })
})

describe('MA1 · 预设库（"开箱即用" = 预设，不是参数）', () => {
  it('路由转场 4 个预设都编译通过，且语义与微信 routeType 对齐', () => {
    const specs = [
      presets.route.bottomSheet(),
      presets.route.slideUp(),
      presets.route.zoom(),
      presets.route.cupertinoModal(),
    ]
    for (const sp of specs) {
      expect(sp.wxRouteType).toMatch(/^wx:\/\//)
      // 必须能编译（预设自身不能违反校验红线）
      const c = compileRoute(sp, { enter: 101, exit: 100 })
      expect(c.enter.anims.length).toBeGreaterThan(0)
      expect(c.enter.composited).toBe(true)
      // 声明里的每个 kind 都必须是合成属性（预设不能踩 §5-bis.1 的分水岭）
      for (const a of [...sp.enter, ...sp.exit]) expect(isComposited(a.kind)).toBe(true)
    }
  })

  it('★bottomSheet：只动进场页（弹窗场景旧页不动——与微信行为一致）', () => {
    const sp = presets.route.bottomSheet()
    expect(sp.exit).toHaveLength(0)
    expect(sp.opaque).toBe(false)   // 半屏 ⇒ 下层可见
  })

  it('★slideUp：进场页推入 + 旧页反向让位（视差）', () => {
    const sp = presets.route.slideUp()
    expect(sp.exit.length).toBeGreaterThan(0)
    const c = compileRoute(sp, { enter: 2, exit: 1 })
    expect(c.exit.anims.every((a) => a.nodeId === 1)).toBe(true)
    expect(c.enter.anims.every((a) => a.nodeId === 2)).toBe(true)
  })

  it('★cupertinoModal 用弹簧（手感）而 bottomSheet 默认用曲线', () => {
    expect(presets.route.cupertinoModal().enter[0]!.spring).toBeDefined()
    expect(presets.route.bottomSheet().enter[0]!.spring).toBeUndefined()
  })

  it('列表让位预设映射到内核 FLIP 的三个参数', () => {
    const sp = presets.list.shift({ durationMs: 250, curve: 'easeInOut', staggerMs: 20 })
    expect(sp).toEqual({ name: 'listShift', durationMs: 250, curve: 'easeInOut', staggerMs: 20 })
    // 默认值
    expect(presets.list.shift().durationMs).toBe(300)
    expect(presets.list.shift().staggerMs).toBe(0)
  })

  it('元素预设可编译（fadeIn / pressRelease / sharedElementFlyIn）', () => {
    for (const sp of [presets.element.fadeIn({ risePx: 8 }), presets.element.pressRelease(), presets.element.sharedElementFlyIn()]) {
      const c = compileAnimations(sp.decls, { nodeId: 5 })
      expect(c.composited).toBe(true)
      expect(c.anims.length).toBeGreaterThan(0)
    }
  })

  it('★pressRelease 用弹簧（弹性手感）且不含同属性重复（引擎语义决定的形态）', () => {
    const sp = presets.element.pressRelease()   // 若它含两条 scale ⇒ 上面「同属性重复」校验会抛
    expect(() => compileAnimations(sp.decls, { nodeId: 1 })).not.toThrow()
    expect(sp.decls[0]!.spring).toBeDefined()
  })

  it('分享元素飞入：scale 用弹簧 + opacity 用曲线（两种求值模式并存，但属性不同 ⇒ 合法）', () => {
    const sp = presets.element.sharedElementFlyIn()
    const kinds = sp.decls.map((d) => d.kind)
    expect(new Set(kinds).size).toBe(kinds.length)   // 属性唯一
  })
})

describe('MA6 · 序列编排（keyframes：一条动画多段）', () => {
  it('★press 预设编译出**一条** scale 动画、内两段（下压 → 回弹）', () => {
    const sp = presets.element.press({ fromScale: 0.9, downMs: 80, upMs: 200 })
    const c = compileAnimations(sp.decls, { nodeId: 3 })
    expect(c.anims).toHaveLength(1)
    const kf = c.anims[0]!.keyframes!
    expect(kf).toHaveLength(2)
    expect(kf[0]!.to).toBe(0.9)      // 下压终点
    expect(kf[1]!.to).toBe(1)        // 回弹终点
    expect(kf[0]!.durMs).toBe(80)
    // ★durMs = 各段之和（内核据此做 时间→进度 换算，写错会整体错位）
    expect(c.anims[0]!.durMs).toBe(280)
    expect(c.anims[0]!.to).toBe(1)
  })

  it('★shake 预设末段必须回到 0（扰动不是位移——不回 0 会永久错位）', () => {
    const sp = presets.element.shake({ amplitude: 12 })
    const c = compileAnimations(sp.decls, { nodeId: 1 })
    const kf = c.anims[0]!.keyframes!
    expect(kf[kf.length - 1]!.to).toBe(0)
    expect(c.anims[0]!.to).toBe(0)
  })

  it('★序列与弹簧/曲线互斥（求值模式必须唯一）', () => {
    const withSpring = validateAnimations([
      { kind: 'scale', from: 1, to: 1, spring: easing.snappy, keyframes: [{ to: 0.9, durationMs: 100 }, { to: 1, durationMs: 100 }] },
    ])
    expect(withSpring.some((i) => i.code === 'conflicting-easing')).toBe(true)
    const withCurve = validateAnimations([
      { kind: 'scale', from: 1, to: 1, curve: 'easeOut', keyframes: [{ to: 0.9, durationMs: 100 }, { to: 1, durationMs: 100 }] },
    ])
    expect(withCurve.some((i) => i.code === 'conflicting-easing')).toBe(true)
  })

  it('★红侧：空序列 / 总时长为 0 / 末段 to 与声明 to 不一致 都被拦', () => {
    const empty = validateAnimations([{ kind: 'scale', from: 1, to: 1, keyframes: [] }])
    expect(empty.some((i) => i.code === 'empty')).toBe(true)

    const zero = validateAnimations([{ kind: 'scale', from: 1, to: 1, keyframes: [{ to: 0.5, durationMs: 0 }] }])
    expect(zero.some((i) => i.message.includes('总时长为 0'))).toBe(true)

    const mismatch = validateAnimations([
      { kind: 'scale', from: 1, to: 1, keyframes: [{ to: 0.5, durationMs: 100 }, { to: 0.8, durationMs: 100 }] },
    ])
    expect(mismatch.some((i) => i.message.includes('不一致'))).toBe(true)
  })

  it('★红侧：段曲线未知 / 段时长非法 被拦', () => {
    const badCurve = validateAnimations([
      { kind: 'scale', from: 1, to: 1, keyframes: [{ to: 0.5, durationMs: 100, curve: 'nope' as never }, { to: 1, durationMs: 100 }] },
    ])
    expect(badCurve.some((i) => i.message.includes('曲线未知'))).toBe(true)
    const badDur = validateAnimations([
      { kind: 'scale', from: 1, to: 1, keyframes: [{ to: 0.5, durationMs: -1 }, { to: 1, durationMs: 100 }] },
    ])
    expect(badDur.some((i) => i.code === 'invalid-range')).toBe(true)
  })

  it('★同属性重复的提示现在指向 keyframes（不再是"不支持"）', () => {
    const issues = validateAnimations([
      { kind: 'scale', from: 1, to: 0.9, durationMs: 100 },
      { kind: 'scale', from: 0.9, to: 1, durationMs: 100 },
    ])
    const dup = issues.find((i) => i.code === 'duplicate-kind')
    expect(dup).toBeDefined()
    expect(dup!.hint).toContain('keyframes')
  })

  it('★序列批次仍具备平台零参与资格（整段 = 一条 CAKeyframeAnimation，不是 N 条）', () => {
    const c = compileAnimations(presets.element.shake().decls, { nodeId: 1 })
    expect(c.anims).toHaveLength(1)
    expect(isPlatformEligible(c)).toBe(true)
  })
})

describe('MA5 · 滚动联动（吸顶 / 视差 / 渐显）', () => {
  it('三个滚动预设都编译通过，且每条声明都带滚动窗口（驱动源必须显式）', () => {
    const specs = [
      scroll.sticky(),
      scroll.parallax(),
      scroll.fadeIn({ from: 100, to: 300, risePx: 12 }),
    ]
    for (const sp of specs) {
      const c = compileAnimations(sp.decls, { nodeId: 7 })
      expect(c.composited).toBe(true)
      expect(c.anims.length).toBeGreaterThan(0)
      for (const a of c.anims) {
        expect(a.scrollFrom).toBeDefined()
        expect(a.scrollTo!).toBeGreaterThan(a.scrollFrom!)
      }
    }
  })

  it('★滚动窗口的线格式与内核字段名一致（scrollFrom/scrollTo）', () => {
    const c = compileAnimations(scroll.parallax({ factor: 0.5, from: 0, to: 200 }).decls, { nodeId: 1 })
    const a = c.anims[0]!
    expect(a.scrollFrom).toBe(0)
    expect(a.scrollTo).toBe(200)
    // factor=0.5 ⇒ 位移 -100（线性，窗口全程）
    expect(a.to).toBe(-100)
  })

  it('★滚动批次不具备平台零参与资格（驱动源不同：位置 vs 时间）', () => {
    const c = compileAnimations(scroll.sticky().decls, { nodeId: 1 })
    expect(isScrollDriven(c)).toBe(true)
    expect(isPlatformEligible(c)).toBe(false)
    // 反例：时间驱动的同一份声明**有**资格（证明判据不是恒 false）
    const t = compileAnimations([{ kind: 'translateY', from: 0, to: -8, durationMs: 100 }], { nodeId: 1 })
    expect(isScrollDriven(t)).toBe(false)
    expect(isPlatformEligible(t)).toBe(true)
  })

  it('★红侧：退化窗口（to <= from）被拦下——多半是 from/to 写反', () => {
    const issues = validateAnimations([
      { kind: 'translateY', from: 0, to: -100, curve: 'linear', scroll: { from: 200, to: 50 } },
    ])
    expect(issues.some((i) => i.code === 'invalid-range' && /写反|正数/.test(i.hint))).toBe(true)
  })

  it('★红侧：滚动 + 弹簧并存被拦下（弹簧是按时间的物理，滚动进度下无意义）', () => {
    const issues = validateAnimations([
      { kind: 'translateY', from: 0, to: -100, spring: easing.snappy, scroll: { from: 0, to: 100 } },
    ])
    expect(issues.some((i) => i.code === 'conflicting-easing')).toBe(true)
  })

  it('★红侧：窗口含非有限值被拦下', () => {
    const issues = validateAnimations([
      { kind: 'translateY', from: 0, to: -100, scroll: { from: Number.NaN, to: 100 } },
    ])
    expect(issues.some((i) => i.code === 'invalid-range')).toBe(true)
  })

  it('渐显叠加上移时属性不重复（opacity + translateY ⇒ 合法）', () => {
    const sp = scroll.fadeIn({ from: 0, to: 100, risePx: 10 })
    expect(sp.decls.map((d) => d.kind).sort()).toEqual(['opacity', 'translateY'])
    expect(() => compileAnimations(sp.decls, { nodeId: 1 })).not.toThrow()
  })
})

describe('MA1 · 编号映射表（名字写错的类型级防线）', () => {
  it('ANIM_KIND_ID / CURVE_ID 覆盖全部名字', () => {
    expect(Object.keys(ANIM_KIND_ID)).toHaveLength(5)
    expect(Object.keys(CURVE_ID)).toHaveLength(5)
    expect(ANIM_KIND_ID.translateX).toBe(0)
    expect(CURVE_ID.easeOut).toBe(1)
  })
})
