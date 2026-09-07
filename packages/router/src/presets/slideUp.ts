// src/router/presets/slideUp.ts
// Proteus 内置预设：全屏向上推入（前页被推出视口上方）
// ★ 由 vite-plugin-mp-transform 内联进 app.js 注册（同 halfScreen 预设机制）
function slideUpBuilder(customRouteContext: RouteContext): RouteBuilderResult {
  const primaryAnimation = customRouteContext.primaryAnimation
  const handlePrimaryAnimation = () => {
    'worklet'
    const t = primaryAnimation.value
    return {
      transform: `translateY(${(1 - t) * 100}%)`,
    }
  }
  const handleSecondaryAnimation = () => {
    'worklet'
    const t = primaryAnimation.value
    return {
      transform: `translateY(${-t * 30}%)`,
      opacity: 1 - t * 0.3,
    }
  }
  return {
    opaque: true,
    handlePrimaryAnimation,
    handleSecondaryAnimation,
  }
}
