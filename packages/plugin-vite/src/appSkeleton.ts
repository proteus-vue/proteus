// src/runtime/appSkeleton.ts
// app.js 骨架模板 —— ★多入口优化：main.mp.ts 极简模式
// 直出 app.js 时，若入口未写 App()，vite-plugin-mp-transform 自动拼装本骨架：
//   App 包装 / onLaunch 调试日志 / 全局错误捕获 / 内置预设注册 全部由框架生成，开发者零样板。
// ⚠ 本文件是"文本模板"（纯字符串导出），仅供 mp-transform 插件引用拼装，不是运行时代码；
//   生成的代码遵守 ES5 安全约定（决策 #32/#36：无 ?? / 无 ?. / 无数组解构 / 无对象展开）。
//   __PROTEUS_DEBUG__ 由插件按 PROTEUS_DEBUG=1 替换；__PRESET_REGISTRATION__ 由插件替换为预设注册行；
//   __PINIA_INSTALL__ 由插件在「页面使用 store」时替换为 Pinia 安装行（否则置空，不引入 runtime 体积）。

// ★★页面生命周期派发桥（2026-09-30）——**必须在 `App({})` 之前装**：
//   页面钩子（onShow/onHide/onReady…）在**页面创建时**就触发，而 `Page` 构造函数在模块求值阶段
//   就已注册 ⇒ 挂在 App 回调里都太晚（首屏 load/show/ready 已错过）。
//   ★**内联实现**（不 import）：MP 无模块系统，且这是"总线唯一入口"——代码极小（20 行），
//     内联比跨包引用更可靠（不依赖 api 包是否被打进主包/时序先后）。
//   ★幂等：重复执行只覆盖同一个全局函数。
//   ★与 `packages/api/src/capability-app.ts` 的 `installPageEmitBridge` **同一契约**
//     （判据：tests/capability-app.test.ts 的 MP 页面事件通道用例 + e2e-mp-components 真机断言）。
export const APP_LIFECYCLE_BOOTSTRAP = `// ★页面生命周期派发装配（App() 之前——见 appSkeleton 注释的时序说明）
//   wx 无全局 onPageShow/onPageHide（官方文档核实）⇒ 页面事件只能靠产物派发到总线
;(function () {
  var g = (typeof globalThis !== 'undefined') ? globalThis : null
  if (!g) return
  if (typeof g.__proteusEmitPage === 'function') return // 幂等（api 包可能已装同契约的）
  // ★★总线**自建**（不能等 api 包）：业务可能从未调用任何 Hook，但派发仍在发生——
  //   等 api 包建总线 ⇒ 首屏事件派发到"不存在的总线"上（真机 e2e 抓出的实际形态：
  //   派发桥在、page 方法在，但 __proteusHostLifecycleBus 未建 ⇒ 事件黑洞）。
  //   ★形态与 'capability-app.ts' 的 'createHostLifecycleBus' **同契约**（topic/kind/on/emit/snapshot）；
  //     api 包后建总线时**复用本全局单例**（同键 ⇒ 单例语义不被破坏）。
  if (!g.__proteusHostLifecycleBus) {
    g.__proteusHostLifecycleBus = (function () {
      var subs = {}
      var appPhase = 'PENDING'
      var pagePhase = 'IDLE'
      var currentScreen = null
      var launchOptions = {}
      var enterOptions = {}
      function fire(key, payload) {
        var set = subs[key]
        if (!set) return
        for (var i = 0; i < set.length; i++) { try { set[i](payload) } catch (e) {} }
      }
      return {
        snapshot: function () {
          return { app: appPhase, page: pagePhase, currentScreen: currentScreen, launchOptions: launchOptions, enterOptions: enterOptions }
        },
        emit: function (ev) {
          if (!ev || (ev.topic !== 'app' && ev.topic !== 'page')) return
          if (ev.topic === 'page') {
            if (ev.kind === 'load') { pagePhase = 'LOAD'; if (ev.screen) currentScreen = ev.screen }
            else if (ev.kind === 'show') { pagePhase = 'SHOW'; if (ev.screen) currentScreen = ev.screen }
            else if (ev.kind === 'hide') { pagePhase = 'HIDE' }
            else if (ev.kind === 'unload') { pagePhase = 'IDLE'; currentScreen = null }
            fire('page:' + ev.kind, ev.payload !== undefined ? ev.payload : { screen: currentScreen })
            return
          }
          if (ev.kind === 'launch') { if (appPhase !== 'PENDING') return; appPhase = 'LAUNCH'; fire('app:launch', ev.payload); return }
          if (ev.kind === 'show') {
            if (appPhase === 'PENDING') { appPhase = 'LAUNCH'; fire('app:launch', undefined) }
            appPhase = 'SHOW'; fire('app:show', ev.payload); return
          }
          if (ev.kind === 'hide') { appPhase = 'HIDE'; fire('app:hide', ev.payload); return }
          fire('app:' + ev.kind, ev.payload)
        },
        on: function (topic, cb) {
          if (!subs[topic]) subs[topic] = []
          subs[topic].push(cb)
          return function () {
            var arr = subs[topic]; if (!arr) return
            var i = arr.indexOf(cb); if (i >= 0) arr.splice(i, 1)
          }
        },
        setLaunchOptions: function (o) { launchOptions = o || {} },
        setEnterOptions: function (o) { enterOptions = o || {} },
        get subscriberCount() { var n = 0; for (var k in subs) n += subs[k].length; return n }
      }
    })()
  }
  g.__proteusEmitPage = function (evt, payload) {
    try {
      var bus = g.__proteusHostLifecycleBus
      if (bus && typeof bus.emit === 'function') bus.emit({ topic: 'page', kind: evt, payload: payload })
    } catch (e) { /* 派发失败不阻断页面 */ }
  }
})()`

