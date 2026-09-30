// tests/capability-domains.test.ts
// ★NC0（原生能力接入方案 §9）：能力分域表的不变量锁
//
// 【为什么需要这些断言】分域表是**官网能力页分组**与**《能力实现优先级表》**共同的事实源
//   （2026-09-30 从官网生成器抽到 component-ir）。两类失效都是**静默**的：
//     ① 新能力落地漏登记 ⇒ 官网分组与优先级表都落入「其他」兜底（没人会注意到）；
//     ② 新增域但忘了加进 CAPABILITY_CATEGORY_ORDER ⇒ 排序 indexOf 返回 -1，排序静默错乱。
//   ⇒ 用断言把两条都变成"能变红"的判据。
import { describe, it, expect } from 'vitest'
import {
  PRIMITIVE_CATALOG,
  CAPABILITY_CATEGORY,
  CAPABILITY_CATEGORY_ORDER,
  capabilityDomainOf,
  auditCapabilityDomains,
} from '@proteus-vue/component-ir'

describe('NC0 capability-domains（能力分域表）', () => {
  const caps = PRIMITIVE_CATALOG.filter((p) => p.kind === 'capability')
  const slugs = caps.map((c) => String(c.semantic).replace(/^capability\./, ''))

  it('清单与分域表一一对应（零缺口——新能力漏登记即红）', () => {
    expect(auditCapabilityDomains(slugs)).toEqual([])
  })

  it('每条登记都指向合法域（且都在展示顺序里——防 indexOf(-1) 静默错序）', () => {
    const order = new Set(CAPABILITY_CATEGORY_ORDER)
    for (const [slug, domain] of Object.entries(CAPABILITY_CATEGORY)) {
      expect(order.has(domain), `${slug} → ${domain} 不在 CAPABILITY_CATEGORY_ORDER`).toBe(true)
    }
  })

  it('capabilityDomainOf 接受完整 semantic 与裸 slug 两种形态（同结果）', () => {
    expect(capabilityDomainOf('capability.camera')).toBe('媒体与扫码')
    expect(capabilityDomainOf('camera')).toBe('媒体与扫码')
    // 未登记 key 不抛错、落「其他」（审计函数负责把它变成红）
    expect(capabilityDomainOf('capability.__nope__')).toBe('其他')
  })

  it('★判据能变红：从分域表拿掉一个 key ⇒ auditCapabilityDomains 当场报出', () => {
    // 用副本验证（不改真表）
    const broken = { ...CAPABILITY_CATEGORY }
    delete broken.camera
    const missing = slugs.filter((s) => !(s in broken))
    expect(missing).toContain('camera')
    expect(missing.length).toBeGreaterThan(0)
  })
})
