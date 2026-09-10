// tests/svg-canvas.test.ts
// ★2026-09-09 G-62 Canvas 通道：含**形状变化动画**的 SVG → p-svg-canvas 组件（离屏 canvas 逐帧绘制）。
//   为什么：<image> 静态光栅化（内部动画不播放，§11.1 MD5 证明）+ CSS 只能做整体变换（§11.1c）。
//   实测（§12.2 探针）：离屏 canvas 可用（createPath2D 直接接受 SVG d / rAF 62fps / toDataURL 2ms），
//   可见 canvas 的 SelectorQuery.node() 拿不到（正常运行时同样 TIMEOUT）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { compileVueSfc } from '../packages/compiler/src/index'
import { sampleValues, evalAnim, primitiveToPathD, drawScene, shouldEmit } from '../src/components/p-svg-canvas/engine'
import { tracePath, getPointAtLength, getPathLength } from '../src/components/p-svg-canvas/path-parser'

const compile = (template: string) => compileVueSfc(`<template>${template}</template>`, { filename: 't.vue' }) as any

describe('G-62 Canvas 通道：形状变化动画 → p-svg-canvas', () => {
  it('位置移动（cx）→ 组件 + 场景数据注入', () => {
    const r = compile(
      '<svg viewBox="0 0 100 100" width="150" height="150"><circle cx="20" cy="50" r="14" fill="#3498db">' +
        '<animate attributeName="cx" values="20;80;20" dur="2s" repeatCount="indefinite"/></circle></svg>',
    )
    expect(r.wxml).toMatch(/<p-svg-canvas[^>]*scene="\{\{proteusSvgScene1\}\}"/)
    expect(r.wxml).toMatch(/width="150"/)
    expect(r.js).toMatch(/proteusSvgScene1:/)
    // 场景结构：viewBox + nodes + duration
    expect(r.js).toMatch(/"viewBox":\[0,0,100,100\]/)
    expect(r.js).toMatch(/"duration":2000/)
    expect(r.js).toMatch(/"attr":"cx"/)
  })

  it('描边进度（stroke-dashoffset）→ 组件', () => {
    const r = compile(
      '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="35" fill="none" stroke="#9b59b6" stroke-width="8" stroke-dasharray="220">' +
        '<animate attributeName="stroke-dashoffset" from="220" to="0" dur="2s" repeatCount="indefinite"/></circle></svg>',
    )
    expect(r.wxml).toMatch(/<p-svg-canvas/)
    expect(r.js).toMatch(/"attr":"stroke-dashoffset"/)
  })

  it('整体变换（rotate）不走 canvas（CSS 方案更优——零运行时）', () => {
    const r = compile(
      '<svg viewBox="0 0 100 100"><rect x="30" y="30" width="40" height="40" fill="#e74c3c">' +
        '<animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="2s"/></rect></svg>',
    )
    expect(r.wxml).not.toMatch(/<p-svg-canvas/)
    expect(r.wxss).toMatch(/@keyframes proteus-svg-anim/)
  })

  it('无动画 SVG 不走 canvas（image 方案更优）', () => {
    const r = compile('<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>')
    expect(r.wxml).not.toMatch(/<p-svg-canvas/)
    expect(r.wxml).toMatch(/<image[^>]*data:image\/svg\+xml/)
  })

  it('源码 <svg> 上的事件绑定透传到 <p-svg-canvas>（@tick → bind:tick）', () => {
    const r = compile(
      '<svg viewBox="0 0 100 100" width="120" height="120" @tick="onTick"><circle cx="20" cy="50" r="14">' +
        '<animate attributeName="cx" values="20;80;20" dur="2s"/></circle></svg>',
    )
    // 事件透传（此前 lowering 丢弃 → 组件事件收不到）
    expect(r.wxml).toMatch(/<p-svg-canvas[^>]*bind:tick="onTick"/)
  })

  it('非简单方法引用的事件不透传（避免生成无效绑定）', () => {
    const r = compile(
      '<svg viewBox="0 0 100 100" @tick="onTick(1)"><circle cx="20" cy="50" r="14">' +
        '<animate attributeName="cx" values="20;80" dur="1s"/></circle></svg>',
    )
    expect(r.wxml).not.toMatch(/bind:tick/)
  })

  it('规则 template/svg-canvas 可禁用', () => {
    const r = compileVueSfc(
      '<template><svg viewBox="0 0 100 100"><circle cx="20" cy="50" r="14"><animate attributeName="cx" values="20;80" dur="1s"/></circle></svg></template>',
      { filename: 't.vue', rules: { disabled: ['template/svg-canvas'] } },
    ) as any
    expect(r.wxml).not.toMatch(/<p-svg-canvas/)
  })
})

