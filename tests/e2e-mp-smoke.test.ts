// tests/e2e-mp-smoke.test.ts
// ★test-framework B5：小程序 E2E 冒烟（05-e2e-mp-automator.md）——IDE 就绪资产
// ★用 automator 官方 launch()（而非裸 connect）：内部处理 trustProject + 轮询 connect + checkVersion + 配置写入
// 运行前置（铁律：automator 必须 GUI）：
//   1. 微信开发者工具已安装（PROTEUS_IDE_CLI 或默认路径）
//   2. npm run build:mp（产物 dist/mp-weixin，含 project.config.json appid）
//   3. PROTEUS_MP_E2E=1 npx vitest run tests/e2e-mp-smoke.test.ts（CLI：proteus test e2e:mp <root> 自动装配）
// ★本机未装 IDE → 默认跳过（PROTEUS_MP_E2E 未置位）
// ⚠ 文件被根 test 排除（tests/e2e-*.test.ts 通配，与 Web E2E 平级）
import { describe, it, expect } from 'vitest'

// miniprogram-automator 动态 import（字符串变量避免编译期模块解析）
const AUTOMATOR_MODULE = 'miniprogram-automator'
// ★CLI（proteus test e2e:mp）注入：端口 / IDE CLI / 项目产物路径
const AUTOMATOR_PORT = Number(process.env.PROTEUS_AUTOMATOR_PORT ?? '9420')
const IDE_CLI = process.env.PROTEUS_IDE_CLI ?? ''
const PROJECT_PATH = process.env.PROTEUS_MINI_PROGRAM_PATH ?? 'dist/mp-weixin'

type AutomatorLaunch = (opts: {
  cliPath?: string
  projectPath: string
  trustProject?: boolean
  port?: number
  timeout?: number
}) => Promise<{
  reLaunch(path: string): Promise<{ waitFor(ms: number): Promise<void>; data(): Promise<Record<string, unknown>> }>
  disconnect(): void
}>

const ENABLED = process.env.PROTEUS_MP_E2E === '1'

describe.skipIf(!ENABLED)('小程序 E2E 冒烟（B5，automator，需 IDE）', () => {
  it(
    '首页加载 → 最小闭环（launch → 路由 → data 断言 → 断开）',
    async () => {
      const mod = (await import(AUTOMATOR_MODULE)) as { default: { launch: AutomatorLaunch } }
      // ★官方 launch：spawn IDE（auto --trust-project）+ waitUntil 轮询 connect + checkVersion
      const mini = await mod.default.launch({
        cliPath: IDE_CLI || undefined,
        projectPath: PROJECT_PATH,
        trustProject: true,
        port: AUTOMATOR_PORT,
        timeout: 60_000,
      })
      try {
        // 首页渲染（逻辑层 data 快照：title = 'Proteus'；★scoped 类名含 hash 不稳定 → 断言 data 而非选择器）
        const page = await mini.reLaunch('/pages/index/index')
        await page.waitFor(500)
        const data = await page.data()
        expect(data.title).toBe('Proteus')
        // 铁律：每个用例独立运行（不依赖上一个用例的页面栈）——断开时重置
      } finally {
        mini.disconnect()
      }
    },
    120_000,
  )
})