export const APP_LAUNCH_SKELETON = `App({
  onLaunch() {
    // 全链路调试开关（PROTEUS_DEBUG=1 构建时由插件替换为 true）
    const debug = typeof __PROTEUS_DEBUG__ !== 'undefined' && __PROTEUS_DEBUG__
    if (debug) console.log('[proteus][app] 启动', Date.now())
    // 全局错误捕获（debug 构建输出，正式构建常量折叠零残留）
    if (typeof wx !== 'undefined' && wx.onError) {
      wx.onError(function (err) {
        if (debug) console.error('[proteus][error]', err, Date.now())
      })
    }
    // ★Pinia 安装（仅页面使用 store 时注入，否则此行为注释）：
    //   小程序无 createApp 实例 → createMpPinia() 内部 setActivePinia，页面 useStore() 才能解析；
    //   时序：onLaunch 早于任何页面 onLoad ✓
__PINIA_INSTALL__
    // 内置预设注册（同文件静态可分析：函数定义在前、注册在后，插件已保证顺序）
    if (typeof wx !== 'undefined' && wx.router) {
__PRESET_REGISTRATION__
    }
  },
  // ★lifecycle-plan B4：App 级 onShow/onHide 钩子（调试日志；Web 端对应 visibilitychange）
  onShow() {
    const debug = typeof __PROTEUS_DEBUG__ !== 'undefined' && __PROTEUS_DEBUG__
    if (debug) console.log('[proteus][app] onShow', Date.now())
  },
  onHide() {
    const debug = typeof __PROTEUS_DEBUG__ !== 'undefined' && __PROTEUS_DEBUG__
    if (debug) console.log('[proteus][app] onHide', Date.now())
  },
})
`

