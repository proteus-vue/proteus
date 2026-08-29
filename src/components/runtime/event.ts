// src/components/runtime/event.ts —— 事件载荷归一（组件库 B4）
// MP 事件对象：e.detail.<field>（原生组件事件 / triggerEvent 载荷）；Web 原生事件：e.target.<field>
// 组件内统一用 eventField(e, 'value') / eventField(e, 'scrollTop') 读取，双端安全
// ★MP 产物安全（决策 #32/#36）：无 ?? / ?. / 对象展开 / 数组解构（共享模块 B0 机制编译进 MP 产物）

interface Shape {
  detail?: Record<string, unknown>
  target?: Record<string, unknown>
}

/** 跨端读取事件字段：MP e.detail.x 优先，Web e.target.x 兜底，均缺失返回 undefined */
export function eventField(e: unknown, key: string): unknown {
  const ev = (e ?? null) as Shape | null
  if (ev && ev.detail && ev.detail[key] !== undefined) return ev.detail[key]
  if (ev && ev.target && ev.target[key] !== undefined) return ev.target[key]
  return undefined
}

/** 输入值归一（input/textarea）：MP e.detail.value / Web e.target.value */
export function eventValue(e: unknown): string {
  const v = eventField(e, 'value')
  return typeof v === 'string' ? v : ''
}

/** 滚动位置归一（scroll-view）：MP e.detail.scrollTop / Web 原生滚动 e.target.scrollTop */
export function eventScrollTop(e: unknown): number {
  const v = eventField(e, 'scrollTop')
  return typeof v === 'number' ? v : 0
}
