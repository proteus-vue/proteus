// VC1 · 计算样式探针——测量各端**实际应用**的 CSS 属性（WebView / Skyline 双模式对照）
//
// 【为什么用 computedStyle 而不是"文档说支持"】支持度矩阵的证据分级：
//   ① 实测（本探针：渲染器实际算出的值） ② 官方文档（备注/默认值） ③ 推断（不可用）。
//
// 【平台事实（决定装置形态）】小程序**不能用 JS 写节点内联样式**——测试声明必须
//   **静态写在 WXML**（每个属性一个测试节点，id 形如 `t-<prop>-<n>`），JS 只做两件事：
//   ① `fields({computedStyle:[...]})` 读回计算值；② 判定（读回值 vs 测试值）。
//   ⇒ 测试节点表在页面 WXML 中；本文件持有**属性 → 测试值 → 判定口径**的单一事实源。
//
// 【判定语义（三档，防「默认值 vs 不支持」混淆）】
//   · supported：读回值 ≠ 属性初始值（说明测试声明被采纳）
//   · default：读回值 === 初始值（声明被忽略，或恰好等于初始值——用**非默认测试值**消除歧义：
//     每个属性选一个与其初始值明显不同的值；例如 overflow 初值 visible，就测 hidden）
//   · absent：读回值为 '' / undefined（属性根本不在计算样式里）
//   ★诚实边界：computedStyle 是**归一化**值（如 color 读回 `rgb(...)`、长度带单位），
//     判定用「与初始值不同即 supported」而不是与测试值字符串全等（各端归一化形态不同）。

const INITIAL = {
  display: 'flex',            // 微信两端初始值不同（Skyline flex / WebView block）——不作为判据基线
  position: 'relative',
  'box-sizing': 'border-box',
  opacity: '1',
  color: 'rgb(0, 0, 0)',
  'background-color': 'rgba(0, 0, 0, 0)',
  width: 'auto',
  height: 'auto',
  'margin-top': '0px',
  'padding-top': '0px',
  'border-radius': '0px',
  'border-width': '0px',
  'flex-direction': 'column',  // 注意：WebView 初始 row；统一表中标注差异
  'justify-content': 'flex-start',
  'align-items': 'normal',     // 各端不同（stretch/normal）——仅参考
  'flex-grow': '0',
  'flex-shrink': '1',
  'min-width': 'auto',
  'max-width': 'none',
  'min-height': 'auto',
  'max-height': 'none',
  'align-self': 'auto',
  'flex-basis': 'auto',
  'border-color': 'rgb(0, 0, 0)',
  gap: '0px',
  overflow: 'visible',
  top: 'auto',
  left: 'auto',
  transform: 'none',
  'font-size': '0px',
  'font-weight': '400',
  'line-height': 'normal',
  'text-align': 'start',
  visibility: 'visible',
  'z-index': 'auto'
}

