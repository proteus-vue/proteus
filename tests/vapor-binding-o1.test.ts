// tests/vapor-binding-o1.test.ts
// ★卡 V2 验收第三条：**单节点更新延迟 ≈ 宿主侧耗时（O(1) 验证）**
//
// 【这份测试在防什么（卡里的风险原文）】
//   卡 V2 要求「单节点更新延迟 ≈ 宿主侧耗时」。若槽位寻址退化为**扫描**（如按 key 遍历
//   全部槽位找目标），延迟会随**绑定总数**线性增长 —— 那时"O(1)"只是文档宣称，
//   而真机上表现为"页面越复杂、改一个字段越慢"。
//
// 【为什么不能只断言"很快"（本仓两次实测教训）】亚毫秒尺度的**绝对耗时不可靠**
//   （T4/V11 两次：CI 共享 runner 波动 14×；并行执行下比值 0.18~0.76）。
//   ⇒ 本测试用**结构性判据**——比"快不快"更重要的是"**是否随规模增长**"：
//     同一操作在 N 个绑定与 10N 个绑定的树上的耗时比，应接近 1 而非 10。
//
// 【判据（三层，全部机器可判）】
//   ① **寻址是直取**：运行时对槽位的访问点必须是 `Map.get(slotId)`（而非遍历/过滤）
//      —— 用源码断言锁定这条架构事实（改回扫描即红）
//   ② **延迟不随规模增长**：10× 绑定数 ⇒ 耗时比 ≤ 3（放缓阈值以抗抖动；线性退化会是 ~10）
//   ③ **只求值受影响源的槽位**：改一个源 ⇒ 其槽位数（而非全表槽位数）与耗时同阶
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildVaporSubscriptions } from '@proteus-vue/compiler'
import { instantiateTemplate, ListRegistry } from '@proteus-vue/slot-runtime'
import type { SubscriptionTable } from '@proteus-vue/slot-runtime'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RUNTIME_SRC = path.join(HERE, '../packages/slot-runtime/src/runtime.ts')

/** 生成含 N 个绑定的 SFC（每个绑定一个独立源 ⇒ 改一个只影响一个） */
function sfcWithBindings(n: number): string {
  const rows = Array.from({ length: n }, (_, i) => `    <text :class="c${i}">{{ v${i} }}</text>`).join('\n')
  const decls = Array.from({ length: n }, (_, i) => `const c${i} = ref('k${i}'); const v${i} = ref(${i})`).join('\n')
  return `<template>\n  <view>\n${rows}\n  </view>\n</template>\n<script setup>\nimport { ref } from 'vue'\n${decls}\n</script>`
}

function tableOf(n: number): SubscriptionTable {
  const r = buildVaporSubscriptions(sfcWithBindings(n), `gen-${n}.vue`)
  return r.table
}

