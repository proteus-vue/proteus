# @proteus-vue/app-config

Proteus 应用全局配置（G-35）——区别于 `proteus.config`（工程构建配置），解决应用级运行时配置。

## 能力（M1：合并 + 校验，纯 TS 零依赖）

| API | 说明 |
|-----|------|
| `mergeAppConfig(layers)` | 四层合并（**默认 < env < platform < remote**，01 §2.1）：深合并 + 数组替换（不拼接） |
| `deepMerge(base, override)` | 深合并原语（对象递归、数组替换、不突变） |
| `extractPlatformOverride(config, platform)` | 平台覆盖提取（§2.2 `platform.ios` 等） |
| `validateAppConfig(config)` | 自研轻量校验（~2KB 零依赖，不强制 zod）：必填 + 范围（semver/timeout/retry/fontScale/枚举） |
| `validateAndApply(config, defaults)` | 校验并应用：**非法降级为默认值 + 告警收集，不抛错**（与 Style Safety G-31 同哲学：宁可降级不崩溃） |

## 使用

```ts
import { mergeAppConfig, validateAppConfig, validateAndApply } from '@proteus-vue/app-config'
import type { AppConfig } from '@proteus-vue/app-config'

const defaults: AppConfig = { /* 完整默认配置 */ }

// 四层合并（默认 < env < platform < remote）
const final = mergeAppConfig({
  defaults,
  env: { api: { baseUrl: 'https://staging.example.com' } },
  platform: { api: { timeout: 15000 } },       // ios 覆盖
  remote: { features: { newHomePage: 'variant-b' } },
})

// 校验（fail-fast 或降级）
const { ok, errors } = validateAppConfig(final)
const { config, invalidFields } = validateAndApply(final, defaults) // 非法字段降级默认值
```

## 状态

- [x] M1：Schema + 合并 + 校验器（100% 单测）
- [ ] M2：`defineAppConfig` + `useAppConfig()` 响应式（Vue runtime）
- [ ] M3：多环境加载 + 平台覆盖
- [ ] M4：远端下发 + L1 缓存（Cache G-28）
- [ ] M5：五端原生持久化 + CLI 集成（G-33）
