// src/runtime/appSkeleton.ts
// app.js 骨架模板 —— ★多入口优化：main.mp.ts 极简模式
// 直出 app.js 时，若入口未写 App()，vite-plugin-mp-transform 自动拼装本骨架：
//   App 包装 / onLaunch 调试日志 / 全局错误捕获 / 内置预设注册 全部由框架生成，开发者零样板。
// ⚠ 本文件是"文本模板"（纯字符串导出），仅供 mp-transform 插件引用拼装，不是运行时代码；
//   生成的代码遵守 ES5 安全约定（决策 #32/#36：无 ?? / 无 ?. / 无数组解构 / 无对象展开）。
//   __PROTEUS_DEBUG__ 由插件按 PROTEUS_DEBUG=1 替换；__PRESET_REGISTRATION__ 由插件替换为预设注册行。

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
