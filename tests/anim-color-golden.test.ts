// tests/anim-color-golden.test.ts
// ★★颜色跨语言契约：CSS 颜色解析 TS ⇄ Rust 同式（数值级 golden）+ 颜色动画的编译形态
//
// 【为什么必须有（本仓纪律：「跨端格式只能有一个实现」）】颜色解析是**跨语言契约**：
//   内核 `ffi.rs::parse_css_color` 解析**底色**（树 DTO 的字符串），
//   `@proteus-vue/animation` 的 `parseColorToChannels` 解析**动画的 from/to**。
//   两者规则若分叉 ⇒ "动画终点"与"复位回底色"对不上（端上出现颜色跳变），且**没有任何测试会红**。
//   ⇒ 本测试以内核**钉值表**（`cargo test --lib parse_css_color_matches_pinned_table` 的
//     同一批用例）为期望，比对 TS 半边 ⇒ 任一侧改规则而另一侧没跟 ⇒ 当场红。
//
// 【第二组：颜色动画的编译形态】颜色在用户面是**一条声明**、在内核面是**四条通道指令**
//   （见内核 `AnimKind::ColorR/G/B/A` 与 `compile.ts` 的 flatMap）。本组锁：
//   ① 一条 color 声明 → 4 条通道指令（kind 5/6/7/8），from/to 来自颜色解析；
//   ② `composited=false`（paint-only 但**非合成**——不进平台零参与路径）；
//   ③ 校验：非十六进制 / 位数非法 / `from` 缺失 都被拦下（**不静默落黑**）。
import { describe, it, expect } from 'vitest'
import {
  parseColorToChannels,
  packChannels,
  channelsToHex,
  compileAnimations,
  validateAnimations,
  isPaintOnly,
  isComposited,
  AnimKind,
} from '@proteus-vue/animation'
import type { ColorAnimDecl } from '@proteus-vue/animation'

/**
 * ★期望值 = **内核钉值表**（`packages/layout-core-rust/src/ffi.rs` 的 `COLOR_CASES`）
 *
 * 表里同一条数据两处消费：内核测试断言 Rust 侧解析，本测试断言 TS 侧解析。
 * ⇒ 新增颜色形态必须**同批**改两处（本仓的"跨语言契约"标准做法）。
 */
const RUST_PINNED: Array<{ input: string; packed: number; legal: boolean }> = [
  { input: '#f0a', packed: 0xff_ff00aa, legal: true },
  { input: '#33', packed: 0, legal: false },
  { input: '#12345', packed: 0, legal: false },
  { input: '#ff5533', packed: 0xffff5533, legal: true },
  { input: '#2f6fed', packed: 0xff2f6fed, legal: true },
  { input: '#11223344', packed: 0x44112233, legal: true },
  { input: '#00000000', packed: 0x00000000, legal: true },
  { input: '#ffffffff', packed: 0xffffffff, legal: true },
  { input: 'ff5533', packed: 0, legal: false },
  { input: '#gggggg', packed: 0, legal: false },
  { input: '#ABC', packed: 0xffaabbcc, legal: true },
]

describe('颜色 · 跨语言契约（TS ⇄ Rust 同一批钉值）', () => {
  for (const { input, packed, legal } of RUST_PINNED) {
    it(`解析 ${input}：${legal ? '合法性 + 打包值' : '必须被拒绝'}`, () => {
      if (legal) {
        const ch = parseColorToChannels(input)
        expect(packChannels(ch), `${input} 的打包值应与内核一致`).toBe(packed)
      } else {
        expect(() => parseColorToChannels(input), `${input} 应被拒绝`).toThrow()
      }
    })
  }

  it('★往返：通道 → hex → 通道（内部自洽）', () => {
    for (const { input, legal } of RUST_PINNED.filter((c) => c.legal)) {
      const ch = parseColorToChannels(input)
      const round = parseColorToChannels(channelsToHex(ch))
      expect(round).toEqual(ch)
    }
  })

  it('★8 位取 CSS4 序（低 8 位 = alpha）——与 Web 一致，不是 Android 的 AARRGGBB', () => {
    // '#11223344'：R=11 G=22 B=33 A=44
    const ch = parseColorToChannels('#11223344')
    expect(ch).toEqual({ r: 0x11, g: 0x22, b: 0x33, a: 0x44 })
    // 若误按 AARRGGBB 解析，会得到 a=0x11（断言打包值即拦住这个错法）
    expect(packChannels(ch)).toBe(0x44112233)
  })

  it('★简写展开：每通道**重复一位**（#f0a → #ff00aa，不是 #f000a0）', () => {
    expect(parseColorToChannels('#f0a')).toEqual({ r: 0xff, g: 0x00, b: 0xaa, a: 0xff })
  })

  it('严格性：两侧都不接受非十六进制 / 缺 # / 位数非法（不静默落黑）', () => {
    for (const bad of ['ff5533', '#gggggg', '#12345', '#33', 'red', 'rgb(1,2,3)']) {
      expect(() => parseColorToChannels(bad), `${bad} 应被拒绝`).toThrow()
    }
  })

  it('两端都不接受空串/纯空白（边界）', () => {
    expect(() => parseColorToChannels('')).toThrow()
    expect(() => parseColorToChannels('   ')).toThrow()
  })
})

