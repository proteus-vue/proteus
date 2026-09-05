---
title: CLI 命令参考
order: 40
group: 工程命令
generated: true
---

# CLI 命令参考

> 本页由 CLI 命令注册表自动生成（`packages/cli/src/args.ts` HELP_GROUPS，`website/scripts/gen-reference.mjs`），请勿手工编辑。

## 构建与开发

### `proteus build`

```bash
proteus build <dir> [--out <dir>] [--debug] [--no-px2rpx] [--rpx-ratio <n>] [--rules <json>] [--compiler <node|rust>] [--target <web|skyline|all>]
```

扫描 <dir> 下所有 .vue，编译为小程序四件套（.wxml / .js / .wxss）到 <out>
      --debug    产物注入源码行号注释 + 决策 trace 落盘（.transform-debug/）
      --rules    JSON 规则覆盖文件（disabled / mapping / customTags）
      --compiler 编译器后端（G-29）：node（缺省）/ rust（每页 Node/Rust 双编译语义等价校验，G-29.1）
      --target   工程构建（G-33 M2）：spawn 项目 build:web / build:mp 脚本（复用 Vite 管线）；缺省 = 独立编译

### `proteus dev`

```bash
proteus dev [--target <web|skyline>]
```

开发服务器（G-33 M1）：web → vite --mode web；skyline → dev-mp watch 构建（app 端待 M3 原生同步）

## 检查与门禁

### `proteus gate`

```bash
proteus gate ls [--group=<族>] | gate run <id|preset> [dir]
```

★统一门禁系统（★#453/#454 Gate 注册表单一来源）：ls = 全量门禁目录（族/scope/●接线态）；run = 统一执行
      preset：check（快速）/ audit（深度八域）；已接线：d2/fluid/api-check/capabilities/i18n/router/module/css/style/config/components/devtools-budget/coverage
      未接线（○：写型/诊断/多旗标工具）经独立命令——新门禁先补录注册表再接线

### `proteus check`

```bash
proteus check [dir] [--no-strict-css|--no-strict-style|--no-strict-router|--no-strict-cli]
```

★一键全量门禁（G-33 M1）：css:check + style:check + router:check + config:check 四域聚合
      任一域失败 → exit 1（默认全开，--no-* 关闭对应域）

### `proteus conformance`

```bash
proteus conformance [--backend <spec>] [--only <C-xx>] [--demo] [--repo <dir>]
```

