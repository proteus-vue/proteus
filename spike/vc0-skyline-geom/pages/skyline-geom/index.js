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
  }
})
