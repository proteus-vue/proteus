// tests/mount-layers.test.ts —— ★★★GP1-a/GP1-b：三层挂载契约判据（2026-10-03）
//
// 【这一层修的是什么】《全局挂载点与App根组件方案》§3 的三层模型（Global/Page/Overlay）
//   在契约层**不存在**（宿主侧全仓零命中）⇒ 先落机器可读契约，供：
//   ① 编译期校验（C1/C2/C3）② 宿主分容器（未来）③ 诊断/调试 消费。
//
// 【判据打在三处（各自对应一个会静默出错的设计错误）】
//   ① **域偏移不重叠**（GP1-b 的关键正确性）：三层各自占用的 z-index 区间**互不交叠**，
//      否则"层间顺序编译期固定"会被层内数值比较破坏（典型误用：Global 的 navigation(10)
//      与 Page 的 content(1) 跨层比较 ⇒ Page 盖不住 Global ⇒ 静默顺序颠倒）。
//   ② **层间顺序不可配置**（硬约束）：顺序是常量，不接受任何运行时参数。
//   ③ **与层内四层正交**（不得混用同一套数值）：层内最大值 + 栈上限 < 域宽域不发生进位。
//   ★反向：`layers.ts`（层内）的行为不因本契约改变（正交 = 互不影响）。

import { describe, it, expect } from 'vitest'
import {
  MOUNT_LAYERS,
  MOUNT_LAYER_ORDER,
  MOUNT_LAYER_DOMAIN,
  MOUNT_LAYER_SEMANTICS,
  MOUNT_LAYER_TAGS,
  GLOBAL_LAYER_NODE_LIMIT,
  mountLayerDomainOffset,
  mountLayerTagOf,
  isMountLayerDeclarableFile,
} from '@proteus-vue/contracts'
import { LAYER_PRIMITIVES, LAYER_MAPPING, POPOUT_STACK_LIMIT, layerValueFor } from '@proteus-vue/contracts'

const platforms = ['web', 'mp-skyline', 'android', 'ios'] as const

describe('★GP1-a · 三层挂载契约（封闭集与顺序）', () => {
  it('封闭集是三层且顺序固定（global < page < overlay——**不可配置**）', () => {
    expect([...MOUNT_LAYERS]).toEqual(['global', 'page', 'overlay'])
    expect(MOUNT_LAYER_ORDER.global).toBeLessThan(MOUNT_LAYER_ORDER.page)
    expect(MOUNT_LAYER_ORDER.page).toBeLessThan(MOUNT_LAYER_ORDER.overlay)
    // ★顺序是**常量**（函数签名无参 ⇒ 构造上不可配置）
    expect(mountLayerDomainOffset.length, '域偏移函数只接受层名，不接受配置').toBe(1)
  })

  it('层语义表覆盖全部三层（含 MP 生命周期差异的诚实标注）', () => {
    for (const layer of MOUNT_LAYERS) {
      const s = MOUNT_LAYER_SEMANTICS[layer]
      expect(s, `${layer} 必须有语义条目`).toBeTruthy()
      expect(s.zh.length).toBeGreaterThan(0)
      // ★MP 的 global 必须写明"每页一份实例"（方案 §1.2-bis——不写就是埋雷）
      if (layer === 'global') {
        expect(s.lifetimeMp, 'MP 的 global 生命周期必须点明"每页一份"').toContain('每页一份')
        expect(s.lifetimeApp).not.toBe(s.lifetimeMp)
      }
    }
  })

  it('框架标签映射：app-root 是层**父**（不属任何层），三个 *-layer 映射到对应层', () => {
    expect(MOUNT_LAYER_TAGS['app-root']).toBe('root')
    expect(MOUNT_LAYER_TAGS['global-layer']).toBe('global')
    expect(MOUNT_LAYER_TAGS['page-layer']).toBe('page')
    expect(MOUNT_LAYER_TAGS['overlay-layer']).toBe('overlay')
    // 反查一致
    expect(mountLayerTagOf('global')).toBe('global-layer')
  })
})

