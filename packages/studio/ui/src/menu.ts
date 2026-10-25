// menu.ts —— 菜单动作总线（决策 #1221）
//
// 【它解决的问题】菜单是**原生**的（Rust 侧建的 NSMenu），动作却分属不同面板：
//   `file.save` 属于编辑器，`view.*` 属于壳。让 App.vue 去 switch 一堆 id，
//   等于让壳知道编辑器的内部函数；让面板自己监听原生事件，又要每个面板各接一次 Tauri。
//   ⇒ 一张 id → 处理器的注册表：谁有能力谁注册，壳只负责把事件送进来。
//
// 【规矩：不留死项】`src/menu.rs` 的 `ACTIONS` 是唯一登记处，门禁会逐个派发到这张表；
//   `dispatchMenuAction` 返回 false（没人接）就说明菜单项是个摆设——必须修，不是"以后再说"。

import { onMenu, type MenuBridge } from './bridge'

type Handler = () => void
const handlers = new Map<string, Handler>()

/** 注册一个菜单动作。返回注销函数（组件卸载时必须调，否则留下旧闭包）。 */
export function onMenuAction(id: string, fn: Handler): () => void {
  handlers.set(id, fn)
  return () => {
    if (handlers.get(id) === fn) handlers.delete(id)
  }
}

/** 派发。返回值 = **有没有人接**。 */
export function dispatchMenuAction(id: string): boolean {
  const fn = handlers.get(id)
  if (!fn) {
    console.warn(`[studio] 菜单动作无人处理：${id}`)
    return false
  }
  fn()
  return true
}

/** 接上原生菜单（App 启动时调一次）。 */
export function wireMenu(): MenuBridge {
  return onMenu((id) => {
    // 空 id 是浏览器兜底路径上的噪声（不是菜单点出来的），直接丢
    if (id) dispatchMenuAction(id)
  })
}

/** 当前已注册的动作 id（诊断用；门禁靠 console.warn 判断死项，不靠这个）。 */
export const registeredMenuActions = (): string[] => [...handlers.keys()]
