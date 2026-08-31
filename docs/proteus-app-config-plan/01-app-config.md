# Proteus 应用全局配置落地方案（G-35）

> **定位**：区别于 `proteus.config`（工程/框架构建配置），本方案解决**应用级运行时配置**的统一管理。
> **执行位**：G-35（P1）
> **依赖**：Architecture 规约（原则 #10：统一语义 + 原生实现）、Theme（G-27）、Memorial（G-25）、Style Safety（G-31）
> **被依赖**：所有需要运行时开关的能力模块

---

## 1. 问题定义

### 1.1 现状痛点

跨端框架普遍缺乏**应用级运行时配置**的统一抽象，导致：

| 痛点 | 具体表现 |
|------|---------|
| **配置散落** | API 域名写死在 axios 里、功能开关散在业务代码、主题默认值在 main.ts |
| **多环境混乱** | dev/staging/prod 靠 `process.env.NODE_ENV` 判断，硬编码到处都是 |
| **多端差异** | iOS 要开某个开关、Android 关掉、鸿蒙特殊值 —— 用 `platform` if-else 散落各处 |
| **无法远端更新** | 改个功能开关要发版，无法像 Firebase Remote Config 那样实时下发 |
| **类型不安全** | 配置读取无类型推导，拼错 key 运行时才报错 |
| **缺乏校验** | 远端下发非法值（如负数版本号、错误域名）导致运行时异常 |

### 1.2 概念边界（核心）

> **必须严格区分 `proteus.config` 与 应用全局配置 —— 两者职责完全正交。**

| 维度 | `proteus.config.ts` | **应用全局配置（`app.config`）** |
|------|---------------------|--------------------------------|
| **层级** | 工程 / 框架配置 | 应用级运行时配置 |
| **作用域** | 构建期（Compiler/CLI 消费） | 运行时（Runtime/业务消费） |
| **内容** | targets、compiler、plugins、output、alias | appId、version、**feature flags**、**API 域名**、**主题默认值**、实验分组 |
| **变更方式** | 改配置 → 重新构建打包 | 启动读取 + **可选远端下发热更新** |
| **消费方** | Compiler、CLI、打包流水线 | Runtime、业务代码、`useAppConfig()`、各能力模块 |
| **生命周期** | 构建时固化 | **运行时动态**（可随启动/远端更新变化） |
| **是否进产物** | 部分（构建后不再需要） | **是**（整个运行时需要） |

**一句话**：
- `proteus.config` = "**怎么构建这个 App**"
- `app.config` = "**这个 App 运行时要怎么表现**"

### 1.2b 配置职责边界（决策 #211，2026-08-31 全字段梳理）

> **判断准则（唯一）**：字段被**构建期**消费（Compiler/CLI/打包 → 产物）→ 归 `proteus.config.ts`；字段被**运行时**消费（业务/`useAppConfig`/能力模块）→ 归 `app.config.ts`。

**全字段对照表**：

| 维度 | `proteus.config.ts`（框架/工程） | `app.config.ts`（应用/运行时） |
|------|--------------------------------|-------------------------------|
| 层级 | 工程 / 框架 | 应用级 |
| 生命周期 | 构建时固化（改配置 → 重新构建） | 运行时动态（启动读取 + 可选远端热更新） |
| 消费方 | Compiler / CLI / 打包流水线 | Runtime / 业务 / `useAppConfig()` |
| 进产物 | 部分（构建后不再需要） | 是（整个运行时需要） |
| 平台字段 | `platform` = **构建目标**（mp-weixin/web，决定产物） | `platform` = **运行时平台覆盖层**（ios/android/harmony 差异化） |
| 标识字段 | `appid` = **平台编译标识**（微信 appid，写 project.config.json / IDE / automator） | `app.id` = **应用运行时标识**（上报/多租户；非微信 appid） |
| 视觉相关 | `style.px2rpx/rpxRatio`（编译换算）、`budget`（包体积） | `theme`/`font`/`safeArea`（运行时表现，联动 G-27） |
| 功能开关 | `rules`/`setDataBridge`（编译行为） | `features.*`（运行时开关，可远端下发） |
| 路由 | `router.tabBar`/`meta`（生成 app.json/路由表） | —（路由声明属框架，文案内容后续可下沉） |
| 应用标题 | —（页面导航标题声明：`router.meta.title`） | **`app.name` = 应用标题唯一事实源**（浏览器标签/关于页/分享；Web 运行时设置 document.title） |
| 环境 | —（`env` 属运行时） | `env`（dev/staging/prod 覆盖层） |
| 网络 | — | `api.baseUrl/timeout/retry/cache` |

