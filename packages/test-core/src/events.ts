// packages/test-core/src/events.ts
// ★test-framework B7：跨端统一断言 helper（06-cross-platform-assert.md §统一事件 helper）
// 断言只碰「逻辑 + 状态 + 语义」：tap 按端分发（Web trigger / 小程序 automator tap）
// 06 铁律：禁止跨端用例直接写 div/view 字面量——DOM 差异收敛到 p-* 映射 + 编译快照
export interface WebEventTarget {
  /** @vue/test-utils wrapper（Web） */
  trigger(event: string, payload?: unknown): void
}

export interface MpEventTarget {
  /** miniprogram-automator element（小程序） */
  tap(): Promise<void>
}

export type CrossPlatformElement = WebEventTarget | MpEventTarget

/** 类型守卫：Web wrapper（@vue/test-utils） */
export function isWebElement(el: CrossPlatformElement): el is WebEventTarget {
  return typeof (el as WebEventTarget).trigger === 'function'
}

/** 类型守卫：小程序 automator element */
export function isMpElement(el: CrossPlatformElement): el is MpEventTarget {
  return typeof (el as MpEventTarget).tap === 'function'
}

/** 统一 tap（06 §统一事件 helper）：Web → trigger('click')；小程序 → tap() */
export async function tap(el: CrossPlatformElement): Promise<void> {
  if (isWebElement(el)) {
    el.trigger('click')
  } else {
    await el.tap()
  }
}

// ============ ★统一测试 API：状态/文本读取（06 分层断言：状态完全共用，DOM 各自断言） ============

/** Web 挂载 host（@vue/test-utils VueWrapper）——vm 状态读取 */
export interface WebHostLike {
  vm: Record<string, unknown> & {
    /** 内部实例（script setup 绑定在 vm.$.setupState：公开代理无 own keys，走 has/get trap） */
    $?: { setupState?: Record<string, unknown>; $data?: Record<string, unknown> }
  }
  text?(): string
}

/** MP 逻辑层 host（mountMpComponent 实例）——data 快照 + WXML */
export interface MpHostLike {
  data: Record<string, unknown>
  wxml?: string
}

/** 统一状态读取：Web → setupState/$data（vm 公开代理无 own keys，状态在内部实例）；MP → data 快照（06 §分层断言：状态跨端完全共用） */
export function stateOf(host: WebHostLike | MpHostLike): Record<string, unknown> {
  const web = host as WebHostLike
  if (web.vm) {
    const out: Record<string, unknown> = {}
    // ★script setup 绑定（vm.$.setupState）+ options API data（$data）合并；排除内部 $/__ 前缀
    const setupState = web.vm.$?.setupState ?? {}
    for (const k of Object.keys(setupState)) {
      if (!k.startsWith('$') && !k.startsWith('__')) out[k] = setupState[k]
    }
    const data = web.vm.$?.$data
    if (data) {
      for (const k of Object.keys(data)) {
        if (!(k in out)) out[k] = data[k]
      }
    }
    return out
  }
  return (host as MpHostLike).data ?? {}
}

/** 统一文本读取：Web → wrapper.text()（渲染文本）；MP → wxml 规范化（结构文本，语义近似） */
export function textOf(host: WebHostLike | MpHostLike): string {
  const web = host as WebHostLike
  if (web.vm && typeof web.text === 'function') return web.text()
  return (host as MpHostLike).wxml ?? ''
}
