// tests/mp-spec-coverage.test.ts
// ★权威标尺（2026-09-12）：官方清单 spec 驱动覆盖度门禁——修「手写矩阵自证同义反复」。
//   标尺 = docs/generated/miniprogram-official-spec.json（官方组件索引 84 + 官方 typings API 298）。
//   本测试证明：① 每个官方项都被归类（gap=0）；② covered 不回归（棘轮）；③ 分类器可失败。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  auditSpecCoverage,
  classifySpecApi,
  classifySpecComponent,
  MP_MAPPING_MATRIX,
  SPEC_RATCHET,
  SPEC_COVERED,
  SPEC_PLANNED,
  SPEC_PRIVATE,
  SPEC_NA,
  SPEC_COMPONENT_OVERRIDE,
} from '@proteus-vue/component-ir'
import type { MpOfficialSpec } from '@proteus-vue/component-ir'

const SPEC_PATH = fileURLToPath(new URL('../docs/generated/miniprogram-official-spec.json', import.meta.url))
const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as MpOfficialSpec

describe('★权威标尺：官方清单 spec 驱动覆盖度', () => {
  it('快照健壮（官方组件 + API 足量，防测试自身失效）', () => {
    expect(spec.components.length).toBeGreaterThanOrEqual(80)
    expect(spec.apis.length).toBeGreaterThanOrEqual(250)
    // 已知官方项抽查
    expect(spec.components).toContain('canvas')
    expect(spec.apis).toContain('createCanvasContext')
  })

  it('★每个官方项都被归类（gap = 0——无「未归类」漏网）', () => {
    const r = auditSpecCoverage(spec, MP_MAPPING_MATRIX)
    expect(r.gaps).toEqual([])
    expect(r.gap).toBe(0)
    expect(r.accounted).toBe(r.total)
    expect(r.classifiedPercent).toBe(100)
  })

  it('★覆盖棘轮：covered 不回归 + gap 不超标', () => {
    const r = auditSpecCoverage(spec, MP_MAPPING_MATRIX)
    expect(r.covered).toBeGreaterThanOrEqual(SPEC_RATCHET.coveredMin)
    expect(r.gap).toBeLessThanOrEqual(SPEC_RATCHET.gapMax)
  })

  it('诚实指标：真·落地率 = covered / (covered+planned)（非「已归类率」）', () => {
    const r = auditSpecCoverage(spec, MP_MAPPING_MATRIX)
    expect(r.actionable).toBe(r.covered + r.planned)
    expect(r.landedPercent).toBe(Math.round((r.covered / r.actionable) * 100))
    // 落地率应是「真实但不等于 100」——防止有人把 planned 也算成已落地
    expect(r.landedPercent).toBeLessThan(100)
    expect(r.landedPercent).toBeGreaterThan(50)
  })

  it('planned 清单可见（规划待落地逐条列出，非黑盒）', () => {
    const r = auditSpecCoverage(spec, MP_MAPPING_MATRIX)
    expect(r.plannedItems.length).toBe(r.planned)
    // ★API 侧 planned 已清零；剩余 planned 均为组件侧（来自矩阵 planned 行——需原生渲染/宿主）
    const apiPlanned = r.plannedItems.filter((p) => p.kind === 'api')
    expect(apiPlanned).toEqual([])
    expect(r.plannedItems.every((p) => p.kind === 'component')).toBe(true)
  })

  it('分类器：覆盖五态语义（covered/planned/private/na/gap）', () => {
    expect(classifySpecApi('createCanvasContext').status).toBe('covered')
    expect(classifySpecApi('createUDPSocket').status).toBe('covered')
    expect(classifySpecApi('createVKSession').status).toBe('covered')
    // ★API 侧 planned 清零——planned 现仅剩组件侧（需原生渲染/宿主能力）
    expect(classifySpecComponent('camera', MP_MAPPING_MATRIX).status).toBe('covered')
    expect(classifySpecApi('requestMerchantTransfer').status).toBe('private')
    expect(classifySpecApi('nextTick').status).toBe('na')
    // 未归类 → gap（防漏网）
    expect(classifySpecApi('totallyUnknownApi123').status).toBe('gap')
  })

  it('组件分类：矩阵登记 + override 双通道', () => {
    expect(classifySpecComponent('canvas', MP_MAPPING_MATRIX).status).toBe('covered')
    expect(classifySpecComponent('checkbox-group', MP_MAPPING_MATRIX).status).toBe('na')
    expect(classifySpecComponent('channel-live', MP_MAPPING_MATRIX).status).toBe('private')
    // ★批 H：keyboard-accessory/selection 已全端真实落地（原 planned）
    expect(classifySpecComponent('keyboard-accessory', MP_MAPPING_MATRIX).status).toBe('covered')
    expect(classifySpecComponent('selection', MP_MAPPING_MATRIX).status).toBe('covered')
    expect(classifySpecComponent('totally-unknown-tag', MP_MAPPING_MATRIX).status).toBe('gap')
  })

  it('破坏性验证：官方新增一项未归类 → gap 命中（门禁可失败）', () => {
    const withNew: MpOfficialSpec = { components: [...spec.components, 'brand-new-tag'], apis: [...spec.apis, 'brandNewApi'] }
    const r = auditSpecCoverage(withNew, MP_MAPPING_MATRIX)
    expect(r.gap).toBe(2)
    expect(r.gaps.map((g) => g.name).sort()).toEqual(['brand-new-tag', 'brandNewApi'])
  })

  it('破坏性验证：covered 回归（模拟丢覆盖）→ 棘轮可失败', () => {
    // 把一条已 covered 的官方 API 从显式表移除的等价：构造缺失该归类的输入不可行（分类器是常量），
    // 改用「未归类」输入模拟覆盖丢失 → 必然 gap>0
    const dropped: MpOfficialSpec = { components: [], apis: ['brandNewApi'] }
    const r = auditSpecCoverage(dropped, MP_MAPPING_MATRIX)
    expect(r.gap).toBeGreaterThan(SPEC_RATCHET.gapMax)
  })

  it('分类表无重叠（同一官方名不得同时出现在多个箱子）', () => {
    const covered = new Set(Object.keys(SPEC_COVERED))
    const planned = new Set(Object.keys(SPEC_PLANNED))
    for (const n of covered) {
      expect(planned.has(n), `${n} 同时在 covered/planned`).toBe(false)
      expect(SPEC_PRIVATE.has(n), `${n} 同时在 covered/private`).toBe(false)
      expect(SPEC_NA.has(n), `${n} 同时在 covered/na`).toBe(false)
    }
    for (const n of planned) {
      expect(SPEC_PRIVATE.has(n), `${n} 同时在 planned/private`).toBe(false)
      expect(SPEC_NA.has(n), `${n} 同时在 planned/na`).toBe(false)
    }
    for (const n of SPEC_COMPONENT_OVERRIDE ? Object.keys(SPEC_COMPONENT_OVERRIDE) : []) {
      expect(spec.components, `override ${n} 非官方组件`).toContain(n)
    }
  })
})
