# proteus-build-plan

> **★实现状态（2026-08）**：✅ 已实现——@proteus-vue/plugin-vite（mp 编译插件 + gen-routes + 共享模块/分包/能力包）+ 双端构建 + CI 流水线（.github/workflows/ci.yml 含测试/构建/模板快照/能力门禁/组件审计/i18n 审计/体积预算 strict 门禁）+ build 产物契约测试（contract-build），638 测试覆盖。

Proteus 构建与 CI/CD 流水线落地执行文档。

## 速览

把所有运行时层（Pinia/Router/API/Component/Platform/Module/Lifecycle）+ 基建层（Compiler/CLI/Types/Testing/DevTools）的产物**串成可发布的工程**。

## 五阶段

```
Source → Compile → Bundle → Optimize → Package → Publish
```

## 文档清单（实际文档 vs Draft 目录）

- `00-overview.md` 架构 + 铁律 + 里程碑 ✅
- `01-m1-vite-plugin.md` Vite 插件骨架 + 多入口 + 代码分割（M1-M3）✅
- `02-optimize-cache.md` 压缩/treeshake/sourcemap/assets + 缓存（M4/M5/M8）✅（实现标注：压缩/treeshake/sourcemap 已落地；M8 缓存标后续）
- `03-ci-pipeline.md` CI 矩阵 + 发布（M6/M7）✅（ci.yml 已落地；发布走 changesets）
- `04-super-app-observability.md` 超级应用 + 可观测（M7/M8）⏸（分包并行/分布式构建标后续）
- `05-testing-batches.md` 测试 + 迁移 + 分批（Testing B5 产物契约 ✅ contract-build.test.ts）

> Draft 的 `06-m6-ci-matrix ~ 14-execution-batches` 已并入上述精简文档（01/02/03/04 覆盖 M1-M8 内容）。

## 防止上下文撑爆

每份 `.md` 是独立上下文单元，单批 ≤ 3 文件喂 LLM。B1-B10 分批，每批 = 1 PR。

## 与其他计划的关系

- 依赖：Compiler / Types / CLI / Testing / DevTools（全部）
- 被依赖：无（最上层编排器）

详见 `14-execution-batches.md`。
