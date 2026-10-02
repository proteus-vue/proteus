// VC1 · CSS 计算样式测试组件：37 个静态测试节点（每属性一个非默认测试值），ready 时读回
// ★VC4-c/d（2026-10-02 实测修正）：一致性快照采集**不放在组件 ready**——同一 app 进程换页时
//   组件实例不重新 ready（实测：webview 页账本里无采集记录）⇒ 改由**页面 onReady** 触发。
const computed = require('../../utils/computed.js')

/** ★L2.5：tap 后展开（宽 60 → 120）——离散交互的**真实**触发源（非注入） */
const TAP_W_SMALL = 60
const TAP_W_LARGE = 120

Component({
  data: { tapW: TAP_W_SMALL },
  methods: {
    onTapExpand() {
      const next = this.data.tapW === TAP_W_SMALL ? TAP_W_LARGE : TAP_W_SMALL
      this.setData({ tapW: next })
      const g = (getApp().globalData.__VC0__ = getApp().globalData.__VC0__ || {})
      g.tapCount = (g.tapCount || 0) + 1
      console.log('[L2.5] tap → tapW=' + next + '（累计 ' + g.tapCount + ' 次）')
    },
  },
  lifetimes: {
    ready() {
      // 延后一拍：与几何探针同节奏（渲染完成后再读计算样式）
      setTimeout(() => {
        var route = ''
        try { var pages = getCurrentPages(); var cur = pages[pages.length - 1]; route = (cur && (cur.route || cur.__route__)) || '' } catch (e) {}
        computed.runComputed('computed-' + route, this, null)
      }, 100)
    },
  },
  properties: { tag: { type: String, value: '' } }
})
