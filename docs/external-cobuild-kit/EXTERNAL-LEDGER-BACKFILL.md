# 外部项目 · 台账回填流程（给外部项目 AI 的操作手册）

> 适用对象：`OPERATOR/web` 侧维护 `web/docs/框架问题台账.json` 与 `web/docs/实战报告_proteus接入.md` 的 AI / 人。
> 版本：2026-11-12（对应框架 `proteus@43266046`，台账 schema 与门禁口径已收敛）。
> 一句话：**台账是派生视图，不是手写文档**——数量、收口率、一致性统统由脚本算，你只管填"问题本身"。

---

## 0. 先记住三条（违反任一条，你的回填会被框架门禁判红）

| # | 规则 | 为什么 |
|---|---|---|
| 1 | **只写你拥有的字段**，不要填 `status` / `fix_state` / `fixed_in` | 那是框架方的修复状态；你填了会被合并逻辑忽略（甚至冲突） |
| 2 | **`verification` / `verified_by` 只有你有资格写** | 框架自测不算独立验证（共建铁律 3） |
| 3 | **`verification_breakdown` 不要手改** | 它是派生数据，手改必然漂移（已实测：外部台账声称 35 条，实际 43 条） |

---

## 1. 字段归属表（唯一判据）

| 字段 | 谁填 | 说明 |
|---|---|---|
| `id` | **你** | 延续编号 `F-NN`，**永不复用、永不改号** |
| `title` / `kind` / `severity` / `round` / `reported_in` / `found_by` / `evidence` / `repro` | **你** | 问题的定义 |
| `related` | 双方 | 修了一半时互指 |
| `status` / `fix_state` / `fixed_in` | **框架** | 修复状态；你不用填，留空即可 |
| `verification` | **你**（复测后） | `passed` / `failed` / `unverified` / `partial` |
| `verified_by` | **你**（复测后） | 只能填 `external`；`framework` 是框架自证的档位，你别用 |
| `verification_note` | 双方 | **不是冲突字段**——合并成 `[external] …` + `[framework] …` 两段，各写各的 |
| `packages` | **框架** | `fix_state=worktree` 时必填，你没这个信息就别猜 |
| `verification_breakdown` | **脚本** | 派生：由 entries 重算。**手改必被门禁判红** |
| `rounds[]` | 双方 | 框架侧 `sync:cobuild` 会从你的报告标题**自动补**，你不必手填 |

`kind` 合法值：`packaging` / `cli` / `compiler` / `runtime` / `router` / `release` / `process` / `docs`
`severity` 合法值：`blocker` / `major` / `minor`
`status` 合法值：`open` / `fixed` / `partial` / `by_design`

---

## 2. 一轮完整回填流程（7 步）

### 步骤 1 — 写报告小节（报告是主，台账是从）

报告标题必须是**机器可解析**的形态。以下**四种都认**（框架 `cobuild-check` / `sync-cobuild` 已同口径）：

```markdown
## 第16轮复测：`0.3.0-beta.31`（2026-11-20）—— 一句话结论
## 第16轮：`0.3.0-beta.31`（2026-11-20）—— 一句话结论
## 第十六轮复测：`0.3.0-beta.31`（2026-11-20）—— 一句话结论
## 第 16 轮复测：`0.3.0-beta.31` —— 一句话结论
```

要点：
- **必须含版本号**（`0.3.0-beta.31` 或 `0.3.0`），框架的规则 C 会拿它和 `rounds[].version` 比对；
- **不要**在轮次标题里写「处理回执」——回执是框架写的另一类小节；
- 一轮报告 → 台账该轮**至少 1 条**（框架规则 A：报了必须立项）。

### 步骤 2 — 每题入台账一条

最小合法条目（复制改值）：

```json
{
  "id": "F-44",
  "title": "一句话说清现象（不是猜测的原因）",
  "kind": "compiler",
  "severity": "major",
  "round": 16,
  "reported_in": "0.3.0-beta.31",
  "found_by": "external",
  "status": "open",
  "verification": "unverified",
  "evidence": "我看到什么（产物片段 / 报错原文 / 截图路径）",
  "repro": "最小复现：能复制粘贴就跑的步骤或代码"
}
```

硬性要求：
- `severity=blocker` **必须**带 `repro`（没复现无法复核）；
- `status=partial` **必须**带 `related` 指向原条目（防"修一半当修完"）；
- 一条问题一个 id。若与旧条目同族（残留 / 同类漏网），用 `related` 互指并在 `repro` 里说清**新增的漏网形态**。

### 步骤 3 — 顺手校正 `last_verified_published`

这个字段的语义是「**你最后完整跑过的那套包版本**」，不是框架最新发布版本。

```json
{ "last_verified_published": "0.3.0-beta.31", "last_verified_at": "2026-11-20" }
```

⚠️ 当前两边都停在 `beta.17`（09-20），而实际已跑到 `beta.31` —— 这是历史遗留，下次回填顺手改对。

### 步骤 4 — **不要**手改 `verification_breakdown`

它是派生数据。按下面任一种方式重算（二选一，效果相同）：

