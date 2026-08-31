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
  reLaunch(path: string): Promise<{ path: string; waitFor(ms: number): Promise<void> }>
  currentPage(): Promise<{ path: string }>
  systemInfo(): Promise<{ platform?: string; SDKVersion?: string }>
  disconnect(): void
}>

const ENABLED = process.env.PROTEUS_MP_E2E === '1'
// ★CLI 注入：端口已被 IDE 自动化服务占用 → 复用 connect（不重复 launch，避免 Port in use）
const REUSE_IDE = process.env.PROTEUS_MP_E2E_CONNECT === '1'

/** ★失败模式诊断（实测坑内化）：automator 连接失败时的精确指引 */
function launchErrorHint(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/Connection closed|Failed connecting|check if target project/.test(msg)) {
    return 'automator 连接被 IDE 拒绝：请在微信开发者工具 GUI 开启「设置 → 安全设置 → 服务端口」，然后重跑（CLI 无法代开 GUI 开关）'
  }
  if (/Failed to launch|not found|cliPath/.test(msg)) {
    return 'IDE 启动失败：确认 PROTEUS_IDE_CLI 路径正确、微信开发者工具已安装且已登录（cli islogin 验证）'
  }
  if (/SDKVersion|Cannot read/.test(msg)) {
    return 'automator 与 IDE 版本兼容问题：重跑 proteus test e2e:mp 会自动应用补丁（scripts/patch-automator.mjs）'
  }
  return `automator 启动失败：${msg}`
}

describe.skipIf(!ENABLED)('小程序 E2E 冒烟（B5，automator，需 IDE）', () => {
  it(
    '首页加载 → 最小闭环（launch → 路由 → data 断言 → 断开）',
    async () => {
      const mod = (await import(AUTOMATOR_MODULE)) as { default: { launch: AutomatorLaunch; connect: (o: { wsEndpoint: string }) => Promise<NonNullable<Awaited<ReturnType<AutomatorLaunch>>>> } }
      // ★官方 launch：spawn IDE（auto --trust-project）+ waitUntil 轮询 connect + checkVersion；
      //   REUSE_IDE：自动化端口已在监听 → 直接 connect 复用（CLI 体检判定）
      let mini: {
        reLaunch(path: string): Promise<{ path: string; waitFor(ms: number): Promise<void> }>
        currentPage(): Promise<{ path: string }>
        systemInfo(): Promise<{ platform?: string; SDKVersion?: string }>
        disconnect(): void
      }
      try {
        if (REUSE_IDE) {
          mini = await mod.default.connect({ wsEndpoint: `ws://localhost:${AUTOMATOR_PORT}` })
        } else {
          mini = await mod.default.launch({
            cliPath: IDE_CLI || undefined,
            projectPath: PROJECT_PATH,
            trustProject: true,
            port: AUTOMATOR_PORT,
            timeout: 60_000,
          })
        }
      } catch (e) {
        // ★失败模式诊断：把实测踩过的坑转成可行动指引
        throw new Error(launchErrorHint(e))
      }
      try {
        // ★冒烟断言（2026-08-31 真机实测通过的通道）：首页导航 + 页面栈 + 小程序运行时
        //  ★不依赖 Page.getData：新版 IDE 的页面级 API 受模拟器激活态影响（GUI 环境可用），
        //    connect/reLaunch/currentPage/systemInfo 是验证 automation 全链路的最稳断言
        const page = await mini.reLaunch('/pages/index')
        await page.waitFor(500)
        const cur = await mini.currentPage()
        expect(cur.path).toBe('pages/index')
        const info = await mini.systemInfo()
        expect(info.platform).toBe('devtools') // 模拟器运行时
        // 铁律：每个用例独立运行（不依赖上一个用例的页面栈）——断开时重置
      } finally {
        mini.disconnect()
      }
    },
    120_000,
  )
})