**易混项澄清**：

| 易混点 | 框架配置（proteus.config） | 应用配置（app.config） | 为何两者都需要 |
|--------|--------------------------|------------------------|----------------|
| `appid` vs `app.id` | `appid`：微信平台编译标识（构建期写 project.config.json） | `app.id`：应用自身运行时标识 | 微信 appid 是编译期必需（IDE 导入/automator 体检）；应用标识是运行时业务语义——**不可互相替代** |
| `platform` ×2 | 构建目标（决定产物端） | 运行时平台覆盖（同端内差异化） | 编译期只能产一端；运行时需要表达「iOS 开、Android 关」 |
| `style` vs `theme/font` | `style`：px→rpx 编译换算（产出 WXSS） | `theme`/`font`：运行时表现（用户可调） | 编译换算 vs 运行时表现，正交 |
| `router.meta.title` | 路由声明（编译期生成 page.json 导航栏标题） | — | 小程序导航栏标题是编译期静态声明；动态文案后续可走运行时配置 |

**铁律**：构建期消费的字段**必须**在 `proteus.config.ts`（放 app.config 会导致编译期读不到）；运行时消费的字段**必须**在 `app.config.ts`（放 proteus.config 会导致无法热更新/无法被业务 `useAppConfig` 读取）。

**示例工程落地**（决策 #211）：`examples/app.config.ts` + config-demo 页 `useAppConfig`/`useFeatureFlag` 演示（详见 §2.3 与 config-demo.vue）——让职责划分有真实形态，避免「应用配置无处安放 → 塞进 proteus.config」。

### 1.3 设计目标

1. **单一事实源**：所有应用级配置集中定义、集中校验
2. **多环境 + 多端**：统一结构，差异通过 `env` / `platform` 覆盖层表达
3. **类型安全**：TS 推导配置 schema，IDE 补全 + 拼错即报错
4. **运行时校验**：启动时校验，非法配置 fail-fast（对接 Style Safety 的降级哲学）
5. **远端下发**：可选集成 Remote Config，支持热更新功能开关
6. **能力联动**：与 Theme / Font / Memorial / Feature Flag 天然打通

---

## 2. 配置语义模型

### 2.1 配置层级（优先级从低到高）

```
┌─────────────────────────────────────────────┐
│  ① 默认值（default）                         │  ← 代码内定义
├─────────────────────────────────────────────┤
│  ② 环境配置（env: dev/staging/prod）         │  ← app.config.{env}.ts
├─────────────────────────────────────────────┤
│  ③ 平台覆盖（platform: ios/android/harmony） │  ← per-platform override
├─────────────────────────────────────────────┤
│  ④ 远端下发（remote config）                 │  ← 运行时覆盖，最高优先级
└─────────────────────────────────────────────┘
            ↓ 合并后 = 运行时最终配置
```

**合并规则**：高层覆盖低层，**深合并（deep merge）**，数组替换（不拼接）。

### 2.2 配置 Schema 定义

