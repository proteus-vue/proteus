---
title: 创建你的第一个工程
order: 5
group: 开始
---

# 创建你的第一个工程

一条脚手架命令，创建一个 **Web + 微信小程序双端工程**。本页的命令与生成物以 `packages/create-proteus` 源码与模板为准。

## 创建

```bash
npm create @proteus-vue/proteus my-app
cd my-app
npm install
```

脚手架没有交互式提问：项目名就是命令参数（自动规范化为小写字母 / 数字 / 连字符——大写与非法字符替换为 `-`、首尾 `-` 去除）；目标目录已存在且非空时会拒绝。

## 它做三件事

1. **复制内置模板工程**（框架快照 + 编译管线 + 首页示例，模板清单见下）
2. **替换占位符**：模板中的 `{{name}}` → 项目名
3. **打印下一步提示**：`npm run dev:web` 跑 Web 端、`npm run build:mp` 跑小程序端

## 模板生成物清单

```
my-app/
├─ proteus.config.ts            # 框架统一配置（唯一配置——vite 组装内建，见下）
├─ package.json                 # 双端 scripts（proteus CLI 命令，见下）+ @proteus-vue/* 依赖
├─ tsconfig.json
├─ index.html                   # Web 入口
├─ .github/workflows/proteus.yml # CI 模板（check 门禁 → 双端构建 → 产物归档）
└─ src/
   ├─ main.ts / main.mp.ts      # Web / 小程序双入口
   ├─ App.vue                   # 根组件
   ├─ pages/index.vue           # 首页示例（p-* 组件 + @tap + 插值全覆盖）
   ├─ router/
   │  ├─ index.ts               # 路由实例
   │  ├─ auto-routes.ts         # gen-routes 产物（编译期生成，勿手改）
   │  └─ RouterView.vue
   └─ shims/                    # mp / events / vue 类型声明
```

> ★#418 配置收敛：模板**没有 vite.config.ts，也没有 scripts/**——vite 配置由框架组装（`@proteus-vue/plugin-vite` 的 `resolveProteusViteConfig`），gen-routes 与小程序入口由 CLI 内建；你只需要 `proteus.config.ts` + CLI 命令。需要扩展 vite 时写在 `proteus.config.ts` 的 `vite` 透传字段（plugins/server/resolve…完全兼容 vite）。

## 模板 proteus.config.ts（生成即编译）

```ts
const config: ProteusConfig = {
  platform: 'mp-weixin',
  skyline: true,
  appid: 'wx0000000000',        // ← 替换为真实 AppID
  pagesDir: 'src/pages',
  routesOutput: 'src/router/auto-routes.ts',
  customRoute: {
    registerPresets: true,
    builders: {                  // 内置转场预设（随 @proteus-vue/router 发布源码）
      halfScreen: 'node_modules/@proteus-vue/router/src/presets/halfScreen.ts',
      slideUp:     'node_modules/@proteus-vue/router/src/presets/slideUp.ts',
      scaleDown:   'node_modules/@proteus-vue/router/src/presets/scaleDown.ts',
    },
  },
  rules: { disabled: [], mapping: {}, customTags: {} }, // 例：{ 'my-widget': 'view' }
  setDataBridge: { batchWindow: 16, perComponent: true },
  style: { px2rpx: true, rpxRatio: 2 },
}
```

字段说明见[全局配置](/docs/10-config)。

## 模板 scripts（双端命令）

| 命令 | 做什么 |
|---|---|
| `npm run dev:web` | `proteus dev --target web`（Web dev server） |
| `npm run build:web` | `proteus build --target web`（vue-tsc 类型检查 + vite build） |
| `npm run dev:mp` | `proteus dev --target skyline`（gen-routes + vite dev） |
| `npm run build:mp` | `proteus build --target skyline`（gen-routes → vue-tsc → 小程序产物四件套） |
| `npm run debug:mp` | `PROTEUS_DEBUG=1` 产物注入源码行号注释 + 决策 trace |
| `npm run proteus` | CLI 入口（`npx proteus` 同义） |

> 脚本只是 CLI 命令的别名——直接 `npx proteus dev --target web` 等价。CLI 是唯一驱动：加载 `proteus.config.ts` → 框架组装 vite 配置 → 启动/构建，全程不经过 npm 脚本与 vite.config。

## npm 包不可用时

若 `npm install` 时 `@proteus-vue/*` 包不可用（npm 尚未发布对应版本），脚手架 README 记载了过渡方案：临时以仓库路径安装对应 `packages/*` 包，或使用 npm link。

## 下一步

- [运行与预览](/docs/06-run-preview)：把 Web 端和小程序端都跑起来
- [全局配置](/docs/10-config)：proteus.config.ts 字段全表
