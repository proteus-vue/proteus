# @proteus-vue/cli —— Proteus 命令行

> 让编译引擎脱离 Vite 独立可用，并把底线循环 ②（产物 → 定位规则）完全命令行化。
> 核心逻辑（参数解析 / explain 识别 / build 扫描）均为纯函数，可单测。

## 命令

```bash
# 独立编译：扫描目录下所有 .vue → 小程序四件套中的三件（wxml/js/wxss）
proteus build <dir> [--out <dir>] [--debug] [--no-px2rpx] [--rpx-ratio <n>] [--rules <json>]

# 底线循环 ②：vue 文件 → 决策 trace（实际触发的全部转换规则）
proteus explain <vue 文件>

# AI 说明书：单条规则的 what/why/when/example/verify/source
proteus explain <规则 ID>

# 编译器能力清单（按阶段分组）
proteus rules [template | script | style | validate]

proteus version / help
```

## 使用

开发期（workspace 内）：

```bash
npm run proteus -- explain examples/pages/index.vue
npm run proteus -- build examples/pages --out /tmp/out --debug
```

发布形态（`npm i -g @proteus-vue/cli` 后）：

```bash
proteus explain tag/div-to-view        # AI 说明书
proteus explain ./src/pages/home.vue   # 决策 trace
proteus build src/pages --out dist/mp  # 独立编译（无 Vite）
```

## 构建与发布

```bash
npm run build -w @proteus-vue/cli   # esbuild 单文件 bundle（含 @proteus-vue/compiler，external @vue/*）+ shebang
npm publish                    # bin: proteus → dist/index.js
```

## 与 Vite 插件的分工

| 能力 | `@proteus-vue/cli` | `vite-plugin-mp-transform` |
|---|---|---|
| 页面编译（wxml/js/wxss） | ✅ 独立可用 | ✅ 构建时 |
| 决策 trace 落盘（--debug） | ✅ `.transform-debug/` | ✅ 同 |
| 路由 / app.json / page.json | ❌（由框架 gen-routes 负责） | ✅ 集成 |
| 预设 builders 内联 / app.js 骨架 | ❌ | ✅ |
| HMR / dev server | ❌ | ✅（Vite 生态） |

CLI 定位：**独立编译器 + AI 调试工具**；Vite 插件定位：**完整构建集成**。