```typescript
// types/app-config.ts
import type { Platform, Env } from '@proteus-vue/shared'

/**
 * 应用全局配置 Schema（开发者定义，框架推导类型）
 */
export interface AppConfig {
  /** 应用标识 */
  app: {
    id: string
    name: string
    version: string
    buildNumber: number
  }

  /** 环境 */
  env: Env  // 'dev' | 'staging' | 'prod'

  /** API 与网络 */
  api: {
    baseUrl: string
    timeout: number
    retry: number
    /** 对接 Cache 分层（G-28）：接口缓存策略 */
    cache: {
      defaultTTL: number
      enabledEndpoints: string[]
    }
  }

  /** 功能开关（Feature Flags） */
  features: {
    /** 示例：是否启用玻璃效果（可远端关闭降级） */
    glassEffect: boolean
    /** 示例：是否启用骨架屏 */
    skeletonScreen: boolean
    /** 示例：是否启用纪念日灰度 */
    memorialGray: boolean
    /** 示例：新首页实验组 */
    newHomePage: 'control' | 'variant-a' | 'variant-b'
    /** 扩展点：业务自定义开关 */
    [key: string]: boolean | string | number
  }

  /** 主题默认值（联动 Theme G-27） */
  theme: {
    default: 'light' | 'dark' | 'system'
    allowUserToggle: boolean
  }

  /** 字体默认值（联动 Font G-27） */
  font: {
    defaultScale: number  // 1.0 = 基准
    allowUserAdjust: boolean
  }

  /** 安全区（联动 Safe Area） */
  safeArea: {
    /** 是否全局启用灵动岛玻璃融合 */
    islandGlass: boolean
  }

  /** 平台覆盖（可选，优先级 ③） */
  platform?: Partial<Record<Platform, DeepPartial<AppConfig>>>
}

/** 深层部分（用于平台覆盖） */
type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}
```

### 2.3 配置文件示例

```typescript
// app.config.ts
import { defineAppConfig } from '@proteus-vue/app-config'

export default defineAppConfig({
  app: {
    id: 'com.example.proteusdemo',
    name: 'Proteus Demo',
    version: '1.0.0',
    buildNumber: 1,
  },
  env: 'prod',
  api: {
    baseUrl: 'https://api.example.com',
    timeout: 10000,
    retry: 3,
    cache: {
      defaultTTL: 60,
      enabledEndpoints: ['/api/user', '/api/config'],
    },
  },
  features: {
    glassEffect: true,
    skeletonScreen: true,
    memorialGray: true,
    newHomePage: 'control',
  },
  theme: { default: 'system', allowUserToggle: true },
  font: { defaultScale: 1.0, allowUserAdjust: true },
  safeArea: { islandGlass: true },

  // 平台差异化（优先级 ③）
  platform: {
    ios: {
      features: { glassEffect: true },  // iOS 强化玻璃
    },
    android: {
      api: { timeout: 15000 },  // Android 网络慢，放宽超时
    },
    harmony: {
      features: { glassEffect: false },  // 鸿蒙暂不支持，降级
    },
  },
})
```

**环境配置覆盖**（优先级 ②）：

```typescript
// app.config.dev.ts
import { defineAppConfig } from '@proteus-vue/app-config'

export default defineAppConfig({
  extends: './app.config.ts',  // 继承基础配置
  env: 'dev',
  api: {
    baseUrl: 'https://dev-api.example.com',
    timeout: 30000,
  },
  features: {
    newHomePage: 'variant-a',  // dev 环境默认走实验组
  },
})
```

---

## 3. 运行时消费 API

### 3.1 `useAppConfig()` — 响应式读取

```vue
<script setup>
import { useAppConfig } from '@proteus-vue/app-config'

const config = useAppConfig()

// ✅ 类型安全 + 响应式（配置更新时自动触发重新渲染）
if (config.features.glassEffect) {
  // 启用玻璃
}
</script>
```

### 3.2 `getConfig()` / `setConfig()` — 命令式

```typescript
import { getConfig, setConfig } from '@proteus-vue/app-config'

// 读取（非响应式场景）
const baseUrl = getConfig().api.baseUrl

// 写入（如远端下发后更新，触发响应式更新）
setConfig({ features: { newHomePage: 'variant-b' } })
```

### 3.3 与能力模块联动

