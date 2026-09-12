// src/components/runtime/nav-close.ts —— 侧栏「点击后自动收起」判定（p-sidebar #467 语义收窄）
// ★问题（2026-09-12）：原实现对侧栏内**任意点击**都收起抽屉——误伤「折叠/展开一级域」等交互控件
//   （用户点开一级菜单，抽屉被顺手关掉）。
// ★规则：只有点击落在**真实导航项**内才自动收起——
//   · <a href>（router-link / navigator 渲染为 a）
//   · 或显式标注 data-sidebar-close 的自定义可导航项
// 纯函数 + 鸭子类型（不引用 document/window/Element 全局——MP 端不执行但仍须编译安全）。

/** 元素最小形状（避免依赖 DOM 全局类型；鸭子类型判定） */
interface NodeLike {
  tagName?: string
  parentElement?: NodeLike | null
  getAttribute?: (name: string) => string | null
}

/** 该点击目标是否应触发侧栏自动收起（沿祖先链查 <a href> / [data-sidebar-close]） */
export function shouldAutoCloseOnClick(target: unknown): boolean {
  let node = target as NodeLike | null
  let guard = 0
  while (node && guard++ < 24) {
    const tag = typeof node.tagName === 'string' ? node.tagName.toLowerCase() : ''
    if (tag === 'a') {
      // 有 href 才是真导航（router-link 渲染的 a；无 href 的 a 不收起）
      const href = typeof node.getAttribute === 'function' ? node.getAttribute('href') : null
      if (href !== null && href !== undefined && href !== '') return true
    }
    if (typeof node.getAttribute === 'function' && node.getAttribute('data-sidebar-close') !== null) return true
    node = node.parentElement ?? null
  }
  return false
}
