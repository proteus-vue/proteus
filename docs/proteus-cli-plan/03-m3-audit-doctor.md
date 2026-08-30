# M3 — audit 子命令族 + doctor

## 1. Audit 规则引擎

`proteus audit` 是全栈静态审计的统一入口。核心是一个**规则引擎**：

```ts
// packages/cli/src/audit/engine.ts
export type AuditRule = {
  id: string                 // 'route/no-hardcoded-navigate'
  severity: 'error' | 'warn'
  description: string
  check(ctx: AuditContext): AuditFinding[]
}

export type AuditFinding = {
  ruleId: string
  severity: 'error' | 'warn'
  location: { file: string; line: number; col: number }
  message: string
  fixSuggestion?: string
}
```

规则分散在各层 plan，CLI 负责**收集 + 执行 + 报告**：

```
proteus audit all
  ├─ audit route      → 加载 Router plan M8.6 规则
  ├─ audit module     → 加载 Module plan M8 规则
  ├─ audit api        → 加载 API plan 08 规则
  ├─ audit capability → 加载 Platform plan M8 规则
  ├─ audit lifecycle  → 加载 Lifecycle plan M8 规则
  └─ audit compile    → 加载 Compiler plan M8 规则
```

## 2. 各子命令映射

### 2.1 `audit route`（Router M8.6）
- 硬编码 `wx.navigateTo` / `wx.redirectTo` → error
- 路由深度 > 3 未显式 `parent` → warn
- `<route>` 块 schema 非法 → error

### 2.2 `audit module`（Module M8）
- 跨模块 import 未走 `ModuleBoundary` → error
- 循环依赖 → error
- 业务目录出现 `wx.*` / `window.*` → error（复用 Platform 规则）

### 2.3 `audit api`（API 08）
- 直接 `wx.request` / `fetch` 绕过 `api.request` → error
- 高频写未防抖（MusicPlayer seek 模式）→ warn

### 2.4 `audit capability`（Platform M8）
- 业务代码 `wx.*` / `window.*` 裸调用 → error
- Adapter 模块顶层调平台 API → error
- 能力未注册即使用 → warn

### 2.5 `audit lifecycle`（Lifecycle M8）
- 页面级逻辑写在 App 钩子里 → warn
- `onUnload` 未清理定时器/连接 → warn

### 2.6 `audit compile`（Compiler M8）
- transform 产物无 source map → warn
- 产物体积超预算 → error
- 死代码未消除 → warn

## 3. 规则配置

`proteus.config.ts` 可覆盖：

```ts
export default defineConfig({
  audit: {
    rules: {
      'route/no-hardcoded-navigate': 'error',
      'module/circular-dep': 'off',   // 临时关闭
    },
    strict: true,  // warning 也算失败
  },
})
```

## 4. `proteus doctor`

环境诊断，检查：

| 检查项 | 期望 |
|--------|------|
| Node 版本 | ≥ 20 |
| 微信开发者工具 | 已安装 + CLI 可用 |
| 基础库版本 | ≥ 2.29.2（Skyline 门槛） |
| `@proteus-vue/compiler` | 与 CLI 主版本一致 |
| `proteus.config.ts` | 存在且校验通过 |
| 端口占用 | dev server 端口空闲 |

输出：
```
$ proteus doctor
  ✓ Node 20.10.0
  ✓ WeChat DevTools 1.06.2308310
  ⚠ 基础库 2.28.0 (期望 ≥ 2.29.2 for Skyline)
  ✗ @proteus-vue/compiler 0.9.0 (期望 1.x)
```

## 5. CI 集成

`audit all` 是 CI 门禁：
- `--strict --reporter json` → 产物 `audit-report.json`
- 上传到 GitHub Actions artifact
- 失败 → PR 阻断

对齐前面所有 plan 的 "M8 CI 审计" 章节 —— CLI 是这些章节的**统一执行入口**。

## 6. 透明化对齐

每条 finding 都带：
- `ruleId`（对应 plan 文档章节，如 `route/no-hardcoded-navigate` → `proteus-router-plan/10-ci-audit.md`）
- `fixSuggestion`（可复制粘贴的修复代码）

这让 AI agent 能**读 finding → 定位 plan 文档 → 自动修复**，闭环。
