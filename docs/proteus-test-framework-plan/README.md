# Proteus 自动化测试框架

官方配套测试方案。**Web 端 Vitest，小程序端 miniprogram-automator。**

## 一句话架构
> **Vitest 统一 L1-L3，仅 L4 E2E 按端分叉（Playwright / automator）。**

## 文档清单

| 文件 | 内容 | 状态 |
|---|---|---|
| 00-overview | 总览、分层、铁律、里程碑 | ✅ |
| 01-vitest-unit | L1 单元 + wx mock | ✅ |
| 02-snapshot-compile | L2 编译产物快照（@proteus-vue/test-core/snapshot：WXML 结构等值 + sourcemap 回源） | ✅ B2 |
| 03-component-integration | L3 组件 + createMockContext | ✅ M3 |
| 03b-mount-unified | **统一测试 API（@proteus-vue/test-core mount.ts）**：同一份 SFC → `mountComponent(platform: 'web'/'mp')` 双端挂载（Web @vue/test-utils 真实渲染 / MP 逻辑层 + WXML 归一化 host）+ `stateOf`/`textOf` 跨端统一断言 + `tap` 事件分发——状态完全共用、DOM 各自断言（06 铁律）；★web 分支需 happy-dom（esbuild TextEncoder 检查）、状态读 vm.$.setupState、increment 后文本断言先 await $nextTick | ✅ 统一 API |
| 03c-driver-e2e | **统一测试 API（E2E 层 @proteus-vue/test-core/driver）**：一套 `TestDriver` 能力接口 → web（Playwright）/ mp（automator）——能力域对照 wechatide-skill automator「意图→工具」表（navigate/reLaunch/back · currentPage/systemInfo · element(tap/input/longPress/text/value/waitFor) · evaluate · screenshot · waitFor）；注入句柄 + 结构类型（零硬依赖）；MP 经验内化（元素每次重新解析、reLaunch 最稳通道）；`createDriver({ platform, page/mini })` 统一入口——同一份跨端用例代码双端跑（tests/test-driver.test.ts 7 用例） | ✅ 统一 API |
| 04-e2e-web-playwright | Web E2E（路由/渲染 + 关键路径 data-testid）；★统一 driver 适配（@proteus-vue/test-core/driver：createDriver({platform:'web', page})) | ✅ B4 |
| 05-e2e-mp-automator | 小程序 E2E（官方 SDK）——**examples 真机全链路跑通**（体检/副本/补丁/端口复用/冒烟断言）；Page.getData 受模拟器激活态影响 → 断言用 reLaunch/currentPage/systemInfo；★统一 driver 适配（createDriver({platform:'mp', mini})） | ✅ B5 |
| 06-cross-platform-assert | 跨端断言一致性（@proteus-vue/test-core 统一 tap/类型守卫 + stateOf/textOf 统一状态/文本读取） | ✅ B7 |
| 07-fixtures-mock-wx | fixture + wx polyfill | ✅ |
| 08-ci-strategy | CI 策略——§08「决策未定前 CI 只跑 L1-L3 + 快照 + Web Playwright」已落 proteus ci:init（automator 留 Mac runner 条件） | 🔶 决策待定 |
| 09-app-end | **App 端（占位）** | ⏸ |
| 10-blueprint-integration | Blueprint 150 页（P1-P5 业务路径待 v0.6 组件） | 🔶 |
| 11-execution-batches | B1-B8 + Prompt | ✅ |
| 12-placeholders | CI / App TODO | ✅ |

## 方案可行性结论
- ✅ Web 用 Vitest —— 正确
- ✅ 小程序用 miniprogram-automator —— 正确（即"官方 SDK"）
- ⚠️ automator 需 GUI → CI 降级已预留
- ⏸ CI 环境 / App 端 —— 本期搁置，仅留接口

## 依赖关系
```
Compiler → CLI → Types → Testing → DevTools → Build → Blueprint → Website
                                                              ↑
                                          本框架（复用 Testing fixture 思路）
```

## 快速开始（目标形态）
```bash
proteus test            # L1-L3 + 快照
proteus test e2e:web    # Playwright
proteus test e2e:mp     # automator（需 IDE 运行）
```

---
