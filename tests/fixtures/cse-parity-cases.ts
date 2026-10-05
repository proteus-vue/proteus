// tests/fixtures/cse-parity-cases.ts
// ★★★G-61 B1：**判据①-b 的用例表**（CSE 与浏览器**同源**跑同一份 CSS + DOM）
//
// 【纪律（本文件是全套判据的地基）】
//   ① **两侧共源**：`css` 与 `html` 是**同一个输入**——CSE 解析 `css` 计算节点；浏览器加载同样的
//      `css` + `html` 读 `getComputedStyle`。任何"给 CSE 开小灶"（特殊改 CSS）都不允许。
//   ② `probes[].key` = CSE 节点 key（`root()` 里自定）；`probes[].selector` = 浏览器对应元素。
//      两侧 DOM 必须**同形**（同层级/同类名/id）——夹具写错会让判据红，这是设计（防"假绿"）。
//   ③ `class: 'A' | 'B'`：A = 布局无关计算值（字面比对）；B = 绝对长度（字面比对）。
//      **C（ratio/auto）不进本表**——resolved 是布局结果，归判据②几何（`03` §3.4）。
//   ④ `kind`：length（CSE absolute ⇄ 浏览器 px）/ color / number / enum。
//   ⑤ `normalize`：确有必要时才给（如浏览器把 `1.4` line-height 解析成 px 数——那个**算 A 类**
//      但需要在用例里写明"期望 px = fs × 1.4"；此时用 normalize 做显式换算，保持可比）。
//
// 【覆盖（100 例）】① 值形态（长度/颜色/枚举/数值）② 选择器与层叠（特异性/源序/important/@layer/inline）
//   ③ 继承（color/fs/fw/lh/letter-spacing/visibility/white-space/text-align/text-overflow）
//   ④ 计算值（em/rem/%font-size/line-height 三形态/currentColor/var/inherit/unset/initial）
//   ⑤ 简写与长手竞争（margin/padding/border-radius/border/gap/flex/overflow/inset）
import type { CseNode } from '@proteus-vue/compiler'

/** 造 CSE 节点（key 由用例给——便于与浏览器 selector 对齐） */
export function n(key: string, tag: string, classes: string[], children: CseNode[] = [], id?: string): CseNode {
  return { key, tag, classes, id, index: 0, count: 1, children }
}

export interface ParityProbe {
  /** CSE 节点 key */
  key: string
  /** 浏览器选择器（与 html 里元素对应） */
  selector: string
  props: Array<{
    /** CSS 属性名（浏览器 getComputedStyle 用） */
    css: string
    /** CSE StreamIR 字段名 */
    field: string
    kind: 'length' | 'color' | 'number' | 'enum'
    /** 可选：浏览器值 → 期望值 归一（少用；用则写清理由） */
    normalize?: (raw: string) => unknown
  }>
}

export interface ParityCase {
  id: string
  /** 用例类别（A/B；见头注③） */
  class: 'A' | 'B'
  css: string
  /** 注入 body 的 DOM（与 root() 同形） */
  html: string
  /** CSE 的节点树（与 html 同形） */
  root: () => CseNode
  probes: ParityProbe[]
}

const L = (css: string, field: string): ParityProbe['props'][number] => ({ css, field, kind: 'length' })
const C = (css: string, field: string): ParityProbe['props'][number] => ({ css, field, kind: 'color' })
const N = (css: string, field: string): ParityProbe['props'][number] => ({ css, field, kind: 'number' })
const E = (css: string, field: string): ParityProbe['props'][number] => ({ css, field, kind: 'enum' })

/** 单节点用例工厂（root + html 同形） */
function single(id: string, css: string, classes: string[], tag = 'div', props: ParityProbe['props']): ParityCase {
  const cls = classes.join(' ')
  return {
    id,
    class: 'B',
    css,
    html: `<${tag} class="${cls}" data-t="${id}"></${tag}>`,
    root: () => n('target', tag, classes),
    probes: [{ key: 'target', selector: `[data-t="${id}"]`, props }],
  }
}

