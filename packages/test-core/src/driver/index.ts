// packages/test-core/src/driver/index.ts
// ★test-framework 统一测试 API（E2E 层）：TestDriver 多端自动化驱动
// 一套能力接口 → web（Playwright）/ mp（miniprogram-automator）——句柄由用户/CLI 装配（零硬依赖）
// 用法：
//   const driver = createDriver({ platform: 'mp', mini })        // automator miniProgram
//   const driver = createDriver({ platform: 'web', page })       // playwright Page
//   await driver.reLaunch('/pages/index'); await driver.element('button').tap(); ...
import type { TestDriver, PlaywrightPageLike, AutomatorMiniLike } from './types'
import { createWebDriver } from './web'
import { createMpDriver } from './mp'

export type { TestDriver, TestElement, TestElementOptions, ElementWaitOptions, ElementWaitState, PageSnapshot, SystemSnapshot } from './types'
export type { PlaywrightPageLike, PlaywrightLocatorLike, AutomatorMiniLike, AutomatorElementLike } from './types'
export { createWebDriver } from './web'
export { createMpDriver } from './mp'

export type DriverLaunchOptions =
  | { platform: 'web'; page: PlaywrightPageLike }
  | { platform: 'mp'; mini: AutomatorMiniLike }

/** ★统一驱动入口：platform + 注入句柄 → TestDriver（对齐 mountComponent 的统一挂载模式） */
export function createDriver(options: DriverLaunchOptions): TestDriver {
  if (options.platform === 'web') return createWebDriver(options.page)
  return createMpDriver(options.mini)
}
