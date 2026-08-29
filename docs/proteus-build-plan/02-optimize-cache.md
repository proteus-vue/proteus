# M4 压缩/Treeshake + M5 Source Map/Assets + M8 缓存优化

## M4：压缩与 Treeshake

### 压缩策略
```ts
// vite.config.ts（由 @proteus/vite-plugin 内部配置）
export default defineConfig({
  build: {
    minify: 'esbuild',   // 快；生产可选 'terser' 更高压缩率
    cssMinify: 'lightningcss',
    target: {
      web: 'es2018',
      mp: 'es2018',       // 小程序基础库 >= 2.29.2
      app: 'es2018',
    },
    terserOptions: {
      compress: { drop_console: true },  // 生产移除 console
    },
  },
})
```

### Treeshake 配置
```ts
build: {
  cssCodeSplit: true,
  sourcemap: true,
  rollupOptions: {
    treeshake: {
      moduleSideEffects: false,  // 依赖 Compiler M1（IR 标注副作用）
      propertyReadSideEffects: false,
      unknownGlobalSideEffects: false,
    },
  },
}
```

**关键**：Compiler 的 IR 已为每个模块标注 `sideEffects`（来自 `package.json` + 静态分析），Build 层直接消费，不做重复分析。

### 平台分支消除
```ts
// Platform plan 的 capability 分叉：*.web.ts / *.mp.ts / *.app.ts
// Rollup 根据 platform 只保留对应分支，其余 tree-shake 掉
// → 三端产物各自不含其他平台代码
```

## M5：Source Map + Assets

### Source Map 策略
```ts
build: {
  sourcemap: 'hidden',  // 生成 .map 但不在 bundle 里引用（安全）
}
// CI 产物上传 .map 到错误监控服务，不随包发布
```

### Assets 处理
- 图片：`< 4KB` 内联 base64，`>= 4KB` 输出到 `assets/` + 内容哈希命名
- 字体：子集化（unicode-range）+ woff2
- Skyline 纹理压缩：KTX2/Basis（对齐 Component plan M7 性能）

### 缓存键（对齐 Compiler M6）
```ts
// 增量构建的缓存键 = 三者哈希
const cacheKey = hash(
  hash(config),      // 配置哈希（Types plan schema）
  hash(sources),     // 源码哈希
  hash(dependencies), // 依赖哈希（lockfile）
)
// 命中 → 复用 Rollup cache；未命中 → 全量构建
```

## M8：缓存优化

### 三级缓存
1. **Rollup 内存缓存**：`build({ cache })` 对象复用
2. **磁盘缓存**：`node_modules/.cache/proteus/{platform}`（按 cacheKey 索引）
3. **远程缓存**（CI）：turbo / nx 远程缓存，跨机器复用

### 增量构建
```ts
// 复用 Compiler M6 的增量编译结果
// 只重新打包变化的 chunk，未变 chunk 直接从缓存读
async function buildIncremental(changedFiles) {
  const graph = await compiler.getDependencyGraph()
  const affected = graph.getAffectedChunks(changedFiles)
  return rollup.build({
    cache: diskCache.get(cacheKey),
    input: affected.entries,  // 只重打受影响入口
  })
}
```

### 并行构建
```yaml
# CI 三端并行（见 03-ci-pipeline.md）
strategy:
  matrix:
    platform: [web, mp, app]
steps:
  - run: pnpm build:${{ matrix.platform }}
```

## 分批归属

- B4：M4 压缩 + treeshake
- B5：M5 source map + assets + 缓存键
- B8：M8 缓存 + 并行（含 M7 超级应用部分）

## 验收

- 压缩后 JS 体积 < 预算（如主包 < 500KB gzip）
- treeshake 消除所有未引用导出（含平台分支）
- source map 可正确定位到源码行（DevTools plan B1 TraceBus 消费）
- 二次构建命中缓存，耗时下降 > 70%
- 远程缓存跨机器命中率 > 90%