```bash
# 方式 A（推荐，如果你能访问框架仓库）
node /path/to/proteus/scripts/sync-cobuild.mjs --from <你的 web 目录>
#   → 会重算 framework 侧台账的 breakdown

# 方式 B（只修你自己的台账）
node /path/to/proteus/scripts/ledger-check.mjs \
  --file web/docs/框架问题台账.json --fix-breakdown
```

### 步骤 5 — 自查（这一步不做，框架侧必红）

```bash
# ① 台账 schema 自检（必填字段 / blocker 必带 repro / partial 必带 related）
node /path/to/proteus/scripts/ledger-check.mjs \
  --file web/docs/框架问题台账.json
#   期望：无 "⚠️ 台账 schema 问题" 段
#   特别注意这行必须不存在：
#   verification_breakdown 与 entries 不一致（...）

# ② 收口率（发布前才要求 exit 0；日常看看就行）
node /path/to/proteus/scripts/ledger-check.mjs \
  --file web/docs/框架问题台账.json --check

# ③ 真跑一次同步，看有没有字段冲突（--check 不写文件）
node /path/to/proteus/scripts/sync-cobuild.mjs --from <你的 web 目录> --check
#   期望最后一行：✅ 无字段冲突
#   若报 conflict：说明你填了框架字段（status/fix_state/fixed_in），把那些字段删掉
```

### 步骤 6 — 提交

```bash
git add web/docs/实战报告_proteus接入.md web/docs/框架问题台账.json
git commit -m "docs(cobuild): 第16轮复测 · F-44~F-47"
```

**两个文件一起提交**——只改台账不改报告，框架规则 B 会判"立项无出处"；只改报告不改台账，规则 A 会判"报了没立项"。

### 步骤 7 — 通知框架方

给框架方的信息只需一句：**「第 N 轮报告已提交，被复测版本 X，新增 F-AA~F-BB」**。
框架方跑 `pnpm sync:cobuild --from <你的路径>` 完成合并。

---

## 3. 复测回写（框架修完发布之后）

这是**唯一能提升真实收口率**的动作，只有你能做。

```json
{
  "id": "F-44",
  "verification": "passed",
  "verified_by": "external",
  "verification_note": "在 <你的工程> 升级到 0.3.0-beta.33 后重跑步骤 2 的最小复现：<结果>；产物 <路径> 零残留。"
}
```

判定标准（**框架方自测/读代码都不算**）：

| 你的验证方式 | 算独立验证吗 |
|---|---|
| 在自己工程里跑报告里的最小复现 | ✅ **唯一金标准** |
| 干净目录装 registry 包跑真实用户旅程 | ✅ 算 |
| 只读框架源码确认"改了" | ❌ 不算（陈述不是证据） |
| 看构建通过但没跑复现 | ❌ 不算 |

若发现**修复不完整**：不要改原条目的 `verification`，而是①原条目保持 `unverified` ②**新开一条** `related` 指向它，说清残留形态。

---

## 4. 常见判红与修法

| 框架门禁报什么 | 你的问题 | 怎么修 |
|---|---|---|
| `A 报了必须立项` | 报告有该轮小节，台账无条目 | 给该轮至少补 1 条 |
| `B 立项必须有出处` | 台账有条目，报告无对应轮次小节 | 检查标题是否含 `第N轮` + 版本号；或删掉无效条目 |
| `C 版本口径一致` | 报告标题版本 ≠ `rounds[].version` | 检查标题里的版本号是否写错 |
| `D 修复必须有回执` | 该轮已全部收口但报告无回执节 | **这是框架要做的**，不是你——提醒框架方补回执 |
| `F 台账框架侧元数据完整` | 你把框架台账整份覆盖了 | 别整份复制！用 `sync-cobuild` 按字段合并 |
| `verification_breakdown 与 entries 不一致` | 你手改了派生字段 | 跑 `--fix-breakdown` 重算 |
| `缺必填字段 xxx` | 条目字段不全 | 见 §1 必填清单 |
| `blocker 必须带最小复现` | `severity=blocker` 无 `repro` | 补 `repro`，或如实降级 severity |

---

## 5. 三条反模式（真实踩过）

1. **整份覆盖框架台账** —— 已发生两次，会抹掉框架自查条目（`found_by=framework`）和 `rounds`/`verification_breakdown`。已加规则 F 拦截，但别试。
2. **报了的没立项** —— 报告写了 5 条，台账只记 3 条。规则 A 会拦，但要在提交前自查。
3. **把"我方适配"报成"框架缺陷"** —— 平台本身不支持（如 WXML 不支持 `?.`）属你方适配；**静默失效**（不报错但行为错）一律归框架。

---

## 6. 一页速查

```
写报告  →  标题含「第N轮」+ 版本号
入台账  →  一条一 id，字段照 §1 归属，blocker 必带 repro
自检    →  ledger-check --file <你的台账>     （无 schema 段 = 通过）
         →  sync-cobuild --check             （✅ 无字段冲突 = 通过）
提交    →  报告 + 台账 两个文件一起
通知    →  「第N轮已提交，版本X，新增 F-AA~F-BB」
复测后  →  verification=passed + verified_by=external + 一句话 note
```
