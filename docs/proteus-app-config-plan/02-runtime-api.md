# 运行时 API 设计（G-35）

## 1. `defineAppConfig()`

定义配置，提供 TS 类型推导。

```typescript
import { defineAppConfig } from '@proteus-vue/app-config'

export default defineAppConfig({
  app: { id: 'com.example.app', version: '1.0.0', buildNumber: 1 },
  env: 'prod',
  api: { baseUrl: 'https://api.example.com', timeout: 10000, retry: 3 },
  features: { glassEffect: true, newHomePage: 'control' },
  theme: { default: 'system', allowUserToggle: true },
  font: { defaultScale: 1.0, allowUserAdjust: true },
  safeArea: { islandGlass: true },

  // 可选：远端配置
  remote: {
    enabled: true,
    source: { type: 'https', url: 'https://config.example.com/v1/app' },
    strategy: { fetchOnLaunch: true, fetchInterval: 3600000, cacheToDisk: true },
  },

  // 可选：平台覆盖
  platform: {
    ios: { features: { glassEffect: true } },
    harmony: { features: { glassEffect: false } },
  },
})
```

**实现要点**：
- 返回原对象 + 附加 `__isAppConfig: true` 标记
- TS 通过泛型推导，IDE 补全 `features.xxx`
- 构建期校验 schema（Compiler）

## 2. `useAppConfig()` — 响应式读取

```vue
<script setup>
import { useAppConfig } from '@proteus-vue/app-config'

const config = useAppConfig()

// ✅ 响应式：远端更新 / setConfig() 时自动触发重新渲染
watch(() => config.features.newHomePage, (val) => {
  console.log('实验组变更:', val)
})
</script>

<template>
  <p-glass v-if="config.features.glassEffect" blur="20" />
  <div v-if="config.env === 'dev'">DEV 标记</div>
</template>
```

**实现要点**：
- 返回 `reactive()` 代理的配置对象
- `setConfig()` 触发 `triggerRef` 通知所有消费者
- 在 `setup()` 外调用会报错（同 `useRoute`）

## 3. `getConfig()` / `setConfig()` — 命令式

```typescript
import { getConfig, setConfig } from '@proteus-vue/app-config'

// 读取（非响应式）
const baseUrl = getConfig().api.baseUrl

// 写入（触发响应式更新 + 校验）
setConfig({ features: { newHomePage: 'variant-b' } })

// 批量更新
setConfig((config) => ({
  ...config,
  api: { ...config.api, timeout: 5000 },
}))
```

**实现要点**：
- `setConfig()` 走 Schema 校验 → 失败则拒绝 + 告警
- 校验通过后深合并 + 触发响应式通知

## 4. `useFeatureFlag()` — 功能开关便捷 API

```typescript
import { useFeatureFlag } from '@proteus-vue/app-config'

const { enabled, variant } = useFeatureFlag('newHomePage')

// enabled: boolean
// variant: 'control' | 'variant-a' | 'variant-b'
if (variant === 'variant-a') {
  // ...
}
```

## 5. 与能力模块联动

### 5.1 Theme (G-27)

```typescript
import { useTheme } from '@proteus-vue/theme'
import { getConfig } from '@proteus-vue/app-config'

const theme = useTheme()
theme.setMode(getConfig().theme.default)  // 'system' | 'light' | 'dark'
```

### 5.2 Memorial (G-25)

```typescript
import { enableMemorialGray } from '@proteus-vue/memorial'

if (getConfig().features.memorialGray) {
  enableMemorialGray()
}
```

### 5.3 Glass

```vue
<p-glass v-if="config.features.glassEffect" preset="navigationBar" />
```

### 5.4 Network（对接 Cache G-28）

```typescript
// api client 读取配置
const client = createApiClient({
  baseUrl: getConfig().api.baseUrl,
  timeout: getConfig().api.timeout,
  retry: getConfig().api.retry,
  cache: getConfig().api.cache,  // 对接 L1/L2 缓存
})
```

## 6. 响应式实现机制

```
setConfig(partial)
    ↓
validate(partial)  ← Schema 校验
    ↓
current = deepMerge(current, partial)
    ↓
configRef.value = current  ← Vue reactive trigger
    ↓
所有 useAppConfig() 消费者重新渲染
```

**性能**：
- `configRef` 是单个 `reactive` 对象，变更精确追踪
- 只有实际读取了 `features.newHomePage` 的组件才会重渲
- 与 Vue 的 Proxy 响应式完全对齐（优于 RN 的 `useMemo` 手动优化）

## 7. SSR / 首屏考量

- **首屏不阻塞**：远端配置异步拉取，首屏用本地默认值
- **SSR 友好**：Node 端读取 `app.config.server.ts`，客户端 hydrate 后接远端
- **序列化**：`config` 可序列化（无函数/循环引用），支持 SSR 注水

## 8. 类型安全

```typescript
// 开发者定义 schema → 全局类型推导
declare module '@proteus-vue/app-config' {
  interface AppConfig {
    features: {
      glassEffect: boolean
      newHomePage: 'control' | 'variant-a' | 'variant-b'
      // ...扩展点
    }
  }
}

// ✅ IDE 补全 + 类型检查
config.features.newHomePage  // 'control' | 'variant-a' | 'variant-b'
config.features.typo         // ❌ TS 报错：属性不存在
```
