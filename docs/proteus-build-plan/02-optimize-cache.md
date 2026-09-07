# M4 压缩/Treeshake + M5 Source Map/Assets + M8 缓存优化

## M4：压缩与 Treeshake

### 压缩策略
```ts
// vite.config.ts（由 @proteus-vue/vite-plugin 内部配置）
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

---

## ★M8 落地批次（2026-08 启动）

### 状态：✅ 编译缓存 + bundle 缓存已落地（2026-08）

验证数据（examples 真实构建）：
- 编译缓存：首次 0/33 → 二次 **33 命中 / 0 未命中（100%）**；单文件变更精确失效（32/1）
- bundle 缓存（esbuild 共享模块）：首次 0/12 → 二次 **12 命中 / 0 未命中（100%）**（输入快照 mtime+size 校验）
- 两次构建产物 **diff 逐字节一致**（正确性证明）
- `PROTEUS_NO_CACHE=1` 关闭生效

### 范围（首批）

**编译缓存**（buildStart 每文件 `compileVueSfc` 结果）：
- 缓存键 = **sha1(源码 + 全部编译入参 + 编译器版本)**（铁律 #4：配置哈希 + 源码哈希 + 依赖哈希）——入参含 px2rpx/rpxRatio/rules/moduleImports/isComponent/annotateLines/debug
- 存储：磁盘 `node_modules/.cache/proteus/compile/<key>.json` + 进程内存 Map
- 命中 → 跳过 compileVueSfc，直接复用 wxml/js/wxss/warnings；未命中 → 编译 + 写缓存
- **debug 构建（PROTEUS_DEBUG=1）跳过缓存**（sourcemap/行号注入与缓存互斥，开发态无需缓存）
- 门控：默认开启；`PROTEUS_NO_CACHE=1` 关闭；构建结束输出缓存命中统计
- 正确性保证：全入参哈希 → 任一输入变化即失效；编译器 dist 重建（版本变化）→ 全局失效

### 后续批次

- ~~共享模块 esbuild bundle 缓存~~ ✅ 已落地（输入快照 mtime+size 指纹，12 共享模块 100% 命中）
- 增量构建（只重编受影响文件，跳过未变 chunk）
- 远程缓存（CI 跨机器，turbo/nx）
- 默认开启验证（多轮真实构建产物 diff 一致后，移除 PROTEUS_CACHE 门控考虑）
