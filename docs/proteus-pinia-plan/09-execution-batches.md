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

---

## 超级应用追加批次（M7 + M8）

> 前置：M1-M6 已完成（骨架就绪）。M7/M8 追加式插入，不重构已有批次。

### Batch 7.1 — 7.6（M7 可靠性）

| 文件 | 产出 | 上下文（喂 LLM） |
|------|------|------------------|
| `10-m7-reliability.md` § M7.1 | `runtime/persist/sharding.ts` | overview + 10 + M2 文档 |
| `10-m7-reliability.md` § M7.2 | `runtime/persist/scheduler.ts` | overview + 10 + M2 文档 |
| `10-m7-reliability.md` § M7.3 | `runtime/persist/quota.ts` | overview + 10 + M1 文档 |
| `10-m7-reliability.md` § M7.4 | `runtime/persist/migrate.ts` | overview + 10 + M2 文档 |
| `10-m7-reliability.md` § M7.5 | `runtime/scope.ts` | overview + 10 + M3 文档 |
| `10-m7-reliability.md` § M7.6 | `runtime/persist/secure.ts` | overview + 10 + M1 文档 |

每批（7.1 / 7.2 / ... / 7.6）各一个 PR，复用 Batch 模板，上下文替换为 `overview + 10-m7-reliability.md + 对应直接依赖文档`。

### Batch 8.1 — 8.4（M8 协同 + 可观测）

| 文件 | 产出 | 上下文（喂 LLM） |
|------|------|------------------|
| `11-m8-sync-observability.md` § M8.1 | `packages/pinia-sync/`（LWW + CRDT 适配） | overview + 11 + M7.4, M7.6 |
| `11-m8-sync-observability.md` § M8.2 | `runtime/devtools/snapshot.ts` | overview + 11 + M7.4 |
| `11-m8-sync-observability.md` § M8.3 | `runtime/tracer.ts` | overview + 11 + M7.6 |
| `11-m8-sync-observability.md` § M8.4 | `stores/registry.ts` + `CONVENTIONS.md` + CI workflow | overview + 11 + M6 |

每批（8.1 / 8.2 / 8.3 / 8.4）各一个 PR。M8.1 为独立 package，可最后做或并行。

### 更新后进度追踪

| Batch | Milestone | 状态 | PR |
|-------|-----------|------|-----|
| 1 | M1 Storage | ✅ 完成（决策 #106） | — |
| 2 | M2 Persistence | ✅ 完成 | — |
| 3 | M3 Platforms | ✅ 完成 | — |
| 4 | M4 SSR | ✅ 完成 | — |
| 5 | M5 DevTools | ✅ 完成 | — |
| 6 | M6 Testing + Migration | ✅ 完成 | — |
| 7.1 + 7.2 | M7 分片 + 调度器 | ✅ 完成（决策 #107） | — |
| 7.3 + 7.4 | M7 配额 + 迁移 | ✅ 完成 | — |
| 7.5 + 7.6 | M7 生命周期 + 敏感字段 | ✅ 完成 | — |
| 8.1 | M8 协同引擎 | ✅ 完成（@proteus/pinia-sync） | — |
| 8.2 + 8.3 | M8 快照 + 埋点 | ✅ 完成 | — |
| 8.4 | M8 注册表 + AI 规范 + 门禁 | ✅ 完成 | — |
| 9.x | ★MP 编译接入（P1 模板绑定 / P2 事件包装 / P3 放行+体积） | ✅ 完成（P1+P2+P3，2026-08，docs/12-mp-compile.md） | — |

### 上下文预算（防撑爆）

- **企业级路径**（M1-M6）：6 批，每批 ≤ 3 文件，单批上下文 ≈ overview(~5k) + 1-2 模块文档(~8k) + 依赖文档(~5k) ≈ **18k tokens**
- **超级应用路径**（M7-M8）：10 批追加，复用同一预算，每批不回头读 M1-M6 全文，只引用直接依赖文档（已在根目录，按需 `read`）
- **新增铁律**：LLM 执行任何 Batch 前，先 `read` 该 Batch 对应的 `.md`（10 或 11）+ overview，再按需 `read` 依赖文档；**禁止一次性读入全部 11 份**

### 追加风险与缓解

| 风险 | 缓解 |
|------|------|
| M7 调度器与 M2 持久化插件冲突 | B7.2 直接改造 M2 的 flush 逻辑，单 PR 内完成，不改插件对外 API |
| M8.1 CRDT 依赖 Yjs 体积过大 | 动态 import，仅 `strategy:'crgt'` 时加载；LWW 为零依赖默认 |
| encrypted 字段参与协同导致密文冲突 | M8.1 自动跳过 `encrypted`/`volatile` 字段并 warn |
| AI 绕过 CI 门禁 | B8.4 门禁跑在 PR 流水线强制步骤，fail 即 block merge |

---

## 一句话总结

> **每份 `.md` = 一个独立上下文单元，每批 = 一个可合并 PR。** LLM 一次只吃 "overview + 当前模块 + 直接依赖"，永远不把 11 份全塞进去。企业级走 6 批（M1-M6），超级应用再加 10 批（M7.1-M7.6 + M8.1-M8.4），追加式插入不重构。
