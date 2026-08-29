# 执行排期：分批喂 LLM 策略

> **目的**：将 9 个模块文档拆成可执行批次，每批上下文可控，避免单次喂入撑爆 LLM 上下文。
> **原则**：每批 = 1 个里程碑 = 独立 PR = 可单独测试。

---

## 总览：6 个 Milestone / 8 个批次

```
Batch 1 (M1) ── 01-storage-adapter.md
Batch 2 (M2) ── 02-persistence-plugin.md + 03-lightweight-persistence.md
Batch 3 (M3) ── 04-create-pinia-per-platform.md
Batch 4 (M4) ── 05-ssr-isolation.md
Batch 5 (M5) ── 06-devtools.md
Batch 6 (M6) ── 07-testing.md + 08-migration-guide.md
```

**依赖链**：Batch 1 → Batch 2 → Batch 3 → {Batch 4, Batch 5} → Batch 6

---

## Batch 1：Storage 抽象层（M1）

**喂入 LLM 的内容**：
- `00-overview.md`（本文件 + 目录结构 + 设计原则）
- `01-storage-adapter.md`（完整）

**产出**：
- `src/shared/storage/types.ts`
- `src/shared/storage/memory.ts`
- `src/shared/storage/localStorage.ts`
- `src/shared/storage/wxStorage.ts`
- `src/shared/storage/nativeKV.ts`（占位）
- `src/shared/storage/index.ts`（工厂）
- `src/shared/persistence/serialize.ts`
- `src/shared/storage/trace.ts`

**验收**：`pnpm test storage` 通过，四端 Adapter 契约测试全绿。

**上下文控制**：仅涉及 `shared/storage/`，不涉及 Pinia / 平台代码。

---

## Batch 2：持久化层（M2）

**喂入 LLM 的内容**：
- `00-overview.md`（快速回顾）
- `02-persistence-plugin.md`
- `03-lightweight-persistence.md`

**产出**：
- `src/shared/persistence/plugin.ts`（社区插件兼容层）
- `src/shared/persistence/lightweight.ts`（自研轻量方案）
- `src/shared/persistence/trace.ts`（持久化追踪）

**验收**：
- 社区插件 demo store 零改动跑通
- 自研 `persisted()` API 单 store 配置 ≤ 3 行
- 两者可共存

**上下文控制**：仅依赖 Batch 1 的 `shared/storage/`，不涉及平台工厂。

---

## Batch 3：四端工厂（M3）

**喂入 LLM 的内容**：
- `00-overview.md`
- `04-create-pinia-per-platform.md`
- `01-storage-adapter.md`（快速参考，不重写）

**产出**：
- `src/platforms/web/pinia.ts`
- `src/platforms/mp/pinia.ts`
- `src/platforms/app/pinia.ts`（占位）
- `src/platforms/ssr/pinia.ts`
- `src/shared/platform.ts`
- `examples/` 下 Web + mp demo（用 `stores/player.ts` 演示）

**验收**：同一份 `player.ts` 在 Web + mp 跑通，状态可持久化。

---

## Batch 4：SSR 隔离（M4）

**喂入 LLM 的内容**：
- `00-overview.md`
- `05-ssr-isolation.md`
- `04-create-pinia-per-platform.md`（SSR 工厂部分）

**产出**：
- SSR entry 示例（`entry-server.ts` / `entry-client.ts`）
- SSR 隔离测试（并发请求无污染）
- hydration 顺序验证

**验收**：1000 QPS × 30s 压测无状态污染。

**注意**：SSR 可延后（Proteus 当前 v2.47 若无 SSR 需求可放 Batch 6 之后）。

---

## Batch 5：DevTools（M5）

**喂入 LLM 的内容**：
- `00-overview.md`
- `06-devtools.md`

**产出**：
- `src/shared/devtools/plugin.ts`
- `src/shared/devtools/trace.ts`
- `__PROTEUS_STORES__` 快照导出

**验收**：Web Vue DevTools 可用；小程序 trace 日志正常。

---

## Batch 6：测试 + 迁移（M6）

**喂入 LLM 的内容**：
- `07-testing.md`
- `08-migration-guide.md`

**产出**：
- 完整测试套件（L1-L4）
- `examples/migration-from-vue/` 示例
- CI 矩阵配置

**验收**：四端矩阵全绿，迁移 diff 清晰。

---

## 每批 LLM Prompt 模板

```
你是 Proteus 框架开发者。我们正在实现 Pinia 多端适配。

【当前批次】Batch X（Milestone MX）
【依赖模块】已完成的 Batch Y, Z（文件已存在，不要重写）
【本批规范】请严格遵循 <对应 .md 文件> 里的 API 设计和验收标准。

【要求】
1. 只产出本批列出的文件，不要提前做后续批次
2. 遵循 Proteus「透明编译 + AI-native」原则：每条适配规则独立模块、JSDoc 契约、产物可追溯
3. stores/ 目录禁止平台分支代码（grep 校验）
4. 每个文件写完后自测（Vitest）

【开始】
```

---

## 进度追踪

| Batch | Milestone | 状态 | PR |
|-------|-----------|------|-----|
| 1 | M1 Storage | ⬜ 待开始 | — |
| 2 | M2 Persistence | ⬜ 待开始 | — |
| 3 | M3 Platforms | ⬜ 待开始 | — |
| 4 | M4 SSR | ⬜ 待开始 | — |
| 5 | M5 DevTools | ⬜ 待开始 | — |
| 6 | M6 Testing + Migration | ⬜ 待开始 | — |

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| App 端 NativeKVAdapter 无原生实现 | Batch 1 先留占位 + 接口契约，后续对接 MMKV |
| pinia-plugin-persistedstate 内部变更 | 兼容层锁定大版本，集成测试守护 |
| SSR hydration mismatch | Batch 4 单独写严格测试，尽早暴露 |
| 上下文爆炸（本计划初衷） | 严格按 Batch 分批，每批 ≤ 3 个文件喂入 |

---

## 一句话总结

> **每份 `.md` = 一个独立上下文单元，每批 = 一个可合并 PR。** LLM 一次只吃 "overview + 当前模块 + 直接依赖"，永远不把 9 份全塞进去。
