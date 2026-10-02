// VC0 几何探针（最小装置核心）——测量 boundingClientRect 在各生命周期/选择器形态下的返回值
//
// 【为什么这样设计（对应卡片测试矩阵）】
//   · 4 类节点：view / text / image / scroll-view
//   · 4 个时机：attached / ready（组件生命周期）/ onReady（页面）/ 延迟 500ms
//   · 两种查询形态：exec 数组形态（官方推荐批量）vs boundingClientRect(cb) 回调形态（Proteus 现用）
//   · 4 种选择器形态：#id / .class / [data-] / tag（Skyline 对各形态的匹配能力）
//   · 作用域两种：页面级 wx.createSelectorQuery() vs 组件级 this.createSelectorQuery()
// 结果全部写入 getApp().globalData.__VC0__（automation_evaluate 同上下文可读）+ console 留痕。

function ledger() {
  const app = getApp()
  if (!app.globalData.__VC0__) app.globalData.__VC0__ = { env: null, runs: [] }
  return app.globalData.__VC0__
}

/** 当前 session（页面 onLoad 设置）——每条记录带上，解析时按 session 分组（**不清账本**：
 *  组件 attached 可能早于页面 onLoad 写入，清空会误删——本装置第一版 bug，已修） */
function sessionId() {
  try {
    const app = getApp()
    return (app.globalData.__VC0__ && app.globalData.__VC0__.session) || 0
  } catch (e) {
    return 0
  }
}

/**
 * 跑一遍完整矩阵。
 * @param inst   组件实例（null = 页面作用域）
 * @param label  记录标签（时机/作用域）
 * @param prefix id 前缀：'' = 页面（#g-*）/ 'c-p1-' = 组件（#c-p1-*）
 */
