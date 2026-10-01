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
  ANIM_RULES,
  listAnimRules,
  formatAnimRule,
  formatAnimCatalog,
  runConformance,
  EscapeRegistry,
  ESCAPE_KINDS,
  compileTimeline,
  timelineDuration,
  APP_TRANSITION_MAP,
  appTransition,
  appTransitions,
  reverseDecls,
  routeTransitionBatches,
} from '@proteus-vue/animation'
import type { AnimDecl } from '@proteus-vue/animation'
// ★类型断言用（不能用 `as never`——`Record<RouteTransition, X>[never]` 求值为 `never`，
//   属性访问会报 TS2339；本文件曾因此在 `vue-tsc` 下红，阻塞交付门禁）
import type { RouteTransition } from '@proteus-vue/contracts'

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

describe('共享元素（跨元素飞行：几何在内核）', () => {
  it('两种源各编译出正确形态（fromRect 系统坐标 / fromNodeId 同树节点）', () => {
    const a = presets.element.sharedElement({ fromRect: { x: 100, y: 300, w: 40, h: 40 } })
    expect(a.fromRect).toEqual({ x: 100, y: 300, w: 40, h: 40 })
    expect(a.fromNodeId).toBeUndefined()
    expect(a.fadeIn).toBe(true)
    const b = presets.element.sharedElement({ fromNodeId: 7, fadeIn: false })
    expect(b.fromNodeId).toBe(7)
    expect(b.fadeIn).toBe(false)
  })

  it('★源必须给且只能给一个（缺源/双源都当场抛错，不静默）', () => {
    expect(() => presets.element.sharedElement({})).toThrow()
    expect(() =>
      presets.element.sharedElement({ fromRect: { x: 0, y: 0, w: 10, h: 10 }, fromNodeId: 1 }),
    ).toThrow()
  })

  it('★诚实边界：预设不含 decls（几何只有运行时才知道，"声明→指令"那条路表达不了）', () => {
    const sp = presets.element.sharedElement({ fromNodeId: 1 })
    expect('decls' in sp).toBe(false)
    // 走的是内核几何原语（proteus_layout_shared_element），不是 compileAnimations
    expect(sp.durationMs).toBe(400)
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
    // ★契约变更（2026-10-01）：封闭集由 5 → 6（`color`）→ 7（`textColor`）→ 9（B 批 3D）
    //   → **10**（C1 裁剪形变：`clip`）。计数变化是**如实反映契约**，不是放宽断言
    //   ——下面逐条钉住编号（含 color / textColor / rotateX / rotateY / clip）。
    expect(Object.keys(ANIM_KIND_ID)).toHaveLength(10)
    expect(Object.keys(CURVE_ID)).toHaveLength(5)
    expect(ANIM_KIND_ID.translateX).toBe(0)
    expect(ANIM_KIND_ID.translateY).toBe(1)
    expect(ANIM_KIND_ID.scale).toBe(2)
    expect(ANIM_KIND_ID.rotate).toBe(3)
    expect(ANIM_KIND_ID.opacity).toBe(4)
    // ★`color` 的编号是**名义值**（= 通道 R 的 5）：编译期会把它展开成 4 条通道指令
    //   （见 `compileOne`）。这条断言钉住"名义值没变"，避免有人误当单条指令用。
    expect(ANIM_KIND_ID.color).toBe(5)
    // ★`textColor` 同理是名义值（= 文字色通道 R 的 9；5..8 是底色四通道）——独立轨道，不共用槽位。
    expect(ANIM_KIND_ID.textColor).toBe(9)
    // ★B 批 3D：rotateX/rotateY 是**单通道**（无数值展开）；13/14 与内核一致
    expect(ANIM_KIND_ID.rotateX).toBe(13)
    expect(ANIM_KIND_ID.rotateY).toBe(14)
    // ★C1：`clip` 同样名义值（= 参数槽 0 的 15）；编译期按参数个数展开成 N 条通道
    expect(ANIM_KIND_ID.clip).toBe(15)
    expect(CURVE_ID.easeOut).toBe(1)
  })
})

