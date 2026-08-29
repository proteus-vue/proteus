# 03 · M3 Codegen 派发（DRY：单一来源 → 多产物）

> 从 `types/` 单一来源自动生成：各层 `.d.ts` + JSON Schema + CLI Audit 规则骨架。**禁止手写重复定义**（铁律 #2）。

---

## 1. 生成器架构

```
types/src/*.ts (单一来源)
       │
       ▼ (generate 命令)
  codegen/
    ├── to-dts.ts        → 各层 .d.ts（StoresRegistry/ModulesRegistry/RoutesRegistry 等）
    ├── to-json-schema.ts → proteus.config.json schema
    ├── to-audit-rules.ts → CLI audit 规则骨架
    └── to-runtime-guards.ts → Platform/Capability 守卫函数
```

命令：`proteus generate types`（对齐 CLI `02-m2-dev-build-preview.md` 的 `dev/build` 编排）。

---

## 2. 产物 1：各层 `.d.ts`

从 `Registry` 接口生成声明合并模板：

```ts
// generated/stores.d.ts
// AUTO-GENERATED — DO NOT EDIT
declare module '@proteus/types' {
  interface StoresRegistry {
    // 由各 defineStore 自动填充
  }
}

// generated/modules.d.ts
declare module '@proteus/types' {
  interface ModulesRegistry {
    // 由各 defineModule 自动填充
  }
}
```

> 业务代码 `useStore('user')` 的类型补全来自此处。

---

## 3. 产物 2：JSON Schema

从 zod schema（`02-m2-config-schema.md`）导出：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "renderer": { "enum": ["skyline", "webgl", "webgpu"], "default": "skyline" },
    "router": {
      "type": "object",
      "properties": {
        "rootComponents": { "type": "array", "items": { "type": "string" } }
      }
    }
  }
}
```

> IDE 补全 + CLI `validate` 命令共用。

---

## 4. 产物 3：Audit 规则骨架

从字段 `layer` 标注生成 CLI audit 规则（对齐 `proteus-cli-plan` `03-m3-audit-doctor.md` 的 `audit all`）：

```ts
// generated/audit-rules.ts
export const rules = [
  {
    id: 'config:layer-violation',
    check: (config) => {
      // router 字段不得影响 pinia 行为（跨层隐式依赖检测）
    },
  },
  {
    id: 'config:unknown-field',
    check: (config) => { /* 未知字段报错 */ },
  },
]
```

> 字段新增时自动扩展规则，**无需手写**（铁律 #5 的自动化实现）。

---

## 5. 产物 4：运行时守卫

```ts
// generated/guards.ts
export const isWeb = (__PLATFORM__: Platform): boolean => __PLATFORM__ === 'web'
export const isSkyline = (__PLATFORM__: Platform): boolean => __PLATFORM__ === 'skyline'
// ... 每个 Platform 成员一组
```

---

## 6. 增量生成（对齐 Compiler `06-incremental-hmr.md`）

- 仅当 `types/src/**` 变更时触发
- 缓存哈希比对，未变则跳过
- CI 中 `proteus generate --check` 校验产物与源码一致（防止手动改 generated）

---

## 7. 验收

- [ ] 修改 `StoreIR` → 重新生成后 `useStore()` 补全更新
- [ ] 修改 schema 字段 → JSON Schema + audit 规则自动同步
- [ ] `--check` 在 CI 中拦截过期的 generated 文件
- [ ] 生成器零手写重复，全由 `types/` 推导
- [ ] 与 Compiler codegen（`03-codegen-backends.md`）共用 IR 类型，无字段冲突
