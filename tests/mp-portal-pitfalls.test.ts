// tests/mp-portal-pitfalls.test.ts —— ★★★GP3-b0：glass-easel **portal 陷阱**回归锁（2026-10-03）
//
// 【这两条是什么（都曾导致真机页面**锁死**，比"不显示"严重得多）】
//   · **S42**：`root-portal`（teleport）是弹层层叠的正解（Skyline 不支持 fixed）；
//     但 portal **自身**带 `v-if` ⇒ **静默丢弃**（本编译器的 teleport 分支直接序列化 children）
//     ⇒ 条件永远失效。
//   · **S47**：portal 的**根内容**用 `v-if` 卸载/重挂 ⇒ glass-easel 下 portal 挂载异常 +
//     残留层锁死页面（实测：**二次打开卡死 + 页面无法滚动**）。
//   · **正解**：**根内容常驻** + `:class`/`visibility` 驱动显隐与动画（对齐 `p-drawer`）。
//
// 【为什么必须机器化（本仓原则）】这两条此前**只写在 `docs/skyline-pitfalls.md`**——
//   与 sleep/重复跑测试同源：**只有工具层门禁是结构性的**，文档靠人记得读。
//   S49 还记录了"改了多轮 v-if/teleport/动画都没用"的排查代价 ⇒ 编译期拦下即省下那轮。
//
// 【★检查范围为什么只到"直接子元素"】`p-drawer` / `p-page-container` 这些**已验证的正解**
//   自己就在内层用 `v-if="modelValue && overlay"` 渲遮罩 ⇒ 广撒网会**误伤**，而误伤会导致
//   开发者加豁免、门禁失效（本仓"门禁被绕过等于没做"的教训）。⇒ 只拦 portal **根内容**。

import { describe, it, expect } from 'vitest'
import { transformTemplateToWxml } from '@proteus-vue/compiler'

const wxml = (tpl: string): { warnings: string[]; code: string } => {
  const r = transformTemplateToWxml(tpl, { px2rpx: false }) as unknown as { warnings: string[]; code?: string; wxml?: string }
  return { warnings: r.warnings, code: String(r.code ?? r.wxml ?? '') }
}
/** 只看 portal 相关警告（其余警告如 "to 无对等" 是既有的，不属本批判据） */
const portalWarns = (tpl: string): string[] =>
  wxml(tpl).warnings.filter((w) => /portal|teleport/i.test(w) && !/to 目标在小程序无对等/.test(w))

describe('★portal 陷阱（S42/S47）回归锁', () => {
  it('S47：`<teleport>` 的**直接子元素**带 v-if ⇒ 必须警告（portal 根内容卸载会锁死页面）', () => {
    const warns = portalWarns(`<teleport to="body"><view v-if="open" class="m">x</view></teleport>`)
    expect(warns.length, '应拦下 portal 根内容 v-if').toBeGreaterThan(0)
    expect(warns[0], '文案要点明后果与修法').toContain('锁死页面')
    expect(warns[0]).toContain('常驻')
  })

  it('S42：`<teleport>` **自身**带 v-if ⇒ 必须警告（v-if 会被静默丢弃）', () => {
    const warns = portalWarns(`<teleport to="body" v-if="open"><view class="m">x</view></teleport>`)
    expect(warns.length, '应拦下 teleport 自身 v-if').toBeGreaterThan(0)
    expect(warns[0]).toContain('静默丢弃')
  })

  it('★产物取证：teleport 自身的 v-if **确实消失**（"静默丢弃"不是猜测）', () => {
    const { code } = wxml(`<teleport to="body" v-if="open"><view class="m">x</view></teleport>`)
    expect(code, 'root-portal 无条件挂载').toContain('<root-portal>')
    expect(code, 'v-if 未出现在产物里（静默丢弃）').not.toContain('wx:if')
  })

  it('★正例：常驻 + 内层 v-if（既有 p-drawer/p-page-container 的形态）⇒ **不报**（防误伤）', () => {
    const warns = portalWarns(
      `<teleport to="body"><view class="root"><view v-if="open && overlay" class="mask" /></view></teleport>`,
    )
    expect(warns, '内层 v-if 是正解的一部分，不得误报').toEqual([])
  })

  it('★反向：普通元素的 v-if 不受影响（检查不越界）', () => {
    expect(portalWarns(`<view v-if="open">x</view>`)).toEqual([])
    const { code } = wxml(`<view v-if="open">x</view>`)
    expect(code, '普通元素 v-if 照常编译').toContain('wx:if')
  })

  it('★同类只报一条（防刷屏：多个直接子元素都带 v-if 时不重复）', () => {
    const warns = portalWarns(
      `<teleport to="body"><view v-if="a">1</view><view v-if="b">2</view></teleport>`,
    )
    expect(warns.filter((w) => w.includes('直接子元素')).length, '一条足够').toBe(1)
  })
})