```typescript
// Theme（G-27）读取默认值
import { useTheme } from '@proteus-vue/theme'
const theme = useTheme()
theme.setMode(getConfig().theme.default)  // 'system' | 'light' | 'dark'

// Memorial（G-25）读取开关
if (getConfig().features.memorialGray) {
  enableMemorialGray()
}

// Glass：动态控制是否启用玻璃
<p-glass v-if="config.features.glassEffect" blur="20" />
```

---

## 4. 远端下发（Remote Config）

### 4.1 集成模型

```
启动 → 读取本地配置（① 默认 + ② env + ③ platform）
     → 异步拉取远端配置（④）
     → 合并 → 校验 → 生效（响应式更新）
```

```typescript
// app.config.ts
export default defineAppConfig({
  // ...
  remote: {
    enabled: true,
    /** 远端配置源 */
    source: {
      type: 'https',          // 'https' | 'firebase' | 'custom'
      url: 'https://config.example.com/v1/app',
      /** 自定义拉取函数（可选） */
      fetcher: async (ctx) => { /* ... */ },
    },
    /** 拉取策略 */
    strategy: {
      fetchOnLaunch: true,     // 启动时拉取
      fetchInterval: 3600000,   // 每小时轮询
      cacheToDisk: true,        // 缓存到 L1（对接 Cache G-28）
    },
    /** 降级：拉取失败时用本地缓存 */
    fallback: 'cache-or-default',
  },
})
```

### 4.2 远端配置格式

```json
// https://config.example.com/v1/app
{
  "features": {
    "glassEffect": false,
    "newHomePage": "variant-b"
  },
  "api": {
    "timeout": 8000
  }
}
```

**合并逻辑**：远端配置只覆盖它声明的字段（深合并），未声明的保留本地值。

### 4.3 安全考量

| 风险 | 防护 |
|------|------|
| **恶意下发** | 签名校验（HMAC）+ 可选加密 |
| **非法值** | 运行时校验（见第 5 节），失败则拒绝并告警 |
| **过度频繁** | 节流 + 本地缓存 + 最小拉取间隔 |
| **敏感信息** | 远端配置只放**非敏感**开关，**密钥类放原生端 Keychain/KeyStore** |

> ⚠️ **架构原则**：远端配置**绝不承载敏感信息**（密钥、token）。敏感配置走原生端安全存储（iOS Keychain / Android KeyStore / 鸿蒙 KeyStore），应用配置只放**功能与参数**。

---

## 5. 配置校验（启动时 fail-fast）

### 5.1 校验规则

```typescript
// types/app-config-schema.ts
import { z } from 'zod'  // 或自研轻量校验器（避免依赖）

export const AppConfigSchema = z.object({
  app: z.object({
    id: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    buildNumber: z.number().int().positive(),
  }),
  api: z.object({
    baseUrl: z.string().url(),
    timeout: z.number().min(100).max(60000),
    retry: z.number().int().min(0).max(10),
  }),
  features: z.record(z.union([z.boolean(), z.string(), z.number()])),
  theme: z.object({
    default: z.enum(['light', 'dark', 'system']),
  }),
  // ...
})
```

### 5.2 校验时机

```
① 构建期：Compiler 校验 app.config.ts 类型（TS 已保证）
② 启动期：合并后配置通过 Schema 校验
    - 合法 → 正常启动
    - 非法 → fail-fast：控制台错误 + 上报 + 降级到默认值
③ 远端更新期：setConfig() 时再次校验
```

**降级哲学**（对齐 Style Safety G-31 + 架构原则 #10）：
> **宁可降级到"安全默认"，也不让非法配置引发运行时异常。**

```typescript
function validateAndApply(config: AppConfig, source: 'local' | 'remote') {
  const result = AppConfigSchema.safeParse(config)
  if (!result.success) {
    __DEV__ && warn(`[AppConfig] Invalid config from ${source}:`, result.error)
    // 降级：保留当前合法配置，远端值丢弃
    return currentValidConfig
  }
  currentValidConfig = result.data
  notifyReactiveListeners()  // 触发 useAppConfig() 响应式更新
  return currentValidConfig
}
```

