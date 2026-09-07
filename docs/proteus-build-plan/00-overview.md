# Proteus 构建与 CI/CD 流水线（proteus-build-plan）

## 定位

把所有运行时层 + 基建层的产物**串成可发布的工程**——这是 16 份规划里的**最后一块基建**。

## 五阶段流水线

```
Source → [Compile] → [Bundle] → [Optimize] → [Package] → [Publish]
          ↑Compiler    ↑Rollup    ↑压缩       ↑分包      ↑changeset
```

| 阶段 | 责任 | 依赖计划 |
|------|------|---------|
| Compile | SFC→IR→三端 codegen | Compiler M3/M4 |
| Bundle | Rollup 多入口 + 依赖图 | Compiler M6（依赖图复用）|
| Optimize | 压缩/treeshake/分包 | Router M7.1 + Module B5 |
| Package | 产物结构 + source map | Types（schema）|
| Publish | changeset + canary | CLI |

## 铁律

1. **Vite 插件是唯一入口**：所有编译逻辑走 Compiler plan，Build 只做编排 + 产物优化，不重写 transform
2. **三端产物分离**：`dist/{web,mp,app}` 独立，CI 并行构建
3. **分包策略单一来源**：`chunk` 字段（Router M7.1 / Module B5）→ `preloadRule` + `subPackages`
4. **缓存键 = 配置哈希 + 源码哈希 + 依赖哈希**（对齐 Compiler M6 增量编译）
5. **体积预算接入 CI 门禁**（CLI `audit --fix` 触发）

## 里程碑

- M1 Vite 插件骨架
- M2 Rollup 多入口 + 依赖图
- M3 代码分割 + 分包
- M4 压缩 + treeshake
- M5 Source map + assets
- M6 CI 矩阵（GitHub Actions）
- M7 发布（changeset/canary/tag）
- M8 缓存 + 超级应用（并行/分布式/确定性构建）

## 验收

- `pnpm build` 一次产出三端产物
- 分包映射与 Router/Module 一致（契约测试）
- CI 矩阵 12 任务全绿
- 体积预算超限阻断 PR
- 增量构建命中率 > 90%
