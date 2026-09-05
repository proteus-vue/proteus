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

> 一句话：**proteus.config 管「怎么构建」，app.config 管「怎么表现」**。改构建配置要重新 `build:mp`；改运行时配置可远端热更新。类型契约 `AppConfig`（`@proteus-vue/app-config` 单一来源）。

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

## 字段全表（AppConfig Schema）

### `app`（应用标识）

| 字段 | 类型 | 必填 | 校验规则 | 说明 |
|---|---|---|---|---|
| `id` | `string` | 是 | 非空字符串 | 应用运行时标识（上报/多租户） |
| `name` | `string` | 是 | 非空字符串 | 应用名称 |
| `version` | `string` | 是 | semver（`1.0.0` / `1.0.0-beta.1`） | 应用版本号 |
| `buildNumber` | `number` | 是 | 非负整数 | 构建号（每次构建递增） |

### `env`（环境）

| 字段 | 类型 | 必填 | 校验规则 | 说明 |
|---|---|---|---|---|
| `env` | `'dev' \| 'staging' \| 'prod'` | 是 | 三值枚举 | 当前环境；驱动 `app.config.{env}.ts` 覆盖层选择 |

### `api`（接口层）

| 字段 | 类型 | 必填 | 校验规则 | 说明 |
|---|---|---|---|---|
| `baseUrl` | `string` | 是 | 非空字符串 | 接口域名（R1 层请求的缺省 origin） |
| `timeout` | `number` | 是 | `(0, 120000]` ms | 请求超时 |
| `retry` | `number` | 是 | `0-5` 整数 | 失败重试次数 |
| `cache.defaultTTL` | `number` | 否 | 秒 | 接口缓存缺省 TTL |
| `cache.enabledEndpoints` | `string[]` | 否 | 路径列表 | 启用缓存的端点白名单 |

### `features`（功能开关）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `glassEffect` | `boolean` | 是 | 玻璃拟态效果开关（G-07 液态玻璃） |
| `skeletonScreen` | `boolean` | 是 | 骨架屏开关（p-skeleton） |
| `memorialGray` | `boolean` | 是 | 置灰模式（公祭日等场景） |
| `newHomePage` | `'control' \| 'variant-a' \| 'variant-b'` | 是 | A/B 实验分组值 |
| `[key: string]` | `boolean \| string \| number` | 否 | 业务自定义开关（useFeatureFlag 消费） |

### `theme` / `font` / `safeArea`（表现层）

| 字段 | 类型 | 必填 | 校验规则 | 说明 |
|---|---|---|---|---|
| `theme.default` | `'light' \| 'dark' \| 'system'` | 是 | 三值枚举 | 缺省主题（system 跟随系统） |
| `theme.allowUserToggle` | `boolean` | 是 | 布尔 | 是否允许用户切换主题 |
| `font.defaultScale` | `number` | 是 | `0.5-2.0` | 缺省字号缩放（联动 p-scale 无障碍档位） |
| `font.allowUserAdjust` | `boolean` | 是 | 布尔 | 是否允许用户调字号 |
| `safeArea.islandGlass` | `boolean` | 是 | 布尔 | 灵动岛/刘海屏玻璃适配（p-safe 消费） |

### 可选扩展字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `platform` | `Partial<Record<Platform, DeepPartial<AppConfig>>>` | 否 | 按端深层覆盖（Platform = `mp-weixin` / `web` / `ios` / `android` / `harmony`），见 [运行时配置消费](/docs/framework/app-config-runtime) |
| `remote` | `RemoteConfigConfig` | 否 | 远端下发策略：`enabled` / `source.type`（`'https' \| 'local'`）/ `source.url` / `strategy`（`fetchOnLaunch` / `fetchInterval` / `cacheToDisk`）/ `fallback`（`'last-cached' \| 'defaults'`） |

## 校验

```bash
proteus app-config:check app.config.ts
```

校验器是**规则表驱动**（自研 ~2KB，零 zod 依赖；ES5 安全——运行时进 MP 产物）：上表的「校验规则」列即 `validate.ts` 的 `RULES` 逐条映射。语义：

- **合法→生效，非法→拒绝 + 告警**（不抛错、不静默破坏——宁可降级也不崩溃，与 Style Safety G-31 同哲学）
- `setConfig()` 深合并**后**整体校验（浅合并会整体替换 features 导致误报缺失）
- 运行时校验失败：`setConfig` 返回 `{ ok: false, errors }` 并拒绝更新
- 构建期校验：CI 里接 `proteus check` 聚合门禁

## 工具

- `proteus gen config`：生成类型安全骨架（IDE 补全 features.xxx——`defineAppConfig` 泛型推导）
- `proteus app-config:check app.config.ts`：字段/类型/迁移校验（缺文件跳过不阻断，独立命令报错）

## 下一步

- [运行时配置消费](/docs/framework/app-config-runtime)：合并层级、平台覆盖、远端热更新、useAppConfig
