# Proteus 平台原生能力适配方案（执行文档 v1）

> 目标：**不用 `#ifdef PLATFORM` 把平台代码撒进业务**，同时承认“框架不可能抽象全部平台能力”。
> 原则：**能力分层 + 接口隔离 + 适配器插件 + 产物分叉 + 回归矩阵**。
> 一句话：**业务写“需要什么能力”，不写“我在哪个平台”；平台差异被关在 `platforms/*` 与 `adapters/*` 里。**

---

## 本计划怎么读（重要）

1. **只吃当前任务相关文件**：执行一个 Batch 时，只读 `00-overview.md` + 本 Batch 对应文件 + 已完成的依赖文件。
2. **禁止把整套文档塞给一次 LLM 调用**。
3. 所有文件均遵循“设计原则 → 接口契约 → Skyline 约束 → 可审计产物 → 验收测试”的结构。
4. 若业务必须写平台分支，只允许出现在：
   - `src/platforms/<platform>/`
   - `src/adapters/<capability>/`
   - `*.platform.ts`（明确的高阶例外）

---

## 文档结构

| 文件 | 职责 |
|------|------|
| `00-overview.md` | 架构、原则、能力等级、目录、铁律、里程碑 |
| `01-m1-capability-contract.md` | 能力接口、探测、版本、权限 |
| `02-m2-adapter-registry.md` | Adapter 注册、覆盖、优先级 |
| `03-m3-build-time-dispatch.md` | 编译分叉、类型收窄、死代码 |
| `04-m4-runtime-fallback.md` | 降级链、shim、failover |
| `05-m5-platform-modules.md` | 平台原生 API 模块规范 |
| `06-m7-reliability.md` | 超级应用：稳定性与性能 |
| `07-m8-observability.md` | trace、DevTools、审计 |
| `08-testing-regression.md` | 回归矩阵（本计划核心） |
| `09-migration-ci.md` | 存量治理、CI 门禁、迁移 |
| `10-execution-batches.md` | 分批策略与 Prompt 模板 |

---

## 当前状态

- 状态：**架构规划完成，未实现**
- 建议执行顺序：**M1 → M2 → M3 → M4 → M5 → M7 → M8 → 测试/迁移**
- 依赖关系：
  - API 层（Request/Trace）完成后更佳
  - 可与 Component B1、Router B1 并行启动部分模块

---

## 成功标准（验收）

- 业务代码中 **不得出现** `#ifdef` / `process.env.PLATFORM` / `wx.*` / `window.*` 等平台直接判断
- 同一能力在 Web / Skyline / App 三端的调用签名完全一致
- 新增平台能力只需：定义接口 → 实现适配器 → 注册 → 补回归用例
- 任何平台差异必须能在 CI 中通过“能力×平台矩阵”回归
