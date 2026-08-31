# 05 · API 设计（业务零样板）

## 1. 主题 Theme

```typescript
// app.config.ts
export default defineApp({
  theme: {
    tokens: {
      color: { primary: { light: '#007AFF', dark: '#0A84FF' } },
      spacing: { sm: 8, md: 16 },
    },
    source: 'system',  // 'light' | 'dark' | 'system'
  },
})

// 组件内
<template>
  <p-view :class="$theme.card">           <!-- 静态 token，编译期优化 -->
    <p-text style="color: var(--color-text)">  <!-- 动态 token，响应式 -->
      {{ title }}
    </p-text>
  </p-view>
</template>

<script setup>
import { useTheme } from '@proteus-vue/runtime'
const { source, resolved, setSource } = useTheme()
setSource('dark')  // 切换，持久化 + 五端同步
</script>
```

**对比**：
- uni-app：手写 `:class="themeClass"` + `onLaunch/onShow` 读 storage
- RN：手写 Provider + Context + useMemo
- **Proteus：全自动**

## 2. 字体 FontScale

```typescript
// app.config.ts
export default defineApp({
  font: { scale: 1.0, followSystem: true, min: 0.8, max: 1.5 },
})

// 组件内
import { useFont } from '@proteus-vue/runtime'
const { scale, finalScale, setScale } = useFont()

// 语义字号（推荐）
<p-text class="body">内容</p-text>
// .body { font-size: calc(16px * var(--font-scale)) }

// 命令式
setScale(1.2)  // 应用级覆盖，clamp [0.8, 1.5]
```

## 3. 缓存 Cache

```typescript
// 读（自动全链路：L0 → L1 → L2 → L3）
const user = await $proteus.cache.get('user:123', {
  fetcher: () => api.getUser(123),
  ttl: 5 * 60_000,
  layer: ['L0', 'L2'],  // 可选，默认全链路
})

// 写
await $proteus.cache.set('user:123', data, { ttl: 300_000 })

// 失效
$proteus.cache.delete('user:123')
$proteus.cache.clear('user:*')  // 前缀清除

// 订阅
$proteus.cache.on('evict', ({ key, reason }) => { ... })

// 作用域（页面销毁自动清理）
$proteus.cache.set('draft', value, { scope: pageId })
```

## 4. 组合使用示例

```vue
<pg-app
  :theme="memorialActive ? 'dark' : undefined"
  :font-scale="prefs.scale"
  :cache-policy="'balanced'"
>
  <p-view :class="$theme.card">
    <p-text class="body" large-content>{{ content }}</p-text>
  </p-view>
</pg-app>

<script setup>
const { memorialActive } = useMemorial()  // 对接 memorial-skeleton
const prefs = useFont()                    // 字号偏好走 L2 持久化
</script>
```

## 5. 类型定义（TypeScript 一等公民）

```typescript
// @proteus-vue/types
export interface ThemeTokens {
  readonly color: Readonly<Record<string, { light: string; dark: string }>>
  readonly spacing: Readonly<Record<string, number>>
  readonly radius: Readonly<Record<string, number>>
}

export interface UseThemeReturn {
  readonly source: Ref<'light' | 'dark' | 'system'>
  readonly resolved: ComputedRef<'light' | 'dark'>
  setSource(source: ThemeSource): void
}

export interface CacheOptions {
  fetcher?: () => Promise<T>
  ttl?: number
  layer?: Array<'L0' | 'L1' | 'L2'>
  scope?: string
  bytes?: number
}
```

**对接 Types v2.1**：所有 API 严格类型化，Platform 判别联合（见 `proteus-types-plan`）。
