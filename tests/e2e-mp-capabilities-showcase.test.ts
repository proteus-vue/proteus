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
  process.env.PROTEUS_IDE_CLI || '/Volumes/data1/work/office-applications/wechatwebdevtools.app/Contents/MacOS/wechatide'
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
