# Proteus 自动化测试框架落地执行文档

> 配套官方框架的**统一测试解决方案**。Web 端用 Vitest，小程序端用 miniprogram-automator。
> CI 环境与 App 端（uni-app / 原生）**本期搁置，仅预留接口与占位**（见 §12）。

## 1. 设计目标

1. **一套命令跑全栈测试**：`proteus test`、`vitest`、`playwright test`、`automator` 统一编排
2. **逻辑层跨端共用**：store / composable / transform / IR 在无 DOM 环境下跑通
3. **运行时分层隔离**：Web(DOM) 与 小程序(wx) 的差异收敛在 `render-host`，断言不写端专属结构
4. **编译产物可测**：`.wxml` / `.json` / `.js` 分包产物进快照，diff 即回归
5. **AI-native**：用例可被 LLM 生成与复现（结构化 fixture + trace 录制）

## 2. 分层架构（核心）

```
L4  E2E 真机/模拟器   ─┬─ Web:     Playwright            ─┐
                        └─ 小程序:  miniprogram-automator  ─┤── proteus test e2e
                                                            │
L3  组件 / 集成         @vue/test-utils + happy-dom  ──────┤── vitest (默认)
                                                            │
L2  编译产物快照         .wxml/.json 结构断言 + jest-snapshot ─┤
                                                            │
L1  单元                Vitest + vi.mock  ────────────────┘── vitest (默认)
```

**关键：Vitest 是 L1-L3 的统一运行器；仅 L4 按端分叉。**

## 3. 技术选型（已确认）

| 层 | Web | 小程序 | 说明 |
|---|---|---|---|
| L1 单元 | Vitest | Vitest（mock wx） | 共用同一份用例 |
| L2 快照 | Vitest | Vitest | 解析产物 AST，不依赖运行时 |
| L3 组件 | happy-dom + @vue/test-utils | createMockContext | 见 §06 |
| L4 E2E | Playwright | miniprogram-automator | 见 §07 / §08 |

**小程序官方 SDK 澄清**：不存在"官方 e2e SDK"一说，实际是 **miniprogram-automator**（运行时驱动）+ **miniprogram-ci**（上传打包）+ **devtools --auto**（连接基座）三件套。本框架用 automator 做 E2E。

## 4. 铁律

1. **Vitest 是唯一单元/快照运行器**，禁止在 L1-L3 引入 jest / mocha
2. **E2E 必须端专属分叉**，禁止用 happy-dom 模拟小程序运行时
3. **`wx` 必须 mock**，禁止在 L1-L3 直接引用全局 wx
4. **快照进 git**，`.wxml` / `pages.json` / `app.json` 全量快照
5. **用例跨端复用**：断言只碰逻辑与状态，DOM 结构差异收敛在 render-host

## 5. 目录结构

```
packages/
├── test-core/          # 公共 fixture / mock / 断言工具
├── test-runner/        # Vitest 配置 + playwright 编排 + automator 驱动
├── test-snapshot/      # 编译产物快照规则
└── fixtures/           # 跨层测试数据
```

详见各模块文档。

## 6. 模块清单

| 文件 | 内容 |
|---|---|
| 01-vitest-unit.md | L1 单元 + wx mock 策略 |
| 02-snapshot-compile.md | L2 编译产物快照 |
| 03-component-integration.md | L3 组件/集成 + createMockContext |
| 04-e2e-web-playwright.md | Web E2E（Playwright） |
| 05-e2e-mp-automator.md | 小程序 E2E（automator） |
| 06-cross-platform-assert.md | 跨端断言一致性 |
| 07-fixtures-mock-wx.md | fixture 工厂 + wx polyfill |
| 08-ci-strategy.md | **CI 环境策略（占位）** |
| 09-app-end.md | **App 端（占位）** |
| 10-blueprint-integration.md | Blueprint 150 页 E2E 路径 |
| 11-execution-batches.md | B1-B8 分批 + Prompt |
| 12-placeholders.md | CI / App 占位接口与后续 TODO |

## 7. 里程碑

| 阶段 | 内容 | 依赖 |
|---|---|---|
| M1 | Vitest + wx mock + L1 跑通 | Compiler IR |
| M2 | 编译快照 L2 | Compiler M3 |
| M3 | 组件 L3 + createMockContext | Component plan |
| M4 | Web E2E（Playwright） | CLI dev |
| M5 | 小程序 E2E（automator） | miniprogram-ci |
| M6 | Blueprint 集成 | Blueprint |
| M7 | **CI 策略（占位，待启动）** | §08 |
| M8 | **App 端（占位，待启动）** | §09 |

## 8. 搁置项（占位，不实现）

- **CI 环境**：官方云测 vs 自建 Mac runner 的决策未定，§08 仅定义接口
- **App 端**：uni-app / 原生自动化方案未定，§09 仅预留 `test-app-driver` 接口

---
