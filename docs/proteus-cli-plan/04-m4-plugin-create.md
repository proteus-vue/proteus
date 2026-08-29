# M4 — Plugin 中间件 + create-proteus

## 1. Plugin Middleware

CLI 支持插件扩展命令与编译流程：

```ts
// proteus.config.ts
export default defineConfig({
  plugins: [
    myCustomPlugin(),  // 形如 Vite 插件
  ],
})

// my-plugin.ts
export function myCustomPlugin(): CliPlugin {
  return {
    name: 'my-plugin',
    // 扩展命令
    commands: [myCommand],
    // 注入 Compiler transform
    transforms: [myTransform],
    // 钩入生命周期
    hooks: {
      'build:start': (ctx) => { /* ... */ },
      'build:end': (ctx) => { /* ... */ },
    },
  }
}
```

**设计原则**：插件只通过**明确定义的 hook** 介入，禁止猴子补丁 CLI 内部。对齐 Compiler plan 的 transform 插件系统 —— CLI 插件和 Compiler transform 是同一套扩展哲学。

## 2. create-proteus 脚手架

`proteus create my-app` 生成标准工程：

```
my-app/
├── proteus.config.ts
├── src/
│   ├── main.web.ts
│   ├── main.mp.ts
│   ├── App.vue
│   ├── pages/
│   ├── components/
│   └── stores/
├── package.json
└── tsconfig.json
```

模板分预设（preset）：
- `minimal`：Web + MP 双端，无业务代码
- `full`：含 Pinia + Router + 示例页面
- `super-app`：含 Module 分包 + 权限树 + 监控

**AI 友好**：模板里的每个文件带注释说明"这是 `<route>` 块 / 这是 `mountMpApp` 注册"，AI agent 可直接改。

## 3. M7 — 可靠性（缓存/增量/并行）

### 3.1 构建缓存
- Compiler IR 按文件哈希缓存（plan 06 增量编译）
- CLI 层加 **任务级缓存**：相同 input hash → 跳过 codegen，直接复用产物
- 缓存目录：`node_modules/.cache/proteus/`

### 3.2 并行构建
- `--platform all` 时 web/mp/app **并行**（独立 Compiler 实例）
- 单平台内部：parse 串行、transform 可并行（Worker 池）

### 3.3 资源清理
- `build` 前清理 `dist/` 对应平台子目录（避免遗留旧产物）
- 进程退出 → 清理临时文件 / socket

## 4. M8 — 可观测性 + CI

### 4.1 Telemetry
- `--trace` 输出全链路 JSON（命令 + Compiler + audit spans）
- 可选上报（脱敏，`proteus.config.ts` 显式开启）

### 4.2 CI 门禁
- `proteus audit all --strict` 阻断 PR
- `proteus build --platform all` 产物体积 diff 超限 → warn
- GitHub Actions 模板：`.github/workflows/proteus.yml`（lint + typecheck + build + audit）

### 4.3 doctor 接入 CI
- `proteus doctor --ci` 退出码参与门禁

## 5. 测试策略

| 层级 | 内容 |
|------|------|
| 单测 | 命令注册表、config loader、规则引擎、plugin hook |
| 集成测 | fixture 工程 → `build` → 断言 `dist/` 结构 |
| E2E | 临时目录跑 `create + dev + build + audit` 全流程 |
| snapshot | `--explain` 输出、`audit-report.json` |

详见 `07-testing.md`。
