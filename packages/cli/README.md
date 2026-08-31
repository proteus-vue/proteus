# @proteus-vue/cli —— Proteus 命令行

> 开发者入口体验（G-33 cli-plus）：独立编译 + AI 调试 + 一键全量门禁 + 工程构建。
> 核心逻辑（参数解析 / explain / check / build）均为纯函数，可单测。

## 命令

### 编译（build）

```bash
# 独立编译：扫描目录下所有 .vue → 小程序四件套中的三件（wxml/js/wxss）
proteus build <dir> [--out <dir>] [--debug] [--no-px2rpx] [--rpx-ratio <n>] [--rules <json>]

# ★工程构建（G-33 M2）：复用项目 Vite 管线（模板约定 build:web / build:mp 脚本）
proteus build --target web        # → npm run build:web（vue-tsc + vite build --mode web）
proteus build --target skyline    # → npm run build:mp（gen-routes + vite build --mode mp-weixin）
proteus build --target all        # → web + skyline 串行
```

### 门禁（check 家族）

```bash
# ★一键全量门禁（G-33 M1）：四域聚合，任一失败 exit 1
proteus check [dir] [--no-strict-css|--no-strict-style|--no-strict-router|--no-strict-cli]

# CSS 跨端兼容（G-21）：CSS001-012 + 预算门禁（字节/选择器/语义占比/禁止项）
proteus css:check [dir|file] [--no-strict] [--fix] [--report <path>]

# 样式运行时安全（G-31）：:style 白名单 STS001-006 + 静态推导覆盖率（常量折叠）
proteus style:check [dir|file] [--platform <web|skyline|ios|android|harmony>]

# 配置校验（types-plus B2/B5）：必填字段 + 跨层依赖 + 版本迁移提示
proteus config:check <proteus.config.ts>

# 路由 <route> 块 / 模块契约 / i18n 用法 / 组件审计 / 能力清单 等专项检查
proteus router:check [dir]
proteus module:check [dir] [--graph]
proteus i18n:check [root] [--catalog <path>]
proteus components:audit [dir]
proteus capabilities:manifest [dir] [--platform <web|skyline|app>]
proteus capabilities:check [dir]
```

### 开发（dev）

```bash
proteus dev [--target <web|skyline>]   # web → vite dev server；skyline → dev-mp watch
```

### AI 调试与类型

```bash
proteus explain <vue 文件 | 规则 ID>    # 决策 trace / AI 说明书
proteus rules [template | script | style | validate]   # 编译器能力清单
proteus generate types [--out <path>] [--check]        # 全局类型产物
proteus migrate types <file>                           # 类型迁移助手
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