function runMatrix(inst, label, prefix) {
  const out = ledger().runs
  const p = prefix || ''
  const ids = [p + 'view', p + 'text', p + 'image', p + 'scroll']
  const sel = (k) => '#' + k

  const mkQuery = () => {
    // ★组件作用域：优先组件实例自带 createSelectorQuery（Proteus 实测的玻璃易拉形态）；
    //   失败回落 wx.createSelectorQuery()（失败形态本身也是读数）
    if (inst) {
      try {
        if (typeof inst.createSelectorQuery === 'function') return { q: inst.createSelectorQuery(), kind: 'inst' }
      } catch (e) { /* 记录在卷 */ }
      try { return { q: wx.createSelectorQuery(), kind: 'wx-fallback' } } catch (e) { return null }
    }
    try { return { q: wx.createSelectorQuery(), kind: 'wx' } } catch (e) { return null }
  }

  // ── 形态 ⓪：`wx.createSelectorQuery().in(inst)`（**官方文档标准形态**——本仓记录
  //    「Skyline/glass-easel 实测查不到组件内元素」的正是这一条，必须对照验证）──
  if (inst) {
    try {
      let q0 = null
      try {
        q0 = typeof wx.createSelectorQuery().in === 'function' ? wx.createSelectorQuery().in(inst) : null
      } catch (e) { q0 = null }
      if (!q0) {
        out.push({ session: sessionId(), label: label, form: 'in', error: 'wx.createSelectorQuery().in 不可用或抛错' })
      } else {
        const rows = []
        const push = (s, what) => (r) => rows.push({ sel: s, what: what, rect: r })
        // ★id + **属性选择器**双测：仓库 2026-09-08 记录「`.in(scope)` 下 id/类/属性三选均 null」
        //   —— 本次要分辨「.in 本身不行」还是「属性选择器不行」的复合因素
        q0.select(sel(ids[0])).boundingClientRect(push(ids[0], 'id'))
          .select(sel(ids[1])).boundingClientRect(push(ids[1], 'id'))
          .select('[data-role="box"]').boundingClientRect(push('[data-role=box]', 'attr'))
          .select('.probe-box').boundingClientRect(push('.probe-box', 'class'))
          .exec(function () {
            out.push({ session: sessionId(), label: label, form: 'in', ts: Date.now(), rows: rows })
            console.log('[VC0] ' + label + ' in ' + JSON.stringify(rows))
          })
      }
    } catch (e) {
      out.push({ session: sessionId(), label: label, form: 'in', error: String(e) })
    }
  }

  // ── 形态 ①：exec 数组（4 节点 + scroll-view scrollOffset）──
  try {
    const got = mkQuery()
    if (!got) {
      out.push({ session: sessionId(), label: label, form: 'exec', error: 'createSelectorQuery 不可用' })
    } else {
      got.q.select(sel(ids[0])).boundingClientRect()
        .select(sel(ids[1])).boundingClientRect()
        .select(sel(ids[2])).boundingClientRect()
        .select(sel(ids[3])).boundingClientRect()
        .select(sel(ids[3])).scrollOffset()
        .exec(function (res) {
          out.push({ session: sessionId(), label: label, form: 'exec', q: got.kind, ts: Date.now(), res: res })
          console.log('[VC0] ' + label + ' exec ' + JSON.stringify(res))
        })
    }
  } catch (e) {
    out.push({ session: sessionId(), label: label, form: 'exec', error: String(e) })
  }

  // ── 形态 ②：boundingClientRect(cb) 回调（Proteus 现用形态）──
  try {
    const got = mkQuery()
    if (got) {
      const rows = []
      const push = (s) => (r) => rows.push({ sel: s, rect: r })
      got.q.select(sel(ids[0])).boundingClientRect(push(ids[0]))
        .select(sel(ids[1])).boundingClientRect(push(ids[1]))
        .select(sel(ids[2])).boundingClientRect(push(ids[2]))
        .select(sel(ids[3])).boundingClientRect(push(ids[3]))
        .exec(function () {
          out.push({ session: sessionId(), label: label, form: 'cb', q: got.kind, ts: Date.now(), rows: rows })
          console.log('[VC0] ' + label + ' cb ' + JSON.stringify(rows))
        })
    }
  } catch (e) {
    out.push({ session: sessionId(), label: label, form: 'cb', error: String(e) })
  }

  // ── 选择器形态（4 种；只在**页面作用域**跑）──
  if (!inst) {
    try {
      const q3 = wx.createSelectorQuery()
      const forms = [
        { sel: '#g-view', what: 'id' },
        { sel: '.probe-box', what: 'class' },
        { sel: '[data-role="box"]', what: 'attr' },
        { sel: 'view', what: 'tag' }
      ]
      const rows = []
      const push = (f) => (r) => rows.push({ sel: f.sel, what: f.what, rect: r })
      q3.select(forms[0].sel).boundingClientRect(push(forms[0]))
        .select(forms[1].sel).boundingClientRect(push(forms[1]))
        .select(forms[2].sel).boundingClientRect(push(forms[2]))
        .select(forms[3].sel).boundingClientRect(push(forms[3]))
        .exec(function () {
          out.push({ session: sessionId(), label: label + '-selfrms', form: 'cb', ts: Date.now(), rows: rows })
          console.log('[VC0] ' + label + '-selfrms ' + JSON.stringify(rows))
        })
    } catch (e) {
      out.push({ session: sessionId(), label: label + '-selfrms', form: 'cb', error: String(e) })
    }
  }
}

/** 组件生命周期三时机（attached / ready / 延迟 500ms） */
function runComponentTimeline(inst, tag) {
  runMatrix(inst, tag + '-attached', 'c-' + tag + '-')       // 时机 ①
  setTimeout(function () {                                    // 时机 ③（attached+500ms，ready 之前/之后都可能）
    runMatrix(inst, tag + '-delayed500', 'c-' + tag + '-')
  }, 500)
}

/** 页面时机：onReady + 延迟 500ms（页面作用域；页面节点 id 前缀 `g-`） */
function runPageTimeline(page, tag) {
  runMatrix(null, tag + '-onReady', 'g-')
  setTimeout(function () {
    runMatrix(null, tag + '-delayed500', 'g-')
  }, 500)
}

module.exports = {
  runMatrix: runMatrix,
  runComponentTimeline: runComponentTimeline,
  runPageTimeline: runPageTimeline
}
