# 06 · M6 超级应用加固

> 针对千级 store/module/route 的可靠性增强：类型层面循环检测、品牌类型防混淆、配置版本迁移、schema registry 可扩展。

---

## 1. 类型层面循环依赖检测（对齐 Module M7.5）

在 Registry 推断中加入深度限制：

```ts
// src/registry.ts
type MAX_DEPTH = 8  // 递归上限，超出即报错

export type ResolveModule<D extends string, Depth extends number = 0> =
  Depth extends MAX_DEPTH
    ? never  // 循环或超深 → 编译报错
    : ModulesRegistry[D] extends infer M
      ? M['dependencies'] extends infer Deps
        ? Deps extends readonly string[]
          ? ResolveModule<Deps[number], Increment<Depth>>
          : never
        : never
      : never
```

> 千级模块依赖图在类型检查时即暴露环，无需运行时。

---

## 2. 品牌类型防混淆（Brand Type）

防止 `store id` 与 `module domain` 混用：

```ts
// src/utils.ts
export type Brand<T, B extends string> = T & { readonly __brand: B }

export type StoreId = Brand<string, 'StoreId'>
export type ModuleDomain = Brand<string, 'ModuleDomain'>
export type RouteName = Brand<string, 'RouteName'>

// 构造函数（仅内部使用，业务侧由 defineStore 自动包装）
export const asStoreId = (s: string): StoreId => s as StoreId
export const asModuleDomain = (s: string): ModuleDomain => s as ModuleDomain
```

> `useStore(id)` 若传入 `ModuleDomain` 编译报错 —— 防混淆（Pinia M8.4 / Module M1）。

---

## 3. 配置版本迁移（对齐 Pinia M7.4）

schema 带版本号，迁移函数注册表：

```ts
// src/migration.ts
export interface Migration {
  from: number
  to: number
  up: (config: any) => any
}

export const configMigrations: Migration[] = [
  { from: 1, to: 2, up: (c) => ({ ...c, pinia: { ...c.pinia, lazyHydrate: true } }) },
  // ...
]

export function migrateConfig(config: any, fromVersion: number): { version: number; config: any } {
  let current = config
  let v = fromVersion
  for (const m of configMigrations) {
    if (m.from === v) {
      current = m.up(current)
      v = m.to
    }
  }
  return { version: v, config: current }
}
```

> `proteus.config.ts` 声明 `version: 2`，加载时若 `version < latest` 自动跑迁移链（对齐 Pinia M7.4 migrations 数组）。

---

## 4. Schema Registry 可扩展

允许业务/插件注册自定义字段（不修改核心 schema）：

```ts
// src/registry.ts
export type CustomSchemaRegistry = {
  // 声明合并点
  [key: string]: z.ZodTypeAny
}

export function extendSchema<K extends string>(
  key: K,
  schema: z.ZodTypeAny,
): void {
  // 合并到 ProteusConfigSchema（运行时）
}
```

> 插件可扩展配置字段，Audit 规则同步扩展（M3 codegen 派发）。

---

## 5. 类型性能（千级 Registry）

- Registry 推断拆分到独立 `.d.ts`，按需加载
- `tsconfig` 设 `"skipLibCheck": true` + `"types"` 白名单
- 避免全局 Registry 过度递归（用 `Brand` 切断深层推断）

---

## 6. 验收

- [ ] 循环模块依赖 → tsc 编译报错（含环路径）
- [ ] `StoreId` 与 `ModuleDomain` 混用 → 编译报错
- [ ] 配置 `version: 1` 自动迁移到 latest，字段补全
- [ ] 插件 `extendSchema` 后 audit 规则同步生效
- [ ] 千级 store 项目 tsc 增量检查 < 5s
- [ ] 品牌类型不穿透到业务代码（仅 defineXxx 内部构造）
