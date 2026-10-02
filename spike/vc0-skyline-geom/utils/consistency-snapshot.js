// spike/vc0-skyline-geom/utils/consistency-snapshot.js
// ★★VC4-c/d：小程序端**统一快照探针**（产出式）——VC3-a/b 格式的微信侧实现。
//
// 【为什么是产出式（卡片 VC4-c 强制约束 + VC1 实测）】VC1 发现 Skyline 下
//   `fields({computedStyle})` **完全不可用**（返回空对象静默丢弃）；几何虽可用
//   `boundingClientRect`（VC0 结论 A），但卡片要求"不依赖查询结果"以保证**跨端同格式**。
//   ⇒ 本探针：几何走查询（VC0 已证可用，且可回退到注入值），**样式走产出式**
//   （由测试页面显式声明 → 探针产出归一化值）——不依赖任何端上 API 的样式读取。
//
// 【与 Web 探针的同格式证据】本文件的产出经 `automation_evaluate` 取回后，
//   必须能过 `@proteus-vue/consistency` 的 `validateGeometrySnapshot/validateStyleSnapshot`
//   （同一校验器——禁止比对层格式适配）。
//
// 【诚实边界】① 归一化原语在微信 JS 环境**重实现一份**（不引 npm：小程序产物无模块系统，
//   `require('@proteus-vue/consistency')` 不存在）——与 TS 版**逐条对拍**防漂移
//   （见 tests/consistency-snapshot.test.ts 的边界用例 + 本文末尾的自检）
//   ② 本探针不解析样式表（微信无 getComputedStyle）——样式快照的输入是**页面声明的期望值**
//   （测试夹具的 purpose 就是"声明 → 采集"，这正是产出式的含义）。

/** round3：与 TS 版同口径（含 -0 归一） */
function round3(v) {
  var r = Math.round(v * 1000) / 1000
  return r === 0 ? 0 : r
}

/** 颜色归一化（#rgb/#rrggbb/#rrggbbaa/rgb()/rgba()/常用色名/transparent）——与 TS 版同规则 */
var NAMED_COLORS = {
  transparent: [0, 0, 0, 0], black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0],
  green: [0, 128, 0], blue: [0, 0, 255], yellow: [255, 255, 0], cyan: [0, 255, 255],
  magenta: [255, 0, 255], gray: [128, 128, 128], grey: [128, 128, 128], silver: [192, 192, 192],
  maroon: [128, 0, 0], olive: [128, 128, 0], lime: [0, 255, 0], aqua: [0, 255, 255],
  teal: [0, 128, 128], navy: [0, 0, 128], fuchsia: [255, 0, 255], purple: [128, 0, 128],
  orange: [255, 165, 0], pink: [255, 192, 203], brown: [165, 42, 42], gold: [255, 215, 0],
}

function normalizeColor(input) {
  var s = String(input).trim().toLowerCase()
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  var named = NAMED_COLORS[s]
  if (named) return { r: named[0], g: named[1], b: named[2], a: named[3] === undefined ? 1 : named[3] }
  var hex = /^#([0-9a-f]{3,8})$/.exec(s)
  if (hex) {
    var h = hex[1]
    if (h.length === 3) {
      return {
        r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16), a: 1,
      }
    }
    if (h.length === 6) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 }
    if (h.length === 8) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: round3(parseInt(h.slice(6, 8), 16) / 255) }
    throw new Error('normalizeColor: 不支持 hex 长度 ' + h.length)
  }
  var fn = /^rgba?\(([^)]+)\)$/.exec(s)
  if (fn) {
    var parts = fn[1].split(/[,/\s]+/).filter(Boolean)
    var num = function (x) { return x.charAt(x.length - 1) === '%' ? round3((parseFloat(x) / 100) * 255) : parseFloat(x) }
    var alpha = function (x) { return x.charAt(x.length - 1) === '%' ? round3(parseFloat(x) / 100) : round3(parseFloat(x)) }
    return { r: num(parts[0]), g: num(parts[1]), b: num(parts[2]), a: parts[3] !== undefined ? alpha(parts[3]) : 1 }
  }
  throw new Error('normalizeColor: 未识别颜色「' + input + '」')
}