/** 测试用例：id = WXML 中测试节点的 id；prop 是读回键；value 是 WXML 里写的测试值 */
const CASES = [
  { id: 't-display-block', read: 'display', prop: 'display', value: 'block' },
  { id: 't-display-flex', read: 'display', prop: 'display', value: 'flex' },
  { id: 't-position-relative', read: 'position', prop: 'position', value: 'relative' },
  { id: 't-position-absolute', read: 'position', prop: 'position', value: 'absolute' },
  { id: 't-box-sizing', read: 'box-sizing', prop: 'box-sizing', value: 'content-box' },
  { id: 't-opacity', read: 'opacity', prop: 'opacity', value: '0.5' },
  { id: 't-color', read: 'color', prop: 'color', value: 'rgb(1, 2, 3)' },
  { id: 't-bg-color', read: 'background-color', prop: 'background-color', value: 'rgb(4, 5, 6)' },
  { id: 't-width', read: 'width', prop: 'width', value: '123px' },
  { id: 't-height', read: 'height', prop: 'height', value: '45px' },
  { id: 't-margin-top', read: 'margin-top', prop: 'margin-top', value: '7px' },
  { id: 't-padding-top', read: 'padding-top', prop: 'padding-top', value: '9px' },
  { id: 't-border-radius', read: 'border-radius', prop: 'border-radius', value: '11px' },
  { id: 't-border-width', read: 'border-width', prop: 'border-width', value: '3px' },
  { id: 't-flex-direction-row', read: 'flex-direction', prop: 'flex-direction', value: 'row' },
  { id: 't-justify-center', read: 'justify-content', prop: 'justify-content', value: 'center' },
  { id: 't-align-center', read: 'align-items', prop: 'align-items', value: 'center' },
  { id: 't-flex-grow', read: 'flex-grow', prop: 'flex-grow', value: '2' },
  { id: 't-flex-shrink', read: 'flex-shrink', prop: 'flex-shrink', value: '0' },
  { id: 't-gap', read: 'gap', prop: 'gap', value: '5px' },
  { id: 't-overflow-hidden', read: 'overflow', prop: 'overflow', value: 'hidden' },
  { id: 't-top', read: 'top', prop: 'top', value: '13px' },
  { id: 't-left', read: 'left', prop: 'left', value: '17px' },
  { id: 't-transform', read: 'transform', prop: 'transform', value: 'translateX(10px)' },
  { id: 't-font-size', read: 'font-size', prop: 'font-size', value: '23px' },
  { id: 't-font-weight', read: 'font-weight', prop: 'font-weight', value: '700' },
  { id: 't-line-height', read: 'line-height', prop: 'line-height', value: '31px' },
  { id: 't-text-align', read: 'text-align', prop: 'text-align', value: 'center' },
  { id: 't-visibility-hidden', read: 'visibility', prop: 'visibility', value: 'hidden' },
  { id: 't-z-index', read: 'z-index', prop: 'z-index', value: '7' },
  { id: 't-min-width', read: 'min-width', prop: 'min-width', value: '123px' },
  { id: 't-max-width', read: 'max-width', prop: 'max-width', value: '321px' },
  { id: 't-min-height', read: 'min-height', prop: 'min-height', value: '55px' },
  { id: 't-max-height', read: 'max-height', prop: 'max-height', value: '77px' },
  { id: 't-align-self', read: 'align-self', prop: 'align-self', value: 'center' },
  { id: 't-flex-basis', read: 'flex-basis', prop: 'flex-basis', value: '44px' },
  { id: 't-border-color', read: 'border-color', prop: 'border-color', value: 'rgb(7, 8, 9)' }
]

/** 读回值 → 判定（与初始值比较；见文件头注的语义） */
function verdictOf(prop, readValue, wroteValue) {
  if (readValue === undefined || readValue === null || readValue === '') return 'absent'
  // ★归一化比较：去空格 + 小写
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase()
  // ★★先比**写入值**（最可靠的应用证据）：读回 == 写入 ⇒ 声明被采纳。
  //   【为什么必须这一步（本装置真机取证）】`display:flex` / `position:relative` 的写入值
  //   恰好等于该属性的初始值之一 ⇒ 仅按「≠初始值」判会误标 'default'（假阴性）。
  if (wroteValue !== undefined && norm(readValue) === norm(wroteValue)) return 'supported'
  const init = INITIAL[prop]
  if (init === undefined) return 'unknown'
  return norm(readValue) === norm(init) ? 'default' : 'supported'
}

/** 跑一遍矩阵（**scope = 组件实例**；测试节点静态在 css-probe 组件 WXML 上） */
function runComputed(label, scope, done) {
  const out = (function () {
    const app = getApp()
    if (!app.globalData.__VC0__) app.globalData.__VC0__ = { env: null, runs: [] }
    if (!app.globalData.__VC0__.computed) app.globalData.__VC0__.computed = []
    return app.globalData.__VC0__.computed
  })()
  const sess = (function () {
    try { return (getApp().globalData.__VC0__ && app.globalData.__VC0__.session) || 0 } catch (e) { return 0 }
  })()

  const mkQ = () => {
    if (scope && typeof scope.createSelectorQuery === 'function') return scope.createSelectorQuery()
    return wx.createSelectorQuery()
  }
  const rows = []
  let i = 0
  const step = () => {
    if (i >= CASES.length) {
      out.push({ session: sess, label: label, rows: rows, ts: Date.now() })
      if (done) done(rows)
      return
    }
    const c = CASES[i++]
    mkQ().select('#' + c.id).fields({ computedStyle: [c.read] }, function (res) {
      // ★★回调形态：请求的字段**平铺**在回调参数上（`{color:'rgb(…)'}`），**不嵌套** `computedStyle` 键
      //   （本装置首版按 `res.computedStyle` 读 ⇒ 全判 absent 假象——真机取证抓出）
      const v = res ? res[c.read] : undefined
      rows.push({ id: c.id, prop: c.prop, wrote: c.value, read: v === undefined ? null : String(v), verdict: verdictOf(c.prop, v, c.value) })
      step()
    }).exec()
  }
  step()
}

module.exports = { CASES: CASES, INITIAL: INITIAL, verdictOf: verdictOf, runComputed: runComputed }