describe('Canvas 引擎核心（插值 / 几何）', () => {
  it('sampleValues 分段线性插值', () => {
    expect(sampleValues(['1', '0.5', '1'], 0)).toBe('1')
    expect(sampleValues(['1', '0.5', '1'], 0.5)).toBe('0.5')
    expect(sampleValues(['1', '0.5', '1'], 1)).toBe('1')
    expect(sampleValues(['20', '80'], 0.5)).toBe('50')
  })

  it('evalAnim 时间轴求值（循环 / 延迟）', () => {
    const anim = { attr: 'cx', values: ['20', '80'], dur: 1000, delay: 0, repeat: true }
    expect(evalAnim(anim, 0)).toBe('20')
    expect(evalAnim(anim, 500)).toBe('50')
    expect(evalAnim(anim, 1000)).toBe('20') // 循环回起点
  })

  it('primitiveToPathD 基础图形转 path', () => {
    expect(primitiveToPathD({ tag: 'circle', attrs: { cx: 50, cy: 50, r: 20 } } as never, 0)).toContain('A20 20')
    expect(primitiveToPathD({ tag: 'rect', attrs: { x: 10, y: 10, width: 30, height: 20 } } as never, 0)).toBe('M10 10 H40 V30 H10 Z')
    expect(primitiveToPathD({ tag: 'line', attrs: { x1: 0, y1: 0, x2: 10, y2: 10 } } as never, 0)).toBe('M0 0 L10 10')
  })
})

describe('SVG path 解析器（真机 createPath2D 不可用 → 自写解析）', () => {
  /** 记录命令序列的 mock target */
  function mockTarget() {
    const calls: string[] = []
    return {
      calls,
      beginPath: () => calls.push('begin'),
      moveTo: (x: number, y: number) => calls.push(`M${x},${y}`),
      lineTo: (x: number, y: number) => calls.push(`L${x},${y}`),
      bezierCurveTo: () => calls.push('C'),
      quadraticCurveTo: () => calls.push('Q'),
      arc: (cx: number, cy: number, r: number) => calls.push(`A${cx},${cy},${r}`),
      closePath: () => calls.push('Z'),
    }
  }
  it('M/L/H/V/Z 基本命令', () => {
    const t = mockTarget()
    tracePath(t, 'M10 10 L30 10 H50 V40 Z')
    expect(t.calls).toEqual(['M10,10', 'L30,10', 'L50,10', 'L50,40', 'Z'])
  })
  it('相对命令 m/l/h/v', () => {
    const t = mockTarget()
    tracePath(t, 'm10 10 l20 0 h20 v30 z')
    expect(t.calls).toEqual(['M10,10', 'L30,10', 'L50,10', 'L50,40', 'Z'])
  })
  it('三次贝塞尔 C/S', () => {
    const t = mockTarget()
    tracePath(t, 'M0 0 C10 10 20 20 30 30 S50 50 60 60')
    expect(t.calls.filter((c) => c === 'C').length).toBe(2)
  })
  it('二次贝塞尔 Q/T', () => {
    const t = mockTarget()
    tracePath(t, 'M0 0 Q10 10 20 0 T40 0')
    expect(t.calls.filter((c) => c === 'Q').length).toBe(2)
  })
  it('圆弧 A → 原生真曲线（真机离屏 canvas 支持 arc/ellipse——消除锯齿）', () => {
    const t = mockTarget()
    tracePath(t, 'M10 50 A20 20 0 0 1 50 50')
    // 有 arc 能力 → 下发一条原生弧命令，不再折线离散
    expect(t.calls.filter((c) => c.startsWith('A')).length).toBe(1)
    expect(t.calls.filter((c) => c.startsWith('L')).length).toBe(0)
  })
  it('圆弧 A 回退：目标无 arc/ellipse 时折线近似（采样/mock 场景）', () => {
    const calls: string[] = []
    // 仅实现基础命令的 target（无 arc/ellipse）
    const bare = {
      beginPath() {}, moveTo() {}, lineTo: () => calls.push('L'),
      bezierCurveTo() {}, quadraticCurveTo() {}, closePath() {},
    }
    tracePath(bare, 'M10 50 A20 20 0 0 1 50 50')
    expect(calls.length).toBeGreaterThan(4)
  })
  it('科学计数法 / 负数 / 小数', () => {
    const t = mockTarget()
    tracePath(t, 'M-1.5 -2.5 L1e2 3.5')
    expect(t.calls).toEqual(['M-1.5,-2.5', 'L100,3.5'])
  })
})

