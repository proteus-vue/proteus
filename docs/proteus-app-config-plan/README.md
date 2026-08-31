# Proteus 应用全局配置落地方案（G-35）

> **区别于 `proteus.config`（工程/框架构建配置），本方案解决应用级运行时配置的统一管理。**

## 核心定位

| | `proteus.config` | **应用全局配置（本方案）** |
|---|---|---|
| 层级 | 工程/框架 | 应用级运行时 |
| 作用域 | 构建期 | 运行时 + 可远端更新 |
| 内容 | targets/compiler/plugins/output | appId/版本/功能开关/API 域名/实验分组 |
| 消费方 | Compiler / CLI | Runtime / 业务 / 能力模块 |

**一句话**：`proteus.config` = "怎么构建"；`app.config` = "运行时怎么表现"。

## 设计原则

1. **单一事实源** — 集中定义、集中校验
2. **多环境 + 多端** — `env` / `platform` 覆盖层
3. **类型安全** — TS 推导 schema
4. **运行时校验** — 启动时校验，非法 fail-fast
5. **远端下发** — 可选 Remote Config 热更新
6. **能力联动** — Theme / Font / Memorial / Feature Flag

## 文档清单

| 文件 | 内容 |
|------|------|
| `01-app-config.md` | ★ 主文档：问题定义/语义模型/运行时 API/远端下发/校验/五端映射/对标 |
| `02-runtime-api.md` | `useAppConfig()` / `getConfig()` / `setConfig()` + 响应式实现 |
| `03-remote-config.md` | 远端下发：source/strategy/降级/安全 |
| `04-validation.md` | Schema 校验 + fail-fast + 降级哲学 |
| `05-five-end-storage.md` | 五端持久化映射（UserDefaults/SharedPreferences/preferences） |
| `06-cli-integration.md` | `proteus check config` / `gen config-types` |
| `07-strict-rules.md` | CFG001-006 + 自动修复 |
| `08-benchmark-budgets.md` | 性能预算 + 验收矩阵 |
| `09-batches.md` | M1-M5 分批 + Prompt 模板 |
| `architecture-update.md` | Architecture 规约更新（G-35） |

## 快速示例

```typescript
// app.config.ts
import { defineAppConfig } from '@proteus-vue/app-config'

export default defineAppConfig({
  app: { id: 'com.example.app', version: '1.0.0', buildNumber: 1 },
  env: 'prod',
  api: { baseUrl: 'https://api.example.com', timeout: 10000, retry: 3 },
  features: {
    glassEffect: true,
    skeletonScreen: true,
    memorialGray: true,
    newHomePage: 'control',
  },
  theme: { default: 'system', allowUserToggle: true },
  font: { defaultScale: 1.0, allowUserAdjust: true },
  safeArea: { islandGlass: true },
  // 平台差异化
  platform: {
    ios: { features: { glassEffect: true } },
    android: { api: { timeout: 15000 } },
    harmony: { features: { glassEffect: false } },
  },
})
```

```vue
<!-- 业务消费 -->
<script setup>
const config = useAppConfig()
</script>

<template>
  <p-glass v-if="config.features.glassEffect" blur="20" />
</template>
```

## 依赖

- Architecture 规约（原则 #10）
- Theme (G-27)、Font (G-27)、Memorial (G-25)
- Style Safety (G-31)、Cache (G-28)
- CLI (G-33)、DevTools (G-34)
