---
title: 构建与发布
order: 7
group: 开始
---

# 构建与发布

## 全部命令速查

| 命令 | 作用 |
|---|---|
| `npm run dev:web` | Web 端开发（`proteus dev --target web`——完整 HMR + devtools） |
| `npm run build:web` | Web 构建（`proteus build --target web`：vue-tsc + vite build）→ `dist/web/` |
| `npm run dev:mp` | 小程序 dev（`proteus dev --target skyline`：gen-routes + vite dev；日常迭代建议用 build:mp） |
| `npm run build:mp` | 小程序正式构建（`proteus build --target skyline`：gen-routes → vue-tsc → vite build）→ `dist/mp-weixin/` |
| `npm run debug:mp` | 全链路调试构建（`PROTEUS_DEBUG=1`，产物注入 `[proteus][环节]` 日志与决策链文件） |
| `npx proteus explain src/pages/index.vue` | 查看该文件实际触发的全部编译规则决策 trace |
| `npx proteus rules` | 编译器规则能力清单（每条规则自带 AI 说明书） |

> 命令全部走 CLI——CLI 加载 `proteus.config.ts`、框架组装 vite 配置（`vite.config.ts` 不是工程文件）。npm scripts 只是 CLI 命令别名。

> 本仓库（monorepo 根目录）另有 `npm run preview:web`（预览 Web 构建产物）与 `npm run verify`（test + 双端构建一键全量验证）。

## 发布到各端

| 端 | 产物 | 发布方式 | 状态 |
|---|---|---|---|
| Web | `dist/web/`（标准静态 SPA） | 任意静态托管 / CDN / 容器 | ✅ |
| 微信小程序 | `dist/mp-weixin/` | 开发者工具「上传代码」→ 提审 → 发布（微信平台流程） | ✅ |
| App（iOS / Android / 鸿蒙） | 原生工程（JSI 载体，G-40） | 随端宿主发布流程 | 🟡 原型映射 |
| Flutter | Flutter 工程嵌入 | Flutter 发布流程 | 🟡 |
| 快应用 | 待定 | 待定 | ⬜ |

- **调试**：行为异常时先跑 `npm run debug:mp`，产物里带 `[proteus][环节]` 日志与决策链文件；`npx proteus explain <file>` 可查单文件编译决策。更多见 [CLI 与工程命令](/docs/28-cli)
- **体积门禁**：`build:mp` 尾部自动输出体积报告（主包预算 `budget.mainPackageKB`，分包微信硬限 2048KB）——见[体积预算](/docs/framework/perf-budget)

## 下一步

- [目录结构](/docs/08-structure)：认识工程里每个目录的职责