/**
 * ★★★GP3-b1（2026-10-03）：**Global 层共享状态模块**（产物 `_proteus/global-layer.js`）。
 *
 * 【它解决什么】MP 端每页是独立渲染树 ⇒ Global 层**每页一份实例**（方案 §1.2-bis），
 *   而"全局网络状态条/主题/未读角标"需要**跨页一致**。官方 `custom-tab-bar` 的答案是
 *   "每页注入 + **共享状态**"；本模块就是那个共享状态（小程序 require 缓存：同路径同实例，
 *   与 vendor 单例化同一机制——`_proteus/pinia.js` 等已验证）。
 *
 * 【为什么不用 `getApp().globalData`】它是否存在**取决于用户入口怎么写**（极简模式下骨架含，
 *   全量模式下用户自己写）——把框架能力押在"用户手写形态"上是脆弱设计。共享模块自包含：
 *   插件保证产出、页面 require 即得。
 *
 * 【API（页面产物注入的桥只调这四个）】get/set/has/all——
 *   · `set(k, v)`：写状态（页面 setData 镜像调用）
 *   · `get(k)`：读状态（Page data 构造 / onShow 拉取）
 *   · `all()`：快照（诊断/调试）
 * ★**条件编译门**：`__PROTEUS_GLOBAL_LAYER_LIMIT__` 由构建 define 注入（缺省不校验）——
 *   每页注入的字段数由 C2（32）在编译期限定，这里只做运行时兜底（防手改产物）。
 *
 * ★★★GP7（2026-10-04）：**内存记账**——本模块同时是 Global 层的「运行时内存可观测面」：
 *   · `stats()`：可查占用（**分端口径**——MP：共享状态一份 + 每页字段 × 页面栈；自绘/Web：1 份）
 *   · `unmount(k)`：显式卸载一个全局状态键（与**编译期挂载**对称）——释放共享状态内存
 *   · `setBudget(b)`：调整预算（超限告警一次，不刷屏）
 *   ★诚实边界（不许含糊）：`unmount` 释放的是**共享状态**（N 页共用的一份）；
 *     页面本地 data 副本与静态 wxml 节点壳归**页面场景**管理（不随本调用回滚）——
 *     视觉联动（如让音乐条消失）请把渲染条件绑在对应字段上、并在业务侧导航/刷新后生效。
 *   ★字节口径 = JSON 序列化长度（近似，非 ASCII 偏小）——诊断口径，不是计量承诺。
 *
 * 【参数（由插件按真实壳片段注入——数值烘焙进产物，不依赖运行时探测）】
 *   · fieldCount：每页注入的 Global 层字段数（data 条目数）
 *   · perPageBytes：每页注入的**初值字节**（JSON 长度——分端估算的 N 倍部分）
 */
