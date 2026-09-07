# CLI 架构总览

## 1. 设计哲学

CLI 的角色是**编排器（Orchestrator）**，不是执行者。它把"开发者意图"翻译成"Compiler + 各层 plan 的具体动作"，并保证：

- **透明**：每条命令展开后能看到完整执行计划（`--explain`）
- **确定性**：同一份 `proteus.config.ts` + 同一份源码 → 完全相同产物
- **可观测**：每步耗时、产物大小、audit 结果可追踪
- **可中断**：任一步失败 → 明确报错 + 清理半成品产物

```
┌──────────────────────────────────────────────┐
│  开发者 / AI  Agent                           │
│         │                                    │
│         ▼                                    │
│   proteus <cmd> [opts]                       │
│         │                                    │
│         ▼                                    │
│  ┌────────────────────────┐                  │
│  │  CLI Core              │                  │
│  │  - config loader       │                  │
│  │  - command registry    │                  │
│  │  - plugin middleware   │                  │
│  │  - reporter            │                  │
│  └──────────┬─────────────┘                  │
│             │ calls                          │
│             ▼                                │
│  ┌────────────────────────┐                  │
│  │  Compiler (plan 02)    │ ← 编译内核       │
│  │  - parse / transform   │                  │
│  │  - IR / codegen        │                  │
│  └────────────────────────┘                  │
│             │ produces                       │
│             ▼                                │
│  ┌────────────────────────┐                  │
│  │  Dist Output           │                  │
│  │  dist/{web,mp,app}     │                  │
│  └────────────────────────┘                  │
└──────────────────────────────────────────────┘
```

## 2. 命令体系

### 2.1 核心命令

| 命令 | 作用 | 调用链 |
|------|------|--------|
| `proteus create <name>` | 脚手架（create-proteus） | 模板拷贝 + 依赖安装 |
| `proteus dev --platform mp` | 开发模式（带 HMR） | Compiler dev server + 微信开发者工具 |
| `proteus build --platform all` | 生产构建 | Compiler codegen → 产物 |
| `proteus preview --platform mp` | 预览产物 | 启动静态服务 + 导入开发者工具 |
| `proteus audit <target>` | 静态审计 | 各层 audit 规则 |
| `proteus doctor` | 环境诊断 | 检查 node / 微信工具 / 基础库版本 |
| `proteus inspect <file>` | 查看编译产物 | Compiler `--trace-transform` 包装 |

### 2.2 audit 子命令族（贯穿全栈）

| 命令 | 触发哪份 plan 的规则 |
|------|------|
| `proteus audit route` | Router M8.6 |
| `proteus audit module` | Module M8 |
| `proteus audit api` | API plan 08-code-splitting-ci |
| `proteus audit capability` | Platform M8 |
| `proteus audit lifecycle` | Lifecycle M8 |
| `proteus audit compile` | Compiler M8 |
| `proteus audit all` | 以上全部串行执行 |

每条 audit 规则：`ruleId | severity | file:line | message | fixSuggestion`。

### 2.3 通用选项

- `--platform <web|mp|app|all>`：目标平台（默认 all）
- `--explain`：打印命令展开后的完整执行计划（不执行）
- `--trace`：开启全链路 trace（等同各层 `--trace-*`）
- `--strict`：audit 发现 warning 即退出码 1
- `--config <path>`：指定 config 文件

## 3. 产物输出结构

```
dist/
├── web/              ← Vite/Rollup 输出（SPA）
├── mp/               ← 小程序四件套
│   ├── app.js / app.json / app.wxss
│   ├── pages/
│   ├── components/
│   ├── app-bar/      ← 来自 mountMpApp({ appBar })
│   └── ...
└── app/              ← App 端（未来）
    ├── ios/
    └── android/
```

## 4. 铁律

1. **CLI 不实现编译逻辑** —— 只调用 Compiler，避免逻辑双写
2. **所有副作用可回滚** —— build 失败 → 清理半成品 dist
3. **配置校验前置** —— 先跑 zod schema，再进编译（早失败）
4. **命令幂等** —— 重复执行同一命令，结果一致
5. **audit 不静默** —— 每条规则命中必输出（对齐"透明化"哲学）

## 5. 里程碑

- **M1**：命令骨架 + config loader + reporter（B1）
- **M2**：dev / build / preview（B2-B3）
- **M3**：audit 子命令族（B4）
- **M4**：plugin middleware + create-proteus（B5）
- **M7**：缓存 / 增量 / 并行构建（B6）
- **M8**：CI 集成 + doctor + telemetry（B7）

详见 `01-05` 各模块文档与 `09-execution-batches.md`。