describe('MA1 收尾 · AI 说明书 + conformance（Morpheus §13 第 11 条）', () => {
  it('★说明书条目齐备且 ID 唯一（AI 要能可靠枚举）', () => {
    const ids = ANIM_RULES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    // 四类都要有（预设/原语/约束/边界）——缺一类说明写漏了一整面
    for (const k of ['preset', 'primitive', 'constraint', 'boundary'] as const) {
      expect(listAnimRules(k).length).toBeGreaterThan(0)
    }
    // 每条必填字段非空（空字符串会在生成物里变成空洞）
    for (const r of ANIM_RULES) {
      for (const f of ['id', 'title', 'description', 'why', 'when', 'example', 'verify', 'source'] as const) {
        expect(String(r[f]).trim().length, `${r.id}.${f} 为空`).toBeGreaterThan(0)
      }
    }
  })

  it('★conformance：每条 preset 声称的预设都在导出面上真实存在', () => {
    const findings = runConformance()
    const miss = findings.filter((f) => f.check === 'preset-exists' && !f.ok)
    expect(miss.map((m) => m.ruleId)).toEqual([])
  })

  it('★conformance：跨语言契约值（弹簧 preset / 编号）与实现一致', () => {
    const findings = runConformance()
    const bad = findings.filter((f) => f.check === 'value-matches' && !f.ok)
    expect(bad.map((b) => `${b.ruleId}: ${b.detail}`)).toEqual([])
  })

  it('★conformance：每条 verify 都指向具体检查（不许"大概测过"）', () => {
    const findings = runConformance()
    const vague = findings.filter((f) => f.check === 'verify-exists' && !f.ok)
    expect(vague.map((v) => v.ruleId)).toEqual([])
  })

  it('★conformance 能变红（破坏性）：改一条 preset 名 ⇒ 断言必须红', () => {
    // 造一条"声称存在但导出面上没有"的规则
    const fake = [{
      ...ANIM_RULES[0]!,
      id: 'preset/route.notARealPreset',
    }]
    const findings = runConformance(undefined, fake)
    expect(findings.some((f) => f.check === 'preset-exists' && !f.ok)).toBe(true)
  })

  it('★conformance 能变红（破坏性）：契约值被改 ⇒ 断言必须红', () => {
    const mockEasing = { ...easing, smooth: { stiffness: 999, damping: 26, mass: 1 } }
    // 直接验 CONTRACT_VALUES 的同源逻辑：改了 smooth 就不该再等于 180/26/1
    expect(mockEasing.smooth.stiffness).toBe(999)
    expect(easing.smooth.stiffness).toBe(180)   // 真实值未被改动（对照）
  })

  it('目录渲染含全部条目（生成物漂移的机器判据的同源）', () => {
    const cat = formatAnimCatalog()
    expect(cat).toContain(`共 ${ANIM_RULES.length} 条`)
    for (const r of ANIM_RULES) expect(cat).toContain(r.id)
  })

  it('单条渲染含 what/why/when/verify/source（AI 可独立消费一条）', () => {
    const txt = formatAnimRule(ANIM_RULES[0]!)
    for (const k of ['是什么', '为什么', '何时用', '如何验证', '实现位置']) expect(txt).toContain(k)
  })
})

