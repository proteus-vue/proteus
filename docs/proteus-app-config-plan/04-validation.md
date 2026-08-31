# 配置校验设计（G-35）

## 1. 校验时机（三层）

```
① 构建期：Compiler 校验 app.config.ts 类型（TS 已保证）
② 启动期：合并后配置通过 Schema 校验
③ 运行时：setConfig() / 远端更新时再次校验
```

## 2. Schema 定义

```typescript
// 使用 zod（或自研轻量校验器）
import { z } from 'zod'

export const AppConfigSchema = z.object({
  app: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'must be semver'),
    buildNumber: z.number().int().positive(),
  }),
  env: z.enum(['dev', 'staging', 'prod']),
  api: z.object({
    baseUrl: z.string().url('must be valid URL'),
    timeout: z.number().min(100).max(60000),
    retry: z.number().int().min(0).max(10),
    cache: z.object({
      defaultTTL: z.number().min(0),
      enabledEndpoints: z.array(z.string()),
    }),
  }),
  features: z.record(
    z.union([z.boolean(), z.string(), z.number()])
  ),
  theme: z.object({
    default: z.enum(['light', 'dark', 'system']),
    allowUserToggle: z.boolean(),
  }),
  font: z.object({
    defaultScale: z.number().min(0.5).max(3.0),
    allowUserAdjust: z.boolean(),
  }),
  safeArea: z.object({
    islandGlass: z.boolean(),
  }),
})
```

## 3. 校验实现

```typescript
function validateAndApply(
  config: unknown,
  source: 'local' | 'remote' | 'setConfig'
): AppConfig {
  const result = AppConfigSchema.safeParse(config)

  if (!result.success) {
    // 开发模式：详细错误
    __DEV__ && warn(`[AppConfig] Invalid config from ${source}:`, result.error.issues)
    // 上报（生产）
    reportToDevTools({ type: 'config-validation-failed', source, issues: result.error.issues })

    // 降级：保留当前合法配置
    return currentValidConfig
  }

  // 校验通过 → 生效
  currentValidConfig = result.data
  notifyReactiveListeners()
  return currentValidConfig
}
```

**降级哲学**（对齐 Style Safety G-31）：
> **宁可降级到"安全默认"，也不让非法配置引发运行时异常。**

## 4. 校验场景

### 4.1 构建期

Compiler 读取 `app.config.ts`，TS 类型检查已保证结构合法。额外检查：
- `env` 值与 `app.config.${env}.ts` 文件名一致
- `platform` 字段只包含合法平台（ios/android/harmony/web/skyline）

### 4.2 启动期

合并 ① 默认 + ② env + ③ platform 后整体校验。

### 4.3 远端更新期

每次 `setConfig()`（含远端拉取回调）都走校验。

## 5. 自定义校验规则

```typescript
// 业务可扩展校验
export const customRules = [
  {
    path: 'api.baseUrl',
    validate: (url: string) => {
      // 禁止内网地址（安全）
      if (url.includes('localhost') && getConfig().env === 'prod') {
        return 'localhost not allowed in prod'
      }
      return null
    },
  },
]
```

## 6. 与 Style Safety (G-31) 的协同

| 维度 | Style Safety | App Config |
|------|--------------|------------|
| 保护对象 | CSS/样式值 | 应用配置值 |
| 校验时机 | 编译期 + 运行时 | 启动期 + 更新期 |
| 降级策略 | 丢弃非法 → 朴素正确 | 拒绝 → 保留当前 |
| 类型系统 | CSS 值类型 | Schema (zod) |

**共享基础设施**：
- 校验器可复用 Style Safety 的 `Validator` 接口
- 降级日志统一走 DevTools（G-34）
- `--strict` CLI 开关统一控制

## 7. 错误示例

```
✘ [AppConfig] Invalid config from remote:
  - api.timeout: 99999 > 60000 (max)
  - app.version: "1.0" does not match semver
  → fallback to current valid config
```

```
✔ [AppConfig] Validation passed (source: local)
  - app.version: 1.2.0
  - api.baseUrl: https://api.example.com
  - features: 4 keys
```
