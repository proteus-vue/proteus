# 02 · M2 配置 Schema（`@proteus-vue/config-schema`）

> 定义 `proteus.config.ts` 的完整字段、归属层、默认值。是 CLI config loader 与 Audit 规则的**唯一真相源**。

---

## 1. 设计原则

- **字段归属显式**：每个字段标注 `layer`（铁律 #3）
- **默认值集中**：`defaultConfig` 一处定义，各层引用
- **双校验**：zod（运行时）+ JSON Schema（IDE/CLI），由同一份源生成
- **变更同步**：字段变更 → schema + CLI audit + transform JSDoc（铁律 #5）

---

## 2. 完整字段定义

```ts
// src/schema.ts
import { z } from 'zod'

/** 字段归属标注 */
type Layer = 'platform' | 'lifecycle' | 'module' | 'pinia' | 'router' | 'api' | 'component' | 'compiler' | 'cli'

const withLayer = <T>(schema: T, layer: Layer) => ({ schema, layer })

export const ProteusConfigSchema = z.object({
  // ── Compiler（layer: compiler） ──
  renderer: withLayer(z.enum(['skyline', 'webgl', 'webgpu']).default('skyline'), 'compiler'),
  componentFramework: withLayer(z.literal('glass-easel').default('glass-easel'), 'compiler'),
  lazyCodeLoading: withLayer(z.enum(['requiredComponents', 'disabled']).default('requiredComponents'), 'compiler'),
  worklet: withLayer(z.object({ enabled: z.boolean().default(true) }).default({}), 'compiler'),

  // ── Router（layer: router） ──
  router: withLayer(z.object({
    rootComponents: z.array(z.string()).default([]),   // 全局根包裹（对齐 Router M6）
    appBar: z.string().optional(),                       // 全局工具栏组件
    transitions: z.record(z.string()).default({}),
    strictMode: z.boolean().default(true),
  }).default({}), 'router'),

  // ── Pinia（layer: pinia） ──
  pinia: withLayer(z.object({
    stores: z.array(z.string()).default([]),             // 全局 store 注册
    persisted: z.boolean().default(true),
    lazyHydrate: z.boolean().default(true),              // M7.1
    version: z.number().default(1),
  }).default({}), 'pinia'),

  // ── API（layer: api） ──
  api: withLayer(z.object({
    baseURL: z.string().default(''),
    timeout: z.number().default(10000),
    retry: z.number().default(1),
    traceId: z.boolean().default(true),
  }).default({}), 'api'),

  // ── Platform / Capability（layer: platform） ──
  capabilities: withLayer(z.record(z.string(), z.object({
    platforms: z.array(z.enum(['web', 'skyline', 'app'])),
    fallback: z.enum(['throw', 'noop', 'polyfill']).default('throw'),
  })).default({}), 'platform'),

  // ── Module（layer: module） ──
  modules: withLayer(z.array(z.string()).default([]), 'module'),

  // ── Component（layer: component） ──
  components: withLayer(z.object({
    global: z.array(z.string()).default([]),             // 自动 usingComponents
    workletAnimations: z.boolean().default(true),
  }).default({}), 'component'),

  // ── Lifecycle（layer: lifecycle） ──
  lifecycle: withLayer(z.object({
    launchTimeout: z.number().default(5000),             // 阶段超时
    trace: z.boolean().default(true),
  }).default({}), 'lifecycle'),
})

export type ProteusConfig = z.infer<typeof ProteusConfigSchema>
```

---

## 3. 默认值合并

```ts
// src/defaults.ts
export const defaultConfig: ProteusConfig = {
  renderer: 'skyline',
  componentFramework: 'glass-easel',
  lazyCodeLoading: 'requiredComponents',
  worklet: { enabled: true },
  router: { rootComponents: [], transitions: {}, strictMode: true },
  pinia: { stores: [], persisted: true, lazyHydrate: true, version: 1 },
  api: { baseURL: '', timeout: 10000, retry: 1, traceId: true },
  capabilities: {},
  modules: [],
  components: { global: [], workletAnimations: true },
  lifecycle: { launchTimeout: 5000, trace: true },
}
```

---

## 4. 字段归属表（Audit 规则引用）

| 字段路径 | Layer | 说明 |
|---------|-------|------|
| `renderer` | compiler | Skyline/WebGPU 开关 |
| `router.rootComponents` | router | 全局根包裹 |
| `router.appBar` | router | 全局工具栏 |
| `pinia.stores` | pinia | 全局 store 注册 |
| `pinia.lazyHydrate` | pinia | M7.1 分片 |
| `api.baseURL` | api | 请求基础地址 |
| `capabilities.*` | platform | capability 配置 |
| `modules` | module | 模块清单 |
| `components.global` | component | 自动全局注册 |
| `lifecycle.launchTimeout` | lifecycle | 阶段超时 |

> CLI audit 规则据此检查"字段归属是否越层"（如 `router` 字段不得影响 `pinia` 行为）。

---

## 5. 验收

- [ ] zod 校验 `proteus.config.ts` 错误字段 → 抛出 + 定位行列
- [ ] JSON Schema 生成后 IDE 自动补全生效
- [ ] 默认值合并后与各层 `defaultConfig` 引用一致（无硬编码散落）
- [ ] 新增字段走"三处同步"流程（铁律 #5），CI 检查
- [ ] 全部字段标注 `layer`，Audit 可据此做归属检查