★G-38 42 项 conformance（C-01~C-10，compiler-backend-spi-plan 02）——默认 G-38 Node 参考实现
      --backend  外部后端：模块路径[#具名导出]（default/#具名工厂返回 G-38 后端实例）
      --only     仅跑某组（如 C-03）
      --demo     Terminal 参考 + FallbackBackend 降级演示（rust 不可用 → node）
      --repo     ★G-42 B5 仓库治理扫描（G-42.6 严禁 fork——宿主仓库 fork 命中 → FAIL，CI 阻断）
      FAIL>0 → exit 1（CI 阻断）

### `proteus host`

```bash
proteus host push <module-dir>
```

★G-45 B3 调试基座：插件模块前置校验（proteus.plugin.json 完整性/签名 sig-*/conformance 覆盖率 CMP084/087）
      + push 信封生成（manifestHash/bundleHash——G-45.8 完整性）
      FAIL → exit 1；devices/logs/serve 随 B4 transport 适配器落地

### `proteus health`

```bash
proteus health [dir]
```

★工程/环境健康检查（与 check 领域门禁正交）：Node 版本 / 工程结构 / 依赖 / 产物 / appid / pagesDir / workspace 链接 / IDE
      一次性诊断（✅/⚠/✗）；error 级 → exit 1（warn 不阻断）

### `proteus css:check`

```bash
proteus css:check [dir|file] [--no-strict] [--fix] [--report <path>]
```

★CSS 跨端兼容校验（G-21）：CSS001-012 + 预算门禁（字节/选择器/语义占比/禁止项）
      --no-strict  违规降级 warn；--report 落盘 css-compat-report.json（check-css-report.mjs 消费）

### `proteus style:check`

```bash
proteus style:check [dir|file] [--platform <web|skyline|ios|android|harmony>]
```

★样式运行时安全（G-31）：模板 :style 白名单 STS001-006 + 静态推导覆盖率（常量折叠）

### `proteus config:check`

```bash
proteus config:check <proteus.config.ts>
```

★配置校验（types-plus B2/B5）：必填字段 + 跨层依赖（CONFIG_LAYER_VIOLATION）+ 版本迁移提示

### `proteus i18n:check`

```bash
proteus i18n:check [root] [--catalog <path>]
```

★i18n 用法检查（i18n-plan B1）：硬编码文案检测 + catalog 键对照

### `proteus router:check`

```bash
proteus router:check [dir]
```

校验 <route> 块与集中式 meta（来源登记 + 父路由推导依据）

### `proteus module:check`

```bash
proteus module:check [dir] [--graph]
```

校验 proteus-module.config.ts 模块契约（缺失字段/环/重名/版本冲突）
      --graph  追加 Mermaid 依赖图

### `proteus module:duplicates`

```bash
proteus module:duplicates [distDir]
```

分包间共享依赖去重检测（读 dist/mp-weixin/app.json 的 subPackages，hash 相同文件 ≥2 分包 → 报告）

### `proteus audit`

```bash
proteus audit module [root] [--dist <dir>] [--graph-json <path> | --no-graph-json]
```

★综合审计门禁（M8.6，全部硬卡）：契约校验 + 图谱（环/重名/版本冲突）+ 可选产物（--dist：分包体积/重复）
      --dist         产物目录（分包体积阈值 + 去重检测）
      --graph-json   落盘 module-graph.json（缺省 .proteus/module-graph.json）

### `proteus audit`

```bash
proteus audit d2 [dir]
```

★D-2 dogfooding 门禁（05-dogfooding-conformance D-2 机器化）：页面不裸写平台 API（wx.*/window.* 等）/ 手写 @media / 引第三方 UI 库
      规则级可配（proteus.config audit.rules：off/warn/error，缺省全 error fail-closed）
      dir 缺省 = 读 audit.dir ?? src（需在工程内运行）；逐行 // d2-exempt 与整文件 d2-exempt-file 豁免登记
      FAIL（error 级）→ exit 1（warn 不阻断）

### `proteus audit`

```bash
proteus audit all [root]
```

★全量审计门禁（test-framework B6 + M10 + ★#450 D-2）：route / module / config / i18n / capabilities / components / d2 / devtools-budget 八域聚合
      + CI 耗时预算（<12s，超预算阻断）；缺配置文件/未声明 audit 的域跳过（独立编译模式；D-2 为 opt-in——声明 audit 即启用）

### `proteus audit`

```bash
proteus audit devtools-budget
```

★DevTools 性能预算烟测（M10/M7.4）：bus.emit / 火焰图 5000 span / 万级 timeline ingest 耗时
      plan 预算 0.1/100/200ms → CI 10 倍余量上界，超限阻断（抓病态回归）

### `proteus audit`

```bash
proteus audit coverage
```

★完整语义覆盖审计（G-32 B1 / G-32.1 门禁）：小程序能力 100% 覆盖 + 闭环一致性（catalog ↔ enum ↔ tag ↔ render-map 四向不漂移）+ 128 清单自检

### `proteus capabilities:manifest`

```bash
proteus capabilities:manifest [dir] [--platform <web|skyline|app>]
```

★扫描 capabilities/*.capability.ts → capability-manifest.json（B1 能力清单审计）
      --platform   能力缺失报告（B3 编译期分叉：该平台无 adapter 的能力 + 业务引用警告）

### `proteus capabilities:check`

```bash
proteus capabilities:check [dir]
```

★平台原生模块规范静态检查（B5 §6 禁止清单：业务目录禁 wx.*/window.*，平台文件防 API 泄漏）

### `proteus api-check`

```bash
proteus api-check [dir]
```

★CMP007 门禁（G-31 B7 / G-32.4）：回调式平台 API（wx.request({ success })）/ 同步存储 / 裸全局能力调用 → 改 useXxx() Hook（Promise/Result）；平台桥文件豁免

### `proteus components:audit`

```bash
proteus components:audit [dir]
```

★组件审计：p-* 组件注册表 vs 实际使用（未登记/未使用/标签漂移）

### `proteus fluid:check`

```bash
proteus fluid:check [dir|file]
```

★柔性布局严格规则（G-22）：FLD001 禁手写 @media / FLD002 禁硬编码断点 / FLD003 p-fluid 须 min·max / FLD004 p-grid 须 min-col-width / FLD006 禁 Dimensions.get
      （FLD005 固定死尺寸启发式噪音大，MVP 未启用）

## 测试

### `proteus test`

```bash
proteus test [unit|e2e:web|e2e:mp] [--ide <cli 路径>] [--port <n>] [--debugger <模块>]
```

★测试入口（test-framework）：unit → L1-L3 + 编译快照；e2e:web → Playwright（先 build --target web）
      e2e:mp → automator（B5）：IDE 路径可配置（PROTEUS_IDE_CLI 环境变量 / --ide 参数 / 平台默认探测）
      + 自动启动微信开发者工具（auto --auto-port）→ 端口就绪 → 跑 e2e-mp-smoke（缺 IDE 报错含指引）
      + --debugger <模块>：注入 MpDebuggerLike 适配模块（console/network/clearCache/refresh——wechatide 工具能力，见 docs 13 §6.5）

## 生成与迁移

### `proteus init`

```bash
proteus init module [dir]
```

★生成 proteus-module.config.ts 骨架（module-plan B9：新工程零门槛接入模块化）

### `proteus generate`

```bash
proteus generate types [--out <path>] [--check]
```

★生成全局类型产物（types-plan B3）：JSON Schema + 全局 d.ts（--check 校验漂移）

### `proteus migrate`

```bash
proteus migrate types <file>
```

★迁移助手：旧类型写法 → 新收口类型（types-plan 10 类型收口）

### `proteus migrate`

```bash
proteus migrate mp <file|dir> [--dry-run]
```

★G-31 B6 小程序迁移 codemod：标签自动（view→p-box 等）+ 同步存储直改（→useStorage）
      + 回调式 API/语义识别标签 manual 标注（幂等；--dry-run 只报告不写回）

### `proteus gen`

```bash
proteus gen config [file]
```

★生成 app.config.ts 骨架（G-35 M5）：defineAppConfig 类型安全形态；缺省 app.config.ts

### `proteus ci:init`

```bash
proteus ci:init [--platform <github|gitlab|circleci>] [--targets <a,b>] [dir]
```

★CI/CD 模板生成（G-33 M4）：.github/workflows/proteus.yml 等（proteus check 门禁 → 逐端构建 → 产物归档）
      默认 platform=github targets=web,skyline；写入当前目录（或 <dir>）

## 诊断与工具

### `proteus explain`

```bash
proteus explain <vue 文件 | 规则 ID>
```

vue 文件 → 决策 trace（该文件实际触发的全部转换规则）
      规则 ID  → 该规则的 AI 说明书（what/why/when/example/verify/source）

### `proteus rules`

```bash
proteus rules [template | script | style | validate]
```

列出全部编译规则（AI 说明书目录）

### `proteus version`

```bash
proteus version
```

版本号

### `proteus help`

```bash
proteus help
```

本帮助

<!-- generated by website/scripts/gen-reference.mjs · 源码 SSOT：packages/cli/src/args.ts HELP_GROUPS -->