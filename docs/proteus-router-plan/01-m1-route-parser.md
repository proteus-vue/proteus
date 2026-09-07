# M1 — `<route>` 块解析 + Schema 校验

> **里程碑**：M1（B1-B2）
> **输入依赖**：无（本层是地基）
> **产出**：`packages/router/src/scan.ts`、`schema.ts`
> **LLM 批次**：B1（骨架）+ B2（完成），单批 ≤ 3 文件

---

## 1. 目标

从所有 `.vue` 文件中提取 `<route>{...}</route>` 自定义块内容，校验合法性，输出 `RouteBlock[]`。

## 2. `<route>` 块语法约定

```vue
<route lang="json">
{
  "path": "/home",
  "name": "home",
  "redirect": "/home/default",
  "parent": "user",
  "meta": { "title": "首页", "needLogin": true, "transition": "slideUp" },
  "lazy": true
}
</route>
```

- 块名固定 `route`（小写）
- 默认 `lang="json"`；可选 `lang="js"`（导出对象，见边界）
- **一个 `.vue` 文件只允许一个 `<route>` 块**（多个报错）

## 3. 数据结构

```ts
// packages/router/src/types.ts
export interface RouteMeta {
  title?: string
  needLogin?: boolean
  transition?: 'slideUp' | 'slideDown' | 'halfScreen' | 'scaleDown' | 'none'
  // ... 允许任意扁平字段（仅 JSON 可序列化）
  [key: string]: unknown
}

export interface RouteBlock {
  /** 源码位置（用于 --trace-router 报错定位） */
  loc: { file: string; line: number; column: number }
  path: string
  name?: string
  redirect?: string
  parent?: string           // 显式子父关系（覆盖 path 推导）
  meta: RouteMeta
  lazy?: boolean
  /** 对应 .vue 文件的绝对路径（用于 codegen 生成 import） */
  componentPath: string
}
```

## 4. Schema 校验（手写，无第三方依赖；若项目已引 Zod 可直接用）

| 字段 | 类型 | 必填 | 规则 |
|------|------|------|------|
| `path` | string | ✅ | 以 `/` 开头；同 path 重复报错（提示文件:行号）| 
| `name` | string | ❌ | 唯一；命名规范 `^[a-z][a-zA-Z0-9]*$` |
| `redirect` | string | ❌ | 与 `parent` 互斥 |
| `parent` | string | ❌ | 值必须存在另一个 `name` |
| `meta` | object | ❌ | 仅 JSON 可序列化（禁止 Function / RegExp / undefined）|
| `lazy` | boolean | ❌ | 默认 `true`（小程序端固定 `lazy: false`，见 M4）|
| `meta.transition` | string | ❌ | 枚举见上；非法值报错 |

校验失败：**不吞错，抛出 `RouteValidationError`，含 `loc` 精确定位**。

## 5. 扫描实现 `scan.ts`

```ts
import { readFileSync, globSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'

export function scanRoutes(rootDir: string): RouteBlock[] {
  const files = globSync('**/*.vue', { cwd: rootDir, ignore: ['**/node_modules/**'] })
  const routes: RouteBlock[] = []

  for (const file of files) {
    const abs = join(rootDir, file)
    const { descriptor } = parse(readFileSync(abs, 'utf-8'))
    const block = descriptor.customBlocks.find(b => b.type === 'route')
    if (!block) continue

    const loc = { file, line: block.loc.start.line, column: block.loc.start.column }
    const parsed = JSON.parse(block.content)  // lang=json
    validateSchema(parsed, loc)               // 见 schema.ts

    routes.push({
      loc,
      componentPath: abs,
      path: parsed.path,
      name: parsed.name,
      redirect: parsed.redirect,
      parent: parsed.parent,
      meta: parsed.meta ?? {},
      lazy: parsed.lazy ?? true,
    })
  }

  checkDuplicates(routes)   // path / name 唯一性
  return routes
}
```

- 用 `@vue/compiler-sfc` 的 `parse`（**不重写 SFC 解析**，复用 Vue 官方，避免黑盒）
- `block.loc` 直接给出行号 → 天然支持 `--trace-router` 定位

## 6. 边界处理

| 情况 | 行为 |
|------|------|
| 页面无 `<route>` 块 | 警告（不报错），跳过（兼容"页面级私有页"）|
| `<route>` 里 `path` 缺失 | **报错** `RouteValidationError` + loc |
| `meta` 含函数 | 报错："meta 必须可序列化，逻辑请放 router.guards" |
| 多个 `<route>` 块 | 报错："一个文件只允许一个 <route>" |

## 7. 测试（B2 完成，见 `07-testing.md` L1）

```ts
describe('scanRoutes', () => {
  it('提取 path/name/meta 并定位行号', () => { ... })
  it('path 重复时报错并指向两个文件:行号', () => { ... })
  it('meta 含函数时报错', () => { ... })
})
```

## 8. `--trace-router` 集成点

`scan.ts` 在 `--trace-router` 时打印：
```
[route] src/pages/home/Home.vue:2  path="/home" → (待生成)
```
（完整映射在 M2-M5 codegen 阶段补齐，scan 只负责"来源登记"）

---

## LLM 执行提示（B1）

> 只读 `00-overview.md` + 本文件。实现 `scan.ts` + `schema.ts` 骨架，先跑通"解析 + 报错定位"，**先不接 codegen**。测试用 fixtures（`fixtures/pages/*.vue`）验证。
