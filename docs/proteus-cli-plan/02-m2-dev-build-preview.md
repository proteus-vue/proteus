# M2 — dev / build / preview 命令

## 1. `proteus build`

生产构建主流程：

```
build --platform mp
  ├─ 1. loadConfig()          → 校验 proteus.config.ts
  ├─ 2. resolveEntries()       → 读 platforms.mp.entry + pages
  ├─ 3. createCompiler()       → 实例化 Compiler（plan 02）
  ├─ 4. compileAll()
  │     ├─ parse（SFC 三段）
  │     ├─ transform（插件链）
  │     └─ codegen → dist/mp
  ├─ 5. runAudit('compile')    → Compiler M8 门禁
  ├─ 6. emitAssets()           → 拷贝静态资源
  └─ 7. report()
```

**关键**：build 是**串行 + 确定性**的。同一输入 → 同一产物（哈希稳定）。

**多端并行**：`--platform all` 时，web/mp/app 三个编译**可并行**（相互独立），用 `Promise.all`；但单个平台的编译内部串行。

## 2. `proteus dev`

开发模式，带 HMR：

- 启动 Vite dev server（Web）
- 启动 Compiler watch 模式（mp）→ 文件变更 → 增量编译 → 通知微信开发者工具刷新
- 输出 `compiled://` 协议供微信工具导入

**HMR 边界**：小程序 HMR 能力受限（微信工具不完全支持模块热替换），降级为**整页刷新 + 状态保持**（通过 Lifecycle `onHide` 保存关键 state）。

**对齐 Compiler plan M6**：增量编译复用 Compiler 的依赖图 + 缓存。

## 3. `proteus preview`

预览已构建产物：

- 启动静态文件服务（`dist/web`）
- 对 `dist/mp`：生成 `project.config.json` + 调用微信开发者工具 CLI 导入
- 对 `dist/app`：输出 Xcode/Android Studio 工程路径提示

## 4. `--explain` 机制

不执行，只打印展开后的计划：

```
$ proteus build --platform mp --explain

[Plan] build --platform mp
  config: ./proteus.config.ts
  entry: src/main.mp.ts
  compiler: @proteus-vue/compiler@1.0
  transforms:
    - v-if → wx:if           (compiler/transforms/v-if.ts:12)
    - appBar → app.json      (router/transforms/app-bar.ts:45)
    - ... (86 transforms)
  codegen:
    - pages/* → dist/mp/pages/*
    - components/* → dist/mp/components/*
  audit:
    - route, module, api, capability, lifecycle, compile
  output: dist/mp/
```

**价值**：这是"透明化"哲学的集中体现 —— AI agent 或开发者一条命令看到**完整执行蓝图**，不需要读 CLI 源码。

## 5. 错误处理与回滚

- 任一步失败 → 清理 `dist/mp`（避免半成品）
- 报错带 `file:line:col` + 对应 transform 规则 ID
- 退出码：`0` 成功 / `1` 编译错 / `2` config 错 / `3` audit 失败

## 6. 与 Compiler 的边界

**CLI 只做**：
- 参数解析、config 加载、生命周期编排、报告

**Compiler 只做**：
- 解析、变换、IR、codegen（plan 02 定义）

**禁止**：CLI 里直接 `fs.writeFile` 生成 `.wxml` —— 必须走 Compiler codegen。这条用 ESLint `no-restricted-imports` 卡口。
