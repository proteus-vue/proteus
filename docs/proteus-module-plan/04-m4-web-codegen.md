# M4 Web 打包（Rollup code-splitting）

## 目标

Web 端利用原生 ESM + 动态 import，按 chunk 自动拆分，实现按需加载。

## 映射规则

| Module 契约 | Web 产物 |
|------|------|
| `chunk: 'trade'` | Rollup `manualChunks: { trade: [...] }` |
| `dependencies` | 静态 import（打包进同一 chunk 或被共享） |
| `preload: ['user']` | `<link rel="modulepreload">` |
| 动态获取模块 | `await ms.getModule('trade')` → `import('./trade/module')` |

## Rollup 配置生成

```ts
// proteus.config.ts → 生成 rollupOptions
export function generateRollupOptions(graph: DependencyGraph) {
  return {
    build: {
      rollupOptions: {
        manualChunks(id) {
          // 按 chunk 分组
          for (const [chunkName, modules] of graph.chunkGroups()) {
            if (modules.some(m => id.includes(`/modules/${m}/`))) {
              return chunkName
            }
          }
        },
        output: {
          chunkFileNames: 'assets/js/[name]-[hash].js',
          entryFileNames: 'assets/js/[name]-[hash].js',
        },
      },
    },
  }
}
```

## 动态加载

```ts
// 业务代码
const trade = await ms.getModule('trade')
// 编译期转为：
const trade = await import('./modules/trade/module')

// preloadRule → modulepreload
// <link rel="modulepreload" href="/assets/js/trade-abc123.js">
```

## 共享依赖去重

vue / pinia / 公共工具被多个 chunk 引用时：
- Rollup 自动提取到 `vendor` chunk
- 小程序端同理（`require` 公共 chunk 天然去重，见 M5）

## 测试

- 分包产物结构验证（每个 chunk 独立文件）
- 共享依赖提取验证（vue 只出现一次）
- preload 生成验证（HTML 含 modulepreload）
- 懒加载触发验证（初始 bundle 不含 trade）
