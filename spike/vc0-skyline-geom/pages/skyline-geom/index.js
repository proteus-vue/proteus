// VC0 · Skyline 几何被测页（renderer: skyline）
const probe = require('../../utils/probe.js')

Page({
  data: { tag: 'sky' },
  onLoad() {
    // ★开新 session（**不清账本**：组件 attached 可能先于 onLoad 写入——第一版清空会误删）
    try {
      const app = getApp()
      if (!app.globalData.__VC0__) app.globalData.__VC0__ = { env: null, runs: [] }
      app.globalData.__VC0__.session = Date.now()
    } catch (e) { /* 保持 */ }
  },
  onReady() {
    // 页面级时机：onReady + 延迟 500ms（4 类节点 + 4 选择器形态）
    probe.runPageTimeline(this, 'page-skyline')
    // ★探针可注入性测试：在页面上下文写全局，供 automation_evaluate 回读（沙箱限制实测）
    try {
      const g = (typeof globalThis !== 'undefined') ? globalThis : (typeof global !== 'undefined' ? global : null)
      if (g) {
        g.__VC0_INJECTED__ = { by: 'page-skyline', ts: Date.now(), marker: 'inject-ok' }
        console.log('[VC0-INJECT] globalThis 可写：' + JSON.stringify(g.__VC0_INJECTED__))
      } else {
        console.log('[VC0-INJECT] 无 globalThis/global 句柄')
      }
    } catch (e) {
      console.log('[VC0-INJECT-ERR] ' + String(e))
    }
    // ★getApp() 账本可读性（automation_evaluate 读同账本的前提）
    console.log('[VC0-LEDGER-KEYS] ' + JSON.stringify(Object.keys(getApp().globalData.__VC0__ || {})))
    // ★VC4-c/d：一致性快照采集（**页面级触发**——组件 ready 跨页复用不可靠，实测抓出）
    var self2 = this
    setTimeout(function () {
      var collect = require('../../utils/collect-consistency.js')
      var comp = self2.selectComponent('#cssprobe')
      collect.collectComponentFromPage(self2, comp, 'p1', 'skyline', function (geo) {
        var selftest = collect.snap.assertSnapshotSelfCheck()
        var style = collect.styleDeclared('skyline')
        var app = getApp()
        if (!app.globalData.__VC0__) app.globalData.__VC0__ = { env: null, runs: [] }
        var bucket = app.globalData.__VC0__.consistency = { geometry: [], style: [], selftest: [] }
        bucket.geometry.push(geo)
        bucket.style.push(style)
        bucket.selftest.push(selftest)
        // ★账本瘦身（实测：完整账本经 automation_evaluate 读会超时）——另存一份"门禁只读区"：
        //   几何全量（门禁的核心比较对象）+ 样式摘要（节点数与首节点键集）——足够 schema+几何判据
        bucket.gateView = {
          geo: geo,   // 完整几何快照（含 format/version/end/viewport/boundaries——校验器需要全部字段）
          style: style,
          styleSummary: { nodes: style.nodes.length, firstKeys: style.nodes.length ? Object.keys(style.nodes[0].styles).sort() : [] },
          selftest: selftest,
        }
        console.log('[VC4-CONSISTENCY] end=skyline nodes=' + (geo.root && geo.root.children ? geo.root.children.length : 0) + ' selftest=' + (selftest.ok ? 'ok' : JSON.stringify(selftest.problems)) + (geo.collectionErrors ? ' ERRORS=' + JSON.stringify(geo.collectionErrors) : ''))
      })
    }, 600)

  }
})
