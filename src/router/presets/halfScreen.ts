// src/router/presets/halfScreen.ts
// Proteus 内置预设：半屏弹窗
// ★ 由 vite-plugin-mp-transform 读取本文件，内联进 app.js 并调用 addRouteBuilder 注册
//   （平台约束：builder 需与注册同文件静态可分析——插件内联天然满足，开发者无需手写）
// 真机验证要点（归档）：
// - worklet 必须局部具名 const 箭头函数 + 'worklet' 单引号 + 简写返回
// - canTransitionFrom: false（否则前页被默认压出动画挤开、右侧露黑底）
// - barrierColor 遮罩压暗前页（视觉边界）
// - 尺寸在逻辑层用 wx.getWindowInfo() 计算（screenHeight 是渲染线程全局），闭包捕获 px
function halfScreenBuilder(customRouteContext: RouteContext): RouteBuilderResult {
  const primaryAnimation = customRouteContext.primaryAnimation
  const windowInfo = wx.getWindowInfo()
  const topDistance = 0.12
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
    barrierColor: 'rgba(0, 0, 0, 0.4)',
    handlePrimaryAnimation,
  }
}
