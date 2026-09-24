// tests/e2e-mp-capabilities-showcase.test.ts
// ★2026-09-24 showcase 能力详情页的真机（微信模拟器）验证。
//
// 背景：能力详情页第二批（storage / cookie / fetch / permission / media-query / element-query /
//   intersection / idle / performance / device-capability）在 Web 端已有「渲染 + 真交互」E2E 锁，
//   但 MP 端走的是**另一条链路**（wxBridge，非 webBridge）→ 必须真机确认：页面能加载、演示态渲染、
//   且桥依赖的 wx API 在该运行时真实存在（否则页面按钮点了会走降级分支，用户看到「点了没反应」）。
//
// ★诚实边界：本环境模拟器的元素点击（automation_element_action）在页面非激活态会挂起
//   （见 tests/e2e-mp-smoke.test.ts 的 elementOps:false 注释）→ 本用例不做真机点击，
//   改为断言 ① 路由可达 + 页面 data 渲染出初始演示文本、② 各能力桥依赖的 wx API 实际可用。
//   真机点击路径由 Web 端真交互锁 + 各能力的 mock 桥单测覆盖。
//
// 运行：PROTEUS_E2E_ONLY=e2e-mp-capabilities-showcase \
//   PROTEUS_IDE_CLI="/.../wechatwebdevtools.app/Contents/MacOS/wechatide" \
//   npx tsx packages/cli/src/index.ts test e2e:mp showcase
import { describe, it, expect } from 'vitest'
import { createDriver, createWxideMini } from '@proteus-vue/test-core/driver'
import type { MpDebuggerLike } from '@proteus-vue/test-core/driver'

const WXIDE_CLI =
  process.env.PROTEUS_IDE_CLI || '/Volumes/data1/applications/wechatwebdevtools.app/Contents/MacOS/wechatide'
const PROJECT = process.env.PROTEUS_MINI_PROGRAM_PATH || 'dist/mp-weixin'
const ENABLED = process.env.PROTEUS_MP_E2E_WXIDE === '1'

/** 第二批能力页：文件 slug → 演示区初始文本里的特征串（证明是**该页**的演示态，非通用骨架） */
const PAGES: Array<{ slug: string; initialHint: string }> = [
  { slug: 'storage', initialHint: '写入 → 读回' },
  { slug: 'cookie', initialHint: 'cookie' },
  { slug: 'fetch', initialHint: '同源请求' },
  { slug: 'permission', initialHint: 'geolocation' },
  { slug: 'media-query', initialHint: '≤ 500px' },
  { slug: 'element-query', initialHint: 'demo-btns' },
  { slug: 'intersection', initialHint: '相交状态' },
  { slug: 'idle', initialHint: '空闲任务' },
  { slug: 'performance', initialHint: '资源加载条目' },
  { slug: 'device-capability', initialHint: 'HEVC' },
]

/** 各能力桥在 MP 端的依赖面（packages/api/src/capability.ts 的 wxBridge 实现）：
 *  这些 API 缺失 → 对应 hook 走 Err 降级分支，页面按钮「点了没反应」。 */
const WX_APIS = [
  'setStorageSync', // storage
  'getStorageSync',
  'getStorageInfo', // storage.info()
  'request', // fetch
  'getSetting', // permission
  'createMediaQueryObserver', // media-query
  'createSelectorQuery', // element-query
  'createIntersectionObserver', // intersection
  'requestIdleCallback', // idle
  'getPerformance', // performance
  'checkDeviceSupportHevc', // device-capability
]

