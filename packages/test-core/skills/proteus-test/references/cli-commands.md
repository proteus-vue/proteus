# CLI 命令参考（proteus test-framework）

## Node 版本门禁

`require(ESM)` 需要 Node ≥22.12。Node 18/20 下 web/jsdom 测试加载失败属环境差异（非代码问题）。
统一命令前缀：`PATH="/path/to/node/v22.x.x/bin:$PATH" <cmd>`

## 测试命令

| 命令 | 作用 | 备注 |
|------|------|------|
| `npm test` / `npx proteus test` | L1-L3 单测 + 编译快照 + 组件 | `--exclude "tests/e2e-*.test.ts"`（E2E 显式触发） |
| `npm run test:update` | 更新快照 | 快照进 git；CI 不自动更新 |
| `npm run test:e2e:web` | Web E2E 全套（Chromium） | 内部先 `build:web`；preview 产物（`examples/dist/web`）；双文件串行 |
| `npx proteus test e2e:mp <root> [--ide <cli>] [--port <n>] [--debugger <module>]` | 小程序 E2E 真机 | 全链路：体检 → 副本 → 补丁 → launch/connect → spec |
| `npx proteus audit all` | 六域门禁 | route/module/config/i18n/capabilities/components；预算 12s 超时阻断 |
| `npx proteus check <root>` | 四域规范检查 | capabilities 域扫业务 `wx.*` 直连（B5 平台规范门禁） |
| `npx proteus health <root>` | **工程/环境健康检查** | Node 版本 / 结构 / 依赖 / 产物 / appid / pagesDir / workspace 链接 / IDE——一次性诊断（✅/⚠/✗，error 阻断） |

## e2e:mp 参数

| 参数 | 说明 |
|------|------|
| `<root>`（位置参数） | 项目根（产物 `dist/mp-weixin` 相对该目录） |
| `--ide <cli>` | 微信开发者工具 CLI 路径；缺省 `PROTEUS_IDE_CLI` → 平台默认路径探测 |
| `--port <n>` | automator 端口（缺省 9420）；被占 → 自动转 connect 复用 |
| `--debugger <module>` | MpDebuggerLike 适配模块（console/network/clearCache/refresh 注入）；仅 e2e:mp |

## 环境变量（CLI 装配）

| 变量 | 用途 |
|------|------|
| `PROTEUS_IDE_CLI` | IDE CLI 路径（`--ide` 优先） |
| `PROTEUS_AUTOMATOR_PORT` | automator 端口（spec 读） |
| `PROTEUS_MINI_PROGRAM_PATH` | 产物副本路径（spec 读；CLI 自动生成 `.proteus/e2e-mp`） |
| `PROTEUS_MP_E2E=1` | 启用 MP E2E spec（未置位 → describe.skipIf 跳过） |
| `PROTEUS_MP_E2E_CONNECT=1` | 端口复用 connect 模式（不重复 launch） |
| `PROTEUS_MP_DEBUGGER_MODULE` | debugger 适配模块（`--debugger` 注入） |

## 测试文件命名

- 单测/组件：`tests/*.test.ts`（根 `npm test` 覆盖）
- Web E2E：`tests/e2e-*.test.ts`（**被根 test 排除**，`test:e2e:web` 显式跑）
- 跨端共享用例：`tests/e2e-driver-shared.ts`（非 test 文件，两端 spec import）
- 组件层统一挂载用例：文件头必须 `// @vitest-environment happy-dom`（esbuild TextEncoder instanceof 检查在 jsdom 崩）
