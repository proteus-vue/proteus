---
title: 创建你的第一个工程
order: 5
group: 开始
---

# 创建你的第一个工程

一条脚手架命令，创建一个 **Web + 微信小程序双端模板工程**（脚手架生成 Web / 微信小程序工程；App 三端（iOS/Android/鸿蒙）接入进度见[端与成熟度](/docs/framework/ends-matrix)）。本页的命令与生成物以 `packages/create-proteus` 源码与模板为准。

## 创建

```bash
npm create @proteus-vue/proteus my-app
cd my-app
npm install
```

> **CLI 从哪来**：`npm create` 由 npx 拉取脚手架（`@proteus-vue/create-proteus`，无需预装）；`npm install` 把 CLI（`@proteus-vue/cli`）连同框架包作为**工程 devDependency** 装进本工程 `node_modules`。此后 `npm run dev:web` 等脚本、以及 `npx proteus …` 都可用——**无需全局安装 CLI**。

脚手架没有交互式提问：项目名就是命令参数（自动规范化为小写字母 / 数字 / 连字符——大写与非法字符替换为 `-`、首尾 `-` 去除）；目标目录已存在且非空时会拒绝。

## 它做三件事

1. **复制内置模板工程**（框架快照 + 编译管线 + 首页示例，模板清单见下）
2. **替换占位符**：模板中的 `{{name}}` → 项目名
3. **打印下一步提示**：`npm run dev:web` 跑 Web 端、`npm run build:mp` 跑小程序端（App 三端用 `proteus build --target ios|android|harmony` 编译屏内容）

## 模板生成物清单

```
my-app/
├─ .agents/skills/proteus-cobuild/SKILL.md  # 框架共建技能（AI 会话用，见 AGENTS.md）
├─ AGENTS.md                    # 本工程对 AI 会话的约定（含框架共建机制）
├─ proteus.config.ts            # 框架统一配置（唯一配置——vite 组装内建，见下）
├─ package.json                 # 双端 scripts（proteus CLI 命令）+ @proteus-vue/* 依赖
├─ tsconfig.json
├─ index.html                   # Web 入口
├─ docs/                        # 框架共建台账（实战报告_proteus接入.md + 框架问题台账.json）
├─ scripts/ledger_check.mjs     # 台账自检（`node scripts/ledger_check.mjs --check`）
├─ .github/workflows/proteus.yml # CI 模板（check 门禁 → 双端构建 → 产物归档）
└─ src/
   ├─ main.ts / main.mp.ts      # Web / 小程序双入口
   ├─ App.vue                   # 根组件
   ├─ pages/index.vue           # 首页示例（p-* 组件 + @tap + 插值全覆盖）
   ├─ router/
   │  ├─ index.ts               # 路由实例
   │  ├─ auto-routes.ts         # gen-routes 产物（编译期生成，勿手改）
   │  └─ RouterView.vue
   └─ shims/                    # mp / events / import-meta / vue 类型声明
```

> ★#418 配置收敛：模板**没有 vite.config.ts，也没有 scripts/**——vite 配置由框架组装（`@proteus-vue/plugin-vite` 的 `resolveProteusViteConfig`），gen-routes 与小程序入口由 CLI 内建；你只需要 `proteus.config.ts` + CLI 命令。需要扩展 vite 时写在 `proteus.config.ts` 的 `vite` 透传字段（plugins/server/resolve…完全兼容 vite）。

## 模板 proteus.config.ts（生成即编译）

```ts
const config: ProteusConfig = {
  version: 4,                       // ★配置模型 v4（决策 #641）：目标端 = 一级键
  targets: {
    mp: {
      appid: 'wx0000000000',        // ← 替换为真实 AppID
      renderer: 'skyline',
      rules: { disabled: [], mapping: {}, customTags: {} }, // 例：{ 'my-widget': 'view' }
      setDataBridge: { batchWindow: 16, perComponent: true },
      style: { px2rpx: true, rpxRatio: 2 },
    },
    // ★App 三端（可选）：原生工程身份（包名 / Bundle ID / 版本），由 `proteus build --package` 注入
    // ios: { bundleId: 'com.example.app' },
    // android: { applicationId: 'com.example.app' },
    // harmony: { bundleName: 'com.example.app' },
  },
  pagesDir: 'src/pages',
  router: {
    routesOutput: 'src/router/auto-routes.ts',   // gen-routes 产物路径
    customRoute: {
      registerPresets: true,                      // 内置转场预设（随 @proteus-vue/router 发布源码）
      builders: {
        halfScreen: 'node_modules/@proteus-vue/router/src/presets/halfScreen.ts',
        slideUp:     'node_modules/@proteus-vue/router/src/presets/slideUp.ts',
        scaleDown:   'node_modules/@proteus-vue/router/src/presets/scaleDown.ts',
      },
    },
  },
}
```

> ★**v4 按端分区**（决策 #641）：小程序 / Skyline 专属字段（`appid` / `renderer` / `rules` / `setDataBridge` / `style.px2rpx`…）收进 `targets.mp`，不再平铺在顶层；App 三端身份进 `targets.{ios,android,harmony}`。旧 v3 配置（平铺形态）加载期**自动迁移**，无需手改。字段全表见[编译器配置](/docs/10-config)。

## 模板 scripts（各端命令）

| 命令 | 做什么 |
|---|---|
| `npm run dev:web` | `proteus dev --target web`（Web dev server） |
| `npm run build:web` | `proteus build --target web`（vue-tsc 类型检查 + vite build） |
| `npm run dev:mp` | `proteus dev --target skyline`（gen-routes + vite dev） |
| `npm run build:mp` | `proteus build --target skyline`（gen-routes → vue-tsc → 小程序产物四件套） |
| `npm run debug:mp` | `PROTEUS_DEBUG=1` 产物注入源码行号注释 + 决策 trace |
| `npm run dev:android` / `dev:ios` / `dev:harmony` | `proteus dev --target <端>`（App 端热刷调试：装宿主 → 局域网 dev server → 改源码即热刷；需设备 + 对应工具链） |
| `npm run build:android` / `build:ios` / `build:harmony` | `proteus build --target <端>`（编译屏内容 IR → `dist/app/<端>/`） |
| `npm run package:android` / `package:ios` / `package:harmony` | `proteus build --target <端> --package`（+ 平台工具链打安装包：apk / app / hap） |
| `npm run proteus` | CLI 入口（`npx proteus` 同义） |

> App 三端脚本依赖各自工具链与设备（Android SDK/设备 · Xcode/证书 · DevEco/签名），首次用前先看[环境要求](/docs/04-requirements)。

> 脚本只是 CLI 命令的别名——直接 `npx proteus dev --target web` 等价。CLI 是唯一驱动：加载 `proteus.config.ts` → 框架组装 vite 配置 → 启动/构建，全程不经过 npm 脚本与 vite.config。

## npm 包不可用时

若 `npm install` 时 `@proteus-vue/*` 包不可用（npm 尚未发布对应版本），脚手架 README 记载了过渡方案：临时以仓库路径安装对应 `packages/*` 包，或使用 npm link。

## 下一步

- [运行与预览](/docs/06-run-preview)：把各端都跑起来
- [编译器配置](/docs/10-config)：proteus.config.ts 字段全表
