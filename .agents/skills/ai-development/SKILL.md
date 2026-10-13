---
name: ai-development
description: 执行多 AI 协作开发框架的规范（Proteus A 链：开发框架功能 / 组件 API / 能力）。当准备推进框架功能迭代、加/改组件或能力、认领任务、判断改动边界、拆分巨型文件、做交接、或与其他 AI 会话并行开发时使用。核心是统一生命周期 7 关（立项→认领→实施→自验证→独立验证→交接·发布→追溯）× 三链路路由（A 开发框架 / B AI 用框架 / C 外部缺陷）× 协作原语（任务板认领 / 所有权边界 / 交接 / 追溯），并可用 pnpm check:ai-tasks / check:file-size 机器强制。不适用：处理外部实战报告（用 ai-cobuild）、用框架写业务代码（见 G-36）、纯问答。
---

# AI 开发协作（LLM 可执行版）

> **一句话**：让**任意数量、任意模型的 AI 会话**用**同一套判据**协作推进 Proteus——
> 把「多个 AI 同时开发框架」从"靠记忆不撞车"变成**有生命周期、有边界、有交接、有追溯、有门禁**的工程流程。
>
> 完整规范：`docs/ai-development-spec.md`（本 skill 是其**可执行形态**，与 `ai-cobuild` 同款约定）。
> 本 skill 解决**五类静默失败**：① 没人认领 ② 撞车（改同一文件）③ 断在半路（WIP 无交接）
> ④ 不可追溯（说不清哪条决策）⑤ 巨型化（新代码又写成几千行）。

---

## 0. 先路由：这是哪条链路？

| 你的任务 | 链路 | 去处 |
|---|---|---|
| **开发/修改框架本身**（`packages/` `hosts/` 的功能、组件、能力） | **A** | **本文**（主线） |
| 让 AI **用框架写业务代码**（产标准 SFC） | B | `docs/proteus-ai-agent-plan/08-rules.md`（G-36） |
| 处理**外部实战报告的缺陷**（报告→立项→修→发→回执） | C | `Skill(ai-cobuild)`（本 skill 的姊妹） |

> ★ 若你是**因为要找"AI 协作规范"才打开 `ai-cobuild`**，但你其实要**开发框架**——你走错了，用本 skill。

---

## 1. 生命周期 7 关（每关有出口判据，不得跳关）

| 关 | 动作 | 出口判据（机器可查） |
|---|---|---|
| 0 立项 | 判链路 + 切**任务单元** + 落 plan / 任务板 | id + type + **架构取舍留决策号** |
| 1 认领 | **往 `docs/ai-tasks.json` 写一行**（`in_progress`+`owner`+`scope`） | owner 非空 + scope 与其它 `in_progress` **不重叠** |
| 2 实施 | 改代码（三条铁律见 §2） | 只碰 `scope` 声明的路径；`check:file-size` 绿 |
| 3 自验证 | 跑**定向门禁**（非全量）+ 破坏性验证 | 定向绿 + 改坏⇒必红 |
| 4 独立验证 | 由**另一会话/子代理**复测（自测不算） | 独立记录（无法独立⇒标 `partial`） |
| 5 交接/发布 | 中断写 handoff；完成 push（+`[deploy]`/发布） | `done`⇒已推送；`blocked`⇒有【Handoff】 |
| 6 追溯 | 闭合 需求→id→决策号→会话→commit | `done` 的 decision 号在 `decisions.md` 真实存在 |

**任务单元**（关 0 切法）：单一可观察结果 + 有定向门禁能证它 + 边界可 glob 化。
**反模式**：把"把玻璃做好"当一个单元（不可验证）——拆成"性能达标 / 折射对齐 / 端到端样例"。

---

## 2. 关 2 三条铁律

1. **同源纪律**：改动与**配套断言同步**（改内核跑 `pnpm test:coupled`——按 git diff 自动建议并**真跑**）；SSOT 类改动同步所有消费面。
2. **基准纪律**：任何"多端对齐"先问「**Web/标准的真值是什么**」，再问各端差在哪（只认 Web 真值，三端内部自洽不算证据）。
3. **反巨型化纪律**：**严禁大文件巨型化**——源文件不得越 **1000 行**（见 §4）。

---

## 3. 协作原语（多 AI 并行）

### 3.1 认领 = 登记（唯一形式）
**往 `docs/ai-tasks.json` 写一行**（`status=in_progress` + `owner` + `scope`）。口头/skill 里的"我来做"**不算**。
> 与 ai-cobuild「报了必须立项」同源：**没有登记，就没有机制发现"没人做/两人做"**。

### 3.2 所有权边界（防撞车）
| 类别 | 并行策略 | 例 |
|---|---|---|
| **独占**（跨文件 SSOT 语义） | 一次只允许一个 `in_progress` 持有 | `component-ir/src/primitives.ts` · `compiler/src/transforms/registry.ts` · `compiler/src/template.ts` · `plugin-vite/src/plugin.ts` |
| **共享可写**（只在"新增"维度安全） | 并行 OK，但**加不改** | 新增 `components/<新组件>/**` · 新增 `docs/*-plan/**` · `decisions.md`（**只追加**） |
| **只读基准**（生成物/golden） | 只改**源**、重生成，不手改产物 | `docs/generated/**` · `**/generated/**` · golden 快照 |

