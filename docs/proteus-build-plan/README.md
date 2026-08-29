# proteus-build-plan

> **★实现状态（2026-08）**：✅ 已实现——@proteus/plugin-vite（mp 编译插件 + gen-routes + 共享模块/分包/能力包）+ 双端构建 + CI 流水线（.github/workflows/ci.yml 含测试/构建/模板快照/能力门禁），508 测试覆盖。

Proteus 构建与 CI/CD 流水线落地执行文档。

## 速览

把所有运行时层（Pinia/Router/API/Component/Platform/Module/Lifecycle）+ 基建层（Compiler/CLI/Types/Testing/DevTools）的产物**串成可发布的工程**。

## 五阶段

```
Source → Compile → Bundle → Optimize → Package → Publish
```

## 文档清单

- `00-overview.md` 架构 + 铁律 + 里程碑
- `01-m1-vite-plugin.md` Vite 插件骨架
- `02-m2-rollup-entries.md` 多入口 + 依赖图
- `03-m3-code-splitting.md` 代码分割 + 分包
- `04-m4-minify-bundle.md` 压缩 + treeshake
- `05-m5-sourcemap-asset.md` source map + assets
- `06-m6-ci-matrix.md` CI 矩阵
- `07-m7-release-publish.md` changeset 发布
- `08-m8-cache-optimization.md` 缓存策略
- `09-m7-super-app.md` 超级应用（并行/分布式/预算）
- `10-m8-observability.md` 可观测（--measure）
- `11-migration.md` 迁移
- `12-security.md` 供应链安全
- `13-testing-validation.md` 产物测试
- `14-execution-batches.md` 分批策略

## 防止上下文撑爆

每份 `.md` 是独立上下文单元，单批 ≤ 3 文件喂 LLM。B1-B10 分批，每批 = 1 PR。

## 与其他计划的关系

- 依赖：Compiler / Types / CLI / Testing / DevTools（全部）
- 被依赖：无（最上层编排器）

详见 `14-execution-batches.md`。
