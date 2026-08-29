# 测试矩阵 + 迁移 + 分批执行

## 1. 测试矩阵

| 层级 | 工具 | 验证点 |
|------|------|--------|
| 单测 | vitest | 命令注册、config schema、规则引擎、plugin hook |
| 集成 | vitest + fixture | `build` 后 `dist/mp` 结构 + `audit-report.json` |
| E2E | 临时目录 + 子进程 | `create → dev → build → audit` 全流程 |
| snapshot | `--explain` / audit json | 输出稳定（对齐 Compiler plan） |

**跨端矩阵**（关键场景）：
- `build --platform web` → `dist/web/` SPA
- `build --platform mp` → `dist/mp/` 四件套 + app.json appBar
- `build --platform all` → 三者并存，互不污染

## 2. 迁移指南

### 从「手写多条命令」迁移到 CLI

**Before**（手工）：
```bash
vite build && node scripts/build-mp.js && node scripts/audit.js
```

**After**（CLI）：
```bash
proteus build --platform all
proteus audit all
```

**改动量**：≤ 10 行（新建 `proteus.config.ts`，删除旧脚本）。

### 渐进迁移
1. 先只接 `proteus audit`（不改动构建）→ 验证规则无误报
2. 再接 `proteus build --platform mp`（并行保留旧流程，diff 产物）
3. 产物一致 → 切到 CLI，删旧脚本

## 3. 分批执行（B1-B7）

```
B1 命令骨架 + config loader + reporter      → 1 PR
B2 dev/build/preview + --explain             → 1 PR
B3 audit 规则引擎 + route/module/api 规则     → 1 PR
B4 audit capability/lifecycle/compile 规则    → 1 PR
B5 plugin middleware + create-proteus         → 1 PR
B6 缓存/并行/增量                             → 1 PR
B7 doctor + telemetry + CI 模板               → 1 PR
```

每批 = 1 PR = LLM 单次 ≤ 3 文件（对齐防撑爆规则）。

**依赖关系**：
- B1 是地基（config + reporter），先落地
- B2-B4 可部分并行（dev/build 与 audit 相互独立）
- B5 依赖 B2（plugin hook 挂在命令生命周期上）
- B6-B7 依赖所有（性能/CI 最后）

## 4. LLM Prompt 模板（每批）

```
你正在实现 Proteus CLI 的 [Bx: 名称]。
只读以下文件：
1. proteus-cli-plan/00-overview.md（快速回顾）
2. proteus-cli-plan/[当前模块].md（本批规范）
3. proteus-compiler-plan/00-overview.md（Compiler 接口契约）

不要读取其他 plan 文件。
产出：[具体文件列表]，每文件 < 500 行。
对齐铁律：CLI 不实现编译逻辑，只调用 Compiler。
```