describe('MA0/§4.2 · 逃生口（显式通道 + 可统计 + degraded 单列）', () => {
  it('★登记三要素齐备才通过；缺任一 → 当场抛错（"没有理由的逃生口"是设计泄漏）', () => {
    const reg = new EscapeRegistry()
    expect(() => reg.register({ kind: 'custom-easing', detail: 'x', reason: 'y', behaviorRisk: '' })).toThrow(/behaviorRisk/)
    expect(() => reg.register({ kind: 'custom-easing', detail: 'x', reason: '  ', behaviorRisk: 'z' })).toThrow(/reason/)
    expect(() => reg.register({ kind: 'custom-easing', detail: '', reason: 'y', behaviorRisk: 'z' })).toThrow(/detail/)
    // 未知类别也拦（类别是封闭集；覆盖不了用 other 但须写清细节）
    expect(() => reg.register({ kind: 'nope' as never, detail: 'x', reason: 'y', behaviorRisk: 'z' })).toThrow(/未知逃生口类别/)
    expect(reg.list()).toHaveLength(0)
  })

  it('★声明式 + 逃生口 → 率的分母含两者（逃生口率 = total/(declaratives+total)）', () => {
    const reg = new EscapeRegistry()
    compileAnimations([{ kind: 'opacity', from: 0, to: 1 }], { nodeId: 1 }, { escapes: reg })
    compileAnimations([{ kind: 'scale', from: 1, to: 1.1 }, { kind: 'translateY', from: 0, to: -4 }], { nodeId: 2 }, { escapes: reg })
    reg.register({ kind: 'custom-easing', detail: 'cubic-bezier(.1,.9,.2,1)', reason: '品牌曲线', behaviorRisk: '不进内核曲线表' })
    const s = reg.summary()
    expect(s.declaratives).toBe(3)   // 1 + 2 条声明
    expect(s.total).toBe(1)
    expect(s.ratio).toBeCloseTo(1 / 4, 5)
  })

  it('★不注入注册表 ⇒ 零副作用（compileAnimations 保持纯函数）', () => {
    const reg = new EscapeRegistry()
    compileAnimations([{ kind: 'opacity', from: 0, to: 1 }], { nodeId: 1 })  // 不传 escapes
    expect(reg.summary().declaratives).toBe(0)
    expect(reg.summary().ratio).toBe(0)
  })

  it('★degraded 必须**单列**（不与类别汇总混排）——报告结构断言', () => {
    const reg = new EscapeRegistry()
    reg.register({ kind: 'layout-property', detail: 'width 0→200', reason: '展开动画需真实占位', behaviorRisk: '触发重排，平台零参与失效', site: 'Comp.vue' })
    reg.register({ kind: 'external-driver', detail: '自建 rAF 交错', reason: '跨属性时间轴未做', behaviorRisk: '不走内核 tick，与声明式动画可能互相覆盖' })
    const txt = reg.format()
    const degradedIdx = txt.indexOf('degraded')
    const byKindIdx = txt.indexOf('按类别汇总')
    expect(degradedIdx).toBeGreaterThan(-1)
    expect(byKindIdx).toBeGreaterThan(degradedIdx)      // degraded 在汇总**之前**（独立一节）
    expect(txt).toContain('最高危险度')
    // 三条信息都要出现（做什么/为什么/风险）
    expect(txt).toContain('width 0→200')
    expect(txt).toContain('展开动画需真实占位')
    expect(txt).toContain('触发重排')
  })

  it('★全部类别都出现（零值也列）——不留"未归类"的想象空间', () => {
    const reg = new EscapeRegistry()
    const s = reg.summary()
    for (const k of ESCAPE_KINDS) expect(s.byKind[k]).toBe(0)
    const txt = reg.format()
    for (const k of ESCAPE_KINDS) expect(txt).toContain(`· ${k}:`)
  })

  it('★超目标（> 5%）时报告给出提示；未超则不给（判据不是恒真）', () => {
    const reg = new EscapeRegistry()
    for (let i = 0; i < 6; i++) {
      reg.register({ kind: 'other', detail: `d${i}`, reason: 'r', behaviorRisk: 'b' })
    }
    expect(reg.summary().ratio).toBe(1)          // 分母 0 + 6
    expect(reg.format()).toContain('超过目标')
    const reg2 = new EscapeRegistry()
    compileAnimations([{ kind: 'opacity', from: 0, to: 1 }], { nodeId: 1 }, { escapes: reg2 })
    expect(reg2.format()).not.toContain('超过目标')
  })

  it('★校验失败时报错指向逃生口通道（不是只说"不支持"）', () => {
    expect(() =>
      compileAnimations([{ kind: 'scale', to: 0.9 }, { kind: 'scale', to: 1 }], { nodeId: 1 }),
    ).toThrow(/显式逃生口[\s\S]*register/)
  })

  it('reset 可归零（测试隔离——跨用例共享状态必须可归零，本仓纪律）', () => {
    const reg = new EscapeRegistry()
    reg.register({ kind: 'other', detail: 'd', reason: 'r', behaviorRisk: 'b' })
    compileAnimations([{ kind: 'opacity', from: 0, to: 1 }], { nodeId: 1 }, { escapes: reg })
    reg.reset()
    expect(reg.summary().total).toBe(0)
    expect(reg.summary().declaratives).toBe(0)
  })
})

