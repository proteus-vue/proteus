// src/main.mp.ts —— 小程序端入口（★极简模式）
// 不需要写 App()/onLaunch/调试日志/错误捕获——app 骨架由编译插件自动生成（appSkeleton），
// 本文件只需写"自定义"：自定义路由 builder（覆盖/新增预设，见 proteus.config customRoute）。
// 若要完全自定义 app 生命周期，写一个含 App() 的完整入口即可（插件尊重原样）。

// 示例：自定义路由 builder（halfScreen 半屏转场，微信 RouteBuilder 契约）
// function myBuilder(customRouteContext: RouteContext): RouteBuilderResult {
//   const primaryAnimation = customRouteContext.primaryAnimation
//   const handlePrimaryAnimation = () => {
//     'worklet'
//     const t = primaryAnimation.value
//     return { transform: `translateY(${(1 - t) * 100}%)` }
//   }
//   return { opaque: false, barrierDismissible: true, barrierColor: 'rgba(0,0,0,0.6)', handlePrimaryAnimation }
// }
// if (typeof wx !== 'undefined' && wx.router) {
//   wx.router.addRouteBuilder('halfScreen', myBuilder)
// }