/** ★批次 9（2026-09-24）Web 端有真实现的能力页：slug → 页面 data 特征。 */
const CAPABILITY_PAGES_9: Array<{ slug: string; featureKey: string; featureHint: string; requireKey?: boolean }> = [
  { slug: 'log', featureKey: 'codeDemo', featureHint: 'useLog' },
  { slug: 'download', featureKey: 'codeDemo', featureHint: 'responseType' },
  { slug: 'file-system', featureKey: 'codeDemo', featureHint: 'writeFile' },
  { slug: 'canvas', featureKey: 'codeDemo', featureHint: 'createContext' },
  // ★phases/pPhases/bgEvents 初值是**空数组** → 值与 hint 都无法判别（'[]' 不含 '['）→ 用 requireKey 语义
  { slug: 'app-lifecycle', featureKey: 'phases', featureHint: '', requireKey: true },
  { slug: 'page-lifecycle', featureKey: 'pPhases', featureHint: '', requireKey: true },
  { slug: 'navigation-guard', featureKey: 'codeDemo', featureHint: 'enable' },
  { slug: 'keyboard', featureKey: 'kbInfo', featureHint: '未订阅' },
  { slug: 'biometric', featureKey: 'codeDemo', featureHint: 'authenticateBiometric' },
  { slug: 'background', featureKey: 'bgEvents', featureHint: '', requireKey: true },
]

