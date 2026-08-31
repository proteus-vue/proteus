---
name: proteus-test
version: 0.1.0
description: >-
  Proteus 跨端自动化测试框架：L1-L3 单测/编译快照/组件 + L4 Web E2E（Playwright）/ 小程序 E2E（automator 真机）
  + TestDriver 统一测试 API（一套能力接口多端自动化）。当项目是 Proteus 框架工程（package.json 含
  @proteus-vue 依赖或 scripts 含 proteus test），用户提到写测试、跑测试、跨端测试断言、TestDriver、
  mock wx、自动化测试时使用。不负责业务功能开发与发布流程。
---

# proteus-test

## 用途

在 Proteus 框架工程内做确定性测试：跑既有套件、写新用例、诊断失败。**跨端（Web/小程序）同一份用例代码**是核心形态。

## 运行前检查（必须）

1. **Node ≥22.12**：`require(ESM)` 支持。Node 18/20 下 web/jsdom 测试加载失败属环境差异非代码问题。命令前缀：
   `PATH="/path/to/node/v22.x.x/bin:$PATH" <cmd>`
2. 确认工程根：含 `proteus.config.ts` / `packages/`（monorepo）或 `src/` + `proteus` scripts。
3. MP E2E（真机）前置门禁（缺一不可）：**真实 appid**（wx+16 位十六进制，占位 `wx0000000000`/touristappid 无效）· `npm run build:mp` 产物 · 微信开发者工具（`--ide <cli>` 或 `PROTEUS_IDE_CLI`）· GUI「设置 → 安全设置 → 服务端口」已开。

## 意图 → 命令

| 意图 | 命令 | 说明 |
|------|------|------|
| L1-L3 单测 + 编译快照 + 组件 | `npm test` 或 `npx proteus test` | vitest；`tests/e2e-*.test.ts` 被排除（E2E 显式触发） |
| 单测更新快照 | `npm run test:update` | 快照进 git，CI 不自动更新 |
| Web E2E（Chromium） | `npm run test:e2e:web` | 先 `npm run build:web`，preview 产物；含路由/渲染 + 关键路径 data-testid |
| 小程序 E2E（真机） | `npx proteus test e2e:mp <root> --ide <cli> [--port 9420] [--debugger <module>]` | 自动体检/副本/补丁/端口复用；`--debugger` 注入 console/network 句柄 |
| 六域全量门禁 | `npx proteus audit all` | route/module/config/i18n/capabilities/components；预算 12s |
| 配置/规范检查 | `npx proteus check <root>` | 四域（appid 等）；capabilities 域扫 `wx.*` 业务直连违规 |
| 跨端统一测试 API | TestDriver（见 references/testdriver-api.md） | `@proteus-vue/test-core/driver`：createDriver + 能力接口 |

## 写用例工作流

1. **单测/组件**（`tests/*.test.ts`）：组件层统一挂载 `mountComponent(sfc, { platform: 'web'|'mp' })` + `stateOf/textOf/tap` 跨端复用断言（文件头 `// @vitest-environment happy-dom`——esbuild TextEncoder 检查）。小程序逻辑层用 `mountMpComponent`（`{ instance, wxml, js, context, config }`）。
2. **跨端 E2E**（`tests/e2e-*.test.ts`，被根 test 排除，显式跑）：`createDriver({ platform, page/mini })` → 同一份用例代码双端跑（模式见 references/cross-platform-cases.md）。
3. **跑**：先 `npm test` 相关文件 → 再 Web E2E → MP E2E（真机，见 references/mp-e2e-guide.md）。

## 失败快表

| 症状 | 根因/处理 |
|------|----------|
| web 单测加载崩（TextEncoder instanceof） | 测试文件环境不是 happy-dom → 加 `// @vitest-environment happy-dom` |
| MP E2E `Connection closed` | GUI「设置 → 安全设置 → 服务端口」未开（CLI 无法代开） |
| MP E2E `Failed to launch` | IDE 登录过期（`cli islogin`，GUI 重登）/ cliPath 错误 |
| MP E2E `SDKVersion/Cannot read` | 补丁未应用 → 重跑 CLI（自动 patch） |
| MP 元素查询超时（3s） | 模拟器未激活（`page.$` 挂起）→ 激活模拟器或改稳通道（currentPage/systemInfo/evaluate） |
| `proteus test e2e:mp` 报 appid 无效 | 占位 appid → `proteus.config.ts` 配真实 wx+16 hex 后重 `build:mp` |

完整坑位 → references/pitfalls.md；MP 诊断细节 → references/mp-e2e-guide.md。

## 参考

- CLI 命令与参数：[references/cli-commands.md](references/cli-commands.md)
- TestDriver 统一测试 API（全部能力接口）：[references/testdriver-api.md](references/testdriver-api.md)
- 跨端用例编写（06 铁律 + 共享用例模式）：[references/cross-platform-cases.md](references/cross-platform-cases.md)
- 小程序 E2E 真机指南（前置/流程/诊断）：[references/mp-e2e-guide.md](references/mp-e2e-guide.md)
- 环境坑合集（Node/happy-dom/evaluate/端口双栈/时序）：[references/pitfalls.md](references/pitfalls.md)