---

## 6. 五端实现映射

| 能力 | Web / Skyline | iOS | Android | 鸿蒙 |
|------|---------------|-----|---------|------|
| 配置存储 | localStorage | UserDefaults | SharedPreferences | preferences |
| 远端拉取 | fetch | URLSession | OkHttp | http |
| 持久化缓存 | IndexedDB/L1 | Codable | DataStore | preferences |
| 响应式通知 | Vue reactive | Combine / KVO | LiveData / Flow | ArkUI @State |
| 启动读取 | 同步 | Info.plist + async | BuildConfig + async | module.json5 + async |

**关键**：配置存储各端用原生方式（原则 #10），框架定义统一语义 `AppConfig`。

---

## 7. 与 Style Safety（G-31）的协同

> **Style Safety 保证"样式值合法"，App Config 保证"配置值合法" —— 两者共用同一套校验哲学。**

| 维度 | Style Safety | App Config |
|------|--------------|------------|
| 保护对象 | CSS/样式值 | 应用配置值 |
| 校验时机 | 编译期 + 运行时 | 启动期 + 远端更新期 |
| 降级策略 | 丢弃非法值 → 朴素正确 | 拒绝非法 → 保留当前 |
| 类型系统 | CSS 值类型 | Schema (zod) |
| 对原生保护 | 防止 JSI 收到非法样式 → crash | 防止业务读到非法配置 → 异常 |

**共享基础设施**：
- 校验器可复用 Style Safety 的 `Validator` 接口
- 降级日志统一走 DevTools（G-34）面板
- 校验规则可由 `--strict` CLI 开关统一控制

---

## 8. CLI 集成（G-33）

```bash
# 校验配置
proteus check config

# 生成配置类型声明（从 schema 推导 .d.ts）
proteus gen config-types

# 预加载远端配置（构建期 fetch，减少首屏等待）
proteus build --preload-remote-config
```

`proteus check config` 输出：
```
✔ app.version 符合 semver
✔ api.baseUrl 是合法 URL
✔ features.newHomePage ∈ ['control','variant-a','variant-b']
✘ api.timeout 超出范围 [100, 60000]：当前 99999
  → app.config.ts:42
```

---

## 9. 严格规则（新增）

| 规则 | 说明 | 级别 |
|------|------|------|
| `CFG001` | 禁止硬编码 API 域名（必须用 `config.api.baseUrl`） | error |
| `CFG002` | 禁止 `process.env` 判断环境（用 `config.env`） | error |
| `CFG003` | 功能开关必须定义在 `features` schema 内 | warning |
| `CFG004` | 远端配置不得包含敏感信息 | error（CI 扫描） |
| `CFG005` | 平台覆盖必须通过 `platform` 字段，禁止散落 if-else | error |
| `CFG006` | 读取配置必须使用 `useAppConfig()` / `getConfig()` | warning |

**自动修复**：
- `CFG001`：`https://hardcoded.com` → `config.api.baseUrl`（需开发者确认）
- `CFG005`：检测到 `if (platform === 'ios')` → 提示迁移到 `platform.ios`

---

## 10. 分批策略

| 批次 | 内容 | 依赖 | 可单测 |
|------|------|------|--------|
| **M1** | Schema 定义 + 合并逻辑 + 校验器 | 无 | ✅ 纯逻辑 |
| **M2** | `defineAppConfig` + `useAppConfig()` 响应式 | Vue runtime | ✅ |
| **M3** | 多环境加载 + 平台覆盖 | M1 | ✅ |
| **M4** | 远端下发（https source）+ 缓存 | Cache G-28 | ⚠️ 需 mock |
| **M5** | 原生端持久化 + CLI `check`/`gen` | CLI G-33 | ⚠️ 需原生 |

**M1 最小验证**：纯 TS 实现 config merge + schema validate，100% 单测覆盖，**零依赖**。最快出可演示 demo。

---

## 11. 对标竞品

