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
