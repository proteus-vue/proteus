// packages/plugin-vite/src/path-polyfill.ts —— ★★★B1（2026-10-04）：小程序端 path 模块 polyfill
//
// 【为什么做（不是"该拒绝的依赖"）】`node:path` 是**纯字符串函数**（无 IO、无平台语义）——
//   小程序运行时只是没有这个模块，语义上完全可实现。跨端框架的正当职责就是把它补上，
//   否则业务代码（和框架自己的共享模块）里一句 `path.join(a, b)` 就要劝退开发者。
//   ★实体清单（`fs`/`child_process`/`net`…）**仍然显式报错**（无对等物，不做假实现）。
//
// 【本实现的边界（诚实登记）】
//   · 实现的是 **posix 语义**（小程序路径恒为 `/` 分隔）——win32 分支不存在，`sep` 恒 `/`；
//   · 覆盖常用面：join / resolve / normalize / relative / dirname / basename / extname / isAbsolute / sep / delimiter；
//   · `process.cwd()` 在 resolve 中不可用 → 用 `'/'` 作为虚拟根（小程序无 CWD 概念）；
//   · 不实现 `path.parse/format/toNamespacedPath/matchesGlob`（用到再走显式报错，不静默给错值）。
//
// 【给谁用】npm 包/框架共享模块的浏览器分支被跳过时（无 browser 字段）的兜底；业务代码直接
//   `import path from 'node:path'` 也由它接住（构建期注入，运行时零依赖）。
//
// 【测试】tests/module-npm-b1.test.ts（对拍 Node 原生 path 的输出——同输入同输出）。

/** 生成 polyfill 源码（esbuild loader:'js' 内容；CJS 形态同时支持 default/named/namespace 导入） */
export const MP_PATH_POLYFILL_CODE = `
function normalizeParts(parts) {
  var out = []
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i]
    if (!p || p === '.') continue
    if (p === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop()
      else out.push('..')
      continue
    }
    out.push(p)
  }
  return out
}
function normalize(p) {
  var s = String(p == null ? '' : p)
  if (s === '') return '.'
  var abs = s.charAt(0) === '/'
  var trailing = s.length > 1 && s.charAt(s.length - 1) === '/'
  var parts = normalizeParts(s.split('/'))
  var joined = parts.join('/')
  if (!joined && !abs) return '.'
  var r = (abs ? '/' : '') + joined
  if (trailing && r.charAt(r.length - 1) !== '/') r += '/'
  return r || (abs ? '/' : '.')
}
function join() {
  var segs = []
  for (var i = 0; i < arguments.length; i++) {
    if (arguments[i]) segs.push(String(arguments[i]))
  }
  if (!segs.length) return '.'
  var joined = segs.join('/')
  var r = normalize(joined)
  return r
}
function resolve() {
  var segs = []
  for (var i = arguments.length - 1; i >= 0; i--) {
    var s = arguments[i]
    if (!s) continue
    s = String(s)
    segs.unshift(s)
    if (s.charAt(0) === '/') break
  }
  var joined = segs.length ? segs.join('/') : ''
  if (joined.charAt(0) !== '/') joined = '/' + joined
  return normalize(joined)
}
function isAbsolute(p) {
  return String(p == null ? '' : p).charAt(0) === '/'
}
function relative(from, to) {
  var f = resolve(from).split('/').filter(function (x) { return x })
  var t = resolve(to).split('/').filter(function (x) { return x })
  var i = 0
  while (i < f.length && i < t.length && f[i] === t[i]) i++
  var up = []
  for (var j = i; j < f.length; j++) up.push('..')
  var down = t.slice(i)
  var r = up.concat(down).join('/')
  return r
}
function dirname(p) {
  var s = String(p == null ? '' : p)
  if (s === '') return '.'
  var abs = s.charAt(0) === '/'
  var parts = s.split('/').filter(function (x, idx) { return !(idx === 0 && abs) })
  parts.pop()
  var r = parts.join('/')
  if (abs) r = '/' + r
  if (!r) return abs ? '/' : '.'
  return r
}
function basename(p, ext) {
  var s = String(p == null ? '' : p)
  var parts = s.split('/').filter(function (x) { return x })
  var base = parts.length ? parts[parts.length - 1] : ''
  if (ext && base.slice(-ext.length) === ext && base !== ext) base = base.slice(0, -ext.length)
  return base
}
function extname(p) {
  var base = basename(p)
  var i = base.lastIndexOf('.')
  if (i <= 0) return ''
  return base.slice(i)
}
var path = {
  resolve: resolve,
  normalize: normalize,
  isAbsolute: isAbsolute,
  join: join,
  relative: relative,
  dirname: dirname,
  basename: basename,
  extname: extname,
  sep: '/',
  delimiter: ':',
}
path.posix = path
module.exports = path
module.exports.default = path
`
