// tests/whitespace-normalize.test.ts —— ★★★CSS `white-space` 文本归一化（2026-10-08 · 用户抓出
//   「font 案例 C：Web 一行、App 三端换行」）。
//
// 【锁什么（App 三端的共享实例化）】CSS `white-space: normal`（缺省）下 `\n`/制表/连续空格**折叠**为
//   单个空格（换行折叠）——浏览器真值。App 宿主此前把 `\n` 当**强制换行** ⇒ 与 Web 不符。
//   修法在**共享运行期实例化**（`slot-runtime/instantiate` 的 `setNormText`）——App 三端同源。
//   ★Web/MP 用浏览器/原生 CSS，不经过本模块（本测试只锁 App 侧语义）。
import { describe, it, expect } from 'vitest'
import { instantiateTemplate, PropKeyTable, StringPool } from '@proteus-vue/slot-runtime'
import type { LayoutTemplate, SubscriptionTable } from '@proteus-vue/slot-runtime'

/** 造一个最小模板：一个 text 节点 + 指定 whiteSpace + 文本（模拟 SFC mustache 带 \n 的形态）。 */
function instText(text: string, whiteSpace?: string): string {
  const tpl: LayoutTemplate = {
    nodes: [
      { id: 0, parentId: null, tag: 'view' },
      { id: 1, parentId: 0, tag: 'text', text, ...(whiteSpace ? { style: { whiteSpace } } : {}) },
    ],
    lists: [],
  } as unknown as LayoutTemplate
  const table = { sources: [], slots: [], evaluators: [], constantSlots: [] } as unknown as SubscriptionTable
  const inst = instantiateTemplate(tpl, {
    viewport: { width: 100, height: 100 },
    read: () => undefined,
    table,
    registry: undefined as never,
  })
  const n = inst.nodes.find((x) => x.id === 1) as { text?: string }
  return n?.text ?? ''
}

const MULTI = '第一行文本\n第二行文本（行高 28px）'

describe('★★★white-space 文本归一化（App 共享实例化）', () => {
  it('① normal / 缺省：`\\n` 折叠为空格（Web 真值——一行）', () => {
    expect(instText(MULTI, 'normal')).toBe('第一行文本 第二行文本（行高 28px）')
    expect(instText(MULTI)).toBe('第一行文本 第二行文本（行高 28px）') // 缺省 = normal
  })

  it('② nowrap：同样折叠（nowrap 只禁折行，不保留 \\n）', () => {
    expect(instText(MULTI, 'nowrap')).toBe('第一行文本 第二行文本（行高 28px）')
  })

  it('③ pre-wrap / pre：原样保留 `\\n` 与空白（本仓 text.vue 案例 C 依赖）', () => {
    const pre = '第一行\n    缩进四格第二行\n第三行'
    expect(instText(pre, 'pre-wrap')).toBe(pre)
    expect(instText(pre, 'pre')).toBe(pre)
  })

  it('④ pre-line：折叠空格/制表但**保留 `\\n`**', () => {
    expect(instText('a  b\tc\nd', 'pre-line')).toBe('a b c\nd')
  })

  it('⑤ 连续空格与制表也折叠（normal）', () => {
    expect(instText('a    b\t\tc', 'normal')).toBe('a b c')
  })

  it('⑥ ★混排合成叶：首尾空格**保留**（行内内容，不 trim）——判据 ㉑ 的共享实例化半边', () => {
    // 【为什么必须锁】混排（`mix <b>MIXB</b> tail`）的合成叶 `"mix "` / `" tail"` / 独立空格叶 `" "`
    //   的首尾空格是**行内内容**（Web 里与相邻 inline 之间存在一个空格）——逐叶 trim 会渲染成
    //   `mixMIXBtail`、空格叶变空（实测：判据 ㉑ 在 iOS/共享实例化红）。★normal 折叠但**不 trim**。
    expect(instText('mix ', 'normal')).toBe('mix ')
    expect(instText(' tail', 'normal')).toBe(' tail')
    expect(instText(' ', 'normal')).toBe(' ') // 独立空格叶必须**存活**（Vue condense：那是真内容）
  })
})
