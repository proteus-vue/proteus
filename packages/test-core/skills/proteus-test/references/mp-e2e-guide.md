# 小程序 E2E 真机指南（proteus test e2e:mp）

## ★执行链路铁律（违反 = 违规操作）

**每进入一个页面，第一动作 = 抓 console 运行日志做零报错门禁；门禁绿后才允许抓元素/断言。**
完整链路定义见框架 plan **15-mp-e2e-console-gate.md**（本文件是它的速查版）。

```
0 环境门禁（wechatide CLI + 登录 + 授权）
1 开窗编译（open_project_window --window-mode fullMode → simulator_open_page <页>）
2 ★console 零错门禁（get_simulator_console grep error）——红即停，先修产物，严禁越步
3 运行时确认（automation_runtime_info currentPage）
4 data 就绪断言（automation_evaluate 读 page data——最稳通道）
5 元素断言（querySelectorAll → text/attribute → tap）
6 交互回读（evaluate 再读 data）
7 截图取证 + 复位
```

> 反面教材（2026-09-07）：页面白屏（onLoad ReferenceError: buildPermissionManifest is not defined）仍去抓元素——
> 无规范乱跑浪费轮次。规范动作：进页 → console 门禁立即红 → 定位产物丢 require（plugin 跨行 import 漏扫）→ 修 → 重编 → 绿 → 才继续。

## 前置门禁（缺一不可）

| 项 | 要求 | 缺失表现 |
|----|------|----------|
| 真实 appid | `proteus.config.ts` 配 wx+16 位十六进制（占位 `wx0000000000`/touristappid 无效） | 体检 ✗ appid error；IDE `gettestpublib 41002 appid missing` |
| 构建产物 | `npm run build:mp`（`dist/mp-weixin` 含 project.config.json） | 体检 ✗ build-output；无项目可开 |
| Electron 版 IDE | wechatide CLI（新版 Electron 重构版，非旧 NWJS） | `wechatide` 命令不可用 → 确认安装路径 |
| 授权 | 首次 `wechatide -c <client> <tool>` 触发 auth，轮询 `polling_task_result` 至 `authorization_success` | 用户拒绝 → 停 |

## CLI 全链路（自动）

```
npx proteus test e2e:mp examples --port 9420 --ide <cli> [--debugger <module>]
```

1. **体检**（一次性报告）：ide-cli / build-output / appid / automator-port（占用 → warn 不阻断）
2. **产物副本**：`dist/mp-weixin` → `.proteus/e2e-mp`（每次重建——避 IDE 按路径缓存旧 project.config.json）
3. **补丁**：`scripts/patch-automator.mjs` 幂等（automator 0.12.1 与新版 IDE 的 SDKVersion 缺失兼容）
4. **launch / connect 复用**：端口被占（已运行 IDE 的 automation）→ 自动 connect 复用（`PROTEUS_MP_E2E_CONNECT=1`）
5. **spec**：`tests/e2e-mp-smoke.test.ts`——TestDriver 稳通道断言（reLaunch → currentPage/systemInfo → evaluate 页面 data）

## 诊断表（实测坑内化）

| 症状 | 根因 | 处理 |
|------|------|------|
| `Connection closed` / `Failed connecting` | 服务端口未开 / 目标项目窗口未开 | GUI 开服务端口；确认项目窗口 |
| `Failed to launch ... cliPath` | IDE 登录过期（code 10）/ cliPath 错误 | `cli islogin`；GUI 重登；核对 `--ide` |
| `SDKVersion` / `Cannot read ... split` | automator 0.12.1 与 IDE checkVersion | 重跑 CLI（自动 patch；`scripts/patch-automator.mjs`） |
| `Port 9420 is in use` | 残留 IDE daemon 占用 | CLI 自动转 connect 复用；或 `pkill -f wechatwebdevtools.app` 后换端口 |
| 元素查询超时（3s 诊断） | 模拟器未激活（`page.$` 挂起） | 激活模拟器窗口；或改稳通道断言 |
| 新版 IDE automation 连不上 | automator 0.12.1 与新 IDE automation WS 协议不兼容（端口不可发现） | 用兼容版本 IDE；官方 SDK 跟进责任 |

## 边界（05 文档已知限制表）

- `page.$`/`getElement`：受模拟器激活态影响（挂起/not on top）→ 稳通道断言
- `screenshot`：当前 IDE 下挂起（协议/激活态）→ MP spec 跳过截图断言
- `evaluate`：必须传**函数**（automator `toString()` 序列化；传字符串运行时无响应挂起）
- automation 端口：只监听 IPv6（`*:9420`）→ 框架端口探测已双栈（IPv4+IPv6）

## debugger 适配模块（--debugger）

console/network/clearCache/refresh 是 **wechatide 工具能力**（automator 无 API）→ 可插拔注入：

```ts
// e2e/mp-debugger.ts —— 导出 default（MpDebuggerLike）或 createMpDebugger()
import type { MpDebuggerLike } from '@proteus-vue/test-core/driver'
export default {
  async consoleGrep(command: string): Promise<string[]> { /* wechatide get_simulator_console */ },
  async networkGrep(command: string): Promise<string[]> { /* wechatide get_simulator_network */ },
  async clearCache(): Promise<void> { /* wechatide debug_clear_cache / wx.clearStorageSync */ },
  async refresh(): Promise<void> { /* wechatide simulator_refresh */ },
} satisfies MpDebuggerLike
```

未注入时 `driver.consoleLogs()` 等抛错提示「注入 wechatide debugger 句柄」。
