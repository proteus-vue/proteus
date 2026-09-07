# 05 · M5 校验器与错误定位

> 配置校验 + SFC IR 类型守卫 + 错误码体系，**对齐 Compiler `05-sourcemap-trace.md` 的 `--trace-transform`**（行列号 + 源码定位）。

---

## 1. 校验器（zod + 行列定位）

```ts
// src/validate.ts
import { ProteusConfigSchema } from './schema'
import type { ZodError } from 'zod'

export interface ValidationError {
  code: string            // 'CONFIG_UNKNOWN_FIELD' | 'CONFIG_LAYER_VIOLATION' | ...
  path: string            // 'router.rootComponents'
  message: string
  line?: number           // 对齐 source map
  column?: number
}

export function validateConfig(
  config: unknown,
  sourceMap?: Record<string, { line: number; column: number }>,
): { ok: true } | { ok: false; errors: ValidationError[] } {
  const result = ProteusConfigSchema.safeParse(config)
  if (result.success) return { ok: true }

  const errors: ValidationError[] = result.error.errors.map((e) => ({
    code: mapZodToCode(e.code),
    path: e.path.join('.'),
    message: e.message,
    ...locateFromSourceMap(e.path.join('.'), sourceMap),
  }))
  return { ok: false, errors }
}

function mapZodToCode(code: string): string {
  switch (code) {
    case 'invalid_type':     return 'CONFIG_INVALID_TYPE'
    case 'unrecognized_keys': return 'CONFIG_UNKNOWN_FIELD'
    default:                  return 'CONFIG_VALIDATION_ERROR'
  }
}

function locateFromSourceMap(
  path: string,
  sourceMap?: Record<string, { line: number; column: number }>,
) {
  return sourceMap?.[path] ?? {}
}
```

> Compiler 在解析 `proteus.config.ts` 时生成字段→行列的 source map，传入 `validateConfig` 实现精准定位。

---

## 2. IR 类型守卫

```ts
// src/guards.ts
import type { SFCIR, RouteIR, StoreIR } from './ir'

export function isRouteIR(x: unknown): x is RouteIR {
  return typeof x === 'object' && x !== null
    && 'path' in x && typeof (x as RouteIR).path === 'string'
    && 'component' in x && typeof (x as RouteIR).component === 'string'
}

export function isStoreIR(x: unknown): x is StoreIR {
  return typeof x === 'object' && x !== null
    && 'id' in x && typeof (x as StoreIR).id === 'string'
    && 'version' in x && typeof (x as StoreIR).version === 'number'
}

export function assertSFCIR(x: unknown): asserts x is SFCIR {
  if (typeof x !== 'object' || x === null) {
    throw new Error('[Proteus] invalid SFCIR: expected object')
  }
}
```

> 各层 codegen 在消费 IR 前调用守卫，失败即抛错 + 定位（对齐 Compiler trace）。

---

## 3. 错误码体系

| 错误码 | 含义 | 定位方式 |
|--------|------|---------|
| `CONFIG_UNKNOWN_FIELD` | 未知配置字段 | source map 行列 |
| `CONFIG_INVALID_TYPE` | 字段类型错误 | source map 行列 |
| `CONFIG_LAYER_VIOLATION` | 字段跨层隐式依赖 | 字段归属表 |
| `CONFIG_VERSION_MISMATCH` | store version 迁移缺失 | store 定义位置 |
| `IR_INVALID_ROUTE` | RouteIR 缺 path/component | SFC 文件路径 + 行号 |
| `IR_CIRCULAR_MODULE` | ModuleIR 循环依赖 | 依赖图环路径 |
| `REGISTRY_DUPLICATE_ID` | Store/Module/Route id 重复 | 两处定义位置 |

---

## 4. 与 `--trace-transform` 集成

`--trace-transform` 输出新增字段：
```json
{
  "phase": "validate",
  "kind": "config",
  "result": "ok",
  "errors": []
}
```
> 与 Compiler trace 同格式，DevTools 统一展示（对齐 DevTools plan）。

---

## 5. 验收

- [ ] 错误字段定位到行列，IDE 可点击跳转
- [ ] IR 守卫失败抛错含 SFC 路径 + 行号
- [ ] 错误码覆盖全部校验场景（CONFIG_*/IR_*/REGISTRY_*）
- [ ] `--trace-transform` 含 validate 阶段结果
- [ ] CI 中配置错误阻断构建，零容忍
