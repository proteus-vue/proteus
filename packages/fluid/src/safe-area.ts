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
  /** ★运行时实测内边距（px）——提供时走 px（MP/Skyline：env() 不受支持），未提供走 env()（Web） */
  insets?: SafeAreaInsets
}

/** CSS 环境变量表达式：fallback>0 → max(env(...), Npx)「至少 Npx」；否则纯 env（fallback 参数 0px 兜底旧浏览器） */
function envExpr(inset: string, fallbackPx: number): string {
  const base = 'env(safe-area-inset-' + inset + ', 0px)'
  return fallbackPx > 0 ? 'max(' + base + ', ' + fallbackPx + 'px)' : base
}

/** 运行时实测内边距（px）——MP/Skyline 不支持 env()（实测整条声明被丢弃），改由逻辑层读数提供。 */
export interface SafeAreaInsets {
  top?: number
  bottom?: number
  left?: number
  right?: number
}

/**
 * 解析安全区避让样式（返回 { paddingTop/paddingLeft/... } 键值）
 * - 提供 `insets`（运行时实测 px）→ 用 px（max(insets, fallback)）——**MP/Skyline 走此路**
 * - 未提供 → env(safe-area-inset-*)（Web，前提 viewport-fit=cover）
 * - fold/span 形态（hinge 生效）：**把内容限制在左窗格**（fold）/ 暴露铰链几何量（span）
 *   ★2026-09-26 二次复审 P1：旧实现同时输出 paddingLeft=env(fold-left) 与
 *   paddingRight=calc(100% - fold-left - fold-width) —— 中置铰链设备（Z Fold / Surface Duo，
 *   fold-left ≈ 50%）两侧内边距之和 = 100% → 内容宽 0（彻底不可用）；且语义自相矛盾
 *   （左侧按「铰链左缘」缩进，右侧又按「右窗格宽」缩进，等于把内容挤成零宽）。
 *   正确语义：fold = 只有左窗格连续可用 → 右侧内边距 = 右窗格宽（100% - fold-left）；
 *   span = 两窗格都可显示，单流内容跨窗格必然穿折痕 → 不伪造内边距，只给 geometry 变量
 *   供布局（如 duo 双栏）按窗格成列；铰链带由 column-gap 预留。
 */
export function resolveSafeAreaStyle(options: SafeAreaStyleOptions = {}): Record<string, string> {
  const area = options.area ?? 'top'
  const fb = typeof options.fallback === 'number' && options.fallback > 0 ? options.fallback : 0
  const mode = options.displayMode ?? 'standard'
  const style: Record<string, string> = {}
  if (options.fold === true) {
    // ★fold 是完整开关：仅 fold/span（hinge 存在）时避让；expand/standard 无 hinge → 空（不误伤普通环境）
    if (mode === 'fold' || mode === 'span') {
      // 铰链几何（Chrome foldable CSS env：fold-left = 屏左至铰链左缘，fold-width = 铰链带宽）
      //   —— 暴露给布局消费（duo 双栏按窗格成列），不在此伪造内边距
      style['--pf-fold-left'] = 'env(fold-left, 0px)'
      style['--pf-fold-width'] = 'env(fold-width, 0px)'
      if (mode === 'fold') {
        // 单窗格：内容限制在左窗格（右窗格宽 + 铰链带 = 100% - fold-left），左侧仅屏边安全区
        style.paddingLeft = envExpr('left', fb)
        style.paddingRight = 'calc(100% - env(fold-left, 0px))'
      } else {
        // 双窗格：单流内容无法靠内边距回避中置铰链 → 只预留铰链带（网格/弹性容器生效，块流为无操作）
        style.columnGap = 'env(fold-width, 0px)'
      }
    }
    return style
  }
  const ins = options.insets
  const px = (side: keyof SafeAreaInsets): string => {
    const v = ins && typeof ins[side] === 'number' ? ins[side]! : 0
    return Math.max(v, fb) + 'px'
  }
  const expr = (side: 'top' | 'bottom' | 'left' | 'right', key: keyof SafeAreaInsets): string =>
    ins ? px(key) : envExpr(side, fb)
  if (area === 'top' || area === 'all') style.paddingTop = expr('top', 'top')
  if (area === 'bottom' || area === 'all') style.paddingBottom = expr('bottom', 'bottom')
  if (area === 'left' || area === 'horizontal' || area === 'all') style.paddingLeft = expr('left', 'left')
  if (area === 'right' || area === 'horizontal' || area === 'all') style.paddingRight = expr('right', 'right')
  return style
}
