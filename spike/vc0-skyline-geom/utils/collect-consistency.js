// spike/vc0-skyline-geom/utils/collect-consistency.js
// ★VC4-c/d + VC5：装置侧采集器——`boundingClientRect` 收几何 → 组装 VC3-a 快照（产出式）。
//
// 【分工】consistency-snapshot.js = 格式实现（纯函数，与 TS 版对拍）；
//   本文件 = **采集**（查询 API 的调用点——VC0 结论 A：Skyline/WebView 查询均可用）。
//
// 【★夹具与 Web 探针**同构**（三端同夹具才能逐节点比对——M1 的 L2 覆盖前提）】
//   对齐来源：tests/consistency-web-probe.test.ts 的 TEST_PAGE：
//     root(400x600, padding 12, column) > [box(200x60,r18), text(160x40,fs16), nested(300x100,pad8) > box(100x24,r4)]
//   semanticKey 与 Web 端一致（p-view / p-box / p-text）——比对引擎按 path 对齐、按 pid 查 override。
const snap = require('./consistency-snapshot.js')

/** 对齐夹具的节点表（id → path → semanticKey） */
var FIXTURE = [
  { id: 'c-root', path: '', sk: 'p-view' },
  { id: 'c-box', path: '0', sk: 'p-box' },
  { id: 'c-text', path: '1', sk: 'p-text' },
  { id: 'c-nested', path: '2', sk: 'p-box' },
  { id: 'c-nested-box', path: '2.0', sk: 'p-box' },
  { id: 'c-abs', path: '3', sk: 'p-box' },   // ★覆盖收官：绝对定位（top/left）
]

/**
 * 采集对齐夹具 → VC3-a 快照。
 * @param inst 查询作用域（组件实例；页面级 createSelectorQuery 查不到组件内节点——VC0 实测）
 * @param tag  历史签名保留（夹具是固定对齐结构，tag 不再使用）
 * @param end  'skyline' | 'webview'
 * @param done 回调（收到快照）
 */
function collectComponent(inst, tag, end, done) {
  void tag
  var out = {}
  var pending = FIXTURE.length
  var errs = []
  var finish = function () {
    var byPath = {}
    for (var i = 0; i < FIXTURE.length; i++) {
      var sp = FIXTURE[i]
      var r = out[sp.id]
      if (!r) errs.push(sp.id + ': boundingClientRect 未返回')
      else if (r.width === 0 || r.height === 0) errs.push(sp.id + ': 尺寸为 0（' + r.width + 'x' + r.height + '）')
      byPath[sp.path] = {
        nodeId: sp.id,
        semanticKey: sp.sk,
        x: r && typeof r.left === 'number' ? r.left : 0,
        y: r && typeof r.top === 'number' ? r.top : 0,
        w: r && typeof r.width === 'number' ? r.width : 0,
        h: r && typeof r.height === 'number' ? r.height : 0,
        children: [],
      }
    }
    var rootNode = byPath['']
    if (!rootNode) errs.push('缺根节点（path=""）')
    else {
      var paths = Object.keys(byPath).filter(function (p) { return p !== '' })
      paths.sort(function (a, b) { return a.split('.').length - b.split('.').length })
      for (var j = 0; j < paths.length; j++) {
        var p = paths[j]
        var parentPath = p.indexOf('.') >= 0 ? p.slice(0, p.lastIndexOf('.')) : ''
        if (byPath[parentPath]) byPath[parentPath].children.push(byPath[p])
        else errs.push('path ' + p + ' 找不到父 ' + parentPath)
      }
    }
    var res = snap.buildGeometrySnapshot({
      end: end,
      viewport: { width: 400, height: 600 },
      tree: rootNode ? [rootNode] : [],
      fontsLocked: false,
      textMeasuredBy: 'wechat (boundingClientRect at ' + Date.now() + ')',
    })
    if (errs.length > 0) res.collectionErrors = errs
    if (done) done(res)
  }
  for (var k = 0; k < FIXTURE.length; k++) {
    (function (sp) {
      var q = (inst && typeof inst.createSelectorQuery === 'function') ? inst.createSelectorQuery() : wx.createSelectorQuery()
      q.select('#' + sp.id).boundingClientRect(function (r) {
        out[sp.id] = r
        if (--pending === 0) finish()
      }).exec()
    })(FIXTURE[k])
  }
}

/** 页面级采集入口（页面 onReady 驱动；作用域用组件实例） */
function collectComponentFromPage(page, comp, tag, end, done) {
  collectComponent(comp || page, tag, end, done)
}

/** 产出样式快照（声明 → 归一化）：与 Web 夹具同声明（同构要求） */
function styleDeclared(end) {
  return snap.buildStyleSnapshot({
    end: end,
    declared: [
      { nodeId: 'c-root', path: '', css: { 'background-color': '#14141c', display: 'flex', 'flex-shrink': '0' } },
      { nodeId: 'c-box', path: '0', css: { 'background-color': '#2a3f66', 'border-radius': '18px', 'flex-shrink': '0', 'overflow': 'hidden' } },
      { nodeId: 'c-text', path: '1', css: { color: '#ffffff', 'font-size': '16px', 'font-weight': 'bold', 'font-family': 'system-ui, sans-serif', 'overflow': 'hidden' } },
      { nodeId: 'c-nested', path: '2', css: { 'background-color': '#1f2c44', 'padding-top': '8px', 'flex-shrink': '0', 'overflow': 'hidden' } },
      { nodeId: 'c-nested-box', path: '2.0', css: { 'background-color': '#2a3f66', 'border-radius': '4px', 'overflow': 'visible' } },
    ],
  })
}

/**
 * ★L3 样式采集（优先**实测**、失败回退产出式）：
 *   · WebView：`fields({computedStyle})` 可用（VC1 实测 37/37）⇒ 走实测 —— 真·样式一致性证据；
 *   · Skyline：读回空 ⇒ 回退产出式（声明 → 归一化）——**语义不同**，由 snap.boundaries.measured 标注，
 *     比对/指标消费方据此区分（避免把"管线一致"当"渲染一致"）。
 */
function collectStyle(scope, end, done) {
  snap.collectStyleFromComputed(scope, FIXTURE, end, function (measured) {
    if (measured) {
      if (done) done(measured)
      return
    }
    var declared = styleDeclared(end)
    declared.boundaries = declared.boundaries || {}
    declared.boundaries.measured = false
    declared.boundaries.note = (declared.boundaries.note || '') + '｜★产出式（声明 → 归一化）——本端 computedStyle 不可用（VC1 实测）；"渲染是否接受"归 L1 矩阵 + L4 观察'
    if (done) done(declared)
  })
}

module.exports = {
  collectComponent: collectComponent,
  collectStyle: collectStyle,
  collectComponentFromPage: collectComponentFromPage,
  styleDeclared: styleDeclared,
  snap: snap,
  FIXTURE: FIXTURE,
}
