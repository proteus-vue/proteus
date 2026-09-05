---
title: 模块化与分包治理
order: 43
group: 模块化
---

# 模块化与分包治理

Proteus 的模块化 = **业务域声明自身元信息（`proteus-module.config.ts`）+ 编译期构建依赖图谱 → 驱动 Web manualChunks 与分包治理**（`@proteus-vue/module`）。铁律：**公共契约（types/interfaces/events/configSchema）是唯一允许跨模块 import 的东西**。

## 模块契约：proteus-module.config.ts

```ts
// examples/proteus-module.config.ts
import { defineModule } from '@proteus-vue/module'

export default defineModule({
  name: 'app',            // 模块标识（全局唯一，kebab-case）
  version: '1.0.0',       // semver（版本协商用）
  dependencies: {},       // 依赖模块：key = 模块名，value = semver range
  exports: {              // 对外公共契约（仅 types/interfaces/events/configSchema）
    types: ['./types'],
    events: ['./events'],
  },
  chunk: 'app',           // 分包策略（对齐 Router M7.1 chunk）
})
```

## 编译期：模块图谱 → Web manualChunks

`@proteus-vue/module` 管线（examples `proteus.config.ts` 的 vite 字段 async 消费）：

```
scanModuleConfigs(root) → DependencyGraph.fromConfigs(模块清单)
  → generateRollupOptions(graph).rollupOptions   // 有 modules/ 时自动生效
```

Web 构建时模块目录下文件按 `chunk` 归组（manualChunks）——无模块时输出空配置零副作用。

## 分包体积治理

| API（`@proteus-vue/module`） | 说明 |
|---|---|
| `scanSubPackages(outDir, roots)` | 各分包体积统计（纯函数） |
| `evaluateSubPackageSizes(stats)` | 阈值评估（收集式）——返回违规描述 |
| `SUBPACKAGE_LIMITS` | `warnKB: 1536` / `errorKB: 2048`（微信单包硬限）/ `totalErrorKB: 16384` |

bundle-report 与 CLI audit 共用该纯函数层（体积口径单一来源）。

## CLI 工具链

| 命令 | 校验面 |
|---|---|
| `proteus module:check [dir] [--graph]` | 契约缺失 / **依赖环** / 重名 / 版本冲突；`--graph` 追加 Mermaid 依赖图 |
| `proteus module:duplicates [distDir]` | 分包间共享依赖去重检测（hash 相同文件 ≥2 分包 → 报告） |
| `proteus audit module [root] [--dist]` | 综合门禁：契约校验 + 图谱（环/重名/版本冲突）+ 可选产物体积/去重 |

## 下一步

- [体积预算](/docs/framework/perf-budget)：主包预算与 Top N 大文件
- [分包与按需注入](/docs/framework/subpackages)：mp 分包形态
