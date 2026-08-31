# @proteus-vue/cli —— Proteus 命令行

> 开发者入口体验（G-33 cli-plus）：独立编译 + AI 调试 + 一键全量门禁 + 工程构建。
> 核心逻辑（参数解析 / explain / check / build）均为纯函数，可单测。

## 命令

> 完整分组清单：`proteus help`（分组 + 参数语义着色；TTY 自动检测，非 TTY/CI 纯文本）。

### 编译与开发

```bash
# 独立编译：扫描目录下所有 .vue → 小程序四件套中的三件（wxml/js/wxss）
proteus build <dir> [--out <dir>] [--debug] [--no-px2rpx] [--rpx-ratio <n>] [--rules <json>]

# ★工程构建（G-33 M2）：复用项目 Vite 管线（模板约定 build:web / build:mp 脚本）
proteus build --target web        # → npm run build:web（vue-tsc + vite build --mode web）
proteus build --target skyline    # → npm run build:mp（gen-routes + vite build --mode mp-weixin）
proteus build --target all        # → web + skyline 串行

# 开发服务器（G-33 M1）：web → vite dev server；skyline → dev-mp watch
proteus dev [--target <web|skyline>]
```

### 检查与门禁

```bash
# ★一键全量门禁（G-33 M1）：四域聚合，任一失败 exit 1
proteus check [dir] [--no-strict-css|--no-strict-style|--no-strict-router|--no-strict-cli]

# ★工程/环境健康检查（与 check 领域门禁正交）：Node 版本 / 工程结构 / 依赖 / 产物 / appid / pagesDir / workspace 链接 / IDE
#   一次性诊断（✅/⚠/✗）；error 级 → exit 1（warn 不阻断）
proteus health [dir]

# CSS 跨端兼容（G-21）：CSS001-012 + 预算门禁（字节/选择器/语义占比/禁止项）
proteus css:check [dir|file] [--no-strict] [--fix] [--report <path>]

# 样式运行时安全（G-31）：:style 白名单 STS001-006 + 静态推导覆盖率（常量折叠）
proteus style:check [dir|file] [--platform <web|skyline|ios|android|harmony>]

# 配置校验（types-plus B2/B5）：必填字段 + 跨层依赖 + 版本迁移提示
proteus config:check <proteus.config.ts>

# 应用配置校验（G-35 M5）：app.config.ts 合法值 + 降级报告（链接 gen config 闭环）
proteus app-config:check <app.config.ts>

# 路由 <route> 块 / 模块契约 / i18n 用法 / 组件审计 / 能力清单 等专项检查
proteus router:check [dir]
proteus module:check [dir] [--graph]
proteus module:duplicates [distDir]              # 分包间共享依赖去重检测
proteus i18n:check [root] [--catalog <path>]
proteus components:audit [dir]
proteus capabilities:manifest [dir] [--platform <web|skyline|app>]
proteus capabilities:check [dir]

# ★综合审计门禁（M8.6 全部硬卡）：契约 + 图谱 + 可选产物
proteus audit module [root] [--dist <dir>] [--graph-json <path> | --no-graph-json]

# ★全量审计门禁（test-framework B6）：route / module / config / i18n / capabilities / components 六域聚合 + CI 耗时预算
proteus audit all [root]
```

### 测试（test-framework）

```bash
# ★测试入口：unit → L1-L3 + 编译快照；e2e:web → Playwright（先 build --target web）
proteus test
proteus test e2e:web

# 小程序 E2E（B5，真机）：体检 → 产物副本 → 补丁 → launch/connect → spec
#   --ide <cli 路径>   IDE CLI（PROTEUS_IDE_CLI 环境变量 / 平台默认路径探测）
#   --port <n>          automator 端口（缺省 9420；被占自动转 connect 复用）
#   --debugger <模块>   注入 MpDebuggerLike 适配模块（console/network/clearCache/refresh——wechatide 工具能力）
proteus test e2e:mp examples --ide /path/to/cli --port 9420 --debugger ./e2e/mp-debugger.ts
```

### 生成与迁移

```bash
proteus init module [dir]                        # 生成 proteus-module.config.ts 骨架（module-plan B9）
proteus generate types [--out <path>] [--check]  # 全局类型产物（types-plan B3）
proteus migrate types <file>                     # 类型迁移助手（types-plan 10）
proteus gen config [file]                        # 生成 app.config.ts 骨架（G-35 M5，应用运行时配置）
proteus ci:init [--platform <github|gitlab|circleci>] [--targets <a,b>] [dir]  # CI/CD 模板（G-33 M4）
```

### AI 调试与工具

```bash
proteus explain <vue 文件 | 规则 ID>    # 决策 trace / AI 说明书
proteus rules [template | script | style | validate]   # 编译器能力清单
proteus version                        # 版本号
proteus help                           # 分组帮助（命令名 cyan、<必选> 黄、[可选] 灰）
```

## 使用

开发期（workspace 内）：

```bash
npm run proteus -- explain examples/pages/index.vue
npm run proteus -- build examples/pages --out /tmp/out --debug
npm run proteus -- check examples            # 一键全量门禁
```

发布形态（`npm i -g @proteus-vue/cli` 后）：

```bash
proteus check --strict         # 四域门禁（CSS/Style/Router/CLI）
proteus build --target all     # 工程构建（web + skyline）
proteus explain ./src/pages/home.vue   # 决策 trace
```

## 严格规则（--strict-cli，G-33）

| 码 | 规则 | 级别 |
|----|------|------|
| CLI001 | proteus.config.ts 校验失败 | error |
| CLI002 | 缺失必要 target 配置（defineProteus 形态） | error |
| CLI003 | 能力开关冲突（feature 开启但 target 不支持） | warn |
| CLI004 | .proteus/ 生成文件被手动修改（sha256 指纹基线） | warn |

`proteus check` 聚合全部 strict 开关，一键全量校验。

## 构建与发布

```bash
npm run build -w @proteus-vue/cli   # esbuild 单文件 bundle（external @proteus-vue/* + @vue/*）+ shebang
npm publish                    # bin: proteus → dist/index.js
```

## 与 Vite 插件的分工

| 能力 | `@proteus-vue/cli` | `vite-plugin-mp-transform` |
|---|---|---|
| 页面编译（wxml/js/wxss） | ✅ 独立可用 + --target 工程构建 | ✅ 构建时 |
| 决策 trace 落盘（--debug） | ✅ `.transform-debug/` | ✅ 同 |
| 一键全量门禁（check 家族） | ✅ 四域聚合 | 🔶 构建时部分 |
| 路由 / app.json / page.json | ❌（由框架 gen-routes 负责） | ✅ 集成 |
| 预设 builders 内联 / app.js 骨架 | ❌ | ✅ |
| HMR / dev server | ✅（proteus dev → Vite） | ✅（Vite 生态） |

CLI 定位：**独立编译器 + AI 调试工具 + 门禁入口**；Vite 插件定位：**完整构建集成**。
