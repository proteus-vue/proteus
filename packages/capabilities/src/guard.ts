// packages/capabilities/src/guard.ts
// ★types-plan B4：平台守卫（铁律 #4：替代 #ifdef——业务侧平台判别收敛为类型安全守卫）
// 运行时探测基于 detectPlatform（wx → skyline / 其余 → web）；app 端 v0.6 渲染器注入后扩展示例
// ★MP 产物安全（决策 #32/#36）：无可选链/空值合并/对象展开/数组解构（共享模块 _proteus/capabilities 进 MP）
import { detectPlatform } from './adapter'
import type { CapabilityPlatform } from './types'

/** 平台判别表：所有守卫必须穷尽三个平台（新增平台成员时编译报错——exhaustiveCheck 兜底） */
export type PlatformCases<T> = Record<CapabilityPlatform, () => T>

/** 当前平台（运行时探测；业务侧唯一平台读取入口） */
export function getPlatform(): CapabilityPlatform {
  return detectPlatform()
}

/**
 * 平台分支（类型收窄）：等价 match/switch，但三端必须全部提供实现——
 * 缺失分支编译报错（Record 完整性），运行时永不走 undefined
 * 用法：const s = matchPlatform({ web: () => 'w', skyline: () => 'mp', app: () => 'app' })
 */
export function matchPlatform<T>(cases: PlatformCases<T>): T {
  const platform = detectPlatform()
  switch (platform) {
    case 'web':
      return cases.web()
    case 'skyline':
      return cases.skyline()
    case 'app':
      return cases.app()
    default:
      // 平台枚举新增成员时：此处 TS 报错（platform 收窄为 never，不兼容）→ 强制补分支
      return exhaustiveCheck(platform, 'matchPlatform 分支未穷尽')
  }
}

/** 运行时断言：平台不符 → 抛错（用于「仅某端可用」的能力/模块入口） */
export function assertPlatform(expected: CapabilityPlatform): void {
  const actual = detectPlatform()
  if (actual !== expected) {
    throw new Error(`[proteus-types] platform assertion failed: expected ${expected}, got ${actual}`)
  }
}

/** 穷尽检查辅助：switch 未覆盖全部枚举成员时编译报错（参数类型 never） */
export function exhaustiveCheck(x: never, msg: string): never {
  throw new Error(`[proteus-types] exhaustive check failed: ${msg}（未知平台 ${String(x)}）`)
}