/** 长度归一化：px/纯数字 → 数值；auto/none/normal → null；em/% 等抛错 */
function normalizeLength(input) {
  var s = String(input).trim().toLowerCase()
  if (s === '' || s === 'auto' || s === 'none' || s === 'normal') return null
  var m = /^(-?[\d.]+)px$/.exec(s)
  if (m) return round3(parseFloat(m[1]))
  if (/^-?[\d.]+$/.test(s)) return round3(parseFloat(s))
  throw new Error('normalizeLength: 「' + input + '」不是 px 数值')
}

function normalizeFontWeight(input) {
  if (typeof input === 'number') return input
  var s = String(input).trim().toLowerCase()
  if (s === 'normal') return 400
  if (s === 'bold') return 700
  var n = Number(s)
  if (isFinite(n)) return n
  throw new Error('normalizeFontWeight: 未识别字重「' + input + '」')
}

function normalizeFontFamily(input) {
  var first = String(input).split(',')[0].trim()
  return first.replace(/^["']|["']$/g, '')
}

/**
 * 采集几何快照（产出式）：从**已收集的几何表**组装 VC3-a 结构树。
 *
 * @param {object} opts
 *   · end: 'skyline' | 'webview'
 *   · viewport: {width, height}
 *   · tree: [{ nodeId, path?, x, y, w, h, children?: [...] }] —— 由调用方（探针页/组件）
 *     用 `boundingClientRect` 收集后按**结构**给出；path/depth 由本函数统一推导（唯一推导点）
 *   · root: 根节点 id（缺省 = tree[0]）
 */
function buildGeometrySnapshot(opts) {
  var end = opts.end || 'skyline'
  var viewport = opts.viewport || { width: 0, height: 0 }
  var derive = function (node, path, depth) {
    var out = {
      nodeId: node.nodeId,
      path: path,
      x: round3(node.x), y: round3(node.y), w: round3(node.w), h: round3(node.h),
      depth: depth,
      children: [],
    }
    if (node.semanticKey !== undefined) out.semanticKey = node.semanticKey
    var kids = node.children || []
    for (var i = 0; i < kids.length; i++) {
      out.children.push(derive(kids[i], path === '' ? String(i) : path + '.' + i, depth + 1))
    }
    return out
  }
  var roots = opts.tree || []
  var root = roots.length === 1
    ? derive(roots[0], '', 0)
    : {
        nodeId: '__forest__', path: '', x: 0, y: 0, w: null, h: null, depth: 0,
        children: roots.map(function (r, i) { return derive(r, String(i), 0) }),
      }
  return {
    format: 'proteus-geometry-snapshot',
    version: 1,
    end: end,
    viewport: { width: round3(viewport.width), height: round3(viewport.height) },
    boundaries: {
      fontsLocked: opts.fontsLocked === true,
      textMeasuredBy: opts.textMeasuredBy || 'wechat (boundingClientRect — 查询式采集)',
      note: opts.note || '小程序端：几何走查询采集（VC0 结论 A）；样式快照为产出式（VC1 实测 computedStyle 不可用）',
    },
    root: root,
  }
}

/**
 * 采集样式快照（产出式）：`declared` 是**页面显式声明**的期望值（原始 CSS 文本），
 * 经归一化产出 VC3-b 闭集。
 *
 * @param opts.end / opts.declared: [{ nodeId, path, css: { 'background-color': '#2a3f66', ... } }]
 */
function buildStyleSnapshot(opts) {
  var nodes = []
  var decls = opts.declared || []
  for (var i = 0; i < decls.length; i++) {
    var d = decls[i]
    var styles = {}
    var css = d.css || {}
    var keys = Object.keys(css)
    for (var j = 0; j < keys.length; j++) {
      var key = keys[j]
      var val = css[key]
      try {
        var camelKey = key.replace(/-([a-z])/g, function (_m, ch) { return ch.toUpperCase() })
        if (key === 'color' || key === 'background-color' || /^border-(top|right|bottom|left)-color$/.test(key)) {
          // 颜色三族：文本色 / 背景色 / 四边框色（longhand）
          styles[camelKey === 'backgroundColor' ? 'backgroundColor' : camelKey] = normalizeColor(val)
        } else if (key === 'font-size') {
          var fs = normalizeLength(val)
          if (fs !== null) styles.fontSize = fs
        } else if (key === 'font-weight') {
          styles.fontWeight = normalizeFontWeight(val)
        } else if (key === 'font-family') {
          styles.fontFamily = normalizeFontFamily(val)
        } else if (/^(padding|margin)-(top|right|bottom|left)$/.test(key)) {
          var len = normalizeLength(val)
          if (len !== null) styles[camelKey] = len
        } else if (key === 'border-radius') {
          // 简写：四项相同则展开（VC3-b 只存 longhand；不同则要求逐角声明——不猜）
          var br = normalizeLength(val)
          if (br !== null) {
            styles.borderTopLeftRadius = br
            styles.borderTopRightRadius = br
            styles.borderBottomRightRadius = br
            styles.borderBottomLeftRadius = br
          }
        } else if (/^border-(top|right|bottom|left)-radius$/.test(key)) {
          // ★longhand 四角（computed style 的稳妥读法——简写可能是多值 "1px 2px 3px 4px"）
          var rv = normalizeLength(val)
          if (rv !== null) styles[camelKey] = rv
        } else if (/^border-(top|right|bottom|left)-width$/.test(key)) {
          var bw = normalizeLength(val)
          if (bw !== null) styles[camelKey] = bw
        } else if (key === 'opacity') {
          var op = normalizeLength(val)
          if (op !== null) styles.opacity = op
        } else if (key === 'width' || key === 'height'
                   || key === 'min-width' || key === 'max-width'
                   || key === 'min-height' || key === 'max-height'
                   || key === 'flex-grow' || key === 'flex-shrink' || key === 'gap'
                   || key === 'top' || key === 'left') {
          // ★布局族数值项（auto/none/normal ⇒ normalizeLength 返回 null ⇒ 不产出——与 TS 版同口径）
          var nv3 = normalizeLength(val)
          if (nv3 !== null) styles[camelKey] = nv3
        } else if (key === 'display' || key === 'position' || key === 'visibility'
                   || key === 'flex-direction' || key === 'justify-content'
                   || key === 'align-items' || key === 'align-self' || key === 'overflow') {
          styles[camelKey === 'flexDirection' ? 'flexDirection' : camelKey] = String(val)
        }
        // 其它键：**静默忽略**是错的——但样式声明的键集由测试夹具控制，
        // 未识别键在自检（assertSnapshotSelfCheck）里会因"声明数与产出数不匹配"暴露
      } catch (e) {
        // 归一化失败：如实登记（不静默）——写进 boundaries 让消费方看见
        d.__errors = (d.__errors || [])
        d.__errors.push(key + ': ' + String(e.message || e))
      }
    }
    nodes.push({ nodeId: d.nodeId, path: d.path, styles: styles })
  }
  return {
    format: 'proteus-style-snapshot',
    version: 1,
    end: opts.end || 'skyline',
    nodes: nodes,
    boundaries: { fontsLocked: opts.fontsLocked === true, note: opts.note || '产出式样式快照（声明 → 归一化）' },
  }
}

/** 自检：产出必须符合 VC3 规格（小程序端没有 TS 校验器——本函数是等价守门人，简化版） */
function assertSnapshotSelfCheck() {
  var problems = []
  // 归一化对拍（与 TS 版逐条同值——防两份实现漂移）
  var cases = [
    ['round3', round3(1.23456), 1.235],
    ['round3-neg0', round3(-0.0004), 0],
    ['color-hex3', JSON.stringify(normalizeColor('#fff')), JSON.stringify({ r: 255, g: 255, b: 255, a: 1 })],
    ['color-alpha8', JSON.stringify(normalizeColor('#00000080')), JSON.stringify({ r: 0, g: 0, b: 0, a: 0.502 })],
    ['color-named', JSON.stringify(normalizeColor('white')), JSON.stringify({ r: 255, g: 255, b: 255, a: 1 })],
    ['length-px', normalizeLength('16px'), 16],
    ['length-auto', normalizeLength('auto'), null],
    // ★覆盖扩展（2026-10-02·二批）：布局族归一化对拍
    ['minkey', 'min-width'.replace(/-([a-z])/g, function (_m, c) { return c.toUpperCase() }), 'minWidth'],
    ['flexgrow-0', normalizeLength('0'), 0],
    ['gap-px', normalizeLength('0px'), 0],
    ['flexdir', 'flex-direction'.replace(/-([a-z])/g, function (_m, c) { return c.toUpperCase() }), 'flexDirection'],
  ]
  for (var i = 0; i < cases.length; i++) {
    var name = cases[i][0], got = cases[i][1], want = cases[i][2]
    if (got !== want) problems.push(name + ': got ' + got + ' want ' + want)
  }
  // 非法输入必须抛（与 TS 版同纪律）
  var threw = false
  try { normalizeColor('hsl(1,2,3)') } catch (e) { threw = true }
  if (!threw) problems.push('color-hsl: 应抛错（不猜）')
  return { ok: problems.length === 0, problems: problems }
}

/** VC3-b 闭集键（与 TS 版 StyleSnapshot 的键一一对应；computed style 读法用 CSS 名） */
var VC3B_KEYS = [
  'background-color', 'color',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'font-size', 'font-weight', 'font-family',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'opacity', 'display', 'position', 'visibility',
  // ★★覆盖扩展（2026-10-02·二批）：布局族（数值项 + 枚举项）——与 TS 版闭集同步
  'width', 'height',
  'min-width', 'max-width', 'min-height', 'max-height',
  'flex-direction', 'justify-content', 'align-items', 'align-self',
  'flex-grow', 'flex-shrink', 'gap', 'overflow',
  'top', 'left',   // ★覆盖收官：偏移定位（条件可见：仅 position 非 static 时产出）
]

/**
 * ★L3 实测采集（VC6 的真源）：用 `fields({computedStyle})` 读**渲染器实际算出的值**。
 *
 * 【为什么只在 WebView 用（VC1 实测）】Skyline 下 `fields({computedStyle})` 返回空对象
 *   （静默丢弃）⇒ 读回全空时本函数返回 `null`，调用方**回退产出式**（如实标注语义差异）。
 *
 * 【与产出式的语义差别（必须写清，否则 M1 会虚高）】
 *   · 实测 = "渲染器接受了声明并算出该值"（真·样式一致性证据）
 *   · 产出式 = "声明 → 归一化"管线一致（**不含**渲染器是否接受——那归 L1 矩阵 + L4 观察）
 *
 * @param scope 组件/页面实例（查询作用域）
 * @param spec  节点表 [{id, path}]（与几何采集同表）
 * @param end   'webview' | 'skyline'
 * @param done  回调（StyleSnapshot；读不到 ⇒ null）
 */
function collectStyleFromComputed(scope, spec, end, done) {
  var nodes = []
  var pending = spec.length
  var gotAny = false
  for (var i = 0; i < spec.length; i++) {
    (function (sp) {
      var q = (scope && typeof scope.createSelectorQuery === 'function') ? scope.createSelectorQuery() : wx.createSelectorQuery()
      q.select('#' + sp.id).fields({ computedStyle: VC3B_KEYS }, function (res) {
        var css = {}
        if (res) {
          for (var k = 0; k < VC3B_KEYS.length; k++) {
            var key = VC3B_KEYS[k]
            var v = res[key]
            if (v !== undefined && v !== null && v !== '') {
              css[key] = String(v)
              gotAny = true
            }
          }
        }
        nodes.push({ nodeId: sp.id, path: sp.path, css: css })
        if (--pending === 0) {
          if (!gotAny) {
            if (done) done(null) // Skyline：读不到 ⇒ 调用方回退
            return
          }
          nodes.sort(function (a, b) { return a.path.length - b.path.length })
          var snap = buildStyleSnapshot({ end: end, declared: nodes })
          snap.boundaries = snap.boundaries || {}
          snap.boundaries.note = (snap.boundaries.note || '') + '｜★实测（fields computedStyle）——渲染器接受并算出的值'
          snap.boundaries.measured = true
          if (done) done(snap)
        }
      }).exec()
    })(spec[i])
  }
}

module.exports = {
  VC3B_KEYS: VC3B_KEYS,
  collectStyleFromComputed: collectStyleFromComputed,
  round3: round3,
  normalizeColor: normalizeColor,
  normalizeLength: normalizeLength,
  normalizeFontWeight: normalizeFontWeight,
  normalizeFontFamily: normalizeFontFamily,
  buildGeometrySnapshot: buildGeometrySnapshot,
  buildStyleSnapshot: buildStyleSnapshot,
  assertSnapshotSelfCheck: assertSnapshotSelfCheck,
}