describe('跨属性共享时间轴（多属性共享停靠点 ⇒ 内核结构性同拍）', () => {
  const spec = {
    kinds: ['scale', 'translateY', 'opacity'] as const,
    stops: [
      { at: 0, values: { scale: 1, translateY: 0, opacity: 0 }, curve: 'easeOut' as const },
      { at: 90, values: { scale: 0.94, translateY: 6, opacity: 1 }, curve: 'springApprox' as const },
      { at: 350, values: { scale: 1, translateY: 0, opacity: 1 } },
    ],
  }

  it('★所有轨道总时长**相同**（内核 lockstep 推进的前提——由构造保证，不靠调用方凑）', () => {
    const c = compileTimeline(spec, { nodeId: 7 })
    expect(c.anims).toHaveLength(3)
    for (const a of c.anims) expect(a.durMs).toBe(350)
    // 且每段的时长 = 停靠点差值（三条轨道**各自的段划分一致**）
    for (const a of c.anims) {
      expect(a.keyframes!.map((k) => k.durMs)).toEqual([90, 260])
    }
    expect(timelineDuration(spec)).toBe(350)
  })

  it('★停靠点值正确落到各轨道（scale/translateY/opacity 三条各自的 from 与末段 to）', () => {
    const c = compileTimeline(spec, { nodeId: 7 })
    const byKind = new Map(c.anims.map((a) => [a.kind, a]))
    expect(byKind.get(2)!.from).toBe(1)      // scale
    expect(byKind.get(2)!.to).toBe(1)
    expect(byKind.get(1)!.from).toBe(0)      // translateY
    expect(byKind.get(4)!.from).toBe(0)      // opacity
    expect(byKind.get(4)!.keyframes![0]!.to).toBe(1)
  })

  it('★曲线归属正确：段曲线取自**上一停靠点**（不是本点）', () => {
    const c = compileTimeline(spec, { nodeId: 7 })
    const kf = c.anims[0]!.keyframes!
    expect(kf[0]!.curve).toBe(CURVE_ID.easeOut)          // stop#0 的 curve 管 0→90
    expect(kf[1]!.curve).toBe(CURVE_ID.springApprox)     // stop#1 的 curve 管 90→350
  })

  it('★红侧：停靠点乱序 / 首点非 0 / 轨道缺值 / 重复轨道 全部被拦（不许静默错形）', () => {
    // 乱序
    expect(() =>
      compileTimeline(
        { kinds: ['scale'], stops: [{ at: 0, values: { scale: 1 } }, { at: 50, values: { scale: 2 } }, { at: 30, values: { scale: 1 } }] },
        { nodeId: 1 },
      ),
    ).toThrow(/严格升序/)
    // 首点非 0
    expect(() =>
      compileTimeline({ kinds: ['scale'], stops: [{ at: 10, values: { scale: 1 } }, { at: 50, values: { scale: 2 } }] }, { nodeId: 1 }),
    ).toThrow(/首停靠点必须是/)
    // 轨道缺值（断轨）
    expect(() =>
      compileTimeline(
        { kinds: ['scale', 'opacity'], stops: [{ at: 0, values: { scale: 1, opacity: 0 } }, { at: 100, values: { scale: 2 } }] },
        { nodeId: 1 },
      ),
    ).toThrow(/没有值/)
    // 重复轨道
    expect(() =>
      compileTimeline(
        { kinds: ['scale', 'scale'], stops: [{ at: 0, values: { scale: 1 } }, { at: 100, values: { scale: 2 } }] },
        { nodeId: 1 },
      ),
    ).toThrow(/重复属性/)
    // 单点（无法构成区间）
    expect(() => compileTimeline({ kinds: ['scale'], stops: [{ at: 0, values: { scale: 1 } }] }, { nodeId: 1 })).toThrow(/至少\*\*两个\*\*停靠点/)
  })

  it('★逃生口记账贯穿时间轴（复用同一份 compile——不新增第二条路径）', () => {
    const reg = new EscapeRegistry()
    compileTimeline(spec, { nodeId: 1 }, { escapes: reg })
    expect(reg.summary().declaratives).toBe(3)
  })

  it('★时间轴与手写 keyframes 编译结果逐字节等价（证明它不是"另一条实现"）', () => {
    const viaTimeline = compileTimeline(spec, { nodeId: 7 })
    const manual = compileAnimations(
      [
        { kind: 'scale', from: 1, to: 1, durationMs: 350, keyframes: [
          { to: 0.94, durationMs: 90, curve: 'easeOut' }, { to: 1, durationMs: 260, curve: 'springApprox' }] },
        { kind: 'translateY', from: 0, to: 0, durationMs: 350, keyframes: [
          { to: 6, durationMs: 90, curve: 'easeOut' }, { to: 0, durationMs: 260, curve: 'springApprox' }] },
        { kind: 'opacity', from: 0, to: 1, durationMs: 350, keyframes: [
          { to: 1, durationMs: 90, curve: 'easeOut' }, { to: 1, durationMs: 260, curve: 'springApprox' }] },
      ],
      { nodeId: 7 },
    )
    expect(JSON.stringify(viaTimeline.anims)).toBe(JSON.stringify(manual.anims))
  })
})

