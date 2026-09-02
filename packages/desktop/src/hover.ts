// packages/desktop/src/hover.ts
// ★G-24 B1（proteus-semantic-primitives-plan 03 §1 p-hover）：指针悬停纯逻辑
//   · resolveHoverClass(preset) → 'p-hover-brighten' 等（CSS 类——渲染层定义过渡）
//   · isHoverPointer(pointerType) → mouse/pen → true；touch → false（p-hover 降级为 tap 高亮——plan §1）
//   纯逻辑零 DOM 依赖；MP 产物安全：无 ?. / ??；无数组解构
export type HoverPreset = 'brighten' | 'lift' | 'underline' | 'none' | string

export type PointerKind = 'mouse' | 'pen' | 'touch' | 'remote' | 'unknown'

/** 预设 → CSS 类名（渲染层 <style> 定义过渡动画） */
export function resolveHoverClass(preset: HoverPreset): string {
  if (!preset || preset === 'none') return ''
  return `p-hover-${preset}`
}

/** pointer 判定：mouse/pen 支持 hover（光标可悬停）；touch/remote 降级（plan：iOS 编译期剔除 → tap 高亮） */
export function isHoverPointer(pointerType: PointerKind): boolean {
  return pointerType === 'mouse' || pointerType === 'pen'
}

/** 事件 pointerType 归一（Web PointerEvent.pointerType / 测试注入） */
export function normalizePointerType(input: string | undefined | null): PointerKind {
  if (input === 'mouse' || input === 'pen') return input
  if (input === 'touch') return 'touch'
  if (input === 'remote') return 'remote'
  return 'unknown'
}

/** 悬停态切换判定（mouseenter/mouseleave 语义——注入 pointer 是否可悬停） */
export function canHover(pointerType: string | undefined | null): boolean {
  return isHoverPointer(normalizePointerType(pointerType))
}