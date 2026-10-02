// VC0 · WebView 几何被测页（renderer 缺省 = WebView；对照组）
const probe = require('../../utils/probe.js')

Page({
  data: { tag: 'webview' },
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
  }
})
