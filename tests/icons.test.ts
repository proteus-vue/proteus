// tests/icons.test.ts —— ★★★Keryx 图标库：OS 级规范 §6 的**单测**面（数据法则）
// 【为什么有它（OS级图标库方案 §9.3「静态失败必有单测」）】check:icons 门禁钉数据法则（构建期）；
//   本测试从**消费视角**再钉一遍：别名解析正确 + 未知名占位 + 主名 kebab/类别合规/零重复（防门禁与
//   数据"同源共错"）。命名/类别/去重的机器判据 = 两者（门禁 + 本测）。
import { describe, it, expect } from 'vitest'
import {
  ICON_SET,
  ICON_NAMES,
  ICON_ALIASES,
  ICON_CATEGORIES,
  UNKNOWN_ICON,
  iconByName,
  normalizedIcon,
  hasIcon,
  resolveIconName,
} from '../packages/icons/src'

const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

describe('★★Keryx 图标数据法则（OS 级规范 §6）', () => {
  it('主名均为 kebab-case（§6 命名）', () => {
    for (const n of ICON_NAMES) expect(KEBAB.test(n), `非 kebab: ${n}`).toBe(true)
  })

  it('类别均属规范清单（§6 类别）', () => {
    for (const n of ICON_NAMES) expect(ICON_CATEGORIES).toContain(ICON_SET[n]!.category)
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
})

describe('★★别名解析（官方 type / 语义等价 / camel 兼容）', () => {
  const CASES: Array<[string, string]> = [
    ['house', 'home'],
    ['person', 'user'],
    ['back', 'arrow-left'],
    ['arrowLeft', 'arrow-left'],
    ['arrowDown', 'arrow-down'],
    ['success_no_circle', 'check'],
    ['cancel', 'error'],
    ['clear', 'error'],
    ['waiting', 'clock'],
  ]
  it.each(CASES)('别名 %s → 主名 %s', (alias, target) => {
    expect(ICON_ALIASES[alias]).toBe(target)
    expect(resolveIconName(alias)).toBe(target)
    // 别名与主名解析出**同一份数据**（向后兼容不改变视觉）
    expect(iconByName(alias).d).toBe(iconByName(target).d)
  })

  it('别名键不得同时是主名（不污染 kebab 契约）', () => {
    for (const a of Object.keys(ICON_ALIASES)) expect(ICON_NAMES).not.toContain(a)
  })

  it('hasIcon 对主名与别名均为 true，未知名 false', () => {
    expect(hasIcon('home')).toBe(true)
    expect(hasIcon('success_no_circle')).toBe(true)
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
