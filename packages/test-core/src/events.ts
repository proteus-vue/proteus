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
