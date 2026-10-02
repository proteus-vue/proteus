// VC1 · CSS 计算样式测试组件：30 个静态测试节点（每属性一个非默认测试值），ready 时读回
const computed = require('../../utils/computed.js')

Component({
  lifetimes: {
    ready() {
      // 延后一拍：与几何探针同节奏（渲染完成后再读计算样式）
      setTimeout(() => {
        var route = ''
        try { var pages = getCurrentPages(); var cur = pages[pages.length - 1]; route = (cur && (cur.route || cur.__route__)) || '' } catch (e) {}
        computed.runComputed('computed-' + route, this, null)
      }, 100)
    }
  },
  properties: { tag: { type: String, value: '' } }
})