describe('描边动画（stroke-dasharray / stroke-dashoffset）', () => {
  it('drawScene 设置 setLineDash + lineDashOffset（dashoffset 随时间插值）', () => {
    const calls: string[] = []
    const ctx: any = {
      fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1, lineCap: '', lineJoin: '', lineDashOffset: 0,
      setLineDash: (s: number[]) => calls.push('dash=' + JSON.stringify(s)),
      save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, setTransform() {}, clearRect() {},
      beginPath() {}, moveTo() {}, lineTo() {}, bezierCurveTo() {}, quadraticCurveTo() {}, arc() {}, closePath() {},
      fill() {}, stroke() {}, fillRect() {},
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
    }
    const canvas: any = { width: 120, height: 120, getContext: () => ctx }
    const scene: any = {
      viewBox: [0, 0, 100, 100],
      nodes: [{
        tag: 'circle',
        attrs: { cx: 50, cy: 50, r: 35, fill: 'none', stroke: '#9b59b6', 'stroke-width': 8, 'stroke-dasharray': 220, 'stroke-dashoffset': 220 },
        anims: [{ attr: 'stroke-dashoffset', values: ['220', '0'], dur: 2000, delay: 0, repeat: true }],
      }],
      duration: 2000,
    }
    drawScene(canvas, scene, 0)
    expect(calls).toContain('dash=[220]')
    expect(ctx.lineDashOffset).toBe(220)
    drawScene(canvas, scene, 1000)
    expect(ctx.lineDashOffset).toBe(110) // 插值中
  })
})

