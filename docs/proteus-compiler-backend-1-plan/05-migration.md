# G-29 渐进迁移策略

## 1. 三种粒度

### 文件级
```ts
// proteus.config.ts
compiler: {
  backend: 'node',
  overrides: {
    'src/heavy/**': 'rust'   // 仅 heavy 目录用 Rust
  }
}
```

### 包级
```ts
// packages/ui/proteus.config.ts
compiler: { backend: 'rust' }
```

### 项目级
```ts
compiler: { backend: 'rust' }  // 整项目
```

## 2. 混合模式

开发期：`node`（快启动、丰富插件）
生产构建：`rust`（吞吐、CI 速度）
Playground：`wasm`（浏览器内）

## 3. 回退机制

任何场景失败 → 自动 fallback 到 Node Backend + 警告日志：
```
⚠ RustBackend failed (reason), falling back to NodeBackend
```

**永远可回退，不阻塞开发。**

## 4. 性能基准（M2 实测）

目标：Rust Backend 相对 Node 显著提升（10x 量级方向），具体数字 M2 实测后填入文档。

## 5. 风险

| 风险 | 缓解 |
|------|------|
| SWC Vue SFC 支持不完善 | B1 先用 Node，B2 跟进 SWC/oxc 进展 |
| WASM 体积 | 按需加载 + 缓存 |
| IR 三端不一致 | IR Golden Test 强制 |
