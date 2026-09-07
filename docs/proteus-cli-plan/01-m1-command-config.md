# M1 — 命令骨架 + 配置加载 + Reporter

## 1. Command Registry

CLI 内部用统一的命令注册表，每条命令是一个纯函数：

```ts
// packages/cli/src/commands/build.ts
export const build: Command = {
  name: 'build',
  description: '生产构建',
  options: {
    platform: { type: 'string', default: 'all' },
    trace: { type: 'boolean', default: false },
    strict: { type: 'boolean', default: false },
  },
  async run(ctx: Context) {
    // 1. 校验 config
    // 2. 调用 Compiler
    // 3. 报告产物
  },
}
```

**AI 可读契约**：每个 command 文件头部 JSDoc 写清「输入（ctx 字段）→ 输出（产物/退出码）→ 依赖（Compiler 哪个模块）」，对齐 Compiler plan 的 transform JSDoc 规范。

## 2. Config Loader

`proteus.config.ts` 是统一配置入口，CLI 负责加载 + zod 校验：

```ts
// proteus.config.ts（用户写）
import { defineConfig } from 'proteus/cli'

export default defineConfig({
  app: { name: 'my-app' },
  platforms: {
    web: { entry: 'src/main.web.ts' },
    mp: {
      entry: 'src/main.mp.ts',
      appBar: './src/global/AppBar.vue',
      rootComponents: ['ProteusConfig'],
    },
  },
  modules: ['./src/**/proteus-module.config.ts'],
})
```

**校验顺序**：
1. 用 zod schema 校验结构（早失败，报错带 `config file:line`）
2. 与 Compiler IR schema 对齐（复用 `proteus-compiler` 的 type）
3. 注入默认值（如 `platform: all`）

**铁律**：CLI 绝不修改 config，只读取 → 保证确定性。

## 3. Reporter（输出层）

统一输出格式，供人 + AI 消费：

```
[proteus] build --platform mp
  ✓ config loaded (12ms)
  ✓ compiler: parse (340ms, 128 files)
  ✓ compiler: transform (1.2s, 86 transforms)
  ✓ compiler: codegen → dist/mp (890ms)
  ✓ audit: route (2 warnings)
  ⚠ 2 warnings (use --strict to fail)
  → dist/mp/  (4.2 MB, 312 files)
```

**两种模式**：
- `tty`：彩色进度条（人看）
- `json`（`--reporter json`）：结构化（CI / AI agent 消费）

## 4. 可观测性对齐

每条命令执行都会产出 trace span，与 Lifecycle/API/Pinia 的 traceId 体系打通：

```json
{
  "command": "build",
  "platform": "mp",
  "spans": [
    { "name": "config.load", "duration_ms": 12 },
    { "name": "compiler.parse", "duration_ms": 340 },
    { "name": "compiler.codegen", "duration_ms": 890 }
  ]
}
```

## 5. 测试

- 单测：`mock Compiler`，验证命令编排逻辑
- 集成测：临时 `proteus.config.ts` + fixture → 跑 `build` → 断言 `dist/mp` 结构
- snapshot：`--explain` 输出快照（对齐 Compiler plan 的 snapshot 审计）

详见 `07-testing.md`。