describe.skipIf(!ENABLED)('showcase 能力详情页批次 9 · MP 真机（页面可达 + 演示态 + API 表进产物）', () => {
  it(
    '10 个新能力页逐个 reLaunch 可达、演示态字段正确、API 表已进产物',
    async () => {
      const mini = createWxideMini({ cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
      const driver = createDriver({ platform: 'mp', mini })
      const failures: string[] = []
      for (const { slug, featureKey, featureHint, requireKey } of CAPABILITY_PAGES_9) {
        const route = `/subpackages/capabilities/pages/${slug}`
        let launched = false
        for (let i = 0; i < 3 && !launched; i++) {
          try {
            await driver.reLaunch(route)
            launched = true
          } catch {
            await driver.waitFor(1500)
          }
        }
        if (!launched) {
          failures.push(`${slug}: reLaunch 失败（3 次）`)
          continue
        }
        const expectedRoute = route.replace(/^\//, '')
        let landedRoute = ''
        let featureVal = ''
        let tableOk = false
        let featureOk = false
        const probeSrc = String(() => {
          const pages = getCurrentPages()
          const p = pages[pages.length - 1]
          const d = (p?.data ?? {}) as Record<string, unknown>
          return JSON.stringify({
            route: p?.route ?? '',
            feature: JSON.stringify(d['__FEATURE_KEY__'] ?? ''),
            hasKey: Object.prototype.hasOwnProperty.call(d, '__FEATURE_KEY__'),
            tableOk: Array.isArray(d.apiRows) && (d.apiRows as unknown[]).length > 0,
          })
        }).replace(/__FEATURE_KEY__/g, featureKey)
        for (let i = 0; i < 10; i++) {
          await driver.waitFor(700)
          const snap = String(await driver.evaluate(new Function(`return ${probeSrc}`)() as () => string))
          const parsed = JSON.parse(snap) as { route: string; feature: string; tableOk: boolean; hasKey: boolean }
          landedRoute = parsed.route
          featureVal = parsed.feature
          tableOk = parsed.tableOk
          featureOk = requireKey ? parsed.hasKey : featureVal.includes(featureHint)
          if (featureOk && tableOk) break
          if (landedRoute !== expectedRoute && i < 3) {
            try {
              await driver.reLaunch(route)
            } catch {
              /* 重试失败则继续轮询 */
            }
          }
        }
        if (!featureOk) {
          failures.push(
            requireKey
              ? `${slug}: 页面 data 缺字段 ${featureKey}（路由 ${landedRoute}）`
              : `${slug}: 演示态字段 ${featureKey} 未含 "${featureHint}"（实际 ${featureVal.slice(0, 60)}，路由 ${landedRoute}）`,
          )
        }
        if (!tableOk) failures.push(`${slug}: API 表未进产物`)
      }
      expect(failures, `批次 9 能力页真机断言失败：\n${failures.join('\n')}`).toEqual([])
      await driver.close()
    },
    300_000,
  )
})

/** ★批次 8（2026-09-24，收官）表单族 + 虚拟列表 + 能力入口：slug → 页面 data 特征。 */
const COMPONENT_PAGES_8: Array<{ slug: string; featureKey: string; featureHint: string }> = [
  { slug: 'p-form', featureKey: 'formMsg', featureHint: '尚未提交' },
  { slug: 'p-selection', featureKey: 'selDetail', featureHint: '划选' },
  { slug: 'p-keyboard-accessory', featureKey: 'kaVisible', featureHint: 'false' },
  { slug: 'p-list-view', featureKey: 'lvCount', featureHint: '点按钮' },
  { slug: 'p-virtual-list', featureKey: 'vlItems', featureHint: 'p-virtual-list' },
  { slug: 'p-location', featureKey: 'locMsg', featureHint: '点按钮' },
  { slug: 'p-scan-qr', featureKey: 'qrMsg', featureHint: '扫码' },
  { slug: 'p-pick-photo', featureKey: 'pickMsg', featureHint: '选一张' },
]

describe.skipIf(!ENABLED)('showcase 组件详情页批次 8 · MP 真机（页面可达 + 演示态 + API 表进产物）', () => {
  it(
    '8 个新组件页逐个 reLaunch 可达、演示态字段正确、API 三表已进产物',
    async () => {
      const mini = createWxideMini({ cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
      const driver = createDriver({ platform: 'mp', mini })
      const failures: string[] = []
      for (const { slug, featureKey, featureHint } of COMPONENT_PAGES_8) {
        const route = `/subpackages/components/pages/${slug}`
        let launched = false
        for (let i = 0; i < 3 && !launched; i++) {
          try {
            await driver.reLaunch(route)
            launched = true
          } catch {
            await driver.waitFor(1500)
          }
        }
        if (!launched) {
          failures.push(`${slug}: reLaunch 失败（3 次）`)
          continue
        }
        const expectedRoute = route.replace(/^\//, '')
        let landedRoute = ''
        let featureVal = ''
        let tableOk = false
        let featureOk = false
        const probeSrc = String(() => {
          const pages = getCurrentPages()
          const p = pages[pages.length - 1]
          const d = (p?.data ?? {}) as Record<string, unknown>
          return JSON.stringify({
            route: p?.route ?? '',
            feature: JSON.stringify(d['__FEATURE_KEY__'] ?? ''),
            tableOk:
              Array.isArray(d.apiRows) && (d.apiRows as unknown[]).length > 0 &&
              Array.isArray(d.eventRows) &&
              Array.isArray(d.slotRows) &&
              Array.isArray(d.compatRows) && (d.compatRows as unknown[]).length > 0,
          })
        }).replace(/__FEATURE_KEY__/g, featureKey)
        for (let i = 0; i < 10; i++) {
          await driver.waitFor(700)
          const snap = String(await driver.evaluate(new Function(`return ${probeSrc}`)() as () => string))
          const parsed = JSON.parse(snap) as { route: string; feature: string; tableOk: boolean; hasKey: boolean }
          landedRoute = parsed.route
          featureVal = parsed.feature
          tableOk = parsed.tableOk
          featureOk = featureVal.includes(featureHint)
          if (featureOk && tableOk) break
          // ★导航后校验路由（冷启动首个 reLaunch 可能静默停留首页——见批次 7 注释）
          if (landedRoute !== expectedRoute && i < 3) {
            try {
              await driver.reLaunch(route)
            } catch {
              /* 重试失败则继续轮询 */
            }
          }
        }
        if (!featureOk) {
          failures.push(`${slug}: 演示态字段 ${featureKey} 未含 "${featureHint}"（实际 ${featureVal.slice(0, 60)}，路由 ${landedRoute}）`)
        }
        if (!tableOk) failures.push(`${slug}: API 表未进产物（apiRows/eventRows/slotRows/compatRows 应有值）`)
      }
      expect(failures, `批次 8 组件页真机断言失败：\n${failures.join('\n')}`).toEqual([])
      await driver.close()
    },
    300_000,
  )
})

/** ★批次 7（2026-09-24）工程类 + 剩余布局/外壳：slug → 页面 data 特征（判据同批次 4/5/6）。 */
const COMPONENT_PAGES_7: Array<{ slug: string; featureKey: string; featureHint: string; requireKey?: boolean }> = [
  { slug: 'p-animate', featureKey: 'codes', featureHint: 'keyframes' },
  { slug: 'p-transition', featureKey: 'trName', featureHint: 'fade' },
  { slug: 'p-error-boundary', featureKey: 'ebMounted', featureHint: 'true' },
  { slug: 'p-scroll', featureKey: 'codes', featureHint: 'paging' },
  { slug: 'p-scrollable', featureKey: 'scLoading', featureHint: 'false' },
  { slug: 'p-adaptive', featureKey: 'codes', featureHint: 'modes' },
  { slug: 'p-masonry', featureKey: 'codes', featureHint: 'col-count' },
  { slug: 'p-svg', featureKey: 'codes', featureHint: 'path' },
  { slug: 'p-toolbar', featureKey: 'tbLast', featureHint: '暂无' },
  { slug: 'p-sidebar', featureKey: 'codes', featureHint: 'min-sidebar-width' },
]

describe.skipIf(!ENABLED)('showcase 组件详情页批次 7 · MP 真机（页面可达 + 演示态 + API 表进产物）', () => {
  it(
    '10 个新组件页逐个 reLaunch 可达、演示态字段正确、API 三表已进产物',
    async () => {
      const mini = createWxideMini({ cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
      const driver = createDriver({ platform: 'mp', mini })
      const failures: string[] = []
      for (const { slug, featureKey, featureHint, requireKey } of COMPONENT_PAGES_7) {
        const route = `/subpackages/components/pages/${slug}`
        let launched = false
        for (let i = 0; i < 3 && !launched; i++) {
          try {
            await driver.reLaunch(route)
            launched = true
          } catch {
            await driver.waitFor(1500)
          }
        }
        if (!launched) {
          failures.push(`${slug}: reLaunch 失败（3 次）`)
          continue
        }
        // ★导航后**校验路由**（2026-09-24 实测）：reLaunch 返回 success 不等于页面已切过去——
        //   每次真机会话的首个 reLaunch 可能静默停留在 pages/index（冷启动瞬态）→
        //   断言会误报「演示态未渲染（路由 pages/index）」。故导航后先确认路由，不符则重试。
        const expectedRoute = route.replace(/^\//, '')
        let landedRoute = ''
        let featureVal = ''
        let tableOk = false
        let featureOk = false
        const probeSrc = String(() => {
          const pages = getCurrentPages()
          const p = pages[pages.length - 1]
          const d = (p?.data ?? {}) as Record<string, unknown>
          return JSON.stringify({
            route: p?.route ?? '',
            feature: JSON.stringify(d['__FEATURE_KEY__'] ?? ''),
            hasKey: Object.prototype.hasOwnProperty.call(d, '__FEATURE_KEY__'),
            tableOk:
              Array.isArray(d.apiRows) && (d.apiRows as unknown[]).length > 0 &&
              Array.isArray(d.eventRows) &&
              Array.isArray(d.slotRows) &&
              Array.isArray(d.compatRows) && (d.compatRows as unknown[]).length > 0,
          })
        }).replace(/__FEATURE_KEY__/g, featureKey)
        for (let i = 0; i < 10; i++) {
          await driver.waitFor(700)
          const snap = String(await driver.evaluate(new Function(`return ${probeSrc}`)() as () => string))
          const parsed = JSON.parse(snap) as { route: string; feature: string; tableOk: boolean; hasKey: boolean }
          landedRoute = parsed.route
          featureVal = parsed.feature
          tableOk = parsed.tableOk
          featureOk = requireKey ? parsed.hasKey : featureVal.includes(featureHint)
          if (featureOk && tableOk) break
          // 路由还没到位 → 再发一次导航（最多 3 次，避免无上限重试）
          if (landedRoute !== expectedRoute && i < 3) {
            try {
              await driver.reLaunch(route)
            } catch {
              /* 重试失败则继续轮询 */
            }
          }
        }
        if (!featureOk) {
          failures.push(
            requireKey
              ? `${slug}: 页面 data 缺字段 ${featureKey}（路由 ${landedRoute}）`
              : `${slug}: 演示态字段 ${featureKey} 未含 "${featureHint}"（实际 ${featureVal.slice(0, 60)}，路由 ${landedRoute}）`,
          )
        }
        if (!tableOk) failures.push(`${slug}: API 表未进产物（apiRows/eventRows/slotRows/compatRows 应有值）`)
      }
      expect(failures, `批次 7 组件页真机断言失败：\n${failures.join('\n')}`).toEqual([])
      await driver.close()
    },
    300_000,
  )
})

/** ★批次 6（2026-09-24）弹层族 + 外壳基础：slug → 页面 data 特征（判据同批次 4/5）。 */
const COMPONENT_PAGES_6: Array<{ slug: string; featureKey: string; featureHint: string; requireKey?: boolean }> = [
  { slug: 'p-modal', featureKey: 'codes', featureHint: 'v-model:visible' },
  { slug: 'p-popup', featureKey: 'popupPos', featureHint: 'bottom' },
  { slug: 'p-drawer', featureKey: 'codes', featureHint: 'overlay' },
  { slug: 'p-action-sheet', featureKey: 'sheetLast', featureHint: '暂无' },
  { slug: 'p-popover', featureKey: 'popoverVisible', featureHint: 'false' },
  { slug: 'p-nav', featureKey: 'codes', featureHint: 'transparent' },
  { slug: 'p-tabbar', featureKey: 'tabActive', featureHint: 'home' },
  { slug: 'p-page', featureKey: 'codes', featureHint: 'pull-refresh' },
  // ★p-select 的演示态初值是**空串**（未选择）——「含子串」判据对空串无判别力，
  //   故此条用 hasKey 语义（断言该键确实在页面 data 里，证明演示状态已初始化）
  { slug: 'p-select', featureKey: 'selValue', featureHint: '', requireKey: true },
]

describe.skipIf(!ENABLED)('showcase 组件详情页批次 6 · MP 真机（页面可达 + 演示态 + API 表进产物）', () => {
  it(
    '9 个新组件页逐个 reLaunch 可达、演示态字段正确、API 三表已进产物',
    async () => {
      const mini = createWxideMini({ cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
      const driver = createDriver({ platform: 'mp', mini })
      const failures: string[] = []
      for (const { slug, featureKey, featureHint, requireKey } of COMPONENT_PAGES_6) {
        const route = `/subpackages/components/pages/${slug}`
        let launched = false
        for (let i = 0; i < 3 && !launched; i++) {
          try {
            await driver.reLaunch(route)
            launched = true
          } catch {
            await driver.waitFor(1500)
          }
        }
        if (!launched) {
          failures.push(`${slug}: reLaunch 失败（3 次）`)
          continue
        }
        let landedRoute = ''
        let featureVal = ''
        let tableOk = false
        let featureOk = false
        const probeSrc = String(() => {
          const pages = getCurrentPages()
          const p = pages[pages.length - 1]
          const d = (p?.data ?? {}) as Record<string, unknown>
          return JSON.stringify({
            route: p?.route ?? '',
            feature: JSON.stringify(d['__FEATURE_KEY__'] ?? ''),
            hasKey: Object.prototype.hasOwnProperty.call(d, '__FEATURE_KEY__'),
            tableOk:
              Array.isArray(d.apiRows) && (d.apiRows as unknown[]).length > 0 &&
              Array.isArray(d.eventRows) &&
              Array.isArray(d.slotRows) &&
              Array.isArray(d.compatRows) && (d.compatRows as unknown[]).length > 0,
          })
        }).replace(/__FEATURE_KEY__/g, featureKey) // ★必须**全局**替换：probe 里引用了两次占位符，
            //   而 String.replace(字符串) 只换第一处（实测：hasKey 检查的是占位符键 → 恒 false，
            //   p-select 的真机断言假红）。用正则 /g 保证两处都替换。
        for (let i = 0; i < 10; i++) {
          await driver.waitFor(700)
          const snap = String(await driver.evaluate(new Function(`return ${probeSrc}`)() as () => string))
          const parsed = JSON.parse(snap) as { route: string; feature: string; tableOk: boolean; hasKey: boolean }
          landedRoute = parsed.route
          featureVal = parsed.feature
          tableOk = parsed.tableOk
          featureOk = requireKey ? parsed.hasKey : featureVal.includes(featureHint)
          if (featureOk && tableOk) break
        }
        if (!featureOk) {
          failures.push(
            requireKey
              ? `${slug}: 页面 data 缺字段 ${featureKey}（路由 ${landedRoute}）`
              : `${slug}: 演示态字段 ${featureKey} 未含 "${featureHint}"（实际 ${featureVal.slice(0, 60)}，路由 ${landedRoute}）`,
          )
        }
        if (!tableOk) failures.push(`${slug}: API 表未进产物（apiRows/eventRows/slotRows/compatRows 应有值）`)
      }
      expect(failures, `批次 6 组件页真机断言失败：\n${failures.join('\n')}`).toEqual([])
      await driver.close()
    },
    300_000,
  )
})

/** ★批次 5（2026-09-24）Fluid 布局 + 外壳基础：slug → 页面 data 特征（判据同批次 4）。 */
const COMPONENT_PAGES_5: Array<{ slug: string; featureKey: string; featureHint: string }> = [
  { slug: 'p-aspect', featureKey: 'codes', featureHint: 'ratio' },
  { slug: 'p-fit', featureKey: 'codes', featureHint: 'maxRatio' },
  { slug: 'p-inline', featureKey: 'codes', featureHint: 'wrap' },
  { slug: 'p-zone', featureKey: 'codes', featureHint: 'sm' },
  { slug: 'p-scale', featureKey: 'codes', featureHint: 'density' },
  { slug: 'p-label', featureKey: 'labelClicks', featureHint: '暂无' },
  { slug: 'p-safe', featureKey: 'codes', featureHint: 'fallback' },
  { slug: 'p-split', featureKey: 'codes', featureHint: 'minSplitWidth' },
  { slug: 'p-mask', featureKey: 'maskVisible', featureHint: 'false' },
  { slug: 'p-toast', featureKey: 'toastVisible', featureHint: 'false' },
]

describe.skipIf(!ENABLED)('showcase 组件详情页批次 5 · MP 真机（页面可达 + 演示态 + API 表进产物）', () => {
  it(
    '10 个新组件页逐个 reLaunch 可达、演示态字段正确、API 三表已进产物',
    async () => {
      const mini = createWxideMini({ cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
      const driver = createDriver({ platform: 'mp', mini })
      const failures: string[] = []
      for (const { slug, featureKey, featureHint } of COMPONENT_PAGES_5) {
        const route = `/subpackages/components/pages/${slug}`
        let launched = false
        for (let i = 0; i < 3 && !launched; i++) {
          try {
            await driver.reLaunch(route)
            launched = true
          } catch {
            await driver.waitFor(1500)
          }
        }
        if (!launched) {
          failures.push(`${slug}: reLaunch 失败（3 次）`)
          continue
        }
        let landedRoute = ''
        let featureVal = ''
        let tableOk = false
        const probeSrc = String(() => {
          const pages = getCurrentPages()
          const p = pages[pages.length - 1]
          const d = (p?.data ?? {}) as Record<string, unknown>
          return JSON.stringify({
            route: p?.route ?? '',
            feature: JSON.stringify(d['__FEATURE_KEY__'] ?? ''),
            hasKey: Object.prototype.hasOwnProperty.call(d, '__FEATURE_KEY__'),
            tableOk:
              Array.isArray(d.apiRows) && (d.apiRows as unknown[]).length > 0 &&
              Array.isArray(d.eventRows) &&
              Array.isArray(d.slotRows) &&
              Array.isArray(d.compatRows) && (d.compatRows as unknown[]).length > 0,
          })
        }).replace(/__FEATURE_KEY__/g, featureKey) // ★必须**全局**替换：probe 里引用了两次占位符，
            //   而 String.replace(字符串) 只换第一处（实测：hasKey 检查的是占位符键 → 恒 false，
            //   p-select 的真机断言假红）。用正则 /g 保证两处都替换。
        for (let i = 0; i < 10; i++) {
          await driver.waitFor(700)
          const snap = String(await driver.evaluate(new Function(`return ${probeSrc}`)() as () => string))
          const parsed = JSON.parse(snap) as { route: string; feature: string; tableOk: boolean }
          landedRoute = parsed.route
          featureVal = parsed.feature
          tableOk = parsed.tableOk
          if (featureVal.includes(featureHint) && tableOk) break
        }
        if (!featureVal.includes(featureHint)) {
          failures.push(`${slug}: 演示态字段 ${featureKey} 未含 "${featureHint}"（实际 ${featureVal.slice(0, 60)}，路由 ${landedRoute}）`)
        }
        if (!tableOk) failures.push(`${slug}: API 表未进产物（apiRows/eventRows/slotRows/compatRows 应有值）`)
      }
      expect(failures, `批次 5 组件页真机断言失败：\n${failures.join('\n')}`).toEqual([])
      await driver.close()
    },
    300_000,
  )
})

/** ★批次 4（2026-09-24）布局与展示组件页。
 *  ★判据为何用页面 data 而非页面文本：MP 端**组件内部节点隔离**（页面级 SelectorQuery 查不到，
 *    与既有结论一致），而页面 data 是可达通道。data 里带 codes/apiRows/eventRows/slotRows/compatRows
 *    ⇒ 证明该页的演示代码片段 + **从官网内容 SSOT 解析出的 API 三表**真的进了 MP 产物（非空壳页）；
 *    `feature` 为该页**独有**的演示状态字段值（证明是这一页，不是通用骨架）。 */
const COMPONENT_PAGES: Array<{ slug: string; featureKey: string; featureHint: string }> = [
  { slug: 'p-box', featureKey: 'codes', featureHint: 'aspect-ratio' },
  { slug: 'p-spacer', featureKey: 'codes', featureHint: 'p-spacer' },
  { slug: 'p-heading', featureKey: 'codes', featureHint: 'level' },
  { slug: 'p-divider', featureKey: 'codes', featureHint: 'orientation' },
  { slug: 'p-stack', featureKey: 'codes', featureHint: 'snap' },
  { slug: 'p-grid', featureKey: 'codes', featureHint: 'min-col-width' },
  { slug: 'p-loading', featureKey: 'loadingVisible', featureHint: 'false' },
  { slug: 'p-skeleton', featureKey: 'skVisible', featureHint: 'true' },
  { slug: 'p-avatar', featureKey: 'codes', featureHint: 'fallback' },
  { slug: 'p-segment', featureKey: 'segActive', featureHint: '全部' },
]

describe.skipIf(!ENABLED)('showcase 组件详情页 · MP 真机（页面可达 + 演示态 + API 表进产物）', () => {
  it(
    '10 个新组件页逐个 reLaunch 可达、演示态字段正确、API 三表已进产物',
    async () => {
      const mini = createWxideMini({ cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
      const driver = createDriver({ platform: 'mp', mini })
      const failures: string[] = []
      for (const { slug, featureKey, featureHint } of COMPONENT_PAGES) {
        const route = `/subpackages/components/pages/${slug}`
        let launched = false
        for (let i = 0; i < 3 && !launched; i++) {
          try {
            await driver.reLaunch(route)
            launched = true
          } catch {
            await driver.waitFor(1500)
          }
        }
        if (!launched) {
          failures.push(`${slug}: reLaunch 失败（3 次）`)
          continue
        }
        // ★有界轮询（首屏冷启动下页面 data 落地晚于导航返回）。
        // ★evaluate 闭包会被序列化下发，拿不到外层变量 → 用占位符 + 字符串替换烘焙特征键名。
        let landedRoute = ''
        let featureVal = ''
        let tableOk = false
        const probeSrc = String(() => {
          const pages = getCurrentPages()
          const p = pages[pages.length - 1]
          const d = (p?.data ?? {}) as Record<string, unknown>
          return JSON.stringify({
            route: p?.route ?? '',
            feature: JSON.stringify(d['__FEATURE_KEY__'] ?? ''),
            hasKey: Object.prototype.hasOwnProperty.call(d, '__FEATURE_KEY__'),
            tableOk:
              Array.isArray(d.apiRows) && (d.apiRows as unknown[]).length > 0 &&
              Array.isArray(d.eventRows) &&
              Array.isArray(d.slotRows) &&
              Array.isArray(d.compatRows) && (d.compatRows as unknown[]).length > 0,
          })
        }).replace(/__FEATURE_KEY__/g, featureKey) // ★必须**全局**替换：probe 里引用了两次占位符，
            //   而 String.replace(字符串) 只换第一处（实测：hasKey 检查的是占位符键 → 恒 false，
            //   p-select 的真机断言假红）。用正则 /g 保证两处都替换。
        for (let i = 0; i < 10; i++) {
          await driver.waitFor(700)
          const snap = String(await driver.evaluate(new Function(`return ${probeSrc}`)() as () => string))
          const parsed = JSON.parse(snap) as { route: string; feature: string; tableOk: boolean }
          landedRoute = parsed.route
          featureVal = parsed.feature
          tableOk = parsed.tableOk
          if (featureVal.includes(featureHint) && tableOk) break
        }
        if (!featureVal.includes(featureHint)) {
          failures.push(`${slug}: 演示态字段 ${featureKey} 未含 "${featureHint}"（实际 ${featureVal.slice(0, 60)}，路由 ${landedRoute}）`)
        }
        if (!tableOk) failures.push(`${slug}: API 表未进产物（apiRows/eventRows/slotRows/compatRows 应有值）`)
      }
      expect(failures, `组件页真机断言失败：\n${failures.join('\n')}`).toEqual([])
      await driver.close()
    },
    300_000,
  )
})

describe.skipIf(!ENABLED)('showcase 能力详情页 · MP 真机（页面可达 + 演示态渲染 + 桥依赖 API 齐备）', () => {
  it(
    '10 个新能力页逐个 reLaunch 可达且渲染出各自演示态；wxBridge 依赖的 wx API 全部存在于该运行时',
    async () => {
      const mini = createWxideMini({ cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
      const driver = createDriver({ platform: 'mp', mini })

      // ① 逐页可达 + 演示态渲染（读页面 data 的 out 字段——能力页范式的输出区绑定）
      const failures: string[] = []
      for (const { slug, initialHint } of PAGES) {
        const route = `/subpackages/capabilities/pages/${slug}`
        let launched = false
        for (let i = 0; i < 3 && !launched; i++) {
          try {
            await driver.reLaunch(route)
            launched = true
          } catch {
            await driver.waitFor(1500)
          }
        }
        if (!launched) {
          failures.push(`${slug}: reLaunch 失败（3 次）`)
          continue
        }
        // ★有界轮询读数（首屏冷启动 / 分包懒加载下页面 data 落地晚于导航返回——实测首个 slug 会读到空）
        let out = ''
        let landedRoute = ''
        for (let i = 0; i < 10; i++) {
          await driver.waitFor(700)
          const snap = String(
            await driver.evaluate(() => {
              const pages = getCurrentPages()
              const p = pages[pages.length - 1]
              return JSON.stringify({ route: p?.route ?? '', out: String((p?.data as { out?: unknown })?.out ?? '') })
            }),
          )
          const parsed = JSON.parse(snap) as { route: string; out: string }
          out = parsed.out
          landedRoute = parsed.route
          if (out.includes(initialHint)) break
        }
        if (!out.includes(initialHint)) {
          failures.push(`${slug}: 演示态未渲染（实际路由 ${landedRoute} · out="${out.slice(0, 60)}"）`)
        }
      }
      expect(failures, `能力页真机断言失败：\n${failures.join('\n')}`).toEqual([])

      // ② 桥依赖 API 齐备（缺失即该能力在 MP 端恒降级）
      //   ★wechatide 后端 evaluate 不支持带参（--args 实测不生效）→ 把 API 清单烘进函数字面量
      const checkApis = new Function(
        `return () => {
          const apis = ${JSON.stringify(WX_APIS)};
          const w = globalThis.wx;
          if (!w) return 'wx 全局对象不存在';
          return apis.filter((a) => typeof w[a] !== 'function').map((a) => 'wx.' + a).join(', ');
        }`,
      )() as () => string
      const missing = String(await driver.evaluate(checkApis))
      expect(missing, `MP 运行时缺少桥依赖 API：${missing}`).toBe('')

      await driver.close()
    },
    180_000,
  )
})