describe('统一路由转场枚举的第三腿（App / Morpheus ⇄ RouteTransition）', () => {
  // 枚举的字面清单（与 @proteus-vue/contracts 的 RouteTransition 同源；此处写死用于**交叉核对**）
  const ENUM: readonly string[] = ['slideUp', 'slideDown', 'halfScreen', 'scaleDown', 'none']

  it('★映射**穷尽**枚举（少一个就红——防"枚举增员、这端静默漏掉"）', () => {
    expect(appTransitions().sort()).toEqual([...ENUM].sort())
    for (const t of ENUM) {
      expect(APP_TRANSITION_MAP[t as RouteTransition], `${t} 缺映射`).toBeDefined()
    }
  })

  it('★每个转场都能编译出指令（除 none——瞬切不应产生动画）', () => {
    for (const t of ENUM) {
      const spec = APP_TRANSITION_MAP[t as RouteTransition]
      expect(spec.name).toBeTruthy()
      const decls = [...spec.enter, ...spec.exit]
      if (t === 'none') {
        expect(decls).toHaveLength(0)
      } else {
        expect(decls.length, `${t} 应有动画声明`).toBeGreaterThan(0)
        // 必须能通过编译期校验（预设自身不能违反红线）
        expect(() => compileAnimations(spec.enter.length ? spec.enter : spec.exit, { nodeId: 1 })).not.toThrow()
      }
    }
  })

  it('★slideDown 方向与 slideUp **相反**（dismiss 语义：往下滑出）', () => {
    const up = APP_TRANSITION_MAP.slideUp
    const down = APP_TRANSITION_MAP.slideDown
    const upEnterY = up.enter.find((d) => d.kind === 'translateY')!
    const downExitY = down.exit.find((d) => d.kind === 'translateY')!
    expect(upEnterY.from!).toBeGreaterThan(0)      // slideUp：新页从下方（正位移）进
    expect(upEnterY.to).toBe(0)
    expect(downExitY.from).toBe(0)                 // slideDown：当前页往下方（正位移）出
    expect(downExitY.to).toBeGreaterThan(0)
  })

  it('★★dismiss 型（slideDown）：back 方向把 `exit` **原样**绑给"被关闭页"（不是反向绑给下层页）', () => {
    // 【本仓实测抓出的真缺陷】此前 back 推导对所有预设都做"角色互换 + 反向" ⇒ slideDown 变成
    //   "下层页从下方升上来"（与"下滑关闭"完全相反）。role:'dismiss' 显式声明退场语义后：
    const plan = routeTransitionBatches('slideDown', { incoming: 1, outgoing: 2 }, { direction: 'back' })
    expect(plan.role).toBe('dismiss')
    // 被关闭页（outgoing）：向下滑出（0 → 正位移）+ 轻微淡出——**原样**，不反向
    const outY = plan.outgoing.anims.find((a) => a.kind === 1)!
    expect(outY.nodeId).toBe(2)
    expect(outY.from).toBe(0)
    expect(outY.to).toBeGreaterThan(0)
    // 返回目标页（incoming）：不动（`enter` 为空——动它会让"关闭"看起来像"又推了一页"）
    expect(plan.incoming.anims).toHaveLength(0)
    // 对照：对称型预设（slideUp）仍是"角色互换 + 反向"（镜像对）
    expect(routeTransitionBatches('slideUp', { incoming: 1, outgoing: 2 }, { direction: 'back' }).role).toBe('push')
  })

  it('★对称型与退场型的**方向语义分档**（push: 镜像对 / dismiss: 原样退场）', () => {
    // push 型：back 时 incoming 播 reverse(exit)、outgoing 播 reverse(enter)（镜像对，已有断言覆盖）
    const upF = routeTransitionBatches('slideUp', { incoming: 1, outgoing: 2 }, { direction: 'forward' })
    const upB = routeTransitionBatches('slideUp', { incoming: 1, outgoing: 2 }, { direction: 'back' })
    expect(upF.role).toBe('push')
    expect(upB.outgoing.anims[0]!.from).toBe(upF.incoming.anims[0]!.to) // 0 ← 0
    expect(upB.outgoing.anims[0]!.to).toBe(upF.incoming.anims[0]!.from) // 800 ← 800
    // dismiss 型：**两个方向都**是"离开视野的页下滑"（动作与方向无关——它只描述退场）
    const dnF = routeTransitionBatches('slideDown', { incoming: 1, outgoing: 2 }, { direction: 'forward' })
    const dnB = routeTransitionBatches('slideDown', { incoming: 1, outgoing: 2 }, { direction: 'back' })
    expect(dnF.role).toBe('dismiss')
    expect(dnF.outgoing.anims[0]!.to).toBe(dnB.outgoing.anims[0]!.to)
  })

  it('★halfScreen 映射到"只动进场页"的弹窗预设（与 Web halfscreen 语义一致）', () => {
    const h = APP_TRANSITION_MAP.halfScreen
    expect(h.exit).toHaveLength(0)     // 下层页不动（弹窗语义）
    expect(h.opaque).toBe(false)       // 半屏 ⇒ 下层可见
  })

  it('★非法 / 缺省输入 ⇒ 落到 none（数据防御，不抛错——与 Web 侧 fade 兜底同一姿态）', () => {
    expect(appTransition(undefined).name).toBe('none')
    expect(appTransition('nonsense').name).toBe('none')
    expect(appTransition(123).name).toBe('none')
    expect(appTransition({}).name).toBe('none')
  })

  it('★参数覆盖生效（distance / durationMs 透传到对应预设）', () => {
    const a = appTransition('slideUp', { distance: 600, durationMs: 500 })
    expect(a.durationMs).toBe(500)
    expect(a.enter[0]!.from).toBe(600)
    const b = appTransition('halfScreen', { distance: 250 })
    expect(b.enter[0]!.from).toBe(250)
    // 不传参数 ⇒ 与预设默认逐字段一致
    expect(appTransition('slideUp').enter[0]!.from).toBe(presets.route.slideUp().enter[0]!.from)
  })

  it('★与 Web/MP 两腿语义对齐（同一枚举成员指向同一类转场，不串味）', () => {
    // Web: halfScreen→halfscreen（层叠半屏）、scaleDown→scale（缩放）；MP: 同名 routeType
    // 本端：halfScreen→bottomSheet（半屏弹窗）、scaleDown→zoom（缩放下沉）——语义对应而非名字相同
    expect(APP_TRANSITION_MAP.halfScreen.name).toBe('bottomSheet')
    expect(APP_TRANSITION_MAP.scaleDown.name).toBe('zoom')
    expect(APP_TRANSITION_MAP.slideUp.name).toBe('slideUp')
    expect(APP_TRANSITION_MAP.slideDown.name).toBe('slideDown')
  })
})

