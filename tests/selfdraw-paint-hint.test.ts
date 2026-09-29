// tests/selfdraw-paint-hint.test.ts
// ★★I3 接线：适配器侧 paint-hint 的**逐形态对拍**（与 IR 路径必须给出一致结论）
//
// 【这个文件存在的理由（不是"多加一组用例"）】
//   判据有两处实现（IR 路径 `component-ir/src/paint-hint.ts` 的 `derivePaintHint`；
//   适配器路径 `renderer-app/adapters/selfdraw.ts` 的 `deriveSpecPaintHint`），
//   而**它们无法共享代码**——`renderer-app` 没有任何 dependencies
//   （它的"可嵌入任意宿主"属性），import `component-ir` 会改变其依赖形态。
//   ⇒ 退而求其次：**对拍**。同一组输入喂给两边，结论必须一致；一旦漂移，本文件当场红。
//   ★这比"读注释确保一致"强得多：漂移不靠人发现，靠测试发现。
//
// 【为什么逐"形态"而不是随机：每个形态都对应一种"会画错"的场景】
//   见下表每条的注释——写错的后果不是"慢"，是**画面错**（丢色/去色/文字消失）。
import { describe, it, expect } from 'vitest'
import { derivePaintHint } from '@proteus-vue/component-ir'
import { deriveSpecPaintHint } from '@proteus-vue/renderer-app/adapters/selfdraw'
import { normalizeStyleString } from '@proteus-vue/component-ir'

/** 一个形态：IR 侧的样式串 + 适配器侧的 spec 字段 + 期望结论 */
interface Case {
  name: string
  style: string
  spec: {
    text?: string
    color?: string
    backgroundColor?: string
    borderRadius?: number
    borderWidth?: number
    opacity?: number
  }
  expect: { isMonochrome: boolean; isPureBackground: boolean }
}

const CASES: Case[] = [
  {
    name: '白字（−39% 实验的形态）→ 单色可用',
    style: 'color:#ffffff;font-size:14px',
    spec: { text: 'hi', color: '#ffffff' },
    expect: { isMonochrome: true, isPureBackground: false },
  },
  {
    name: '★彩色文本 → 不可用（灰度格式无色相 ⇒ 会变灰）',
    style: 'color:#ff0000;font-size:14px',
    spec: { text: 'hi', color: '#ff0000' },
    expect: { isMonochrome: false, isPureBackground: false },
  },
  {
    name: '★白字 + 蓝底（4050 夹具真实形状）→ 不可用（两种颜色）',
    style: 'color:#ffffff;background-color:#285ac8;font-size:14px',
    spec: { text: 'hi', color: '#ffffff', backgroundColor: '#285ac8' },
    expect: { isMonochrome: false, isPureBackground: false },
  },
  {
    name: '★带文本的节点 → isPureBackground 必须 false（有字形就要存储）',
    style: 'color:#fff;background-color:#285ac8;font-size:14px',
    spec: { text: 'hi', color: '#ffffff', backgroundColor: '#285ac8' },
    expect: { isMonochrome: false, isPureBackground: false },
  },
  {
    name: '纯底色（无文本）→ isPureBackground 可用',
    style: 'background-color:#285ac8',
    spec: { backgroundColor: '#285ac8' },
    expect: { isMonochrome: false, isPureBackground: true },
  },
  {
    name: '★文本 + 圆角 → 不可用（紧凑格式无 alpha 边缘）',
    style: 'color:#fff;border-radius:4px;font-size:14px',
    spec: { text: 'hi', color: '#ffffff', borderRadius: 4 },
    expect: { isMonochrome: false, isPureBackground: false },
  },
  {
    name: '★文本 + 半透明 → 不可用（需 alpha 合成）',
    style: 'color:#fff;opacity:0.5;font-size:14px',
    spec: { text: 'hi', color: '#ffffff', opacity: 0.5 },
    expect: { isMonochrome: false, isPureBackground: false },
  },
  {
    name: '半透明字色（8 位 hex alpha=80）→ 不可用',
    style: 'color:#ffffff80;font-size:14px',
    spec: { text: 'hi', color: '#ffffff80' },
    expect: { isMonochrome: false, isPureBackground: false },
  },
  {
    name: '具名色（拿不准）→ 保守不可用',
    style: 'color:red;font-size:14px',
    spec: { text: 'hi', color: 'red' },
    expect: { isMonochrome: false, isPureBackground: false },
  },
  {
    name: '中性灰（rgb 三参，R=G=B）→ 可用',
    style: 'color:rgb(128,128,128);font-size:14px',
    spec: { text: 'hi', color: 'rgb(128,128,128)' },
    expect: { isMonochrome: true, isPureBackground: false },
  },
  {
    name: '底色 + 边框 → isPureBackground 不可用（边框是第二处绘制）',
    style: 'background-color:#000;border:1px solid #fff',
    spec: { backgroundColor: '#000000', borderWidth: 1 },
    expect: { isMonochrome: false, isPureBackground: false },
  },
  {
    name: '底色 + 圆角 → isPureBackground 不可用',
    style: 'background-color:#000;border-radius:8px',
    spec: { backgroundColor: '#000000', borderRadius: 8 },
    expect: { isMonochrome: false, isPureBackground: false },
  },
]

describe('★★I3 · paint-hint 两路一致性（IR 路径 ⟷ 自绘适配器路径）', () => {
  for (const c of CASES) {
    it(c.name, () => {
      // ① IR 路径：走真实的样式归一化（不是手搓 PaintHint）
      const irHint = normalizeStyleString(c.style).props.paintHint
      // ② 适配器路径：喂等价的 spec 字段
      const sdHint = deriveSpecPaintHint(c.spec)

      // ③ 对拍：两路结论必须一致（这是本文件的核心判据）
      expect(sdHint.isMonochrome, `适配器与 IR 的 isMonochrome 必须一致（形态：${c.name}）`)
        .toBe(irHint.isMonochrome)
      expect(sdHint.isPureBackground, `适配器与 IR 的 isPureBackground 必须一致（形态：${c.name}）`)
        .toBe(irHint.isPureBackground)

      // ④ 同时锁定**期望值**（防止"两路一起错"也能通过——对拍只保证一致，不保证正确）
      expect(irHint.isMonochrome, `IR 侧 isMonochrome 期望值（${c.name}）`).toBe(c.expect.isMonochrome)
      expect(irHint.isPureBackground, `IR 侧 isPureBackground 期望值（${c.name}）`).toBe(c.expect.isPureBackground)
    })
  }

  it('★派生实现的独立性：适配器**不**依赖 component-ir 包（依赖形态是设计属性）', () => {
    // 【为什么要断言这条】它是"为什么需要本文件"的前提：
    //   若哪天 renderer-app 加了 component-ir 依赖，两路就可以共享唯一实现，
    //   届时本对拍文件可以退化为"只锁期望值"。断言它可让那个决定是**显式**的。
    const pkg = require('../packages/renderer-app/package.json') as {
      dependencies?: Record<string, string>
    }
    expect(pkg.dependencies?.['@proteus-vue/component-ir'], '适配器不应依赖 component-ir（若改了，请更新本文件与注释）')
      .toBeUndefined()
  })
})
