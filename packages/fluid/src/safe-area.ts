// packages/fluid/src/safe-area.ts
// ★Fluid System S2 + G-09 SafeArea 语义：安全区避让样式纯逻辑（Web env() 映射 + 折叠屏 hinge 避让）
//   把系统能力搬进框架（原则 #10）：组件薄壳只做 displayMode 状态桥接，样式生成在本模块（纯函数可单测）
//   五端同语义：iOS safeAreaLayoutGuide / Android WindowInsets / 鸿蒙 getAvoidArea / Web env() / Skyline env()+
export interface SafeAreaStyleOptions {
  /** 避让方向：top / bottom / left / right / horizontal / all（默认 top） */
  area?: string
  /** 兜底 px：桌面/无刘海屏 env()=0 时强制至少该值（max() 包裹；0 = 不兜底） */
  fallback?: number
  /** 折叠屏 hinge 避让开关（displayMode 为 fold/span 时生效） */
  fold?: boolean
  /** 当前 display-mode（fold/span/expand/standard）——由 createDeviceEnv 提供 */
  displayMode?: string
}

/** CSS 环境变量表达式：fallback>0 → max(env(...), Npx)「至少 Npx」；否则纯 env（fallback 参数 0px 兜底旧浏览器） */
function envExpr(inset: string, fallbackPx: number): string {
  const base = 'env(safe-area-inset-' + inset + ', 0px)'
  return fallbackPx > 0 ? 'max(' + base + ', ' + fallbackPx + 'px)' : base
}

/**
 * 解析安全区避让样式（返回 { paddingTop/paddingLeft/... } 键值）
 * - 非 fold/span 形态：area 映射 env(safe-area-inset-*)
 * - fold/span 形态（hinge 生效）：左右避开折叠区域 env(fold-left)/推导 fold-right（Chrome 折叠屏 CSS env）
 */
export function resolveSafeAreaStyle(options: SafeAreaStyleOptions = {}): Record<string, string> {
  const area = options.area ?? 'top'
  const fb = typeof options.fallback === 'number' && options.fallback > 0 ? options.fallback : 0
  const mode = options.displayMode ?? 'standard'
  const style: Record<string, string> = {}
  if (options.fold === true) {
    // ★fold 是完整开关：仅 fold/span（hinge 存在）时避让；expand/standard 无 hinge → 空（不误伤普通环境）
    if (mode === 'fold' || mode === 'span') {
      // fold-right = fold-left + fold-width（Chrome 提供 fold-left/fold-width，右侧 calc 推导）
      style.paddingLeft = 'env(fold-left, 0px)'
      style.paddingRight = 'calc(100% - env(fold-left, 0px) - env(fold-width, 0px))'
    }
    return style
  }
  if (area === 'top' || area === 'all') style.paddingTop = envExpr('top', fb)
  if (area === 'bottom' || area === 'all') style.paddingBottom = envExpr('bottom', fb)
  if (area === 'left' || area === 'horizontal' || area === 'all') style.paddingLeft = envExpr('left', fb)
  if (area === 'right' || area === 'horizontal' || area === 'all') style.paddingRight = envExpr('right', fb)
  return style
}