| 能力 | uni-app | RN | Flutter | **Proteus** |
|------|---------|-----|---------|------------|
| 统一配置抽象 | ❌（散落 .env / manifest） | ❌（react-native-config） | ⚠️（flutter_config） | ✅ 内置 |
| 多环境 + 多端覆盖 | ⚠️ 手动 | ⚠️ 手动 | ⚠️ 手动 | ✅ 结构化 |
| 类型安全 | ❌ | ❌ | ⚠️（dart define） | ✅ TS 推导 |
| 远端下发集成 | ❌ | ⚠️（第三方） | ⚠️（Firebase） | ✅ 一等公民 |
| 运行时校验 | ❌ | ❌ | ⚠️ | ✅ Schema fail-fast |
| 与能力模块联动 | ❌ | ❌ | ⚠️ | ✅ Theme/Font/Memorial |

**Proteus = 唯一提供"应用级配置一等公民 + 类型安全 + 远端下发 + 能力联动"的跨端框架。**

---

## 12. 反例与 FAQ

### Q1: 应用配置和 `proteus.config` 会不会混淆？
**不会**。两者文件分离（`proteus.config.ts` vs `app.config.ts`）、消费方分离（Compiler vs Runtime）、生命周期分离（构建期 vs 运行时）。文档与 IDE 类型会明确区分。

### Q2: 远端配置下发失败怎么办？
**降级链**：远端失败 → 用本地缓存（L1）→ 缓存也没有 → 用默认值。**应用永不因配置失败而崩溃**。

### Q3: 配置太大影响启动？
**不会**。配置通常是 KB 级（开关 + 域名 + 参数）。远端拉取异步，**不阻塞首屏**，首屏用本地默认值。

### Q4: 敏感信息放哪里？
**远端配置只放非敏感开关**。密钥类走原生端安全存储（Keychain/KeyStore），通过 JSI 暴露 `useSecret(key)` —— 不在应用配置里。

### Q5: 和 Feature Flag 服务（LaunchDarkly 等）怎么集成？
**两种模式**：
- 轻量：直接用内置 Remote Config（自建 / Firebase）
- 企业：实现 `RemoteSource` 接口对接 LaunchDarkly / Split.io / 自研平台

---

## 13. 与 Architecture 原则 #10 的关系

> **App Config 是原则 #10「统一语义 + 原生实现」在"配置管理"领域的又一次应用。**

```
统一语义层（AppConfig Schema + API）
    ↓ Compiler / Runtime 消费
各端原生实现（存储 / 拉取 / 持久化）
    ↓
五端一致的配置体验 + 各端最优实现
```

**框架定义"配置长什么样、怎么校验、怎么联动"，各端用原生方式存储和拉取。** 这正是 Proteus 一以贯之的设计哲学。

---

## 附：完整配置示例（生产级）

```typescript
// app.config.ts
import { defineAppConfig } from '@proteus-vue/app-config'

export default defineAppConfig({
  app: {
    id: 'com.example.proteusdemo',
    name: 'Proteus Demo',
    version: '1.2.0',
    buildNumber: 42,
  },
  env: 'prod',
  api: {
    baseUrl: 'https://api.example.com',
    timeout: 10000,
    retry: 3,
    cache: { defaultTTL: 60, enabledEndpoints: ['/api/user'] },
  },
  features: {
    glassEffect: true,
    skeletonScreen: true,
    memorialGray: true,
    newHomePage: 'control',
    // 业务自定义...
  },
  theme: { default: 'system', allowUserToggle: true },
  font: { defaultScale: 1.0, allowUserAdjust: true },
  safeArea: { islandGlass: true },

  remote: {
    enabled: true,
    source: { type: 'https', url: 'https://config.example.com/v1/app' },
    strategy: { fetchOnLaunch: true, fetchInterval: 3600000, cacheToDisk: true },
    fallback: 'cache-or-default',
  },

  platform: {
    ios: { features: { glassEffect: true } },
    android: { api: { timeout: 15000 } },
    harmony: { features: { glassEffect: false } },
  },
})
```