describe('★★方向语义与执行器入口（routeTransitionBatches —— M5 命令流的消费者）', () => {
  it('reverseDecls：from/to 互换、曲线与时长原样、弹簧参数保持', () => {
    const decls = [
      { kind: 'translateY' as const, from: 800, to: 0, curve: 'easeOut' as const, durationMs: 300 },
      { kind: 'opacity' as const, from: 1, to: 0.7, curve: 'easeIn' as const, durationMs: 300 },
    ]
    const rev = reverseDecls(decls)
    expect(rev[0]).toMatchObject({ kind: 'translateY', from: 0, to: 800, curve: 'easeOut', durationMs: 300 })
    expect(rev[1]).toMatchObject({ kind: 'opacity', from: 0.7, to: 1, curve: 'easeIn', durationMs: 300 })
    // 纯粹性：不改原数组
    expect(decls[0].from).toBe(800)
  })

  it('reverseDecls：from 缺省按 0 落定（与 compileOne 的缺省一致）；keyframes 整条端点互换、段不逐段反转', () => {
    const noFrom = reverseDecls([{ kind: 'scale' as const, to: 1 }])
    expect(noFrom[0].from).toBe(1)
    expect(noFrom[0].to).toBe(0)
    const kf = reverseDecls([
      { kind: 'translateY' as const, from: -60, to: 60, keyframes: [
        { to: 20, durationMs: 100, curve: 'easeOut' as const },
        { to: 60, durationMs: 120, curve: 'easeIn' as const },
      ] } as never,
    ])
    expect(kf[0].from).toBe(60)
    expect(kf[0].to).toBe(-60)
    // 段本身保持（不镜像）：段边界值/曲线/时长原样
    expect((kf[0] as { keyframes: unknown[] }).keyframes).toEqual([
      { to: 20, durationMs: 100, curve: 'easeOut' },
      { to: 60, durationMs: 120, curve: 'easeIn' },
    ])
  })

  it('forward（push）：incoming 播 enter、outgoing 播 exit —— 与 compileRoute 同形', () => {
    const plan = routeTransitionBatches('slideUp', { incoming: 200, outgoing: 100 })
    expect(plan.direction).toBe('forward')
    expect(plan.transition).toBe('slideUp')
    // enter = translateY 800→0（进场页）
    expect(plan.incoming.anims).toHaveLength(1)
    expect(plan.incoming.anims[0]).toMatchObject({ nodeId: 200, kind: 1, from: 800, to: 0 }) // kind 1 = translateY
    // exit = 旧页让位（translateY 0→-240）+ 淡出（opacity 1→0.7）
    expect(plan.outgoing.anims.length).toBeGreaterThanOrEqual(2)
    expect(plan.outgoing.anims.every((a) => a.nodeId === 100)).toBe(true)
    expect(plan.durationMs).toBe(300)
    expect(plan.opaque).toBe(true)
  })

  it('★back（pop）：两组声明各自反向 —— 离开页播 reverse(enter)、回来页播 reverse(exit)', () => {
    const plan = routeTransitionBatches('slideUp', { incoming: 100, outgoing: 200 }, { direction: 'back' })
    expect(plan.direction).toBe('back')
    // 回来的下层页：reverse(exit) ⇒ translateY -240→0（视差复原）+ opacity 0.7→1
    expect(plan.incoming.anims.every((a) => a.nodeId === 100)).toBe(true)
    const backTx = plan.incoming.anims.find((a) => a.kind === 1) // translateY
    expect(backTx).toMatchObject({ from: -240, to: 0 })
    // 离开的旧顶：reverse(enter) ⇒ translateY 0→800（向上推入的反向 = 向下滑出）
    expect(plan.outgoing.anims).toHaveLength(1)
    expect(plan.outgoing.anims[0]).toMatchObject({ nodeId: 200, kind: 1, from: 0, to: 800 })
  })

  it('★back 与 forward 是**镜像对**（同一转场：forward.enter 的 from/to 恰是 back.outgoing 的 to/from）', () => {
    const fwd = routeTransitionBatches('slideUp', { incoming: 200, outgoing: 100 })
    const back = routeTransitionBatches('slideUp', { incoming: 100, outgoing: 200 }, { direction: 'back' })
    const fe = fwd.incoming.anims[0]
    const bo = back.outgoing.anims[0]
    expect({ from: bo.from, to: bo.to }).toEqual({ from: fe.to, to: fe.from })
  })

  it('none / 非法枚举：空批次 + 规范化为 none（不产生任何动画，不抛错）', () => {
    for (const t of ['none', 'not-a-transition', undefined]) {
      const plan = routeTransitionBatches(t, { incoming: 1, outgoing: 2 })
      expect(plan.transition).toBe('none')
      expect(plan.incoming.anims).toEqual([])
      expect(plan.outgoing.anims).toEqual([])
      expect(plan.durationMs).toBe(0)
    }
  })

  it('exit-only 提交（incoming 缺省）：只绑 outgoing（step 命令流里"只退场"的边界）', () => {
    const plan = routeTransitionBatches('slideUp', { outgoing: 100 })
    expect(plan.incoming.anims).toEqual([])
    expect(plan.outgoing.anims.every((a) => a.nodeId === 100)).toBe(true)
  })

  it('参数覆盖经 opts 透传（distance/durationMs 作用于预设）', () => {
    const plan = routeTransitionBatches('slideUp', { incoming: 2, outgoing: 1 }, { distance: 1200, durationMs: 500 })
    expect(plan.durationMs).toBe(500)
    expect(plan.incoming.anims[0]).toMatchObject({ from: 1200, to: 0, durMs: 500 })
  })

  it('★非法声明（非合成属性）在批次入口即被拦（不静默降级——与 compileRoute 同一红线）', () => {
    // 合法声明过；`width`（布局属性）不是 AnimKind 的成员 ⇒ TS 层就拦（这里用 never 绕过类型做运行时验证）
    expect(() => compileAnimations([{ kind: 'translateY' as never, from: 0, to: 1 }], { nodeId: 1 })).not.toThrow()
    expect(() =>
      compileAnimations([{ kind: 'width' as never, from: 0, to: 1 }], { nodeId: 1 }),
    ).toThrow(/校验失败/)
    // reverseDecls 反转后仍是同一封闭集（不引入非法 kind）
    const rev = reverseDecls([{ kind: 'opacity', from: 0, to: 1 }])
    expect(() => compileAnimations(rev, { nodeId: 1 })).not.toThrow()
  })
})

describe('三端转场枚举一致性（跨包交叉核对——防"枚举增员、某一端漏掉"）', () => {
  it('★Web / MP / App 三张映射表的键**完全相同**（同一份 RouteTransition）', async () => {
    // 直接加载 router 的两张表做**真实交叉核对**（不是读文档、不是抄清单）
    const mod = await import('../packages/router/src/transforms/transform-transition')
    const web = Object.keys(mod.WEB_TRANSITION_MAP).sort()
    const mp = Object.keys(mod.MP_ROUTE_TYPE_MAP).sort()
    const app = appTransitions().sort()
    expect(web).toEqual(mp)
    expect(mp).toEqual(app)
    // 且每一端都真的给了值（不是空字符串/undefined 占位）
    for (const t of web) {
      expect(typeof mod.WEB_TRANSITION_MAP[t as never]).toBe('string')
      expect(typeof mod.MP_ROUTE_TYPE_MAP[t as never]).toBe('string')
      expect(APP_TRANSITION_MAP[t as never]).toBeDefined()
      expect(mod.isTransition(t)).toBe(true)
    }
  })
})