describe('animateMotion 路径运动（真机验证）', () => {
  it('路径采样：按弧长取点（起点/中点/终点）', () => {
    const d = 'M10 50 Q50 10 90 50'
    const p0 = getPointAtLength(d, 0)
    const p5 = getPointAtLength(d, 0.5)
    const p1 = getPointAtLength(d, 1)
    expect(p0?.x).toBeCloseTo(10, 1)
    expect(p0?.y).toBeCloseTo(50, 1)
    expect(p5?.x).toBeCloseTo(50, 0)
    expect(p5?.y).toBeCloseTo(30, 0) // 二次贝塞尔顶点
    expect(p1?.x).toBeCloseTo(90, 1)
    expect(p1?.y).toBeCloseTo(50, 1)
  })

  it('路径总长度（弧长累计）', () => {
    expect(getPathLength('M0 0 L10 0')).toBeCloseTo(10, 3)
    expect(getPathLength('M0 0 L10 0 L10 10')).toBeCloseTo(20, 3)
  })

  it('animateMotion 编译 → p-svg-canvas + attr=motion + 路径数据', () => {
    const r = compile('<svg viewBox="0 0 100 100"><circle r="8" fill="#e74c3c"><animateMotion dur="2s" repeatCount="indefinite" path="M10 50 Q50 10 90 50"/></circle></svg>')
    expect(r.wxml).toMatch(/<p-svg-canvas[^>]*scene="\{\{proteusSvgScene1\}\}"/)
    expect(r.js).toMatch(/"attr":"motion"/)
    expect(r.js).toMatch(/"values":\["M10 50 Q50 10 90 50"\]/)
  })

  it('drawScene 应用路径运动（不同时刻 translate 不同）', () => {
    const seen: number[] = []
    const ctx: any = {
      fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1, lineCap: '', lineJoin: '', lineDashOffset: 0,
      setLineDash() {},
      save() {}, restore() {}, translate: (x: number) => seen.push(x), rotate() {}, scale() {}, setTransform() {},
      clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, bezierCurveTo() {}, quadraticCurveTo() {},
      arc() {}, closePath() {}, fill() {}, stroke() {}, fillRect() {},
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
    }
    const canvas: any = { width: 100, height: 100, getContext: () => ctx }
    const scene: any = {
      viewBox: [0, 0, 100, 100],
      nodes: [{ tag: 'circle', attrs: { r: 8, fill: '#e74c3c' }, anims: [{ attr: 'motion', values: ['M10 50 L90 50'], dur: 2000, delay: 0, repeat: true }] }],
      duration: 2000,
    }
    drawScene(canvas, scene, 0)
    const x0 = seen[seen.length - 1]
    seen.length = 0
    drawScene(canvas, scene, 1000)
    const x1 = seen[seen.length - 1]
    expect(x0).toBeCloseTo(10, 0) // 起点
    expect(x1).toBeCloseTo(50, 0) // 中点
  })
})

