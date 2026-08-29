// src/router/presets/scaleDown.ts
// Proteus 内置预设：缩放下沉转场（★综合能力演示）
// - B 页（handlePrimaryAnimation）：底部滑入 + 放大 + 缓出/缓入曲线
// - A 页（handlePreviousPageAnimation ≥3.0.0）：被覆盖时下沉缩放
// 覆盖能力：曲线 / 遮罩 / 前后页联动 / 时长 / 手势
// ★ 由 vite-plugin-mp-transform 内联进 app.js 注册（同 halfScreen 预设机制）
// 真机经验（归档）：
// - 经典架构（A 页自带 builder 的 handleSecondaryAnimation）在本环境不生效（A 永远默认压出）
// - handlePreviousPageAnimation 生效但掉帧且不跟踪手势（平台行为差异）
// - 掉帧规避：borderRadius 静态（逐帧动画不可合成）、Easing/derived 链弃用（内联多项式）、
//   不做整页 scale 动画（整页重绘昂贵）
// - 物理引擎：wx.worklet 的 spring/timing 用于手势驱动场景，自定义路由进度由微信自驱
function scaleDownBuilder(customRouteContext: RouteContext): RouteBuilderResult {
  const primaryAnimation = customRouteContext.primaryAnimation
  const primaryAnimationStatus = customRouteContext.primaryAnimationStatus
  const screenH = wx.getWindowInfo().screenHeight

  // B 页进入/退出动画（进入缓出 easeOutCubic / 退出缓入 easeInCubic）
  const handlePrimaryAnimation = () => {
    'worklet'
    let t = primaryAnimation.value
    if (primaryAnimationStatus.value !== 2) t = 1 - (1 - t) * (1 - t) * (1 - t)
    else t = t * t * t
    const transY = screenH * 0.15 * (1 - t)
    const scale = 0.9 + 0.1 * t
    return {
      overflow: 'hidden',
      borderRadius: '16px 16px 0 0',
      transform: `translateY(${transY}px) scale(${scale})`,
    }
  }

  // A 页（被覆盖页）压入/压出动画（≥3.0.0：B 直接控制 A）
  const handlePreviousPageAnimation = () => {
    'worklet'
    let t = primaryAnimation.value
    if (primaryAnimationStatus.value !== 2) t = 1 - (1 - t) * (1 - t) * (1 - t)
    else t = t * t * t
    const scale = 0.08
    const transY = screenH * (0.1 - 0.5 * scale) * t
    return {
      overflow: 'hidden',
      borderRadius: '12px 12px 0 0',
      transform: `translateY(${transY}px) scale(${1 - scale * t})`,
    }
  }

  return {
    opaque: false,
    barrierDismissible: true,
    barrierColor: 'rgba(0, 0, 0, 0.8)',
    transitionDuration: 400,
    reverseTransitionDuration: 360,
    fullscreenDrag: true,
    popGestureDirection: 'vertical',
    handlePrimaryAnimation,
    handlePreviousPageAnimation,
  }
}
