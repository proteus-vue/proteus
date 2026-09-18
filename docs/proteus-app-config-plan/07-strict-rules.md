# 严格规则（G-35）

## 规则清单

| 规则 | 说明 | 级别 | 自动修复 |
|------|------|------|---------|
| `CFG001` | 禁止硬编码 API 域名（必须用 `config.api.baseUrl`） | error | ⚠️ 需确认 |
| `CFG002` | 禁止 `process.env.NODE_ENV` 判断环境（用 `config.env`） | error | ✅ |
| `CFG003` | 功能开关必须声明在 `features` schema | warning | ✅ |
| `CFG004` | 远端配置不得含敏感信息（密钥/secret/token） | error (CI) | ❌ |
| `CFG005` | 平台覆盖必须用 `platform` 字段，禁止散落 if-else | error | ⚠️ 提示 |
| `CFG006` | 读取配置必须用 `useAppConfig()`/`getConfig()` | warning | ✅ |

## 规则详解

### CFG001：禁止硬编码域名

```typescript
// ❌
axios.get('https://api.example.com/user')
// ✅
axios.get(`${getConfig().api.baseUrl}/user`)
```

**检测**：静态扫描字符串字面量匹配 URL 模式。

### CFG002：禁止 process.env 判断环境

```typescript
// ❌
if (process.env.NODE_ENV === 'production') {}
// ✅
if (getConfig().env === 'prod') {}
```

**自动修复**：`process.env.NODE_ENV` → `getConfig().env`（映射 dev/staging/prod）。

### CFG003：功能开关声明

```typescript
// app.config.ts 必须声明
features: {
  newHomePage: 'control',  // ✅ 声明了
}
// 使用未声明的 key → warning
config.features.undeclared  // ⚠️ CFG003
```

### CFG004：敏感信息扫描

CI 扫描远端配置 JSON，匹配关键词：`secret`、`apiKey`、`token`、`password`、`private_key`。匹配到则阻断构建（防止误提交密钥）。

### CFG005：平台覆盖集中

```typescript
// ❌ 散落在业务代码
if (platform === 'ios') { /* ... */ }
// ✅ app.config.ts 集中
platform: {
  ios: { features: { glassEffect: true } },
}
```

### CFG006：统一读取入口

```typescript
// ❌ 直接 import 配置对象
import config from '../app.config'
// ✅ 通过 API 读取（享受响应式 + 校验）
const config = getConfig()
```

## 配置示例（含所有规则）

```typescript
// app.config.ts
import { defineAppConfig } from '@proteus-vue/app-config'

export default defineAppConfig({
  // CFG003: features 集中声明
  features: {
    glassEffect: true,
    newHomePage: 'control',
  },
  // CFG005: 平台覆盖用 platform 字段
  platform: {
    ios: { features: { glassEffect: true } },
    android: { api: { timeout: 15000 } },
  },
  remote: {
    enabled: true,
    source: { type: 'https', url: 'https://config.example.com/v1/app' },
    // CFG004: url 是非敏感端点（敏感信息走原生 Keychain）
  },
})
```
