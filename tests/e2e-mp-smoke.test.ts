// tests/e2e-mp-smoke.test.ts
// ★test-framework B5：小程序 E2E 冒烟（05-e2e-mp-automator.md）——IDE 就绪资产
// miniprogram-automator 驱动真实小程序运行时（微信开发者工具 GUI，非 headless）
// ★运行前置（铁律：automator 必须 GUI）：
//   1. 微信开发者工具启动 + CLI 远程调试端口：
//      "/Applications/wechatwebdevtools.app/Contents/MacOS/cli" auto --project "<abs>/dist/mp-weixin" --auto-port 9420
//   2. npm run build:mp（产出小程序包）
//   3. PROTEUS_MP_E2E=1 npx vitest run tests/e2e-mp-smoke.test.ts
// ★本机未装 IDE → 默认跳过（PROTEUS_MP_E2E 未置位）；骨架未在真机验证（环境依赖）
// ⚠ 文件被根 test 排除（tests/e2e-*.test.ts 通配，与 Web E2E 平级）
import { describe, it, expect } from 'vitest'

// miniprogram-automator 未内置依赖（仅 IDE 环境按需安装）；动态 import 用变量名避免编译期模块解析
// ★连接形状对齐 05 §用例（automator.connect({ wsEndpoint }) → mini.reLaunch → page.$ → disconnect）
const AUTOMATOR_MODULE = 'miniprogram-automator'
// ★B5：端口由 CLI 注入（proteus test e2e:mp --port <n>；缺省 9420）
const AUTOMATOR_PORT = Number(process.env.PROTEUS_AUTOMATOR_PORT ?? '9420')

type AutomatorConnect = (opts: { wsEndpoint: string }) => Promise<{
  reLaunch(path: string): Promise<{ waitFor(ms: number): Promise<void>; $(selector: string): Promise<{ text(): Promise<string> } | null> }>
  disconnect(): void
}>

const ENABLED = process.env.PROTEUS_MP_E2E === '1'

describe.skipIf(!ENABLED)('小程序 E2E 冒烟（B5，automator，需 IDE）', () => {
  it('首页加载 → 最小闭环（连接 → 路由 → 断言 → 断开）', async () => {
    const mod = (await import(AUTOMATOR_MODULE)) as { default: { connect: AutomatorConnect } }
    const mini = await mod.default.connect({ wsEndpoint: `ws://localhost:${AUTOMATOR_PORT}` })
    try {
      // 首页渲染（MP 产物：<view class="proteus-h1">Proteus</view>）
      const page = await mini.reLaunch('/pages/index/index')
      await page.waitFor(500)
      const title = await page.$('.proteus-h1')
      expect(await title?.text()).toContain('Proteus')
      // 铁律：每个用例独立运行（不依赖上一个用例的页面栈）——断开时重置
    } finally {
      mini.disconnect()
    }
  })
})