describe('★★GP1-b · 域偏移（与层内四层正交的关键正确性）', () => {
  it('★三层域区间**互不重叠**（这是"层间顺序固定"的充要条件）', () => {
    // 每层的实际区间 = [offset, offset + 层内最大值]
    const maxInner = Math.max(
      ...LAYER_PRIMITIVES.map((p) => Math.max(LAYER_MAPPING[p].cssZIndex, LAYER_MAPPING[p].androidTranslationZ, LAYER_MAPPING[p].iosZPosition)),
    ) + POPOUT_STACK_LIMIT
    const ranges = MOUNT_LAYERS.map((l) => {
      const off = mountLayerDomainOffset(l)
      return { layer: l, lo: off, hi: off + maxInner }
    })
    for (let i = 1; i < ranges.length; i++) {
      const prev = ranges[i - 1]!
      const cur = ranges[i]!
      expect(cur.lo, `${cur.layer} 的下沿必须 > ${prev.layer} 的上沿`).toBeGreaterThan(prev.hi)
    }
  })

  it('★域宽足够（层内最大值 + 栈上限 < 域宽——不会跨层进位）', () => {
    const maxInner = Math.max(...LAYER_PRIMITIVES.map((p) => LAYER_MAPPING[p].cssZIndex)) + POPOUT_STACK_LIMIT
    expect(MOUNT_LAYER_DOMAIN, '域宽必须留足层内空间').toBeGreaterThan(maxInner)
  })

  it('★正交性实证（方案 §3 的典型误用被数值拦住）', () => {
    // 误用场景：Global 的 navigation 与 Page 的 content **直接比数值** ⇒ 顺序颠倒
    const wrongGlobalNav = layerValueFor('layer-navigation', 'web')          // 10
    const wrongPageContent = layerValueFor('layer-content', 'web')            // 1
    expect(wrongGlobalNav, '不加偏移时 Global 的 nav 会压住 Page 的 content（10 > 1）').toBeGreaterThan(wrongPageContent)
    // 正解：加域偏移后 Global 的**一切**都低于 Page 的**一切**
    const rightGlobalNav = mountLayerDomainOffset('global') + wrongGlobalNav
    const rightPageContent = mountLayerDomainOffset('page') + wrongPageContent
    expect(rightGlobalNav, '加偏移后 Global 的 nav < Page 的 content').toBeLessThan(rightPageContent)
    // 且 Page 的一切 < Overlay 的一切
    const rightPagePopout = mountLayerDomainOffset('page') + layerValueFor('layer-popout', 'web')
    const rightOverlayContent = mountLayerDomainOffset('overlay') + layerValueFor('layer-content', 'web')
    expect(rightPagePopout).toBeLessThan(rightOverlayContent)
  })

  it('偏移在各端取同一层域（跨端一致：层间顺序与端无关）', () => {
    for (const layer of MOUNT_LAYERS) {
      expect(mountLayerDomainOffset(layer)).toBe(MOUNT_LAYER_ORDER[layer] * MOUNT_LAYER_DOMAIN)
    }
    // 跨端验证：同一层同一原语，加了偏移后仍保持层间关系（任取两端）
    for (const p of platforms) {
      const g = mountLayerDomainOffset('global') + layerValueFor('layer-popout', p)
      const pg = mountLayerDomainOffset('page') + layerValueFor('layer-content', p)
      expect(g, `${p}：层域关系跨端一致`).toBeLessThan(pg)
    }
  })
})

describe('★GP1-a · 编译期约束的契约支撑（C1/C2）', () => {
  it('C1：只有 App.vue 允许声明挂载层（含路径与大小写形态）', () => {
    expect(isMountLayerDeclarableFile('App.vue')).toBe(true)
    expect(isMountLayerDeclarableFile('examples/App.vue')).toBe(true)
    expect(isMountLayerDeclarableFile('/abs/path/src/app.vue'), '大小写不敏感').toBe(true)
    expect(isMountLayerDeclarableFile('pages/index.vue'), '普通页面不得声明').toBe(false)
    expect(isMountLayerDeclarableFile('components/MyComp.vue')).toBe(false)
    expect(isMountLayerDeclarableFile('App.vue.bak'), '不是精确文件名').toBe(false)
    expect(isMountLayerDeclarableFile(''), '空文件名').toBe(false)
  })

  it('C2：Global 层节点上限是**契约常量**（32——非魔法数字，且带理由）', () => {
    expect(GLOBAL_LAYER_NODE_LIMIT).toBe(32)
    expect(Number.isInteger(GLOBAL_LAYER_NODE_LIMIT)).toBe(true)
  })

  it('★反向：层内四层契约不因本契约改变（正交 = 互不影响）', () => {
    // layers.ts 的既有数值与语义保持原样
    expect([...LAYER_PRIMITIVES]).toEqual(['layer-content', 'layer-navigation', 'layer-mask', 'layer-popout'])
    expect(LAYER_MAPPING['layer-content'].cssZIndex).toBe(1)
    expect(LAYER_MAPPING['layer-popout'].cssZIndex).toBe(1000)
  })
})