export function globalLayerStateCode(opts: {
  fieldCount?: number
  perPageBytes?: number
  budgetBytes?: number
} = {}): string {
  const fieldCount = typeof opts.fieldCount === 'number' && opts.fieldCount >= 0 ? opts.fieldCount : 0
  const perPageBytes = typeof opts.perPageBytes === 'number' && opts.perPageBytes >= 0 ? opts.perPageBytes : 0
  const budgetBytes = typeof opts.budgetBytes === 'number' && opts.budgetBytes > 0 ? opts.budgetBytes : 65536
  return `// _proteus/global-layer.js —— Proteus Global 层共享状态（GP3-b1 建 · GP7 内存记账 2026-10-04）
// 自动生成，请勿编辑。用途：MP 端"实例每页一份、状态一份"（与官方 custom-tab-bar 同模式）。
// ★GP7：stats() 内存读数（分端口径）/ unmount(k) 显式卸载 / setBudget(b) 预算——见仓库 GP7 卡。
// ★require 缓存保证：所有页面 require 本模块拿到的是**同一个对象**（跨页状态一致）。
var __state = Object.create(null)
var __subs = Object.create(null)
var __gone = Object.create(null)   // 墓碑：unmount 过的键（区分"没写过"与"已卸载"）
var __budget = ${budgetBytes}      // 预算（字节）——超限告警一次；可 setBudget 调整（GP7，阈值待实测校准）
var __fieldCount = ${fieldCount}   // 编译期注入：每页字段数（分端口径的 N 倍部分）
var __perPageBytes = ${perPageBytes} // 编译期注入：每页初值字节（分端口径的 N 倍部分）
var __warned = false               // 告警去重（不刷屏）

function __bytes(v) {
  // 近似字节：JSON 序列化长度（ASCII 1:1；非 ASCII 偏小——诊断口径）
  try { return JSON.stringify(v === undefined ? null : v).length } catch (e) { return 0 }
}
function __totalBytes() {
  var n = 0
  for (var k in __state) if (Object.prototype.hasOwnProperty.call(__state, k)) n += __bytes(__state[k])
  return n
}
function __warnIfOver() {
  var b = __totalBytes()
  if (b > __budget && !__warned) {
    __warned = true
    try {
      console.warn('[proteus] Global 层共享状态 ' + b + ' 字节，超过预算 ' + __budget +
        ' 字节——Global 层常驻内存（MP 端：状态一份 + 每页字段 × 页面栈；见 GP7）。' +
        '建议把大集合移出全局层（编译期也会告警），或调 __proteusGlobal.setBudget(b) 显式确认预算')
    } catch (e) {}
  }
}

module.exports = {
  /** 读一个全局字段（未写过/已卸载 ⇒ undefined——调用方用声明初值兜底） */
  get: function (k) {
    return __state[k]
  },
  /** 写一个全局字段（页面 setData 镜像调用；通知订阅者） */
  set: function (k, v) {
    if (__gone[k]) delete __gone[k] // 重新写入 ⇒ 复活（unmount 后再挂载的语义：显式 set 即恢复）
    __state[k] = v
    var list = __subs[k]
    if (list) {
      for (var i = 0; i < list.length; i++) {
        try { list[i](v) } catch (e) {}
      }
    }
    __warnIfOver()
  },
  /** 是否写过（区分"没写过"与"写过 undefined"） */
  has: function (k) {
    return Object.prototype.hasOwnProperty.call(__state, k)
  },
  /** 全量快照（诊断/调试；深拷贝防外部改内部） */
  all: function () {
    var out = {}
    for (var k in __state) if (Object.prototype.hasOwnProperty.call(__state, k)) out[k] = __state[k]
    return out
  },
  /** 订阅字段变更（返回退订函数）——为将来"实时同步"预留（当前页面间靠 onShow 拉取） */
  subscribe: function (k, fn) {
    (__subs[k] || (__subs[k] = [])).push(fn)
    return function () {
      var list = __subs[k]
      if (!list) return
      var idx = list.indexOf(fn)
      if (idx >= 0) list.splice(idx, 1)
    }
  },
  /** ★GP7：显式卸载一个全局状态键——释放共享状态内存（与编译期挂载对称）；通知订阅者 */
  unmount: function (k) {
    if (Object.prototype.hasOwnProperty.call(__state, k)) delete __state[k]
    __gone[k] = 1
    var list = __subs[k]
    if (list) {
      for (var i = 0; i < list.length; i++) {
        try { list[i](undefined) } catch (e) {}
      }
    }
  },
  /** ★GP7：该键是否已被 unmount（get 返回 undefined 的两种来源：从未写 / 已卸载） */
  unmounted: function (k) {
    return __gone[k] === 1
  },
  /** ★GP7：内存读数（**分端口径**——MP：状态一份 + 每页初值 × 页面栈；无页面栈环境为 1 份） */
  stats: function () {
    var keys = 0
    for (var k in __state) if (Object.prototype.hasOwnProperty.call(__state, k)) keys++
    var stack = 1
    try {
      if (typeof getCurrentPages === 'function') {
        var ps = getCurrentPages()
        if (ps && ps.length) stack = ps.length
      }
    } catch (e) {}
    var bytes = __totalBytes()
    return {
      keys: keys,
      bytes: bytes,
      budgetBytes: __budget,
      overBudget: bytes > __budget,
      fieldCount: __fieldCount,
      perPageBytes: __perPageBytes,
      pageStack: stack,
      residentEstimateBytes: bytes + __perPageBytes * stack,
    }
  },
  /** ★GP7：调整预算（字节）——返回是否生效；调大 = 显式确认更大常驻（重置告警去重后按新预算判定） */
  setBudget: function (b) {
    var n = Number(b)
    if (!isFinite(n) || n <= 0) return false
    __budget = n
    __warned = false
    __warnIfOver()
    return true
  },
  /** ★GP7：测试钩子（重置内部状态——e2e"跨运行状态残留"纪律：判据先归一） */
  __resetForTest: function () {
    __state = Object.create(null)
    __subs = Object.create(null)
    __gone = Object.create(null)
    __warned = false
    return true
  },
}
`
}

/**
 * 默认形态（无烘焙数值）——供既有测试/诊断引用；
 * ★插件侧请调 `globalLayerStateCode({...})` 传入真实字段数/初值字节（分端估算依赖它）。
 */
export const GLOBAL_LAYER_STATE_CODE = globalLayerStateCode()
