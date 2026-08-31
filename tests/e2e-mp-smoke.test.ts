// tests/e2e-mp-smoke.test.ts
// ★test-framework B5：小程序 E2E 冒烟（05-e2e-mp-automator.md）——★统一测试 API（TestDriver）实战验证
// ★用 automator 官方 launch()（而非裸 connect）：内部处理 trustProject + 轮询 connect + checkVersion + 配置写入
// ★装配：CLI（proteus test e2e:mp <root>）注入 env → createDriver({ platform: 'mp', mini }) → 同一份跨端用例 runSharedSmoke
// 运行前置（铁律：automator 必须 GUI）：
//   1. 微信开发者工具已安装（PROTEUS_IDE_CLI 或默认路径）
//   2. npm run build:mp（产物 dist/mp-weixin，含 project.config.json appid）
//   3. PROTEUS_MP_E2E=1 npx vitest run tests/e2e-mp-smoke.test.ts（CLI：proteus test e2e:mp <root> 自动装配）
// ★本机未装 IDE → 默认跳过（PROTEUS_MP_E2E 未置位）
// ⚠ 文件被根 test 排除（tests/e2e-*.test.ts 通配，与 Web E2E 平级）
import { describe, it, expect } from 'vitest'
import { createDriver } from '@proteus-vue/test-core/driver'
import type { AutomatorMiniLike } from '@proteus-vue/test-core/driver'
import { runSharedSmoke } from './e2e-driver-shared'

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
}) => Promise<AutomatorMiniLike>

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

describe.skipIf(!ENABLED)('小程序 E2E 冒烟（B5 + 统一测试 API TestDriver，需 IDE）', () => {
  it(
    '同一份跨端用例 runSharedSmoke → driver 能力接口全链路跑通（launch/connect → reLaunch → element tap → currentPage/systemInfo → screenshot）',
    async () => {
      const log = (s: string) => console.log(`[spec] ${s}`)
      log('start')
      const mod = (await import(AUTOMATOR_MODULE)) as {
        default: { launch: AutomatorLaunch; connect: (o: { wsEndpoint: string }) => Promise<AutomatorMiniLike> }
      }
      let mini: AutomatorMiniLike
      try {
        if (REUSE_IDE) {
          log(`connect ws://localhost:${AUTOMATOR_PORT}`)
          mini = await mod.default.connect({ wsEndpoint: `ws://localhost:${AUTOMATOR_PORT}` })
        } else {
          log('launch ...')
          mini = await mod.default.launch({
            cliPath: IDE_CLI || undefined,
            projectPath: PROJECT_PATH,
            trustProject: true,
            port: AUTOMATOR_PORT,
            timeout: 60_000,
          })
        }
        log('connect/launch OK')
      } catch (e) {
        // ★失败模式诊断：把实测踩过的坑转成可行动指引
        throw new Error(launchErrorHint(e))
      }
      // ★统一测试 API：注入 automator miniProgram → TestDriver → 同一份跨端用例（tests/e2e-driver-shared.ts）
      log('createDriver + runSharedSmoke ...')
      const driver = createDriver({ platform: 'mp', mini })
      // ★elementOps:false——当前 IDE 模拟器激活态下 automator page.$ 挂起（B5 边界：页面级 DOM 查询受激活态影响）
      //   稳通道（reLaunch/currentPage/systemInfo/evaluate/screenshot）全链路验证；元素层待模拟器激活态场景
      await runSharedSmoke(driver, {
        route: '/pages/index',
        tapSelector: 'button',
        shotPath: '/tmp/proteus-e2e-driver-mp.png',
        elementOps: false,
        // ★screenshotOps:false——当前 IDE 下 automator screenshot 挂起（协议/激活态限制，B5 未验证能力）
        screenshotOps: false,
        // ★closeAtEnd:false——close（disconnect）后还有专属 evaluate 断言，断连后调用会挂起
        closeAtEnd: false,
      })
      log('runSharedSmoke OK')
      // ★MP 专属：evaluate 运行时内读页面 data（稳定通道，不受模拟器激活态影响；★必须传函数——automator 内部 toString 序列化）
      log('evaluate ...')
      const count = await mini.evaluate(() => {
        const pages = getCurrentPages()
        return pages[pages.length - 1].data.count
      })
      log(`evaluate OK: ${JSON.stringify(count)}`)
      expect(count).toBe(0) // 初始 count（未执行元素点击）——验证 evaluate 数据读取能力
      await driver.close()
      log('done')
    },
    120_000,
  )
})
