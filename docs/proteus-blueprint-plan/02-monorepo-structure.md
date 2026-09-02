# Monorepo 结构

> **把 15 份 plan 落地为可执行的 `packages/*` 结构**

---

## 2.1 目录结构

```
proteus-music/                    ← 验证应用（本蓝图产物）
├── packages/
│   ├── compiler/                 ← proteus-compiler-plan
│   ├── cli/                      ← proteus-cli-plan
│   ├── types/                    ← proteus-types-plus-plan
│   ├── testing/                  ← proteus-testing-plan
│   ├── devtools/                 ← proteus-devtools-plan
│   ├── build/                    ← proteus-build-plan
│   ├── security/                 ← proteus-security-plan
│   ├── i18n/                     ← proteus-i18n-plan
│   │
│   ├── runtime/                  ← 运行时层（组合 7 份 plan）
│   │   ├── pinia/                ←   proteus-pinia-plan
│   │   ├── router/               ←   proteus-router-plan
│   │   ├── api/                  ←   proteus-api-plan
│   │   ├── component/            ←   proteus-component-plan
│   │   ├── platform/             ←   proteus-platform-plan
│   │   ├── lifecycle/            ←   proteus-lifecycle-plan
│   │   └── module/               ←   proteus-module-plan
│   │
│   └── app/                      ← 应用层（Proteus Music 业务）
│       ├── modules/              ← 15 个业务模块（对应 01-app-spec）
│       │   ├── player/
│       │   ├── trade/
│       │   ├── social/
│       │   ├── content/
│       │   ├── account/
│       │   └── campaign/
│       └── main.{web,mp,app}.ts  ← 三端入口
│
├── docs/                         ← 12 份 blueprint 文档
│   └── blueprint/
│
├── pnpm-workspace.yaml
├── proteus.config.ts              ← 统一配置（对齐 types plan）
└── package.json
```

## 2.2 依赖关系（pnpm workspace）

```yaml
# pnpm-workspace.yaml (示意)
packages:
  - 'packages/*'
  - 'packages/runtime/*'
  - 'packages/app/modules/*'

dependencies:
  # 基建层（无依赖）
  '@proteus-vue/compiler': workspace:*
  '@proteus-vue/types': workspace:*
  
  # 运行时层（依赖基建）
  '@proteus-vue/pinia': 
    workspace:*, 
    requires: ['@proteus-vue/compiler', '@proteus-vue/types']
  '@proteus-vue/lifecycle':
    workspace:*,
    requires: ['@proteus-vue/compiler', '@proteus-vue/types']
  '@proteus-vue/module':
    workspace:*,
    requires: ['@proteus-vue/compiler', '@proteus-vue/types']
  
  # 应用层（依赖运行时）
  '@app/modules/player':
    workspace:*,
    requires: ['@proteus-vue/pinia', '@proteus-vue/lifecycle', '@proteus-vue/api']
```

**验收点**：
- [ ] `pnpm install` 后依赖图无循环（Turbo / pnpm why 验证）
- [ ] `proteus audit module` 检测 workspace 内循环依赖
- [ ] 每个 package 独立可发布（changeset 管理版本）

## 2.3 配置单一来源（对齐 types plan）

```ts
// proteus.config.ts
import { defineConfig } from '@proteus-vue/types'

export default defineConfig({
  // Compiler
  compiler: { /* ... */ },
  
  // Router (chunk → 分包)
  router: {
    routes: [
      { path: '/player', chunk: 'player' },
      { path: '/trade/*', chunk: 'trade' },
    ],
  },
  
  // Lifecycle
  lifecycle: {
    phases: ['bootstrap', 'coreReady', 'navigationReady', 'interactive'],
  },
  
  // Module
  modules: [
    { name: 'player', chunk: 'player', dependencies: ['user'] },
    { name: 'trade', chunk: 'trade', dependencies: ['user', 'security'] },
  ],
  
  // i18n
  i18n: {
    locales: ['zh-CN', 'en-US', 'ar'],
    default: 'zh-CN',
  },
})
```

**关键**：所有 plan 的 config 字段**统一收敛到这一个文件**（对齐 `proteus-types-plus-plan/02-m2-config-schema.md`），禁止各自定义。

## 2.4 三端入口

```
main.web.ts   → createApp() + SPA mount
main.mp.ts    → defineApp() + appBar + Page()
main.app.ts   → createNativeApp() + Custom Renderer
```

编译产物：
```
dist/web/   ← Vite SPA
dist/mp/    ← 150 页四件套 + subPackages/ + app-bar/
dist/app/   ← Native 模块 + JSI bridge
```

---