**边界 SSOT**：内核改动→配套测试的精化映射在 `scripts/test-coupling.mjs` 的 `COUPLING`（`pnpm test:coupled -- --explain`）——**改哪块先看它**。

### 3.3 交接（中断必留）
置 `status=blocked` + 在 `note` 写：
```
【Handoff】
- 做到哪 / 已改（含 commit sha）/ 未做 / 下一步（可照做）/ 坑 / 判据状态
```
小交接写任务板 `note`；大交接加 `PROJECT_MEMORY.md` 当月归档 + 任务板互指。

### 3.4 追溯锚点链
```
需求/报告 → 任务板 id → 决策号（decisions.md 只增不改号）→ 会话 owner → commit sha
```
commit 遵循 `<type>(<scope>): <desc> · 决策 #NNN`。

---

## 4. 文件拆分（反巨型化 · 用户明令）

- **硬规则**：新文件 **< 1000 行**；存量棘轮（`scripts/file-size-baseline.json` **只减不增**）；`ALLOW` 具名豁免（默认空，须写理由）。
- **三问**：这个文件几个职责（>1 就拆）？每段能用一个名词说清吗？拆完依赖**无环**吗？
- **方法**（照抄决策 #870 的 capability 三层范式）：先补/确认 characterization 测试 → 按职责+依赖切无环层（`类型契约 ← 平台实现 ← 工厂/装配`）→ 机械搬迁（值/类型分离 import）→ 处理**前向引用**（被引用者上移）与**共享可变态**（必须同文件）→ safe-edit + 定向/全量验证，**行为零变化**。
- **反模式**：先堆后拆 / 用 `ALLOW` 逃避 / 只按行数不看职责。

---

## 5. 机器判据（改代码后跑对应门禁）

```bash
pnpm check:ai-tasks        # 认领/边界/追溯/防撞车自洽（任务板）
pnpm check:file-size       # 反巨型化（新文件硬上限 1000 行 + 存量棘轮）
pnpm test:coupled          # 改内核→按 diff 建议并真跑配套断言
pnpm check:gates-sync      # 新增门禁必须接线（CI 或 LOCAL_ONLY 声明）
pnpm verify                # 全链（一轮工作收尾跑一次，≈10 分钟）
```
> ★ 新增门禁不接线 ⇒ `check:gates-sync` 当场红。改哪块就跑哪块的门禁，别一上来跑全量。

---

## 6. 反模式（真实踩过）

| # | 反模式 | 处置 |
|---|---|---|
| M1 | 任务只在对话里说"我来做" | 关 1：认领必落任务板 |
| M2 | 不登记 scope 就开干 | 关 1 + 重叠检测 |
| M3 | 改内核不跑 `test:coupled` | 债务推迟到全量（贵 10 倍） |
| M4 | 改 SSOT 不同步消费面 | §3.2 独占分类 |
| M5 | 一条任务改多件不相干的事 | §1 任务单元切分 |
| M6 | 自测当独立验证 | 关 4（独立性 = 异会话） |
| M7 | 本地提交不推 | `check:pushed` |
| M8 | done 但无决策号 | 关 6 |
| M9 | 手改生成物/golden | §3.2 只读基准 |
| M12 | 新文件写成几千行 | §4 + `check:file-size` |
| M13 | 用 `ALLOW`/`eslint-disable` 逃避拆分 | §4：只给"真的不可拆"且须写理由 |

---

## 7. 完成判据（DoD）

- [ ] 任务板该行 `done`：有 `decision`（`decisions.md` 真实存在）+ `verification`（可执行）；
- [ ] 改动只碰认领的 `scope`；`check:file-size` 绿（无新增巨型文件）；
- [ ] 定向门禁绿 + 每条新断言**破坏性验证**过；
- [ ] 独立验证有记录（异会话/子代理；无法独立标 `partial`）；
- [ ] 已 `git push`（`check:pushed` 无 ahead）；`[deploy]`（若动 `website/**`）已推；
- [ ] `pnpm check:ai-tasks`（+ 收尾 `pnpm verify`）通过。

---

## 8. 诚实边界

- **"完整"= 接线与索引**：本 skill 不创造新机器设施，只统一已有判据 + `check:ai-tasks`/`check:file-size` 两个门禁。
- **独立性是概率不是保证**：异会话降低相关偏差 ≠ 零偏差（无法真独立标 `verification=partial`）。
- **重叠检测是保守近似**（按 glob 静态前缀，宁可少报误报），拦"显然撞车"，不做形式化互斥证明。
- **任务板是协调工件**（谁做/边界/完成/决策），不是进度看板。
- 行为底线仍是 `ai-efficiency-rules`（对所有动作生效）；本 skill 只管**框架开发协作**。
