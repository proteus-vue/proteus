// examples/main.mp.ts —— 小程序端入口（极简模式）
// ★ 应用开发者的文件，插件直出为 app.js。
// ★ 极简模式（推荐）：本文件不需要写 App()/onLaunch/调试日志/错误捕获/预设注册——
//   这些 app 骨架由框架自动生成（src/runtime/appSkeleton.ts，插件拼装），开发者只写"自定义"：
//   · 覆盖内置预设：同名 addRouteBuilder('<预设名>', fn)——插件检测后跳过同名预设的自动注册（开发者优先）
//   · 新增自定义 builder：本文件内编写具名函数 + wx.router.addRouteBuilder(name, fn)
// ⚠ 约束：直出文件无模块解析（不得 import 其它模块）；自定义 builder 与注册必须同文件静态可分析
//   （真机约束，决策 #33/#39）；调试开关 __PROTEUS_DEBUG__ 由插件替换。
// ⚠ 若要完全自定义 app 生命周期（如自写 onLaunch），写一个含 App() 的完整入口即可（全量模式，插件尊重原样）。

// ═══ 示例：覆盖内置预设 halfScreen（改遮罩浓度 + 高度比例，仅此一处自定义）═══
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

if (typeof wx !== 'undefined' && wx.router) {
  wx.router.addRouteBuilder('halfScreen', myHalfScreenVariant)
}
