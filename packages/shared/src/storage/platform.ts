// packages/shared/src/storage/platform.ts
// 平台标记（docs/proteus-pinia-plan M1 §3）—— 由 platforms/*/pinia.ts 初始化时设置，
// getPlatform() 仅读取，避免在 store 里直接 if (typeof window === 'undefined')
export type ProteusPlatform = 'web' | 'mp' | 'app' | 'ssr'

/** 设置平台标记（M3 的 createXxxPinia 工厂调用；App 端 v0.6 接入） */
export function setPlatform(p: ProteusPlatform): void {
  ;(globalThis as { __PROTEUS_PLATFORM__?: string }).__PROTEUS_PLATFORM__ = p
}

/** 读取平台标记（未设置时默认 web——基准实现） */
export function getPlatform(): ProteusPlatform {
  const v = (globalThis as { __PROTEUS_PLATFORM__?: string }).__PROTEUS_PLATFORM__
  if (v === 'mp' || v === 'app' || v === 'ssr' || v === 'web') return v
  return 'web'
}