describe('颜色 · 属性分类（paint-only 但非合成）', () => {
  it('color 是 paint-only、**非**合成（⇒ 不进平台零参与路径）', () => {
    expect(isPaintOnly('color')).toBe(true)
    expect(isComposited('color')).toBe(false)
  })

  it('标量五属性不受影响（回归：分类表没被改坏）', () => {
    for (const k of ['translateX', 'translateY', 'scale', 'rotate', 'opacity'] as const) {
      expect(isComposited(k)).toBe(true)
      expect(isPaintOnly(k)).toBe(false)
    }
  })
})

describe('颜色 · 编译形态（一条声明 → 四条通道指令）', () => {
  const decl: ColorAnimDecl = { kind: 'color', from: '#ff5533', to: '#2f6fed', durationMs: 200 }

  it('★一条 color 声明编译成 4 条通道指令（kind 5/6/7/8）', () => {
    const batch = compileAnimations([decl], { nodeId: 7 })
    expect(batch.anims).toHaveLength(4)
    expect(batch.anims.map((a) => a.kind)).toEqual([
      AnimKind.COLOR_R,
      AnimKind.COLOR_G,
      AnimKind.COLOR_B,
      AnimKind.COLOR_A,
    ])
    // from/to 来自颜色解析：#ff5533 → #2f6fed
    expect(batch.anims.map((a) => a.from)).toEqual([0xff, 0x55, 0x33, 0xff])
    expect(batch.anims.map((a) => a.to)).toEqual([0x2f, 0x6f, 0xed, 0xff])
    expect(batch.anims.every((a) => a.nodeId === 7)).toBe(true)
    expect(batch.anims.every((a) => a.durMs === 200)).toBe(true)
  })

  it('★batch.composited=false 且 nonComposited 含 color（不进平台路径）', () => {
    const batch = compileAnimations([decl], { nodeId: 7 })
    expect(batch.composited).toBe(false)
    expect(batch.nonComposited).toEqual(['color'])
  })

  it('混合批次：标量 + 颜色 ⇒ composited=false（整批不可走平台路径）', () => {
    const batch = compileAnimations(
      [{ kind: 'translateX', to: 10, durationMs: 100 }, decl],
      { nodeId: 7 },
    )
    expect(batch.anims).toHaveLength(5) // 1 标量 + 4 通道
    expect(batch.composited).toBe(false)
    expect(batch.nonComposited).toEqual(['color'])
  })

  it('曲线/延迟/接管透传到四条通道（同一份求值参数）', () => {
    const batch = compileAnimations(
      [{ kind: 'color', from: '#000000', to: '#ffffff', durationMs: 300, delayMs: 40, curve: 'linear', takeover: false }],
      { nodeId: 1 },
    )
    for (const a of batch.anims) {
      expect(a.delayMs).toBe(40)
      expect(a.takeover).toBe(false)
      // 'linear' = 曲线 0（跨语言编号）
      expect(a.curve).toBe(0)
    }
  })

  it('弹簧透传（逐通道独立积分；四条共用同一物理参数）', () => {
    const batch = compileAnimations(
      [{ kind: 'color', from: '#000000', to: '#ffffff', spring: { stiffness: 180, damping: 26, mass: 1 } }],
      { nodeId: 1 },
    )
    for (const a of batch.anims) {
      expect(a.spring).toEqual({ stiffness: 180, damping: 26, mass: 1 })
    }
  })
})

