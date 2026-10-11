// tests/icons.test.ts —— ★★★Keryx 图标库：OS 级规范 §6 的**单测**面（数据法则）
// 【为什么有它（OS级图标库方案 §9.3「静态失败必有单测」）】check:icons 门禁钉数据法则（构建期）；
//   本测试从**消费视角**再钉一遍：别名/变体解析 + 未知名占位 + 主名 kebab/类别合规/零重复/坐标域
//   （防门禁与数据"同源共错"）。
import { describe, it, expect } from 'vitest'
import {
  ICON_SET,
  ICON_NAMES,
  ICON_ALIASES,
  ICON_CATEGORIES,
  FILLED_SUFFIX,
  UNKNOWN_ICON,
  iconByName,
  normalizedIcon,
  hasIcon,
  hasFilled,
  resolveIconName,
} from '../packages/icons/src'

const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
const coordRange = (d: string) => {
  const ns = (d.match(/-?\d+\.?\d*/g) || []).map(Number)
  return { min: Math.min(...ns), max: Math.max(...ns) }
}

describe('★★Keryx 图标数据法则（OS 级规范 §6）', () => {
  it('规模 ≥ 200（覆盖 Proteus Music 场景的 OS 级门槛）', () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(200)
  })

  it('主名均为 kebab-case（§6 命名）', () => {
    for (const n of ICON_NAMES) expect(KEBAB.test(n), `非 kebab: ${n}`).toBe(true)
  })

  it('类别均属规范清单，且 7 类全部有图标（§6 类别）', () => {
    const used = new Set<string>()
    for (const n of ICON_NAMES) {
      const c = ICON_SET[n]!.category
      expect(ICON_CATEGORIES).toContain(c)
      used.add(c)
    }
    for (const c of ICON_CATEGORIES) expect(used.has(c), `类别 ${c} 无图标`).toBe(true)
  })

  it('零重复主名路径（同路径只允许一枚主名）', () => {
    const seen = new Map<string, string>()
    for (const n of ICON_NAMES) {
      const d = ICON_SET[n]!.d
      expect(seen.has(d), `路径重复：${n} 与 ${seen.get(d)}`).toBe(false)
      seen.set(d, n)
    }
  })

  it('viewBox 统一 24×24 基准网格（§6 网格）', () => {
    for (const n of ICON_NAMES) expect(ICON_SET[n]!.viewBox ?? '0 0 24 24').toBe('0 0 24 24')
  })

  it('★坐标域 ∈ [0,24]（生成器须把上游网格缩放——App 内核/宿主不读 viewBox）', () => {
    for (const n of ICON_NAMES) {
      const r = coordRange(normalizedIcon(n).d)
      expect(r.min, `${n} min`).toBeGreaterThanOrEqual(-0.5)
      expect(r.max, `${n} max`).toBeLessThanOrEqual(24.5)
    }
  })
})

describe('★★双体系：outline 默认 + filled 选中（§6）', () => {
  it('filled 变体亦内核可吃（仅绝对 M/L/C/Q/Z）', () => {
    for (const n of ICON_NAMES) {
      const f = ICON_SET[n]!.filled
      if (!f) continue
      expect(/[AaSsTtHhVv]/.test(f), `${n} filled 含 A/S/T/H/V`).toBe(false)
    }
  })

  it('`<name>-filled` 解析到该图标的 filled 变体（有 filled 时）', () => {
    const withFilled = ICON_NAMES.filter((n) => ICON_SET[n]!.filled)
    expect(withFilled.length).toBeGreaterThan(0)
    for (const n of withFilled) {
      expect(iconByName(`${n}${FILLED_SUFFIX}`).d).toBe(ICON_SET[n]!.filled)
      expect(hasFilled(n)).toBe(true)
    }
  })

  it('无 filled 变体时 `<name>-filled` 回退 outline（不静默置空）', () => {
    // 构造：取一枚人为去 filled 的 def（不改数据）——直接验证回退语义
    const anyName = ICON_NAMES[0]!
    const def = ICON_SET[anyName]!
    const saved = def.filled
    try {
      def.filled = undefined
      expect(iconByName(`${anyName}${FILLED_SUFFIX}`).d).toBe(def.d)
    } finally {
      def.filled = saved
    }
  })
})

describe('★★别名解析（官方 type / 语义等价 / 早期 camel）', () => {
  const CASES: Array<[string, string]> = [
    ['house', 'home'],
    ['user', 'person'],
    ['more', 'more-horiz'],
    ['message', 'chat'],
    ['plus', 'add'],
    ['minus', 'remove'],
    ['heart', 'favorite'],
    ['back', 'arrow-back'],
    ['arrowLeft', 'arrow-back'],
    ['arrowDown', 'arrow-downward'],
    ['success', 'check-circle'],
    ['warn', 'warning'],
    ['waiting', 'schedule'],
    ['clock', 'schedule'],
    ['success_no_circle', 'check'],
    ['clear', 'error'],
  ]
  it.each(CASES)('别名 %s → 主名 %s', (alias, target) => {
    expect(ICON_ALIASES[alias]).toBe(target)
    expect(resolveIconName(alias)).toBe(target)
    expect(iconByName(alias).d).toBe(iconByName(target).d)
  })

  it('别名键不得同时是主名（不污染 kebab 契约）', () => {
    for (const a of Object.keys(ICON_ALIASES)) expect(ICON_NAMES).not.toContain(a)
  })

  it('hasIcon：主名 / 别名 / -filled 变体 true，未知名 false', () => {
    expect(hasIcon('home')).toBe(true)
    expect(hasIcon('house')).toBe(true)
    expect(hasIcon('star-filled')).toBe(true)
    expect(hasIcon('__nope__')).toBe(false)
  })
})

describe('★★未知图标 → 显式占位（§9.3 不静默）', () => {
  it('未知名的数据 == UNKNOWN_ICON', () => {
    expect(iconByName('__definitely_missing__').d).toBe(UNKNOWN_ICON.d)
  })
})

describe('★★内核可吃（svg_path.rs 只认绝对 M/L/C/Q/Z）', () => {
  it('全部主名归一化后只含绝对 M/L/C/Q/Z 且以 M 起', () => {
    for (const n of ICON_NAMES) {
      const d = normalizedIcon(n).d
      expect(/[AaSsTtHhVv]/.test(d), `${n} 仍含 A/S/T/H/V`).toBe(false)
      expect(d.trim().startsWith('M')).toBe(true)
    }
  })
})
