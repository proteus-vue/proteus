---
title: 快速开始
order: 2
group: 入门
---

# 快速开始

从零到一个 Web + 微信小程序双端工程：一条脚手架命令，两次构建。本页的命令、交互与生成物均以 `packages/create-proteus` 源码与模板为准。

## 环境要求

| 依赖 | 版本要求 | 用途 |
|---|---|---|
| Node.js | ≥ 18 | 构建工具链 |
| npm | 随 Node | 依赖管理 |
| 微信开发者工具 | 最新稳定版 | 小程序端调试（需真实 AppID） |
| 微信基础库 | ≥ 2.29.2 | 启用 Skyline 渲染与 wx.router 自定义路由 |

> 无真实 AppID 时可在开发者工具「详情 → 基本信息」使用测试号，但 Skyline 能力建议用真实 AppID 验证。

## 创建工程

```bash
npm create @proteus-vue/proteus my-app
cd my-app
npm install
```

脚手架没有交互式提问：项目名就是命令参数（自动规范化为小写字母 / 数字 / 连字符）；目标目录已存在且非空时会拒绝。它做三件事：

1. 复制内置模板工程（框架快照 + 编译管线 + 首页示例）
2. 把模板中的 `{{name}}` 占位符替换为项目名
3. 打印下一步提示：`npm run dev:web` 跑 Web 端、`npm run build:mp` 跑小程序端

> 若 `npm install` 时 `@proteus-vue/*` 包不可用（npm 尚未发布对应版本），脚手架 README 记载了过渡方案：临时以仓库路径安装对应 `packages/*` 包，或使用 npm link。

## 工程目录结构

| 路径 | 作用 |
|---|---|
| `proteus.config.ts` | 框架统一配置：appid / skyline / pagesDir / rules 规则覆盖 / setDataBridge / style（px→rpx）；编译期读取，改完需重新 `npm run build:mp` |
| `vite.config.ts` | 双端 Vite 配置：Web 端走 `@vitejs/plugin-vue`，小程序端走 `mpTransform` 编译管线 |
| `scripts/gen-routes.ts` | 递归扫描 `pagesDir`，按目录结构推导路由，生成 `app.json` / `page.json` / 路由表 |
| `scripts/mp-entry-stub.ts` | 小程序构建的 rollup 占位入口（真实 `app.js` 由插件直出） |
| `src/main.ts` | Web 入口 |
| `src/main.mp.ts` | 小程序极简入口：不写 `App()`，app 骨架由框架自动生成 |
| `src/pages/` | 页面目录（`pagesDir`），每个 `.vue` 即一个页面 |
| `src/router/` | RouterView / 路由实例 / `auto-routes.ts`（编译期生成，勿手动编辑） |
| `src/shims/` | wx / 事件 / Vue 类型声明 |
| `.github/workflows/proteus.yml` | CI 模板（双端构建） |

## 双端命令

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

## 跑通 Web 端

```bash
npm run dev:web
```

浏览器打开 Vite 提示的地址（默认 `http://localhost:5173`），看到首页即成功。Web 端就是标准 Vite SPA：**零转换**，Vue devtools、HMR、按路由 code-split 全部可用。

## 跑通小程序端

```bash
npm run build:mp
```

产物在 `dist/mp-weixin/`：`app.js` / `app.json` / `app.wxss` + `pages/`（每页 wxml / wxss / js / json 四件套，配置了 subPackages 时还有 `subpackages/`）。然后在微信开发者工具：

1. 「导入项目」→ 目录选择 `dist/mp-weixin/`
2. AppID 填入 `proteus.config.ts` 中的真实 AppID（模板默认占位 `wx0000000000`，使用前必须替换）
3. 「详情 → 本地设置」勾选「调试基础库」并选择 ≥ 2.29.2
4. Skyline 所需字段无需手配：`app.json` 的 `lazyCodeLoading`、各页 `page.json` 的 `"renderer": "skyline"` 均由 gen-routes 自动生成

## 第一个页面

`src/pages/index.vue` 是脚手架自带的首页，完整可用：

```vue
<route>
{
  "meta": {
    "title": "首页",
    "isTab": true
  }
}
</route>
<script setup lang="ts">
import { ref } from 'vue'

const count = ref(0)

function handleTap() {
  count.value++
}
</script>

<template>
  <div class="home">
    <h1>Hello Proteus</h1>
    <p class="tapped-count">tapped {{ count }} times</p>
    <button @click="handleTap">tap</button>
  </div>
</template>

<style>
.home {
  text-align: center;
  padding: 48px 0;
}
</style>
```

要点：

- 业务代码只写**标准 HTML 标签 + 标准 Vue SFC**：`div→view`、`h1/p→text`、`img→image`、`a→view`（导航链接）等映射全部由编译器完成，业务零条件编译
- `<route>` 自定义块声明页面元信息（标题 / 是否 tab 页），编译期由 gen-routes 读取生成 `app.json`
- `ref` 的读写：Web 端是 Vue 真实响应式；小程序端由编译器重写为 `this.setData({ ... })`（16ms 窗口批量合并）
- 新建页面：在 `src/pages/` 下添加 `.vue` 文件，重新 `npm run build:mp`，Web 与小程序两端同时生效

## 下一步

- [语义模型](/docs/03-semantic-model)：理解「一份源码 → 双端产物」背后的 Compiler IR 与语义树
- [柔性布局](/docs/06-fluid-layout)：屏幕越宽自动排越多列的系统级布局能力
- [状态管理](/docs/22-state-management)：跨页 / 跨端状态与 pinia-sync
