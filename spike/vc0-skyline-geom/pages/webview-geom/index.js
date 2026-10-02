// VC0 · WebView 几何被测页（renderer 缺省 = WebView；对照组）
const probe = require('../../utils/probe.js')

Page({
  data: { tag: 'webview', scrollTop: 0 },
  /** ★L2.6：程序化滚动（与 skyline 页同法） */
  scrollTo(v) {
    this.setData({ scrollTop: v })
  },
  onLoad() {
    // ★开新 session（**不清账本**：组件 attached 可能先于 onLoad 写入——第一版清空会误删）
    try {
      const app = getApp()
      if (!app.globalData.__VC0__) app.globalData.__VC0__ = { env: null, runs: [] }
      app.globalData.__VC0__.session = Date.now()
    } catch (e) { /* 保持 */ }
  },
  onReady() {
    probe.runPageTimeline(this, 'page-webview')
    try {
      const g = (typeof globalThis !== 'undefined') ? globalThis : (typeof global !== 'undefined' ? global : null)
      if (g) {
        g.__VC0_INJECTED_WEBVIEW__ = { by: 'page-webview', ts: Date.now(), marker: 'inject-ok' }
        console.log('[VC0-INJECT] webview globalThis 可写：' + JSON.stringify(g.__VC0_INJECTED_WEBVIEW__))
      }
    } catch (e) {
      console.log('[VC0-INJECT-ERR] ' + String(e))
    }
    // ★VC4-c/d + L3：一致性快照采集（**页面级触发**——组件 ready 跨页复用不可靠，实测抓出）
    //   样式优先**实测**（fields computedStyle，WebView 可用）、失败回退产出式（Skyline 实测不可用）
    var self2 = this
    setTimeout(function () {
      var collect = require('../../utils/collect-consistency.js')
      var comp = self2.selectComponent('#cssprobe')
      collect.collectComponentFromPage(self2, comp, 'p1', 'webview', function (geo) {
        var selftest = collect.snap.assertSnapshotSelfCheck()
        collect.collectStyle(comp, 'webview', function (style) {
          var app = getApp()
          if (!app.globalData.__VC0__) app.globalData.__VC0__ = { env: null, runs: [] }
          var bucket = app.globalData.__VC0__.consistency = { geometry: [], style: [], selftest: [] }
          bucket.geometry.push(geo)
          bucket.style.push(style)
          bucket.selftest.push(selftest)
          bucket.gateView = {
            geo: geo,     // 完整几何快照
            style: style, // 完整样式快照（含 boundaries.measured 标注语义）
            selftest: selftest,
          }
          console.log('[VC4-CONSISTENCY] end=webview styleMeasured=' + !!(style && style.boundaries && style.boundaries.measured) +
            ' selftest=' + (selftest.ok ? 'ok' : JSON.stringify(selftest.problems)) +
            (geo.collectionErrors ? ' ERRORS=' + JSON.stringify(geo.collectionErrors) : ''))
        })
      })
    }, 600)

  }
})
