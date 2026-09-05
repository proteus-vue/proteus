---
title: 构建与发布
order: 7
group: 开始
---

# 构建与发布

## 全部命令速查

| 命令 | 作用 |
|---|---|
| `npm run dev:web` | Web 端开发（Vite dev server，完整 HMR + devtools） |
| `npm run build:web` | Web 构建（vue-tsc 类型检查 + vite build）→ `dist/web/` |
| `npm run dev:mp` | 小程序 Vite dev（gen-routes + `vite --mode mp-weixin`；日常迭代建议用 build:mp） |
| `npm run build:mp` | 小程序正式构建（gen-routes → vue-tsc → vite build）→ `dist/mp-weixin/` |
| `npm run debug:mp` | 全链路调试构建（`PROTEUS_DEBUG=1`，产物注入 `[proteus][环节]` 日志与决策链文件） |
| `npx proteus explain src/pages/index.vue` | 查看该文件实际触发的全部编译规则决策 trace |
| `npx proteus rules` | 编译器规则能力清单（每条规则自带 AI 说明书） |

> 本仓库（monorepo 根目录）另有 `npm run preview:web`（预览 Web 构建产物）与 `npm run verify`（test + 双端构建一键全量验证）。

## 发布到各端

- **Web 端**：`dist/web/` 是标准静态 SPA 产物，任意静态托管 / CDN / 容器均可部署
- **小程序端**：`dist/mp-weixin/` 在微信开发者工具中「上传代码」后，走小程序正常的提审与发布流程
- **调试**：行为异常时先跑 `npm run debug:mp`，产物里带 `[proteus][环节]` 日志与决策链文件；`npx proteus explain <file>` 可查单文件编译决策。更多见 [CLI 与工程命令](/docs/28-cli)

## 下一步

- [目录结构](/docs/08-structure)：认识工程里每个目录的职责