describe('Canvas 通道渐变支持（url(#id) → createGradient）', () => {
  it('场景收集渐变定义（linear/radial + stops）', () => {
    const r = compile(
      '<svg viewBox="0 0 100 100"><defs><radialGradient id="g"><stop offset="0%" stop-color="#fff" stop-opacity="1"/><stop offset="100%" stop-color="#00f" stop-opacity="0.5"/></radialGradient></defs>' +
        '<circle cx="50" cy="50" r="30" fill="url(#g)"><animate attributeName="r" values="30;20;30" dur="1s"/></circle></svg>',
    )
    expect(r.js).toMatch(/"gradients":\{/)
    expect(r.js).toMatch(/"type":"radial"/)
    expect(r.js).toMatch(/"color":"#fff"/)
    expect(r.js).toMatch(/"opacity":0.5/)
  })

  it('drawScene 把 url(#id) 解析为 Canvas 渐变（fillStyle 收到渐变对象）', () => {
    const gradCalls: string[] = []
    const ctx: any = {
      fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1, lineCap: '', lineJoin: '', lineDashOffset: 0,
      setLineDash() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, setTransform() {},
      clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, bezierCurveTo() {}, quadraticCurveTo() {},
      arc() {}, closePath() {}, fill() { gradCalls.push('fill:' + typeof this.fillStyle) }, stroke() {}, fillRect() {},
      createLinearGradient: () => { gradCalls.push('createLinear'); return { addColorStop() { gradCalls.push('stop') } } },
      createRadialGradient: () => { gradCalls.push('createRadial'); return { addColorStop() { gradCalls.push('stop') } } },
    }
    const canvas: any = { width: 100, height: 100, getContext: () => ctx }
    const scene: any = {
      viewBox: [0, 0, 100, 100],
      nodes: [{ tag: 'circle', attrs: { cx: 50, cy: 50, r: 30, fill: 'url(#g)' }, anims: [{ attr: 'r', values: ['30', '20'], dur: 1000, delay: 0, repeat: true }] }],
      duration: 1000,
      gradients: { g: { type: 'radial', stops: [{ offset: 0, color: '#fff', opacity: 1 }, { offset: 1, color: '#00f', opacity: 0.5 }], cx: 0.5, cy: 0.5, r: 0.5 } },
    }
    drawScene(canvas, scene, 0)
    expect(gradCalls).toContain('createRadial')
    expect(gradCalls.filter((c) => c === 'stop').length).toBe(2)
    expect(gradCalls).toContain('fill:object') // fillStyle 被设为渐变对象
  })

  it('stop-opacity 合成进颜色（canvas addColorStop 不认 opacity）', () => {
    const colors: string[] = []
    const ctx: any = {
      fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1, lineCap: '', lineJoin: '', lineDashOffset: 0,
      setLineDash() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, setTransform() {},
      clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, bezierCurveTo() {}, quadraticCurveTo() {},
      arc() {}, closePath() {}, fill() {}, stroke() {}, fillRect() {},
      createLinearGradient: () => ({ addColorStop: (_o: number, c: string) => colors.push(c) }),
      createRadialGradient: () => ({ addColorStop: (_o: number, c: string) => colors.push(c) }),
    }
    const canvas: any = { width: 100, height: 100, getContext: () => ctx }
    const scene: any = {
      viewBox: [0, 0, 100, 100],
      nodes: [{ tag: 'rect', attrs: { x: 0, y: 0, width: 100, height: 100, fill: 'url(#g)' }, anims: [{ attr: 'width', values: ['100', '50'], dur: 1000, delay: 0, repeat: true }] }],
      duration: 1000,
      gradients: { g: { type: 'linear', stops: [{ offset: 0, color: '#ffffff', opacity: 0.5 }, { offset: 1, color: '#0000ff', opacity: 1 }], x1: 0, y1: 0, x2: 1, y2: 0 } },
    }
    drawScene(canvas, scene, 0)
    expect(colors[0]).toBe('rgba(255,255,255,0.5)') // opacity 合成
    expect(colors[1]).toBe('#0000ff') // opacity=1 原样
  })
})

describe('回传节流（真机「15 秒后动画停止」根因——相位回绕）', () => {
  it('shouldEmit 用单调时间：跨多个动画周期仍持续发帧', () => {
    const fps = 20
    const dur = 4500 // 演示页主场景周期
    const step = 50
    let lastEmit: number | undefined
    const emits: number[] = []
    for (let elapsed = 0; elapsed <= 30000; elapsed += step) {
      // 相位（elapsed % dur）只用于插值；节流必须用 elapsed
      if (shouldEmit(lastEmit, elapsed, fps)) {
        lastEmit = elapsed
        emits.push(elapsed)
      }
    }
    // 30s / 50ms = 600 帧 → 按 20fps 约 300 次回传
    expect(emits.length).toBeGreaterThan(250)
    // 关键：一个周期（4500ms）之后仍有回传
    expect(emits.filter((t) => t > dur).length).toBeGreaterThan(150)
    expect(emits[emits.length - 1]).toBeGreaterThan(29000)
  })

  it('回归护栏：若误用相位时间做节流 → 一个周期后永久停发（此测试证明该 bug 存在）', () => {
    const fps = 20
    const dur = 4500
    const step = 50
    let lastPhase: number | undefined
    const emits: number[] = []
    for (let elapsed = 0; elapsed <= 30000; elapsed += step) {
      const phase = elapsed % dur
      if (lastPhase === undefined || phase - lastPhase >= 1000 / fps) {
        lastPhase = phase
        emits.push(elapsed)
      }
    }
    // 相位回绕 → 最后一个 emit 落在第一个周期内，之后 25s 零发帧
    expect(emits[emits.length - 1]).toBeLessThan(dur)
  })

  it('组件源码契约：src 只用裸 tempFilePath（真机 wxfile:// 拼查询参数不渲染）', () => {
    const src = readFileSync(new URL('../src/components/p-svg-canvas/index.vue', import.meta.url), 'utf-8')
    expect(src).not.toMatch(/tempFilePath\s*\+\s*['"`]\?/)
    expect(src).toMatch(/this\.setSrc\(r\.tempFilePath\)/)
  })
})
