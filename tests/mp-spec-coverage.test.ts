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
  GESTURE_HANDLER_EXPECTED,
  auditSpecOverrideRefs,
  PRIMITIVE_CATALOG,
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
    expect(r.landedPercent).toBe(Math.floor((r.covered / r.actionable) * 100)) // ★floor（永不夸大）
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

describe('★2026-09-18 override 表引用一致性（本轮漏网根因的门禁）', () => {
  it('SPEC_COMPONENT_OVERRIDE 的 covered 声明须指向已落地原语（悬空/planned 均 FAIL）', () => {
    const r = auditSpecOverrideRefs(PRIMITIVE_CATALOG)
    expect(r.coveredRefs, '应存在若干 covered 引用（防门禁空转）').toBeGreaterThan(0)
    expect(r.issues, `问题：${JSON.stringify(r.issues)}`).toEqual([])
  })

  it('破坏性验证：指向 planned 原语的 covered → 报 unimplemented', () => {
    // ★2026-09-18：改用**仍为 planned** 的原语做样本（原用 gesture.tap，其已落地转 implemented，
    //   不再是「planned 原语」的有效样本 —— 门禁语义未变，仅换样本）。
    const r = auditSpecOverrideRefs(PRIMITIVE_CATALOG, {
      'pan-gesture-handler': { status: 'covered', proteus: 'gesture.pan' },
    })
    expect(r.issues).toHaveLength(1)
    expect(r.issues[0].kind).toBe('unimplemented')
    expect(r.issues[0].ref).toBe('gesture.pan')
  })

  it('破坏性验证：悬空引用（拼写错误）→ 报 semantic/component', () => {
    const r = auditSpecOverrideRefs(PRIMITIVE_CATALOG, {
      'long-press-gesture-handler': { status: 'covered', proteus: 'gesture.long-press' },
    })
    expect(r.issues).toHaveLength(1)
    expect(r.issues[0].kind).toBe('semantic')
  })

  it('★破坏性验证：语义错位（引用存在且已落地，但张冠李戴）→ 报 mismatched', () => {
    // 本轮真实缺陷形态：double-tap-gesture-handler 曾标 covered 并引用 gesture.draggable——
    // draggable **存在且已落地**，旧的「引用一致性」检查完全放过；实为拖拽语义，与双击无关。
    const r = auditSpecOverrideRefs(PRIMITIVE_CATALOG, {
      'tap-gesture-handler': { status: 'covered', proteus: 'gesture.draggable' },
    })
    expect(r.issues).toHaveLength(1)
    expect(r.issues[0].kind).toBe('mismatched')
    expect(r.issues[0].ref).toBe('gesture.tap') // 提示期望语义，便于修
  })

  it('★语义配对表覆盖全部 *-gesture-handler（防新增处理器漏登记）', () => {
    for (const tag of Object.keys(GESTURE_HANDLER_EXPECTED)) {
      expect(SPEC_COMPONENT_OVERRIDE[tag], `${tag} 应在 override 表`).toBeTruthy()
    }
    // 反向：override 表里的 gesture-handler 都必须有期望语义（新条目遗漏即红）
    for (const tag of Object.keys(SPEC_COMPONENT_OVERRIDE)) {
      if (!tag.endsWith('-gesture-handler')) continue
      expect(GESTURE_HANDLER_EXPECTED[tag], `${tag} 缺 GESTURE_HANDLER_EXPECTED 登记`).toBeTruthy()
    }
  })

  it('★诚实性回归：状态必须与**原语真实状态**一致（covered ↔ implemented 双向对齐）', () => {
    // 这条断言随事实演进，锁的是「状态不得与原语漂移」这一不变量：
    // · 2026-09-18 前：5 条手势处理器原语为 planned → 全标 planned（修正真·落地率虚高 5 项）
    // · 2026-09-18 后：tap/longpress 经编译器 directive/v-gesture 落地（原语转 implemented）
    //   → 该 2 条据实转 covered；pan/scale/force-press 仍 planned（MP 无事件对等）。
    // ★判据：逐条比较 override 状态与 catalog 原语状态——任一漂移即红。
    const semOf: Record<string, string> = {
      'tap-gesture-handler': 'gesture.tap',
      // ★2026-09-19 补入：double-tap 属 tap 的 count 变体（MP bindtap 不带 count → 无对等），
      //   原标 covered 且引用 draggable（错位）——据实转 planned。
      'double-tap-gesture-handler': 'gesture.tap',
      'long-press-gesture-handler': 'gesture.longpress',
      'pan-gesture-handler': 'gesture.pan',
      'scale-gesture-handler': 'gesture.pinch',
      'force-press-gesture-handler': 'gesture.press',
    }
    for (const [tag, sem] of Object.entries(semOf)) {
      const prim = PRIMITIVE_CATALOG.find((x) => x.semantic === sem)
      expect(prim, `${sem} 应在 catalog`).toBeTruthy()
      // ★特例：double-tap 是 tap 语义的变体，MP 无 count 对等——即便 gesture.tap 已 implemented，
      //   其**双击语义**在 MP 仍无等价 → 保持 planned（诚实边界，与上表「原语状态」判据的例外）
      const expected =
        tag === 'double-tap-gesture-handler' ? 'planned' : prim!.status === 'implemented' ? 'covered' : 'planned'
      expect(SPEC_COMPONENT_OVERRIDE[tag]?.status, `${tag} 状态应与 ${sem}（${prim!.status}）一致`).toBe(expected)
    }
    // 已落地的两条（draggable）
    expect(SPEC_COMPONENT_OVERRIDE['horizontal-drag-gesture-handler']?.status).toBe('covered')
    expect(SPEC_COMPONENT_OVERRIDE['vertical-drag-gesture-handler']?.status).toBe('covered')
  })
})
