# 07 · M7 测试、迁移与 CI 门禁

> 四层测试矩阵 + 存量配置/类型迁移 codemod + CI 硬卡口。

---

## 1. 测试矩阵（四层）

| 层 | 测试类型 | 工具 | 覆盖 |
|----|---------|------|------|
| 类型 | 类型单测 | `tsd` / `expect-type` | 收窄/推断/穷尽 |
| Schema | 校验单测 | `vitest` | 合法/非法配置 |
| Codegen | 产物快照 | `vitest -s` | 生成 `.d.ts`/schema 一致性 |
| 集成 | 端到端 | Compiler + CLI | `proteus generate --check` |

---

## 2. 类型单测示例（tsd）

```ts
// test/types.test-d.ts
import { expectType } from 'tsd'
import type { IfPlatform, Platform } from '../src'

expectType<IfPlatform<'web', true>>(true)
expectType<IfPlatform<'skyline', true>>(true)

// 穷尽检查
function test(x: Platform) {
  switch (x) {
    case 'web': return 1
    case 'skyline': return 2
    case 'app': return 3
    // @ts-expect-error 新增平台时必须补全
    default: return exhaustiveCheck(x, '')
  }
}
```

---

## 3. Schema 校验单测（vitest）

```ts
// test/schema.test.ts
import { describe, it, expect } from 'vitest'
import { validateConfig } from '../src/validate'

describe('validateConfig', () => {
  it('rejects unknown field', () => {
    const r = validateConfig({ renderer: 'skyline', unknown: 1 })
    expect(r.ok).toBe(false)
    expect(r.errors[0].code).toBe('CONFIG_UNKNOWN_FIELD')
  })

  it('locates field to line/column', () => {
    const sourceMap = { 'renderer': { line: 3, column: 5 } }
    const r = validateConfig({ renderer: 123 }, sourceMap)
    expect(r.errors[0]).toMatchObject({ line: 3, column: 5 })
  })
})
```

---

## 4. Codegen 快照测试

```ts
// test/codegen.test.ts
it('generates consistent StoresRegistry', () => {
  const dts = generateDts(/* ... */)
  expect(dts).toMatchFileSnapshot('__snapshots__/stores.d.ts')
})
```

> `proteus generate --check` 在 CI 比对快照，不一致即失败。

---

## 5. 存量迁移 Codemod

`proteus migrate types` 命令（对齐 CLI）：

```ts
// codemod/legacy-to-v2.ts
export function migrate(configText: string): string {
  return configText
    // 1. 重命名字段：router.transitions → router.animation
    .replace(/router:\s*{\s*transitions:/g, 'router: {\n  animation:')
    // 2. 注入 version 字段
    .replace(/export default defineConfig\({/, 'export default defineConfig({\n  version: 2,')
}
```

> 规则集对齐 `06-m6-super-app.md` 的 migration 数组。

---

## 6. CI 门禁（对齐 `proteus-cli-plan` doctor）

GitHub Actions 矩阵：
```yaml
- name: typecheck
  run: pnpm tsc --strict --noEmit
- name: test
  run: pnpm vitest run
- name: generate check
  run: pnpm proteus generate --check
- name: audit
  run: pnpm proteus audit all
```

硬卡口：
- `no-explicit-any` 报错即失败（零 any 泄漏）
- `generate --check` 失败 = generated 与源码不一致
- `proteus audit config` 发现跨层依赖即阻断

---

## 7. 验收

- [ ] 四层测试矩阵全绿
- [ ] 存量项目 `proteus migrate types` 自动迁移成功
- [ ] CI 阻断任何绕过（手写 any、改 generated、缺字段）
- [ ] codemod 幂等（跑两次结果一致）
- [ ] 千级 store 项目 CI 全量检查 < 3min
