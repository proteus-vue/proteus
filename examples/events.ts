// examples/events.ts —— app 模块公共契约：events（module-plan B1）
// 事件契约（type-only，运行时无副作用）
export interface AppEvents {
  'app:launch': { route: string }
}
