// examples/main.mp.ts —— 小程序端入口（应用开发者的文件，插件直出为 app.js）
// ★ 内置预设 builders（slideUp / scaleDown 等）由 vite-plugin-mp-transform
//   按 proteus.config.ts 的 customRoute.builders 自动内联进 app.js 并注册——开发者无需手写。
// ★ 手写覆盖预设：本文件内同名 addRouteBuilder 注册即可——插件检测后跳过同名预设的自动注册（开发者优先）。
// ★ 自定义新 builder：本文件内编写具名函数 + wx.router.addRouteBuilder(name, fn)（平台约束：同文件静态可分析）。
// 注意：不得 import 其它模块（直出文件无模块解析）；调试开关 __PROTEUS_DEBUG__ 由插件替换。

// ═══ 示例：手写覆盖内置预设 halfScreen（改遮罩浓度 + 高度比例）═══
function myHalfScreenVariant(customRouteContext: RouteContext): RouteBuilderResult {
  const primaryAnimation = customRouteContext.primaryAnimation
  const windowInfo = wx.getWindowInfo()
  const topDistance = 0.08
  const marginTop = topDistance * windowInfo.screenHeight
  const pageHeight = (1 - topDistance) * windowInfo.screenHeight
  const handlePrimaryAnimation = () => {
    'worklet'
    const t = primaryAnimation.value
    const transY = pageHeight * (1 - t)
    return {
      overflow: 'hidden',
      borderRadius: '16px 16px 0 0',
      marginTop: `${marginTop}px`,
      height: `${pageHeight}px`,
      transform: `translateY(${transY}px)`,
    }
  }
  return {
    opaque: false,
    barrierDismissible: true,
    canTransitionFrom: false,
    barrierColor: 'rgba(0, 0, 0, 0.6)',
    handlePrimaryAnimation,
  }
}

App({
  onLaunch() {
    // 全链路调试开关（PROTEUS_DEBUG=1 构建时由插件替换为 true）
    const debug = typeof __PROTEUS_DEBUG__ !== 'undefined' && __PROTEUS_DEBUG__
    if (debug) console.log('[proteus][app] 启动', Date.now())

    // 覆盖内置预设 halfScreen（同名注册，插件跳过预设自动注册）
    if (typeof wx !== 'undefined' && wx.router) {
      wx.router.addRouteBuilder('halfScreen', myHalfScreenVariant)
    }

    // 全局错误捕获（debug 构建输出）
    if (typeof wx !== 'undefined' && wx.onError) {
      wx.onError((err: unknown) => {
        if (debug) console.error('[proteus][error]', err, Date.now())
      })
    }
  },
})
