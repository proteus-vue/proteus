# M5 · 小程序 E2E（miniprogram-automator）

## 澄清
**miniprogram-automator 就是"小程序官方自动化测试 SDK"**——通过 WebSocket 驱动真实小程序运行时。
配套：miniprogram-ci（上传/打包）+ devtools `--auto`（启动 IDE + 远程调试端口）。

## 前置：启动 IDE

```bash
"/Applications/wechatwebdevtools.app/Contents/MacOS/cli" auto \
  --project "/abs/path/dist/mp" \
  --auto-port 9420
```

## 用例

```ts
import automator from 'miniprogram-automator'

let mini

beforeAll(async () => {
  mini = await automator.connect({ wsEndpoint: 'ws://localhost:9420' })
})

it('首页加载并跳转搜索', async () => {
  const page = await mini.redirectTo('/pages/index/index')
  await page.waitFor(300)
  const text = await page.$('view.title')!.text()
  expect(text).toBe('Proteus Music')
})

afterAll(() => mini.disconnect())
```

## 常用 API
- `mini.redirectTo` / `navigateTo` — 路由
- `page.$` / `page.$$` — 选择器（仅类小程序语法）
- `page.callMethod` — 调用页面方法
- `page.data` — 取 data 快照
- `page.waitFor` — 等待

## ⚠️ 硬伤：需要 GUI 环境
automator **不能 headless**，必须启动微信开发者工具。

### CI 降级策略（§08 详述，此处仅骨架）
- **本地 + 专用 Mac runner** 跑 automator E2E
- **CI 通用节点**：只跑 L1-L3 + 编译快照，**跳过 L4 小程序**
- CI 流水线：
  ```
  vitest (L1-L3 + 快照)  →  playwright (Web E2E)  →  [Mac runner] automator
  ```
- 官方云测（MP 云端真机）作为可选后端，接入方式 §08 占位

## 铁律
- 小程序 E2E **只用 automator**，禁止自己 WebSocket 协议
- 用例文件放 `e2e/mp/`，与 Web E2E 平级
- 每个用例必须可独立运行（不依赖上一个用例的页面栈）

## ⚠ 已知限制（2026-08-31 真机实测，2.01.2510260）

**miniprogram-automator 0.12.1 与新版微信开发者工具（2.01.x）实际兼容**（examples 全链路跑通：connect/reLaunch/currentPage/systemInfo ✓）：

| 项 | 结论 |
|---|---|
| automation 端口 | `--auto-port 9420` 仍有效（automation WS 监听该端口；★仅 IPv6 监听（lsof `*:9420`）→ 框架端口探测已双栈（IPv4+IPv6，2026-08-31 真机踩坑））；IDE server 端口是另一个，动态 |
| `Tool.getInfo.SDKVersion` | 返回（项目就绪后；未就绪时为空 → automator checkVersion 崩 → 框架 patch 容错） |
| `Page.getData` / `page.$` | **受模拟器页面激活态影响**（GUI 未激活页面时报 not on top / `$` 查询挂起无响应）→ 断言改用 connect/reLaunch/currentPage/systemInfo/evaluate（全链路最稳通道）；**★框架已加查询超时诊断**（MpElement 单次查询 3s 有界——$ 挂起时快速失败并提示「激活模拟器/改稳通道」，不再静默拖死用例） |
| `mini.screenshot` | **当前 IDE 挂起**（协议/激活态限制，B5 未验证能力）→ TestDriver 截图断言 MP 端跳过（web 正常） |
| `mini.evaluate` | 正常（★必须传**函数**——automator 内部 `fn.toString()` 序列化；传字符串原样下发导致运行时无响应挂起；带参函数正常） |
| 端口复用 | 已运行 IDE 的 automation 端口被占 → CLI 自动转 connect 复用（不重复 launch） |

**framework 内化**（`proteus test e2e:mp`）：
- IDE 路径可配置（PROTEUS_IDE_CLI / --ide / 平台默认探测）
- 环境体检（appid 有效性 / 产物 / 端口占用一次性报告，占位 appid 直接 error）
- 产物独立副本（.proteus/e2e-mp，避 IDE 路径缓存 + 不污染 dist）
- automator SDKVersion 幂等补丁（scripts/patch-automator.mjs，CLI 自动执行；★单行文件禁用 // 注释 MARK——会吞整行代码）
- 失败模式诊断（连接拒绝 → 提示 GUI「设置 → 安全设置 → 服务端口」）
- **端口复用**（automation 端口被占 → connect 模式）+ **双栈端口探测**（IPv4/IPv6）
- **元素查询超时诊断**（MpElement：automator `$` 挂起 → 3s 有界快速失败 + 激活态/稳通道提示）
- **debugger 适配装配**（`--debugger <module>`：MpDebuggerLike 注入 console/network/clearCache/refresh——wechatide 工具能力）
- **TestDriver MP 适配**（决策 #205）：稳通道（reLaunch/currentPage/systemInfo/evaluate）已验证跑通；元素层（$）与截图标注激活态/协议边界（web 端完整可用）

**examples 实测**：`proteus test e2e:mp examples --port 9420 --ide <cli>` 全链路 EXIT=0（体检 → 副本 → 补丁 → connect → TestDriver runSharedSmoke 稳通道 + evaluate 页面 data 断言）。

## debugger 适配装配（--debugger <module>，决策 #209）

console/network/clearCache/refresh 是 **wechatide 工具能力**（automator 无 API）→ CLI 支持注入 MpDebuggerLike 适配模块：

```bash
proteus test e2e:mp examples --ide <cli> --debugger ./e2e/mp-debugger.ts
```

适配模块导出 `default`（MpDebuggerLike 形状）或 `createMpDebugger()`（spec 动态 import 装配；模块导出 default 优先）：

```ts
// e2e/mp-debugger.ts —— MpDebuggerLike 示例适配
import type { MpDebuggerLike } from '@proteus-vue/test-core/driver'
import { execFileSync } from 'node:child_process'

export default {
  // wechatide 工具：get_simulator_console --command '<grep>'
  async consoleGrep(command: string): Promise<string[]> {
    return runWechatide('get_simulator_console', command)
  },
  async networkGrep(command: string): Promise<string[]> {
    return runWechatide('get_simulator_network', command)
  },
  async clearCache(): Promise<void> {
    // wechatide debug_clear_cache；或运行时 wx.clearStorageSync（evaluate 通道）
  },
  async refresh(): Promise<void> {
    // wechatide simulator_refresh（重新编译当前页）
  },
} satisfies MpDebuggerLike
```

未注入 `--debugger` 时，`driver.consoleLogs()` 等调用抛错提示「注入 wechatide debugger 句柄」（接口就位、句柄可插拔）。

## 统一 driver 适配（决策 #205）

```ts
import { createDriver } from '@proteus-vue/test-core/driver'

// ★注入 automator miniProgram → TestDriver（launch/connect 由 CLI：proteus test e2e:mp 装配）
const driver = createDriver({ platform: 'mp', mini })
await driver.reLaunch('/pages/index')
const btn = driver.element('button')
await btn.waitFor()
await btn.tap()
const cur = await driver.currentPage()
expect(cur.path).toBe('pages/index')
```

- ★经验内化：元素每次操作重新解析（currentPage().$()，导航后失效重查）；reLaunch 全链路最稳通道（不依赖模拟器激活态）；back 用 wx.navigateBack 降级
- 同一份用例代码经 `createDriver({ platform: 'mp' })` / `({ platform: 'web' })` 双端复用（§06）
- App 端为 TestDriver 第三实现预留（§09）

---