export const PARITY_CASES: ParityCase[] = [
  // ── ① 基础值形态（长度）──
  single('len-px', '.target { margin-top: 12px }', ['target'], 'div', [L('margin-top', 'marginTop')]),
  single('len-zero', '.target { margin-top: 0 }', ['target'], 'div', [L('margin-top', 'marginTop')]),
  single('len-em-self', '.target { font-size: 20px; margin-top: 2em }', ['target'], 'div', [L('margin-top', 'marginTop')]),
  single('len-rem', 'html { font-size: 16px } .target { margin-top: 2rem }', ['target'], 'div', [L('margin-top', 'marginTop')]),
  single('len-pt', '.target { margin-top: 12pt }', ['target'], 'div', [L('margin-top', 'marginTop')]),
  single('len-vw', '.target { margin-top: 10vw }', ['target'], 'div', [L('margin-top', 'marginTop')]),
  single('len-vh', '.target { margin-top: 10vh }', ['target'], 'div', [L('margin-top', 'marginTop')]),
  single('len-padding', '.target { padding-left: 24px }', ['target'], 'div', [L('padding-left', 'paddingLeft')]),
  single('len-border-width', '.target { border-top: 3px solid #000 }', ['target'], 'div', [L('border-top-width', 'borderTopWidth')]),
  single('len-letter-spacing', '.target { letter-spacing: 2px }', ['target'], 'div', [L('letter-spacing', 'letterSpacing')]),
  single('len-radius', '.target { border-radius: 12px }', ['target'], 'div', [N('border-top-left-radius', '__radiusNum')].map(() => L('border-top-left-radius', 'borderRadius'))),

  // ── ① 基础值形态（颜色）──
  single('color-hex3', '.target { color: #abc }', ['target'], 'div', [C('color', 'color')]),
  single('color-hex6', '.target { color: #112233 }', ['target'], 'div', [C('color', 'color')]),
  single('color-hex8', '.target { color: #11223344 }', ['target'], 'div', [C('color', 'color')]),
  single('color-rgb', '.target { color: rgb(255, 0, 0) }', ['target'], 'div', [C('color', 'color')]),
  single('color-rgb-space', '.target { color: rgb(255 0 0) }', ['target'], 'div', [C('color', 'color')]),
  single('color-rgba', '.target { color: rgba(255, 0, 0, 0.5) }', ['target'], 'div', [C('color', 'color')]),
  single('color-rgb-pct', '.target { color: rgb(100%, 0%, 0%) }', ['target'], 'div', [C('color', 'color')]),
  single('color-hsl', '.target { color: hsl(120, 100%, 50%) }', ['target'], 'div', [C('color', 'color')]),
  single('color-hsla', '.target { color: hsla(120, 100%, 50%, 0.25) }', ['target'], 'div', [C('color', 'color')]),
  single('color-named', '.target { color: rebeccapurple }', ['target'], 'div', [C('color', 'color')]),
  single('color-bg', '.target { background-color: #eeeeee }', ['target'], 'div', [C('background-color', 'backgroundColor')]),
  single('color-border', '.target { border: 1px solid #123456 }', ['target'], 'div', [C('border-left-color', 'borderLeftColor')]),
  single('color-transparent', '.target { background-color: transparent }', ['target'], 'div', [C('background-color', 'backgroundColor')]),
  single('color-current', '.target { color: #445566; border-left-color: currentColor }', ['target'], 'div', [C('border-left-color', 'borderLeftColor')]),

  // ── ① 基础值形态（枚举 / 数值）──
  single('enum-display-flex', '.target { display: flex }', ['target'], 'div', [E('display', 'display')]),
  single('enum-display-block', '.target { display: block }', ['target'], 'div', [E('display', 'display')]),
  single('enum-display-none', '.target { display: none }', ['target'], 'div', [E('display', 'display')]),
  single('enum-position', '.target { position: absolute }', ['target'], 'div', [E('position', 'position')]),
  single('enum-overflow', '.target { overflow: hidden }', ['target'], 'div', [E('overflow', 'overflow')]),
  single('enum-text-align', '.target { text-align: center }', ['target'], 'div', [E('text-align', 'textAlign')]),
  single('enum-visibility', '.target { visibility: hidden }', ['target'], 'div', [E('visibility', 'visibility')]),
  single('enum-flex-direction', '.target { display: flex; flex-direction: column }', ['target'], 'div', [E('flex-direction', 'flexDirection')]),
  single('enum-flex-wrap', '.target { display: flex; flex-wrap: wrap }', ['target'], 'div', [E('flex-wrap', 'flexWrap')]),
  single('enum-justify', '.target { display: flex; justify-content: space-between }', ['target'], 'div', [E('justify-content', 'justifyContent')]),
  single('enum-align-items', '.target { display: flex; align-items: center }', ['target'], 'div', [E('align-items', 'alignItems')]),
  single('enum-align-self', '.target { display: flex; align-self: flex-end }', ['target'], 'div', [E('align-self', 'alignSelf')]),
  single('enum-align-content', '.target { display: flex; flex-wrap: wrap; align-content: space-around }', ['target'], 'div', [E('align-content', 'alignContent')]),
  single('enum-pointer-events', '.target { pointer-events: none }', ['target'], 'div', [E('pointer-events', 'pointerEvents')]),
  single('enum-box-sizing', '.target { box-sizing: border-box }', ['target'], 'div', [E('box-sizing', 'boxSizing')]),
  single('enum-text-overflow', '.target { text-overflow: ellipsis }', ['target'], 'div', [E('text-overflow', 'textOverflow')]),
  single('num-opacity', '.target { opacity: 0.4 }', ['target'], 'div', [N('opacity', 'opacity')]),
  single('num-flex-grow', '.target { display: flex; flex-grow: 3 }', ['target'], 'div', [N('flex-grow', 'flexGrow')]),
  single('num-flex-shrink', '.target { display: flex; flex-shrink: 0 }', ['target'], 'div', [N('flex-shrink', 'flexShrink')]),
  single('num-font-weight', '.target { font-weight: 600 }', ['target'], 'div', [N('font-weight', 'fontWeight')]),
  single('num-font-weight-bold', '.target { font-weight: bold }', ['target'], 'div', [N('font-weight', 'fontWeight')]),
  single('num-font-size', '.target { font-size: 18px }', ['target'], 'div', [N('font-size', 'fontSize')]),
  single('num-z-index', '.target { position: absolute; z-index: 5 }', ['target'], 'div', [N('z-index', 'zIndex')]),

  // ── ⑤ 简写与长手竞争（长手层叠的核心正确性）──
  single('shorthand-margin', '.target { margin: 8px }', ['target'], 'div', [
    L('margin-top', 'marginTop'), L('margin-right', 'marginRight'), L('margin-bottom', 'marginBottom'), L('margin-left', 'marginLeft'),
  ]),
  single('shorthand-margin-2', '.target { margin: 4px 12px }', ['target'], 'div', [
    L('margin-top', 'marginTop'), L('margin-right', 'marginRight'), L('margin-bottom', 'marginBottom'), L('margin-left', 'marginLeft'),
  ]),
  single('shorthand-margin-3', '.target { margin: 1px 2px 3px }', ['target'], 'div', [
    L('margin-top', 'marginTop'), L('margin-right', 'marginRight'), L('margin-bottom', 'marginBottom'), L('margin-left', 'marginLeft'),
  ]),
  single('shorthand-padding-4', '.target { padding: 1px 2px 3px 4px }', ['target'], 'div', [
    L('padding-top', 'paddingTop'), L('padding-right', 'paddingRight'), L('padding-bottom', 'paddingBottom'), L('padding-left', 'paddingLeft'),
  ]),
  single('longhand-vs-shorthand', '.target { margin: 0; margin-top: 5px }', ['target'], 'div', [
    L('margin-top', 'marginTop'), L('margin-left', 'marginLeft'),
  ]),
  single('shorthand-vs-longhand', '.target { margin-top: 5px; margin: 0 }', ['target'], 'div', [L('margin-top', 'marginTop')]),
  single('shorthand-gap', '.target { display: flex; gap: 6px 10px }', ['target'], 'div', [
    L('row-gap', 'rowGap'), L('column-gap', 'columnGap'),
  ]),
  single('shorthand-overflow', '.target { overflow: hidden }', ['target'], 'div', [E('overflow-x', 'overflow'), E('overflow-y', 'overflow')]),
  single('shorthand-inset', '.target { position: absolute; inset: 0px 8px }', ['target'], 'div', [
    L('top', 'top'), L('right', 'right'), L('bottom', 'bottom'), L('left', 'left'),
  ]),

  // ── ② 层叠（特异性 / 源序 / important）──
  {
    id: 'cascade-specificity',
    class: 'B',
    css: '.wrap .target { margin-top: 3px } .target { margin-top: 9px }',
    html: `<div class="wrap"><div class="target" data-t="cascade-specificity"></div></div>`,
    root: () => {
      const t = n('target', 'div', ['target'])
      return n('wrap', 'div', ['wrap'], [t])
    },
    probes: [{ key: 'target', selector: '[data-t="cascade-specificity"]', props: [L('margin-top', 'marginTop')] }],
  },
  {
    id: 'cascade-order',
    class: 'B',
    css: '.target { margin-top: 3px } .target { margin-top: 9px }',
    html: `<div class="target" data-t="cascade-order"></div>`,
    root: () => n('target', 'div', ['target']),
    probes: [{ key: 'target', selector: '[data-t="cascade-order"]', props: [L('margin-top', 'marginTop')] }],
  },
  {
    id: 'cascade-important',
    class: 'B',
    css: '.target { margin-top: 3px !important } .target.t2 { margin-top: 9px }',
    html: `<div class="target t2" data-t="cascade-important"></div>`,
    root: () => n('target', 'div', ['target', 't2']),
    probes: [{ key: 'target', selector: '[data-t="cascade-important"]', props: [L('margin-top', 'marginTop')] }],
  },
  {
    id: 'cascade-id',
    class: 'B',
    css: '#x { margin-top: 4px } .target { margin-top: 8px }',
    html: `<div id="x" class="target" data-t="cascade-id"></div>`,
    root: () => n('target', 'div', ['target'], [], 'x'),
    probes: [{ key: 'target', selector: '[data-t="cascade-id"]', props: [L('margin-top', 'marginTop')] }],
  },
  {
    id: 'cascade-layer-normal',
    class: 'B',
    css: '@layer base, theme;\n@layer base { .target { margin-top: 4px } }\n@layer theme { .target { margin-top: 12px } }',
    html: `<div class="target" data-t="cascade-layer-normal"></div>`,
    root: () => n('target', 'div', ['target']),
    probes: [{ key: 'target', selector: '[data-t="cascade-layer-normal"]', props: [L('margin-top', 'marginTop')] }],
  },
  {
    id: 'cascade-layer-important',
    class: 'B',
    css: '@layer base, theme;\n@layer base { .target { margin-top: 4px !important } }\n@layer theme { .target { margin-top: 12px !important } }',
    html: `<div class="target" data-t="cascade-layer-important"></div>`,
    root: () => n('target', 'div', ['target']),
    probes: [{ key: 'target', selector: '[data-t="cascade-layer-important"]', props: [L('margin-top', 'marginTop')] }],
  },
  {
    id: 'cascade-unlayered',
    class: 'B',
    css: '@layer base;\n@layer base { .target { margin-top: 4px } }\n.target { margin-top: 12px }',
    html: `<div class="target" data-t="cascade-unlayered"></div>`,
    root: () => n('target', 'div', ['target']),
    probes: [{ key: 'target', selector: '[data-t="cascade-unlayered"]', props: [L('margin-top', 'marginTop')] }],
  },
  {
    id: 'cascade-unlayered-important',
    class: 'B',
    css: '@layer base;\n@layer base { .target { margin-top: 4px !important } }\n.target { margin-top: 12px !important }',
    html: `<div class="target" data-t="cascade-unlayered-important"></div>`,
    root: () => n('target', 'div', ['target']),
    probes: [{ key: 'target', selector: '[data-t="cascade-unlayered-important"]', props: [L('margin-top', 'marginTop')] }],
  },
  {
    id: 'cascade-structural-pseudo',
    class: 'B',
    css: '.kid { margin-top: 4px } .kid:last-child { margin-top: 14px }',
    html: `<div><div class="kid" data-t="k1"></div><div class="kid" data-t="cascade-structural-pseudo"></div></div>`,
    root: () => {
      const k1 = n('k1', 'div', ['kid'])
      const k2 = n('k2', 'div', ['kid'])
      return n('wrap', 'div', [], [k1, k2])
    },
    probes: [{ key: 'k2', selector: '[data-t="cascade-structural-pseudo"]', props: [L('margin-top', 'marginTop')] }],
  },
  {
    id: 'cascade-not',
    class: 'B',
    css: '.kid { margin-top: 4px } .kid:not(.first) { margin-top: 14px }',
    html: `<div><div class="kid first" data-t="c2not-1"></div><div class="kid" data-t="cascade-not"></div></div>`,
    root: () => {
      const k1 = n('k1', 'div', ['kid', 'first'])
      const k2 = n('k2', 'div', ['kid'])
      return n('wrap', 'div', [], [k1, k2])
    },
    probes: [{ key: 'k2', selector: '[data-t="cascade-not"]', props: [L('margin-top', 'marginTop')] }],
  },

  // ── ③ 继承（沿树传播；含"因子 vs 绝对"与"不该继承"）──
  {
    id: 'inherit-color',
    class: 'A',
    css: '.wrap { color: #334455 }',
    html: `<div class="wrap"><span data-t="inherit-color"></span></div>`,
    root: () => {
      const leaf = n('leaf', 'span', [])
      return n('wrap', 'div', ['wrap'], [leaf])
    },
    probes: [{ key: 'leaf', selector: '[data-t="inherit-color"]', props: [C('color', 'color')] }],
  },
  {
    id: 'inherit-font-size',
    class: 'A',
    css: '.wrap { font-size: 22px }',
    html: `<div class="wrap"><span data-t="inherit-font-size"></span></div>`,
    root: () => {
      const leaf = n('leaf', 'span', [])
      return n('wrap', 'div', ['wrap'], [leaf])
    },
    probes: [{ key: 'leaf', selector: '[data-t="inherit-font-size"]', props: [N('font-size', 'fontSize')] }],
  },
  {
    id: 'inherit-font-weight',
    class: 'A',
    css: '.wrap { font-weight: 700 }',
    html: `<div class="wrap"><span data-t="inherit-font-weight"></span></div>`,
    root: () => {
      const leaf = n('leaf', 'span', [])
      return n('wrap', 'div', ['wrap'], [leaf])
    },
    probes: [{ key: 'leaf', selector: '[data-t="inherit-font-weight"]', props: [N('font-weight', 'fontWeight')] }],
  },
  {
    id: 'inherit-line-height-factor',
    class: 'A',
    // ★两侧共源：子节点 font-size 用**类**（不是 inline style）——inline 需经 opts.inlineStyles 注入，
    //   本判据 v1 不覆盖 inline（那是另一条通路；B3 切换时并测）
    css: '.wrap { font-size: 10px; line-height: 1.5 } .small { font-size: 20px }',
    html: `<div class="wrap"><span class="small" data-t="inherit-line-height-factor"></span></div>`,
    root: () => {
      const leaf = n('leaf', 'span', ['small'])
      return n('wrap', 'div', ['wrap'], [leaf])
    },
    probes: [
      { key: 'leaf', selector: '[data-t="inherit-line-height-factor"]', props: [N('line-height', 'lineHeight')] },
    ],
  },
  {
    id: 'inherit-letter-spacing',
    class: 'A',
    css: '.wrap { letter-spacing: 1.5px }',
    html: `<div class="wrap"><span data-t="inherit-letter-spacing"></span></div>`,
    root: () => {
      const leaf = n('leaf', 'span', [])
      return n('wrap', 'div', ['wrap'], [leaf])
    },
    probes: [{ key: 'leaf', selector: '[data-t="inherit-letter-spacing"]', props: [L('letter-spacing', 'letterSpacing')] }],
  },
  {
    id: 'inherit-visibility',
    class: 'A',
    css: '.wrap { visibility: hidden }',
    html: `<div class="wrap"><span data-t="inherit-visibility"></span></div>`,
    root: () => {
      const leaf = n('leaf', 'span', [])
      return n('wrap', 'div', ['wrap'], [leaf])
    },
    probes: [{ key: 'leaf', selector: '[data-t="inherit-visibility"]', props: [E('visibility', 'visibility')] }],
  },
  {
    id: 'inherit-text-align',
    class: 'A',
    css: '.wrap { text-align: right }',
    html: `<div class="wrap"><span data-t="inherit-text-align"></span></div>`,
    root: () => {
      const leaf = n('leaf', 'span', [])
      return n('wrap', 'div', ['wrap'], [leaf])
    },
    probes: [{ key: 'leaf', selector: '[data-t="inherit-text-align"]', props: [E('text-align', 'textAlign')] }],
  },
  {
    id: 'not-inherit-text-decoration',
    class: 'A',
    css: '.wrap { text-decoration: underline }',
    html: `<div class="wrap"><span data-t="not-inherit-text-decoration"></span></div>`,
    root: () => {
      const leaf = n('leaf', 'span', [])
      return n('wrap', 'div', ['wrap'], [leaf])
    },
    // 子元素 computed 应为 none（装饰不继承）——两侧都读 `text-decoration-line`
    probes: [
      {
        key: 'leaf',
        selector: '[data-t="not-inherit-text-decoration"]',
        props: [{ css: 'text-decoration-line', field: 'textDecoration', kind: 'enum', normalize: (v) => (v === 'none' ? undefined : v) }],
      },
    ],
  },
  {
    id: 'not-inherit-background',
    class: 'A',
    css: '.wrap { background-color: #112233 }',
    html: `<div class="wrap"><span data-t="not-inherit-background"></span></div>`,
    root: () => {
      const leaf = n('leaf', 'span', [])
      return n('wrap', 'div', ['wrap'], [leaf])
    },
    probes: [
      {
        key: 'leaf',
        selector: '[data-t="not-inherit-background"]',
        props: [{ css: 'background-color', field: 'backgroundColor', kind: 'color', normalize: (v) => (v === 'rgba(0, 0, 0, 0)' ? undefined : v) }],
      },
    ],
  },
  {
    id: 'inherit-inherit-keyword',
    class: 'A',
    css: '.wrap { color: #ff0000 } .leaf { color: inherit }',
    html: `<div class="wrap"><span class="leaf" data-t="inherit-inherit-keyword"></span></div>`,
    root: () => {
      const leaf = n('leaf', 'span', ['leaf'])
      return n('wrap', 'div', ['wrap'], [leaf])
    },
    probes: [{ key: 'leaf', selector: '[data-t="inherit-inherit-keyword"]', props: [C('color', 'color')] }],
  },
  {
    id: 'inherit-unset-on-inheritable',
    class: 'A',
    css: '.wrap { color: #00ff00 } .leaf { color: unset }',
    html: `<div class="wrap"><span class="leaf" data-t="inherit-unset-on-inheritable"></span></div>`,
    root: () => {
      const leaf = n('leaf', 'span', ['leaf'])
      return n('wrap', 'div', ['wrap'], [leaf])
    },
    probes: [{ key: 'leaf', selector: '[data-t="inherit-unset-on-inheritable"]', props: [C('color', 'color')] }],
  },

  // ── ④ 计算值（em/rem/%/var/rel 权重）──
  single('calc-em-fontsize', '.parent { font-size: 20px } .target { font-size: 1.5em }', ['parent', 'target'], 'div', [N('font-size', 'fontSize')]),
  single('calc-percent-fontsize', '.target { font-size: 150% }', ['target'], 'div', [N('font-size', 'fontSize')]),
  single('calc-lineheight-factor', '.target { font-size: 20px; line-height: 1.5 }', ['target'], 'div', [N('line-height', 'lineHeight')]),
  single('calc-lineheight-px', '.target { font-size: 20px; line-height: 30px }', ['target'], 'div', [N('line-height', 'lineHeight')]),
  single('calc-lineheight-percent', '.target { font-size: 20px; line-height: 150% }', ['target'], 'div', [N('line-height', 'lineHeight')]),
  single('calc-weight-bolder', '.parent { font-weight: 400 } .target { font-weight: bolder }', ['parent', 'target'], 'div', [N('font-weight', 'fontWeight')]),
  single('calc-weight-lighter', '.parent { font-weight: 700 } .target { font-weight: lighter }', ['parent', 'target'], 'div', [N('font-weight', 'fontWeight')]),
  {
    id: 'calc-var',
    class: 'A',
    css: ':root { --brand: #123456 } .target { color: var(--brand) }',
    html: `<div class="target" data-t="calc-var"></div>`,
    root: () => n('target', 'div', ['target']),
    probes: [{ key: 'target', selector: '[data-t="calc-var"]', props: [C('color', 'color')] }],
  },
  {
    id: 'calc-var-fallback',
    class: 'B',
    css: '.target { margin-top: var(--missing, 14px) }',
    html: `<div class="target" data-t="calc-var-fallback"></div>`,
    root: () => n('target', 'div', ['target']),
    probes: [{ key: 'target', selector: '[data-t="calc-var-fallback"]', props: [L('margin-top', 'marginTop')] }],
  },
  {
    id: 'calc-var-inherited',
    class: 'A',
    css: '.wrap { --c: #654321 } .leaf { color: var(--c) }',
    html: `<div class="wrap"><span class="leaf" data-t="calc-var-inherited"></span></div>`,
    root: () => {
      const leaf = n('leaf', 'span', ['leaf'])
      return n('wrap', 'div', ['wrap'], [leaf])
    },
    probes: [{ key: 'leaf', selector: '[data-t="calc-var-inherited"]', props: [C('color', 'color')] }],
  },
  {
    id: 'calc-var-chain',
    class: 'A',
    css: ':root { --a: #778899; --b: var(--a) } .target { color: var(--b) }',
    html: `<div class="target" data-t="calc-var-chain"></div>`,
    root: () => n('target', 'div', ['target']),
    probes: [{ key: 'target', selector: '[data-t="calc-var-chain"]', props: [C('color', 'color')] }],
  },
  single('calc-initial-non-inherit', '.target { opacity: initial }', ['target'], 'div', [N('opacity', 'opacity')]),

  // ── 更多值形态覆盖（凑足 100+ 且边界化）──
  single('edge-negative-margin', '.target { margin-top: -8px }', ['target'], 'div', [L('margin-top', 'marginTop')]),
  single('edge-fraction-px', '.target { margin-top: 2.5px }', ['target'], 'div', [L('margin-top', 'marginTop')]),
  single('edge-alpha-hex', '.target { color: #00000080 }', ['target'], 'div', [C('color', 'color')]),
  single('edge-fs-em-parent', '.p { font-size: 24px } .target { font-size: 0.5em }', ['p', 'target'], 'div', [N('font-size', 'fontSize')]),
  single('edge-zero-unit', '.target { margin-top: 0px }', ['target'], 'div', [L('margin-top', 'marginTop')]),
  single('edge-border-all-sides', '.target { border: 2px solid rgb(10, 20, 30) }', ['target'], 'div', [
    L('border-top-width', 'borderTopWidth'),
    L('border-left-width', 'borderLeftWidth'),
    C('border-top-color', 'borderTopColor'),
  ]),
  single('edge-radius-pct', '.target { border-radius: 50% }', ['target'], 'div', [
    {
      css: 'border-top-left-radius',
      field: 'borderRadiusPct',
      kind: 'number',
      // 浏览器返回 `50%`（resolved 保留百分比）；CSE 的 borderRadiusPct 是比例 ⇒ 显式换算后比对
      normalize: (v) => (v.endsWith('%') ? Number(v.slice(0, -1)) / 100 : Number(v)),
    },
  ]),
  single('edge-white-space', '.target { white-space: nowrap }', ['target'], 'div', [E('white-space', 'whiteSpace')]),
  single('edge-pointer-events-auto', '.target { pointer-events: auto }', ['target'], 'div', [E('pointer-events', 'pointerEvents')]),
  single('edge-visibility-visible', '.target { visibility: visible }', ['target'], 'div', [E('visibility', 'visibility')]),
  single('edge-opacity-int', '.target { opacity: 1 }', ['target'], 'div', [N('opacity', 'opacity')]),
  single('edge-font-size-rem', 'html { font-size: 16px } .target { font-size: 1.5rem }', ['target'], 'div', [N('font-size', 'fontSize')]),
  single('edge-margin-em', '.target { font-size: 10px; margin-left: 1.5em }', ['target'], 'div', [L('margin-left', 'marginLeft')]),
  single('edge-text-align-left', '.target { text-align: left }', ['target'], 'div', [E('text-align', 'textAlign')]),
  single('edge-display-inline-block', '.target { display: inline-block }', ['target'], 'div', [E('display', 'display')]),

  // ── 组合场景（多属性 + 继承树）──
  {
    id: 'combo-card',
    class: 'B',
    css: `
      .card { padding: 12px 16px; margin-bottom: 8px; border-radius: 12px; background-color: #ffffff; color: #1f2329; font-size: 14px }
      .card .title { font-size: 16px; font-weight: 600; letter-spacing: 0.5px }
    `,
    html: `<div class="card" data-t="combo-card"><span class="title" data-t="combo-card-title"></span></div>`,
    root: () => {
      const title = n('title', 'span', ['title'])
      return n('card', 'div', ['card'], [title])
    },
    probes: [
      { key: 'card', selector: '[data-t="combo-card"]', props: [L('padding-top', 'paddingTop'), L('padding-left', 'paddingLeft'), L('margin-bottom', 'marginBottom'), C('background-color', 'backgroundColor'), C('color', 'color')] },
      { key: 'title', selector: '[data-t="combo-card-title"]', props: [N('font-size', 'fontSize'), N('font-weight', 'fontWeight'), L('letter-spacing', 'letterSpacing'), C('color', 'color')] },
    ],
  },
  {
    id: 'combo-flex-row',
    class: 'B',
    css: `
      .row { display: flex; flex-direction: row; justify-content: space-between; align-items: center; gap: 8px; padding: 4px }
      .row .item { flex-grow: 1; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis }
    `,
    html: `<div class="row" data-t="combo-flex-row"><span class="item" data-t="combo-flex-item"></span></div>`,
    root: () => {
      const item = n('item', 'span', ['item'])
      return n('row', 'div', ['row'], [item])
    },
    probes: [
      { key: 'row', selector: '[data-t="combo-flex-row"]', props: [E('display', 'display'), E('flex-direction', 'flexDirection'), E('justify-content', 'justifyContent'), E('align-items', 'alignItems'), L('row-gap', 'rowGap'), L('column-gap', 'columnGap')] },
      { key: 'item', selector: '[data-t="combo-flex-item"]', props: [N('flex-grow', 'flexGrow'), N('flex-shrink', 'flexShrink'), E('overflow', 'overflow'), E('text-overflow', 'textOverflow')] },
    ],
  },
  {
    id: 'combo-deep-nesting',
    class: 'A',
    css: `
      .a { color: #111111; font-size: 18px }
      .b { font-weight: 700 }
      .c { letter-spacing: 2px }
    `,
    html: `<div class="a"><div class="b"><span class="c" data-t="combo-deep-nesting"></span></div></div>`,
    root: () => {
      const c = n('c', 'span', ['c'])
      const b = n('b', 'div', ['b'], [c])
      return n('a', 'div', ['a'], [b])
    },
    probes: [
      {
        key: 'c',
        selector: '[data-t="combo-deep-nesting"]',
        props: [C('color', 'color'), N('font-size', 'fontSize'), N('font-weight', 'fontWeight'), L('letter-spacing', 'letterSpacing')],
      },
    ],
  },
  {
    id: 'combo-override-chain',
    class: 'A',
    css: `
      .a { color: #111111 }
      .a .b { color: #222222 }
      .a .b .c { color: #333333 }
    `,
    html: `<div class="a"><div class="b"><span class="c" data-t="combo-override-chain"></span></div></div>`,
    root: () => {
      const c = n('c', 'span', ['c'])
      const b = n('b', 'div', ['b'], [c])
      return n('a', 'div', ['a'], [b])
    },
    probes: [{ key: 'c', selector: '[data-t="combo-override-chain"]', props: [C('color', 'color')] }],
  },
  {
    id: 'combo-child-combinator',
    class: 'B',
    css: `
      .list > .item { padding-top: 6px }
      .list .nested { padding-top: 20px }
    `,
    html: `<div class="list" data-t="combo-child-combinator"><div><span class="nested item" data-t="combo-child-nested"></span></div></div>`,
    root: () => {
      // nested 的**直接父**是中间 div（不是 .list）⇒ `.list > .item` **不**命中它 ⇒ padding-top 应为 20（.list .nested 命中）
      const nested = n('nested', 'span', ['nested', 'item'])
      const mid = n('mid', 'div', [], [nested])
      return n('list', 'div', ['list'], [mid])
    },
    probes: [{ key: 'nested', selector: '[data-t="combo-child-nested"]', props: [L('padding-top', 'paddingTop')] }],
  },
  {
    id: 'combo-universal',
    class: 'B',
    css: `* { margin-top: 7px }`,
    html: `<div data-t="combo-universal"></div>`,
    root: () => n('target', 'div', []),
    probes: [{ key: 'target', selector: '[data-t="combo-universal"]', props: [L('margin-top', 'marginTop')] }],
  },
  {
    id: 'combo-element-selector',
    class: 'B',
    css: `span { letter-spacing: 3px }`,
    html: `<span data-t="combo-element-selector"></span>`,
    root: () => n('target', 'span', []),
    probes: [{ key: 'target', selector: '[data-t="combo-element-selector"]', props: [L('letter-spacing', 'letterSpacing')] }],
  },
  {
    id: 'combo-multi-class',
    class: 'B',
    css: `.a.b { margin-top: 11px } .a { margin-top: 2px }`,
    html: `<div class="a b" data-t="combo-multi-class"></div>`,
    root: () => n('target', 'div', ['a', 'b']),
    probes: [{ key: 'target', selector: '[data-t="combo-multi-class"]', props: [L('margin-top', 'marginTop')] }],
  },
]
