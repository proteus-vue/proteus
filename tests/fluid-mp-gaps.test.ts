/**
 * 柔性布局系统 MP 端能力缺口 · 回归锁（2026-11-12，决策 #1493）
 *
 * 来源：外部实战报告第 15 轮 F-39~F-43（指定最高优先级）。五条同源——
 *   **柔性布局系统在 MP 端没接完**。逐条锁死判据：
 *
 *   F-39 p-fluid 表达式只接受纯数字 → `var(--x)` / 百分比 / auto 被**静默剥离**
 *        （柔性布局与 CSS 变量 token 体系无法共存）
 *   F-40 MP 产物是裸 calc 无 clamp 上下界 → viewportMax 之外不夹取；
 *        designWidth 偏离实际端时甚至外推出**负值**
 *   F-41 p-grid 的 minColWidth 是固定下限 → 手机端列数无法与手写断点方案对齐
 *   F-42 p-adaptive 在 MP 端模板 ref 拿不到元素 → onReady 首行就 return，整段逻辑被跳过
 *   F-43 MP 尺寸观察能力已实现（createMpSizeObserverFactory）但**零接线**
 *
 * ★破坏性验证（每条都要能红，见各 it 内的「破坏性」注释）
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseFluidExpr, linearFluid, fluidDecl } from '@proteus-vue/compiler'
import { compileVueSfc } from '@proteus-vue/compiler'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => fs.readFileSync(path.join(root, p), 'utf8')

describe('F-39 · p-fluid 表达式接受 var()/百分比/auto（不再静默剥离）', () => {
  it('parseFluidExpr 接受纯数字与单位/函数/关键字三类实参', () => {
    // 纯数字（对照：原本就支持）
    expect(parseFluidExpr('padding(16, 24)')).toEqual([
      { prop: 'padding', min: 16, max: 24, minRaw: '16', maxRaw: '24' },
    ])
    // var() / 百分比 / auto —— 这些原先整组不匹配且**无告警**
    const groups = parseFluidExpr('padding(var(--sp-4)) width(50%, 100%) margin(0, auto)')
    expect(groups.map((g) => g.prop)).toEqual(['padding', 'width', 'margin'])
    expect(groups[0].minRaw).toBe('var(--sp-4)')
    expect(groups[1].minRaw).toBe('50%')
    expect(groups[2].maxRaw).toBe('auto')
  })

  it('var() 组原样透传（不参与插值）——这是与 CSS 变量 token 体系共存的落点', () => {
    // 设计稿宽度 375、视口 [320,1440]；var() 无法插值 ⇒ 原样输出，不做 calc
    expect(fluidDecl({ prop: 'padding', min: 0, max: 0, minRaw: 'var(--sp-4)', maxRaw: 'var(--sp-4)' }, 375)).toBe(
      'padding: var(--sp-4)',
    )
    // 百分比同样原样（不是 px 插值）
    expect(fluidDecl({ prop: 'width', min: 0, max: 0, minRaw: '50%', maxRaw: '50%' }, 375)).toBe('width: 50%')
  })

  it('★编译期端到端：p-fluid="padding(var(--sp-4))" 必须产 style，不能剥空', () => {
    const out = compileVueSfc('<template><div p-fluid="padding(var(--sp-4))">x</div></template>', { px2rpx: true, rpxRatio: 2 }, { file: 't.vue' })
    expect(out.wxml, 'F-39：var() 被整条剥离').toContain('padding: var(--sp-4)')
    // 反面对照：仍是纯数字时走 clamp(calc(...))（原有行为不许退化）
    const out2 = compileVueSfc('<template><div p-fluid="padding(16, 24)">x</div></template>', { px2rpx: true, rpxRatio: 2 }, { file: 't.vue' })
    expect(out2.wxml).toMatch(/padding: clamp\(16px, calc\(/)
  })
})

describe('F-40 · MP 产物必须有 clamp 上下界（并夹住负值）', () => {
  it('流体产物在 viewportMax 之外不越界（1600 宽应为 max=32 而非 33.8）', () => {
    // designWidth=375 / viewportMax=1440 / font-size(20,32)
    const slope = (32 - 20) / (1440 - 375)
    const intercept = 20 - slope * 375
    const at1600 = intercept + slope * 1600
    expect(at1600).toBeGreaterThan(32) // 裸 calc 确实越界（缺陷本体：33.8 > 32）
    // ★修复判据：fluidDecl 产物必须是 clamp()，由 CSS 引擎夹取
    const css = fluidDecl({ prop: 'font-size', min: 20, max: 32, minRaw: '20', maxRaw: '32' }, 375, { min: 320, max: 1440 })
    expect(css).toMatch(/^font-size: clamp\(20px, calc\([^)]*\), 32px\)$/)
    // linearFluid 保持「纯线性段」语义（不带 clamp——调用方自行包，见 generateClamp）
    expect(linearFluid(20, 32, 375, { min: 320, max: 1440 })).toBe('calc(15.77px + 1.1268vw)')
  })

  it('designWidth 大于实际端时 clamp 下界兜住（不产生负值）', () => {
    // designWidth=1280 / viewportMax=1920 ⇒ 窄屏（390）代入线性式会远低于 min，甚至接近/越过 0
    const slope = (32 - 20) / (1920 - 1280)
    const intercept = 20 - slope * 1280
    const at390 = intercept + slope * 390
    // 裸 calc 在 390 宽只有 3.31px（远低于 min=20，已属严重越界）
    expect(at390).toBeLessThan(20)
    // 修复后：clamp 下界 20px 保证不会退到这种值（更不会为负）
    const css = fluidDecl({ prop: 'font-size', min: 20, max: 32, minRaw: '20', maxRaw: '32' }, 1280, { min: 320, max: 1920 })
    expect(css).toMatch(/^font-size: clamp\(20px,/)
  })

  it('★编译期端到端：MP 产物含 clamp', () => {
    const out = compileVueSfc('<template><div p-fluid="font-size(20, 32)">x</div></template>', {
      px2rpx: true,
      rpxRatio: 2,
      fluidLayout: { designWidth: 375, viewport: { min: 320, max: 1440 } },
    }, { file: 't.vue' })
    expect(out.wxml, 'F-40：MP 产物仍是裸 calc').toMatch(/clamp\(20px,\s*calc\(/)
  })
})

describe('F-41 · p-grid 的 minColWidth 支持按容器宽度变化', () => {
  it('calcColumns 在容器变窄时允许通过更小的 minColWidth 排更多列', () => {
    // 手写版 390 宽 = 3 列（min-width 96）；固定 142 只有 2 列
    expect(calcCols(390, 142, 12)).toBe(2) // 缺陷表现
    expect(calcCols(390, 96, 12)).toBe(3) // 手写版
  })

  it('★p-grid 支持流式下限（minColWidthMin + minColWidthVw → CSS max()/min()）', () => {
    const src = read('packages/components/p-grid/index.vue')
    // ① 新增的两个 prop 必须在位
    expect(src, 'F-41：缺 minColWidthMin').toContain('minColWidthMin')
    expect(src, 'F-41：缺 minColWidthVw').toContain('minColWidthVw')
    // ② ★必须是**可执行**的 CSS 表达式生成（不是只在注释里提一句）：
    //    从源码里抽出 colWidthCss 的 computed 体并真跑——只查字符串存在等于没查（破坏性验证已证伪）。
    const m = /const colWidthCss = computed<string>\(\(\) => \{([\s\S]*?)\n\}\)/.exec(src)
    expect(m, 'F-41：找不到 colWidthCss computed（实现被删？）').toBeTruthy()
    const body = m![1]
    // 用真实 props 值驱动：模拟 Vue computed 的求值
    const evalWith = (p: { minColWidth: number; minColWidthMin: number; minColWidthVw: number }): string => {
      const fn = new Function('props', body) as (p: typeof p) => string
      return fn(p)
    }
    // 未启用流式 → 固定值（旧行为不变）
    expect(evalWith({ minColWidth: 142, minColWidthMin: 0, minColWidthVw: 0 })).toBe('142px')
    // 启用 → CSS max()/min() 表达式
    expect(evalWith({ minColWidth: 142, minColWidthMin: 96, minColWidthVw: 22 })).toBe(
      'max(96px, min(142px, 22vw))',
    )
    // ③ CSS 语义确认：上述表达式在 390 宽解出 96px → 3 列（与手写断点方案一致）
    const at390 = Math.max(96, Math.min(142, 0.22 * 390)) // 85.8 → 被 min 抬回 96
    expect(at390).toBe(96)
    expect(calcCols(390, at390, 12)).toBe(3)
    // 宽屏封顶：1920 宽下 22vw=422.4 → 被 max 压回 142
    expect(Math.max(96, Math.min(142, 0.22 * 1920))).toBe(142)
  })

  // ★F-41 第二道锁（补「删 prop 声明测试仍绿」的漏洞）：
  //   上面那条只验证 computed 体；删掉 defineProps 里的声明后 body 仍能读到 undefined 而跑通。
  //   这条直接对 **defineProps 块**断言——那是 prop 声明的唯一来源（编译期静态提取靠它）。
  it('★p-grid 的 minColWidthMin / minColWidthVw 必须在 defineProps 里声明', () => {
    const sfc = read('packages/components/p-grid/index.vue')
    const m = /defineProps\(\{([\s\S]*?)\n\}\)/.exec(sfc)
    expect(m, 'F-41：找不到 defineProps 块').toBeTruthy()
    const block = m![1]
    expect(block, 'F-41：defineProps 缺 minColWidthMin 声明').toMatch(/minColWidthMin\s*:\s*\{\s*type:\s*Number/)
    expect(block, 'F-41：defineProps 缺 minColWidthVw 声明').toMatch(/minColWidthVw\s*:\s*\{\s*type:\s*Number/)
    expect(block, 'F-41：minColWidth 本身不得丢').toMatch(/minColWidth\s*:\s*\{\s*type:\s*Number/)
  })
})

describe('F-42/F-43 · p-adaptive 在 MP 端必须接线尺寸测量', () => {
  it('★组件源码必须使用 mpContainerObserverFactory（否则 ref 拿不到 → 整段逻辑跳过）', () => {
    const src = read('packages/components/p-adaptive/index.vue')
    expect(src, 'F-42/F-43：p-adaptive 未接线 MP 测量源').toContain('mpContainerObserverFactory')
    // 且必须真的把 factory 传给 createAdaptiveController
    expect(src).toMatch(/createAdaptiveController\s*\([^)]*createObserver/)
  })

  it('★不得再有「if (!wrapEl) return」把 MP 整段跳过', () => {
    const src = read('packages/components/p-adaptive/index.vue')
    expect(src).not.toMatch(/if\s*\(\s*!\s*wrapEl\.value\s*\)\s*return/)
  })

  it('MP 测量工厂在非 MP 运行时返回 null（Web 仍走 ResizeObserver）', async () => {
    // 同 tests/container-measure.test.ts 的导入形态（package exports 未声明该子路径）
    const mod = await import('../packages/components/runtime/container-measure')
    // 测试环境（happy-dom）不是 mp 运行时 ⇒ 应为 null，调用方回退 RO
    expect(mod.mpContainerObserverFactory('.x')).toBe(null)
  })
})

/** 列数求解（与 fluid-layout.calcColumns 同式；此处内联以便对照手写断点方案） */
function calcCols (viewportWidth: number, minColWidth: number, gap: number): number {
  return Math.max(1, Math.floor((viewportWidth + gap) / (minColWidth + gap)))
}
