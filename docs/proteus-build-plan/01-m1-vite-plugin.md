# M1 Vite 插件 + M2 多入口 + M3 代码分割

## M1：@proteus/vite-plugin 骨架

### 设计原则
**Vite 插件是唯一入口**（铁律 #1）。所有编译逻辑在 Compiler plan，本插件只做：
- 配置加载（`proteus.config.ts`，schema 来自 Types plan）
- 调用 Compiler 的 `compile()` 拿到三端 IR
- 编排 Rollup 多入口
- 产物后处理（分包/压缩/source map）

### 插件结构
```ts
// packages/vite-plugin/src/index.ts
import type { Plugin } from 'vite'
import { loadConfig } from '@proteus/types'  // Types plan M2
import { compile } from '@proteus/compiler'   // Compiler M3

export interface ProteusPluginOptions {
  platform: 'web' | 'mp' | 'app'
  configFile?: string
}

export function proteus(options: ProteusPluginOptions): Plugin[] {
  return [
    {
      name: 'proteus:config',
      async configResolved(config) {
        const cfg = await loadConfig(options.configFile)
        this.api = { config: cfg, platform: options.platform }
      },
    },
    {
      name: 'proteus:compile',
      async transform(code, id) {
        if (!/\.(vue|tsx)$/.test(id)) return null
        // 委托给 Compiler，不自己解析
        const result = await compile(code, id, {
          platform: options.platform,
          ir: this.api.ir,
        })
        return { code: result.code, map: result.map }
      },
    },
    {
      name: 'proteus:emit',
      generateBundle(_, bundle) {
        // 产物归类到 dist/{platform}/
        for (const [name, chunk] of Object.entries(bundle)) {
          chunk.fileName = `${options.platform}/${chunk.fileName}`
        }
      },
    },
  ]
}
```

### 三端 resolve
```ts
// 根据 platform 解析条件导出
resolveId(id) {
  if (id.startsWith('@proteus/capability')) {
    return `${id}/${options.platform}`  // → .web.ts / .mp.ts / .app.ts
  }
}
```

## M2：Rollup 多入口 + 依赖图

复用 Compiler M6 的依赖图（`DependencyGraph`），Build 层不重新建图：

```ts
// 输入：Compiler 产出的 IR + Module plan 的分包配置
// 输出：Rollup input 对象
export function createRollupInput(ir, moduleConfig) {
  const entries = {}
  // 1. 页面入口（Router B1 产物）
  for (const page of ir.pages) {
    entries[`pages/${page.name}`] = page.jsPath
  }
  // 2. 应用入口
  entries['app'] = ir.appEntry
  // 3. 分包入口（Module B5）
  for (const [name, pkg] of Object.entries(moduleConfig.subPackages)) {
    entries[`subpackages/${name}`] = pkg.entry
  }
  return entries
}
```

### 依赖图复用
- Compiler M6 已在增量编译时构建 `DependencyGraph`
- Build 层直接消费其 `getChunks()` 结果，推导分包边界
- **不重新扫描 AST**，避免重复工作

## M3：代码分割 + 分包

### 分包策略（对齐 Router M7.1 + Module B5）
```ts
// rollupOptions.output.manualChunks
manualChunks(id, { getModuleInfo }) {
  // 1. 按 Module plan 的 subPackages 配置归类
  for (const [name, pkg] of Object.entries(subPackages)) {
    if (pkg.includes.some((inc) => id.includes(inc))) {
      return `subpackages/${name}`
    }
  }
  // 2. 公共依赖抽到 shared
  if (id.includes('node_modules/vue')) return 'shared/vue'
  if (id.includes('node_modules/@vue')) return 'shared/vue-runtime'
  // 3. 平台 adapter
  if (id.includes('@proteus/adapter')) return 'shared/adapters'
}
```

### 小程序分包映射
```json
// dist/mp/app.json（由 Compiler codegen 生成，Build 校验一致性）
{
  "subPackages": [
    {
      "root": "subpackages/trade",
      "name": "trade",
      "pages": ["pages/order/List", "pages/order/Detail"]
    }
  ],
  "preloadRule": {
    "pages/index": {
      "network": "all",
      "packages": ["subpackages/trade"]
    }
  }
}
```

### 校验（契约测试，对齐 Testing plan B5）
```ts
// 构建后断言：分包映射与 Router/Module 配置完全一致
assert.deepEqual(
  readJson('dist/mp/app.json').subPackages,
  expectedFrom(moduleConfig, routerConfig),
)
```

## 分批归属

- B1：M1 Vite 插件骨架
- B2：M2 多入口 + 依赖图
- B3：M3 代码分割 + 分包 + 校验

## 验收

- `pnpm build:web` / `pnpm build:mp` / `pnpm build:app` 各自产出
- `dist/` 结构：`dist/{web,mp,app}/{assets,pages,subpackages}`
- 分包映射与 Router/Module 配置一致（契约测试通过）
- 公共 chunk 被多页面共享（不重复打包）
