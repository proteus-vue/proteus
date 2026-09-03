// packages/test-ir/src/breakpoint.ts
// ★G-44 B1/B2 前置：三维断点矩阵参数化生成器（G-25 首次被自动化——100 profiles，非手写）
//   W ∈ {320,600,840,1200,1920} × H ∈ {480,720,1080,1200} × F ∈ {touch,cursor,remote,dial,voice}
//   形态求解对齐 p-adaptive 缺省三档：sheet < 840 ≤ dialog < 1200 ≤ popover
import type { Profile3D, TestIR } from './types'

export const W_BREAK = [320, 600, 840, 1200, 1920] as const
export const H_BREAK = [480, 720, 1080, 1200] as const
export const F_FORMS = ['touch', 'cursor', 'remote', 'dial', 'voice'] as const

/** p-adaptive 形态求解（宽度档位——与 computeAdaptiveForm 缺省档对齐） */
export function formForWidth(w: number): 'sheet' | 'dialog' | 'popover' {
  if (w >= 1200) return 'popover'
  if (w >= 840) return 'dialog'
  return 'sheet'
}

/** ★参数化生成断点矩阵 Test IR（5W × 4H × 5F = 100 个——G-25 自动化载体） */
export function generateBreakpointSuite(): TestIR[] {
  const cases: TestIR[] = []
  let seq = 0
  for (const w of W_BREAK) {
    for (const h of H_BREAK) {
      for (const f of F_FORMS) {
        const profile: Profile3D = { w, h, f }
        cases.push({
          id: `T-bp-${String(seq++).padStart(3, '0')}`,
          name: `profile ${w}x${h}/${f}`,
          target: { layer: 'breakpoint', capability: 'resolveProfile' },
          arrange: { type: 'p-adaptive' },
          act: [
            { op: 'resize', w, h },
            { op: 'setFormFactor', f },
          ],
          assert: [
            { kind: 'eq', path: 'root.children[0].attrs.form', value: formForWidth(w) },
            { kind: 'eq', path: `inputMode.${f}`, value: true },
          ],
          profile,
          backend: 'device',
          tags: ['breakpoint', 'conformance'],
        })
      }
    }
  }
  return cases
}
