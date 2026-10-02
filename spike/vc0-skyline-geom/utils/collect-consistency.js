// spike/vc0-skyline-geom/utils/collect-consistency.js
// ★VC4-c/d：装置侧采集器——用 `boundingClientRect` 收几何 → 组装 VC3-a 快照（产出式）。
//
// 【分工】consistency-snapshot.js = 格式实现（纯函数，可对拍）；
//   本文件 = **采集**（查询 API 的调用点——VC0 结论 A：Skyline/WebView 查询均可用）。
const snap = require('./consistency-snapshot.js')

/**
 * 页面级采集入口（★VC4-c/d 实测修正）：组件 ready 跨页复用不可靠（同一 app 进程换页时
 * 组件实例不重新 ready）⇒ 由**页面 onReady**（每次都触发）驱动；查询作用域用组件实例
 * （页面级 createSelectorQuery 查不到组件内节点——VC0 实测）。
 */
function collectComponentFromPage(page, comp, tag, end, done) {
  var scope = comp || page
  collectComponent(scope, tag, end, done)
}

/** 采集指定组件实例内部的 4 类节点 → VC3-a 快照（产出式组装） */
function collectComponent(inst, tag, end, done) {
  var ids = {
    view: 'c-' + tag + '-view',
    text: 'c-' + tag + '-text',
    image: 'c-' + tag + '-image',
    scroll: 'c-' + tag + '-scroll',
  }
  var out = {}
  var keys = ['view', 'text', 'image', 'scroll']
  var pending = keys.length
  var finish = function () {
    // ★★读数健全性（装置缺陷自检——首版把"查不到"静默写 0，导致 4 节点全 0x0 假读数）：
    //   任何一项缺失/零尺寸 ⇒ 如实登记 `collectionErrors`（消费方/判据必须能看见"这次采集是坏的"）
    var collectionErrors = []
    var mk = function (k) {
      var r = out[k]
      var missing = !r
      var zero = r && (r.width === 0 || r.height === 0)
      if (missing) collectionErrors.push(k + ': boundingClientRect 未返回（选择器 ' + ids[k] + '）')
      else if (zero) collectionErrors.push(k + ': 尺寸为 0（' + r.width + 'x' + r.height + '，可能未布局/不可见）')
      return {
        nodeId: ids[k],
        x: r && typeof r.left === 'number' ? r.left : 0,
        y: r && typeof r.top === 'number' ? r.top : 0,
        w: r && typeof r.width === 'number' ? r.width : 0,
        h: r && typeof r.height === 'number' ? r.height : 0,
        children: [],
      }
    }
    var tree = [{
      nodeId: 'c-' + tag + '-root',
      x: 0, y: 0, w: 0, h: 0,
      children: [mk('view'), mk('text'), mk('image'), mk('scroll')],
    }]
    var res = snap.buildGeometrySnapshot({
      end: end, viewport: { width: 0, height: 0 }, tree: tree, fontsLocked: false,
      textMeasuredBy: 'wechat (boundingClientRect at ' + Date.now() + ')',
    })
    // 采集错误随快照回带（不吞——"零静默失败"）
    if (collectionErrors.length > 0) res.collectionErrors = collectionErrors
    if (done) done(res)
  }
  for (var i = 0; i < keys.length; i++) {
    (function (k) {
      var q = (inst && typeof inst.createSelectorQuery === 'function') ? inst.createSelectorQuery() : wx.createSelectorQuery()
      q.select('#' + ids[k]).boundingClientRect(function (r) {
        out[k] = r
        if (--pending === 0) finish()
      }).exec()
    })(keys[i])
  }
}

/** 产出样式快照（声明 → 归一化）：输入为测试夹具显式声明的期望值 */
function styleDeclared(end) {
  return snap.buildStyleSnapshot({
    end: end,
    declared: [
      {
        nodeId: 'c-p1-view', path: '0.0',
        css: { 'background-color': '#2a3f66', 'border-radius': '18px', 'padding-top': '8px' },
      },
      {
        nodeId: 'c-p1-text', path: '0.1',
        css: { color: '#ffffff', 'font-size': '16px', 'font-weight': 'bold', 'font-family': 'system-ui, sans-serif' },
      },
      {
        nodeId: 'c-p1-image', path: '0.2',
        css: { 'background-color': 'rgb(4, 5, 6)', opacity: '0.5' },
      },
    ],
  })
}

module.exports = { collectComponent: collectComponent, collectComponentFromPage: collectComponentFromPage, styleDeclared: styleDeclared, snap: snap }
