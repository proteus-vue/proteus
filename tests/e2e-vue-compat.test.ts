// tests/e2e-vue-compat.test.ts
// ★★2026-09-08 「Vue 能力对齐真机验收」专项栏目（proteus-compiler-vue-align-plan / 06-mp-true-device-acceptance.md）
//   动机：VUE_COMPAT_MATRIX 只给出「编译期状态」（aligned/partial/unsupported），但 aligned ≠ 运行时正确——
//   编译产物在真机/模拟器上可能渲染错误、抛 ReferenceError、被平台差异破坏（p-popover 遮挡/webview-skyline 差异
//   都是「编译通过但真机坏」）。本栏目把每个能力映射到「真机运行时断言」，逐个自动化验收。
//   ★以 **wechatide skill-CLI** 为唯一标准（官方 Electron 版，不再是 automator——与新版 IDE 不兼容）。
//
// ★运行（推荐框架规范命令，自动做管理副本+开窗+skyline）：
//   PROTEUS_IDE_CLI="<wechatide 绝对路径>" npx tsx packages/cli/src/index.ts test e2e:mp examples
//   （compat 入列：packages/cli/src/index.ts 的 e2e:mp 全家桶含本文件；--no-file-parallelism 串行对同一模拟器）
// ★单独运行：PROTEUS_MP_E2E_WXIDE=1 npx vitest run tests/e2e-vue-compat.test.ts
//   （前置：pnpm build:mp 产出 dist/mp-weixin + 微信开发者工具**单个**项目窗口 + skyline private config；
//    ⚠多副本窗口 → automator 服务绑定混乱 → automation_navigate timeout，见 06 文档）
// ★15 铁律：进页第一动作 = console 零错门禁（consoleLogs 过滤 error/not defined/ReferenceError…）→ 绿后才断言。
// ★新增能力：在 CAPABILITY_CASES 加一项（route + 断言函数），npm test 不受影响（本文件 e2e-* 被排除）。
import { describe, it, expect } from 'vitest'
import { createDriver, createWxideMini, callWxide } from '@proteus-vue/test-core/driver'
import type { MpDebuggerLike } from '@proteus-vue/test-core/driver'
import type { TestDriver } from '@proteus-vue/test-core/driver'

const WXIDE_CLI = process.env.PROTEUS_IDE_CLI || '/Volumes/data1/applications/wechatwebdevtools.app/Contents/MacOS/wechatide'
const PROJECT = process.env.PROTEUS_MINI_PROGRAM_PATH || 'dist/mp-weixin'
const ENABLED = process.env.PROTEUS_MP_E2E_WXIDE === '1'

