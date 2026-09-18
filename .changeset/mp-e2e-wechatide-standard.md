---
'@proteus-vue/cli': minor
'@proteus-vue/test-core': minor
---

MP E2E 后端迁移：miniprogram-automator → wechatide skill-CLI（官方 Electron 版唯一标准）

- **起因**：`miniprogram-automator@0.12.1` 与新版 Electron 版微信开发者工具的 automation WS 协议/端口不可发现不兼容（`proteus test e2e:mp` launch 报 `Failed to launch ... http port is open`，服务端口一直开着也连不上）。
- **`@proteus-vue/test-core`**：新增 `@proteus-vue/test-core/driver` 的 `createWxideMini`（实现 `AutomatorMiniLike`，内部 spawn `wechatide -c <client> <tool> --project` + 解析嵌套 JSON）与 `callWxide`；`createMpDriver` 无缝复用。`waitFor` 改烘字面量无参函数（wechatide `automation_evaluate` 只认裸函数源码，不支持带参/IIFE）。
- **`@proteus-vue/cli`**：`proteus test e2e:mp` 改为 wechatide 装配——`open_project_window`（fullMode）+ skyline render config + 设 `PROTEUS_MP_E2E_WXIDE=1` 让 spec 走 `createWxideMini`；不再打 automator 兼容补丁 / 不 launch automator。
- **兼容**：`tests/e2e-mp-smoke.test.ts` 加 `WXIDE_ENABLED` 分支——设 `PROTEUS_MP_E2E_WXIDE=1` 走 wechatide，否则保留 automator（向后兼容）。
- 工具映射：`automation_navigate`（reLaunch/back）、`automation_runtime_info`（currentPage/systemInfo）、`automation_evaluate`、`automation_element_action`、`get_simulator_console`、`simulator_screenshot`、`simulator_refresh`、`debug_clear_cache`。

★ 环境前置：微信开发者工具（Electron 版）已安装 + 小程序产物 `dist/mp-weixin` + `build:mp` 通过；`--ide <cli>`（或 `PROTEUS_IDE_CLI`）指定 wechatide CLI 路径。工具签名/输出见 `docs/wechatide-skill`。