describe('颜色 · 编译期校验（都拦下，不静默）', () => {
  it('from 缺失 ⇒ invalid-range（内核对颜色无"缺省 = 当前值"语义）', () => {
    const issues = validateAnimations([
      { kind: 'color', to: '#ffffff', durationMs: 100 } as unknown as ColorAnimDecl,
    ])
    expect(issues.some((i) => i.code === 'invalid-range' && i.message.includes('from'))).toBe(true)
    expect(() =>
      compileAnimations([{ kind: 'color', to: '#ffffff', durationMs: 100 } as unknown as ColorAnimDecl], { nodeId: 1 }),
    ).toThrow() // 编译期就抛（不是运行时才发现）
  })

  it('非法颜色（位数/十六进制）⇒ 拦下并给修法提示', () => {
    const issues = validateAnimations([
      { kind: 'color', from: '#12345', to: '#ffffff', durationMs: 100 },
    ])
    const hit = issues.find((i) => i.code === 'invalid-range' && i.message.includes('from'))
    expect(hit).toBeTruthy()
    expect(hit!.hint).toContain('#RRGGBB')
  })

  it('颜色 + keyframes ⇒ 明确拦下（v1 边界，不静默忽略）', () => {
    const issues = validateAnimations([
      { kind: 'color', from: '#000000', to: '#ffffff', durationMs: 100, keyframes: [] } as unknown as ColorAnimDecl,
    ])
    expect(issues.some((i) => i.message.includes('keyframes'))).toBe(true)
  })

  it('颜色 + curve&spring 并存 ⇒ conflicting-easing', () => {
    const issues = validateAnimations([
      { kind: 'color', from: '#000000', to: '#ffffff', durationMs: 100, curve: 'linear', spring: { stiffness: 180, damping: 26 } },
    ])
    expect(issues.some((i) => i.code === 'conflicting-easing')).toBe(true)
  })

  // ══════════════════════════════════════════════════════════════
  // ★★文字色（2026-10-01）：与底色**同一条数学、不同的槽**
  // ══════════════════════════════════════════════════════════════
  it('textColor：一个声明 → 四条**文字色**通道（kind 9/10/11/12，不是 5..8）', () => {
    const batch = compileAnimations([{ kind: 'textColor', from: '#ffffff', to: '#000000' }], { nodeId: 3 })
    expect(batch.anims.map((a) => a.kind)).toEqual([9, 10, 11, 12])
    expect(batch.composited).toBe(false)
    expect(batch.nonComposited).toEqual(['textColor'])
  })

  it('★底色与文字色是**两组独立编号**（同时动时不会互相覆盖）', () => {
    const batch = compileAnimations(
      [
        { kind: 'color', from: '#000000', to: '#ffffff' },
        { kind: 'textColor', from: '#ffffff', to: '#000000' },
      ],
      { nodeId: 3 },
    )
    expect(batch.anims).toHaveLength(8)
    expect(batch.anims.map((a) => a.kind)).toEqual([5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('textColor 的 from 也必填（与底色同一条纪律）', () => {
    const issues = validateAnimations([
      { kind: 'textColor', to: '#ffffff', durationMs: 100 } as unknown as ColorAnimDecl,
    ])
    expect(issues.some((i) => i.message.includes('from'))).toBe(true)
  })

  // ══════════════════════════════════════════════════════════════
  // ★★颜色序列 keyframes（2026-10-01：v1 边界收掉）
  // ══════════════════════════════════════════════════════════════
  it('颜色 keyframes：四条通道各得一条多段序列（段表共用、终点逐段解析）', () => {
    const batch = compileAnimations(
      [
        {
          kind: 'color',
          from: '#000000',
          to: '#ff0000',
          durationMs: 300,
          keyframes: [
            { to: '#00ff00', durationMs: 100, curve: 'linear' },
            { to: '#ff0000', durationMs: 200, curve: 'linear' },
          ],
        },
      ],
      { nodeId: 5 },
    )
    expect(batch.anims).toHaveLength(4)
    // 每条通道都有自己的 2 段序列（R 通道：0 → 0 → 255）
    for (const a of batch.anims) {
      expect(a.keyframes).toHaveLength(2)
      expect(a.keyframes!.map((s) => s.durMs)).toEqual([100, 200])
      expect(a.keyframes!.map((s) => s.curve)).toEqual([0, 0]) // linear = 0
    }
    // R 通道：黑(0) → 绿(0) → 红(255)；G 通道：黑(0) → 绿(255) → 红(0)
    const r = batch.anims.find((a) => a.kind === AnimKind.COLOR_R)!
    const g = batch.anims.find((a) => a.kind === AnimKind.COLOR_G)!
    expect(r.keyframes!.map((s) => s.to)).toEqual([0, 255])
    expect(g.keyframes!.map((s) => s.to)).toEqual([255, 0])
    // 末段端点 = 声明的 to（端点钉死）
    expect(r.to).toBe(255)
  })

  it('颜色序列：段终点非法 / 总时长为零 / 末段与声明 to 不一致 ⇒ 各自拦下', () => {
    const badSeg = validateAnimations([
      { kind: 'color', from: '#000000', to: '#ffffff', keyframes: [{ to: 'nope', durationMs: 100 }] },
    ])
    expect(badSeg.some((i) => i.message.includes('段'))).toBe(true)

    const zero = validateAnimations([
      { kind: 'color', from: '#000000', to: '#ffffff', keyframes: [{ to: '#ffffff', durationMs: 0 }] },
    ])
    expect(zero.some((i) => i.message.includes('总时长为 0'))).toBe(true)

    const mismatch = validateAnimations([
      { kind: 'color', from: '#000000', to: '#ffffff', keyframes: [{ to: '#0000ff', durationMs: 100 }] },
    ])
    expect(mismatch.some((i) => i.message.includes('不一致'))).toBe(true)
  })

  it('颜色序列：末段与声明一致（大小写不敏感）⇒ 通过', () => {
    const okv = validateAnimations([
      { kind: 'color', from: '#000000', to: '#FFFFFF', keyframes: [{ to: '#ffffff', durationMs: 100 }] },
    ])
    expect(okv).toEqual([])
  })

  it('同色（from === to）合法但无视觉变化——不报错（与标量"同值"同口径）', () => {
    const issues = validateAnimations([{ kind: 'color', from: '#ff0000', to: '#ff0000', durationMs: 100 }])
    expect(issues).toEqual([])
  })
})