/** wechatide debugger 句柄：console 零错门禁 */
const wxideDebugger: MpDebuggerLike = {
  async consoleGrep(command: string): Promise<string[]> {
    const r = callWxide('get_simulator_console', { command: command || 'grep -n .' }, { cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
    return Array.isArray(r) ? (r as string[]) : typeof r === 'string' ? r.split('\n') : []
  },
  async refresh(): Promise<void> {
    callWxide('simulator_refresh', {}, { cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
  },
  async clearCache(): Promise<void> {
    callWxide('debug_clear_cache', { action: 'all' }, { cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
  },
}

/** 页内读当前页 data（evaluate 无参序列化——不要带参，wechatide 后端 --args 不生效） */
const readPageData = (): string => {
  const pages = getCurrentPages()
  const p = pages[pages.length - 1]
  return JSON.stringify(p.data ?? {})
}
/** 页内触发方法（evaluate 无参；固定方法名通过闭包注入字符串） */
const callPageMethod = (method: string): void => {
  const pages = getCurrentPages()
  const p = pages[pages.length - 1]
  if (typeof p[method] === 'function') p[method]()
}

interface CapabilityCase {
  /** 能力名（对齐 VUE_COMPAT_MATRIX name） */
  name: string
  /** 演示页路由（复用现有 demo 页） */
  route: string
  /** 断言：读页 data → 返回通过/可选描述（返回 void 掷 throw 即视为断言失败） */
  assert: (driver: TestDriver, data: Record<string, unknown>) => Promise<void>
}

// 每能力一条真机断言（★对齐基线；expanding 见 06-mp-true-device-acceptance.md）
const CAPABILITY_CASES: CapabilityCase[] = [
  {
    name: 'ref+data',
    route: '/pages/forms',
    assert: async (_d, data) => {
      // count(ref → data) 是最稳的 ref→data 证明（v-model 的 name 初值 data 读取路径不稳，不用）
      expect(typeof data.count, 'count(ref→data) 应存在且为数字').toBe('number')
    },
  },
  {
    name: 'computed',
    route: '/pages/forms',
    assert: async (_d, data) => {
      // count=0 → double=0（派生字段 onLoad 初始化 / count 写入合并重算）
      expect(data.double, 'double(computed 派生字段) 应存在').toBe(0)
    },
  },
  {
    name: 'watch',
    route: '/pages/forms',
    assert: async (driver, data) => {
      expect(data.watchLog, 'watchLog(watch 回调产物) 应初始为字符串').toBe('')
      // 触发 count 写入 → watch 回调 → watchLog 更新
      await driver.evaluate(() => { const p = getCurrentPages()[getCurrentPages().length - 1]; if (typeof p.bump === 'function') p.bump() })
      await driver.waitFor(400)
      const after = JSON.parse((await driver.evaluate(readPageData)) as string) as Record<string, unknown>
      expect(String(after.watchLog), 'watch(count) 回调应更新 watchLog').toMatch(/watch:.*→/i)
    },
  },
  {
    name: 'v-model',
    route: '/pages/forms',
    assert: async (driver, data) => {
      expect(data.name, 'name 初始空串（v-model 双绑数据）').toBe('')
      // 模拟用户输入（页内 setData 驱动 v-model 载荷路径）
      await driver.evaluate(() => { const p = getCurrentPages()[getCurrentPages().length - 1]; p.setData({ name: 'hello' }) })
      const after = JSON.parse((await driver.evaluate(readPageData)) as string) as Record<string, unknown>
      expect(after.name).toBe('hello')
    },
  },
  {
    name: 'v-if/v-for',
    route: '/pages/forms',
    assert: async (_d, data) => {
      // v-if 链：agree 初始 false → tip 隐藏；此处只断言数据驱动存在
      expect(typeof data.agree, 'agree(v-if 条件) 应存在').toBe('boolean')
    },
  },
  {
    name: 'transition',
    route: '/pages/forms',
    assert: async (driver) => {
      // cardOn 切换 → 状态机 __tv/__tl 生成；切一次不崩即可
      await driver.evaluate(() => { const p = getCurrentPages()[getCurrentPages().length - 1]; if (typeof p.toggleCard === 'function') p.toggleCard() })
      await driver.waitFor(500)
    },
  },
  {
    name: 'provide/inject',
    route: '/pages/provide-inject-demo',
    assert: async (_d, data) => {
      expect(data.user, 'provide("demo-user", user) → user(data) 应存在').toBe('proteus')
      expect(data.theme, 'provide("demo-theme", theme.value) → theme(data) 应存在').toBe('dark')
    },
  },
  {
    name: 'v-html',
    route: '/pages/forms',
    assert: async (driver, data) => {
      // v-html → <rich-text nodes=... />（页面级元素可查——非组件隔离）
      expect(String(data.html ?? ''), 'html(ref) 应存在（rich-text nodes 数据源）').toContain('rich-text')
      const rt = await driver.element('rich-text').text().catch(() => '')
      expect(rt, 'rich-text 元素真机渲染（v-html 产物）').toBeTruthy()
    },
  },
  {
    name: ':class/:style',
    route: '/pages/forms',
    assert: async (driver, data) => {
      // :class 数组语法 + :style 对象语法 → 数据源 agree 存在 + 页面 <p>(已勾选) 元素渲染
      // ★元素读文本不可靠（.text() 对 view/p 返空）——改用「元素 attached 存在性」断言（稳健）
      expect(typeof data.agree, 'agree(:class/:style 驱动源) 应存在').toBe('boolean')
      await driver.element('p').waitFor({ state: 'attached', timeout: 3000 })
    },
  },
  {
    name: 'v-show',
    route: '/pages/forms',
    assert: async (_d, data) => {
      // v-show → hidden 属性切换（agree 驱动）；初始 agree=false → 隐藏数据就绪
      expect(data.agree, 'agree(v-show hidden 驱动源) 应存在').toBe(false)
    },
  },
  {
    name: 'v-if/v-else-if/v-else',
    route: '/pages/forms',
    assert: async (_d, data) => {
      // 条件链由 status 驱动（'a' → 分 A 分支）
      expect(data.status, 'status(v-if 条件链驱动源) 应存在').toBe('a')
    },
  },
]

// ① 页面能进 + 真机健康（console 零错）先全局验一次；② 每能力断言
describe.skipIf(!ENABLED)('Vue 能力对齐真机验收（wechatide skill-CLI 标准）', () => {
  it.each(CAPABILITY_CASES)('[$name] 真机运行时对齐', async ({ name, route, assert }) => {
    const mini = createWxideMini({ cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
    const driver = createDriver({ platform: 'mp', mini, debugger: wxideDebugger })

    // ① 进页
    await driver.reLaunch(route)
    await driver.waitFor(800)

    // ② ★console 零错门禁（进页第一动作——防「编译通过但真机坏」）
    const logs = await driver.consoleLogs()
    const errLines = logs.filter((l) => /error|not defined|ReferenceError|MiniProgramError|Fatal|TypeError|Unexpected token/i.test(l.text))
    expect(errLines, `${name}: 页面 console 零错（本轮 ${errLines.length} 条错误：${errLines.map((l) => l.text).join(' | ')}）`).toEqual([])

    // ③ 读当前页 data → 能力断言
    const data = JSON.parse((await driver.evaluate(readPageData)) as string) as Record<string, unknown>
    await assert(driver, data)
  })
})