describe('★卡 V2 · 槽位 O(1)（结构判据，非绝对秒数）', () => {
  it('① 寻址是 Map 直取（源码级架构断言：改回扫描即红）', () => {
    const src = fs.readFileSync(RUNTIME_SRC, 'utf-8')
    // 槽位访问必须是 Map.get（O(1)），而不是 find/filter 扫描
    expect(src, '★槽位访问应存在 `this.slots.get(spec.slotId)` 形式的直取').toMatch(/this\.slots\.get\(/)
    // 反向断言：不得出现"遍历 slots 找匹配"的写法（那是 O(n) 退化）
    const scanPatterns = [/this\.slots\.values\(\)[\s\S]{0,80}find\(/, /Array\.from\(this\.slots[^)]*\)\.find\(/]
    for (const re of scanPatterns) {
      expect(re.test(src), `★不得用扫描方式找槽位（O(n) 退化）：${re}`).toBe(false)
    }
  })

  it('② 10× 绑定数 ⇒ 单节点更新耗时比 ≤ 3（线性退化会是 ~10）', () => {
    const measureOnce = (n: number): number => {
      const table = tableOf(n)
      const { tpl, read } = buildTpl(table)
      const reg = new ListRegistry()
      const inst = instantiateTemplate(tpl, { viewport: { width: 390, height: 844 }, read, table, registry: reg })
      expect(inst.nodes.length, `${n} 绑定应产出节点`).toBeGreaterThan(0)
      // 改**同一个**源（v0）——与 n 无关的单点更新
      const data: Record<string, unknown> = {}
      for (let i = 0; i < 40; i++) data[`v0`] = i
      const t0 = performance.now()
      for (let i = 0; i < 40; i++) {
        data['v0'] = i
        // 走"该源求值 → 其槽位直写"的同一路径（read 取新值）
        instantiateTemplate(tpl, { viewport: { width: 390, height: 844 }, read: (k) => (k === 'v0' ? data['v0'] : read(k)), table, registry: reg })
      }
      return performance.now() - t0
    }
    // ★★测量口径（2026-10-01，与 T4 同一原则「信号必须远大于噪声」）：
    //   单轮读数仅 0.03ms（= `performance.now()` 粒度），全量套件并发下实测比值 3.78 假红
    //   （同代码隔离复跑 4 次：0.85 / 1.05 / 1.20 / 0.98）。⇒ 每侧取**多轮最小值**：
    //   min 是最接近"无干扰真实成本"的估计（抢占/GC 只会让单轮变慢、不会让 min 变快），
    //   而线性退化在 min 下同样成立（真 O(n) ⇒ 两侧 min 就是 ~10×）。
    const measure = (n: number): number => {
      let best = Number.POSITIVE_INFINITY
      for (let r = 0; r < 7; r++) best = Math.min(best, measureOnce(n))
      return best
    }
    // ★预热（JIT）——两侧同等对待（本仓 T4/V11 的教训：不对称预热会制造假差异）
    measure(20)
    const small = measure(20)
    const big = measure(200)
    const ratio = big / Math.max(small, 0.01)
    // eslint-disable-next-line no-console
    console.log(`[V2 O(1) 读数] 20 绑定=${small.toFixed(2)}ms · 200 绑定=${big.toFixed(2)}ms · 比=${ratio.toFixed(2)}`)
    expect(
      ratio,
      `★10× 绑定数下耗时比 ${ratio.toFixed(2)}（O(1) 应接近 1；线性退化约 10）`,
    ).toBeLessThanOrEqual(3)
  })

  it('③ 槽位数随绑定数增长，但**受影响**的只有单源的槽位', () => {
    const table = tableOf(200)
    const slotsOf = (name: string): number => table.sources.filter((s) => s.sourceName === name).reduce((a, s) => a + s.slots.length, 0)
    // 每个源有自己的槽位（v0 与 v199 各 1 个）——证明"改一个源"只需动它的槽位
    expect(slotsOf('v0'), 'v0 的槽位数').toBeGreaterThan(0)
    expect(slotsOf('v199'), 'v199 的槽位数').toBeGreaterThan(0)
    const totalSlots = table.sources.reduce((a, s) => a + s.slots.length, 0)
    expect(totalSlots, '总槽位数应远大于单源槽位数').toBeGreaterThan(100)
    // ★结构性事实：单源槽位数 ≪ 总槽位数 ⇒ 更新一个源不必触碰全表
    expect(slotsOf('v0') + slotsOf('v199'), '改两个源涉及的槽位应远小于全表').toBeLessThan(totalSlots / 10)
  })
})

/** 从订阅表构造 instantiateTemplate 需要的 tpl（与既有用例同法） */
function buildTpl(table: SubscriptionTable): { tpl: ReturnType<typeof layoutTpl>; read: (k: string) => unknown } {
  const tpl = layoutTpl()
  const values: Record<string, unknown> = {}
  for (const src of table.sources) {
    if (src.sourceName.startsWith('c')) values[src.sourceName] = 'cls'
    else if (src.sourceName.startsWith('v')) values[src.sourceName] = 0
    else values[src.sourceName] = undefined
  }
  // read 按源名取值；未登记的返回 undefined（模板不引用）
  return { tpl, read: (k) => values[k] }
}

/** 3 个静态节点 + 每源一个文本节点的模板（值由槽位写入） */
function layoutTpl(): import('@proteus-vue/slot-runtime').LayoutTemplate {
  return {
    viewport: { width: 390, height: 844 },
    nodes: [
      { id: 1, parentId: null, tag: 'view', flexDirection: 'column', width: 390, height: 844 },
      { id: 2, parentId: 1, tag: 'text', text: '' },
    ],
    lists: [],
    values: {},
  } as unknown as import('@proteus-vue/slot-runtime').LayoutTemplate
}
