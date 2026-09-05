---
title: 应用配置 app.config
order: 11
group: 代码构成
---

# 应用配置 app.config

工程里有**两个配置文件**，职责正交（决策 #211）：

| 文件 | 时机 | 管什么 | 消费方 |
|---|---|---|---|
| `proteus.config.ts` | **构建期** | 怎么构建：appid / skyline / pagesDir / 编译规则 / 样式转换 | 编译器、CLI、Vite 插件 |
| `app.config.ts` | **运行时** | 怎么表现：应用标识 / API 地址 / 功能开关 / 主题字体 / 安全区 | 业务代码（`useAppConfig`） |

> 一句话：**proteus.config 管「怎么构建」，app.config 管「怎么表现」**。改构建配置要重新 `build:mp`；改运行时配置可远端热更新。

## 定义

```ts
// app.config.ts
import { defineAppConfig } from '@proteus-vue/app-config'

export default defineAppConfig({
  app: {
    id: 'com.proteus.demo',        // 应用运行时标识（上报/多租户）
    name: 'Proteus Demo',
    version: '1.0.0',
    buildNumber: 1,
  },
  env: 'dev',                      // 'dev' | 'staging' | 'prod'
  api: {
    baseUrl: 'https://api.example.com',
    timeout: 10000,
    retry: 3,
    cache: { defaultTTL: 60, enabledEndpoints: [] },
  },
  features: {                      // 功能开关（useFeatureFlag 消费）
    glassEffect: true,
    skeletonScreen: true,
    newHomePage: 'control',        // 也可以是实验分组值
  },
  theme: { default: 'system', allowUserToggle: true },
  font: { defaultScale: 1.0, allowUserAdjust: true },
  safeArea: { islandGlass: true },
})
```

> **app.id ≠ proteus.config 的 appid**：前者是应用运行时标识（业务上报用）；后者是微信平台编译标识（构建期写进 project.config.json）。

## 校验

```bash
proteus app-config:check app.config.ts
```

字段缺失 / 类型错误 / 版本迁移提示——CI 里接 `proteus check` 聚合门禁。

## 下一步

- [运行时配置消费](/docs/framework/app-config-runtime)：合并层级、平台覆盖、远端热更新、useAppConfig
