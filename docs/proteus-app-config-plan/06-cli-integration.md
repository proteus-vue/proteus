# CLI 集成（G-35 × G-33）

## 1. `proteus check config`

校验应用配置文件。

```bash
proteus check config
```

输出：
```
✔ app.version 符合 semver (1.2.0)
✔ api.baseUrl 是合法 URL (https://api.example.com)
✔ features.newHomePage ∈ ['control','variant-a','variant-b']
✘ api.timeout 超出范围 [100, 60000]：当前 99999
  → app.config.ts:42
✘ features.invalidFlag 未在 schema 中声明
  → app.config.ts:55

校验失败：2 个错误
```

**实现**：调用 AppConfigSchema 校验，输出结构化错误。

## 2. `proteus gen config-types`

从 schema 推导 `.d.ts`，提供全局类型补全。

```bash
proteus gen config-types
```

生成 `types/app-config.d.ts`：
```typescript
declare module '@proteus-vue/app-config' {
  interface AppConfig {
    features: {
      glassEffect: boolean
      newHomePage: 'control' | 'variant-a' | 'variant-b'
      // ...自动推导
    }
  }
}
```

## 3. `proteus build --preload-remote-config`

构建期预加载远端配置，减少首屏等待。

```bash
proteus build --preload-remote-config
```

行为：
- 构建时 fetch 远端配置
- 内联到产物（作为 L1 初始值）
- 运行时优先用内联值，后台静默更新

## 4. 配置相关脚手架

```bash
# 创建配置文件
proteus gen config --env dev,staging,prod

# 生成
# app.config.ts
# app.config.dev.ts
# app.config.staging.ts
# app.config.prod.ts
```

## 5. CI 集成

```yaml
# .github/workflows/check.yml
- name: Validate app config
  run: pnpm proteus check config

- name: Generate config types
  run: pnpm proteus gen config-types

- name: Check for secrets in config
  run: pnpm proteus check config --no-secrets  # CFG004
```

## 6. `--strict` 规则

| 规则 | 说明 | 级别 |
|------|------|------|
| `CFG001` | 禁止硬编码 API 域名 | error |
| `CFG002` | 禁止 `process.env` 判断环境 | error |
| `CFG003` | 功能开关必须声明在 schema | warning |
| `CFG004` | 远端配置不得含敏感信息 | error (CI) |
| `CFG005` | 平台覆盖必须用 `platform` 字段 | error |
| `CFG006` | 读取配置必须用 `useAppConfig()`/`getConfig()` | warning |

### 自动修复

```bash
proteus check config --fix
```

- `CFG001`：`https://hardcoded.com` → `config.api.baseUrl`（需确认）
- `CFG005`：`if (platform === 'ios')` → 提示迁移到 `platform.ios`
