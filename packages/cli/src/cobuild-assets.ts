// packages/cli/src/cobuild-assets.ts
// ★AI 共建工具包的**规范源**（canonical）——`proteus cobuild init` 按此写进任何使用 Proteus 的工程。
//
// 为什么以「CLI 内嵌字符串」为规范源（2026-09-20 设计）：
//   共建工具包必须能**随包分发**——任何工程装了 @proteus-vue/cli 就自带，不依赖：
//     ① 网络（不联网取模板）；② 框架仓库路径（工程可能在另一台机器）；③ 人工复制（会漂移）。
//   故内容是 TS 字符串常量，随 dist/index.js 一起发布；`scripts/gen-cobuild-kit.mjs` 由它派生
//   仓库内的副本（create-proteus 模板 + docs），并有门禁校验三者一致（防漂移）。
//
// 契约（外部工程据此与之交互，勿随意改字段名）：
//   台账 schema：version/project/report/schema/entries[]（字段见 LEDGER_SCHEMA）
//   收口判据：status=fixed ∧ fix_state=published ∧ verification=passed
//   报告锚点：`## 第N轮复测：\`<版本>\`` ——框架侧靠它做跨工程对齐

/** 共建 skill（外部工程的 AI 入口文档） */
export const COBUILD_SKILL = `---
name: proteus-cobuild
description: 参与 Proteus 框架共建——把"使用框架时撞到的问题"变成框架方可以复核并修掉的正式提交，并跟踪到发布与复测闭环。适用于：撞到框架缺陷（编译报错 / 静默失败 / 发布物缺件 / 文档与实际不符）要报给框架方时、准备写实战报告一节时、更新框架问题台账时、框架发新版后做复测回写时、判断"这是框架缺陷还是我方平台适配"时；或用户要求"报给 proteus""提交报告""复测新版""更新台账""共建"时。不适用：纯业务 bug（与框架无关）、平台限制导致的适配（记 consumer_notes 即可，不算框架缺陷）。
---

# 参与 Proteus 框架共建

> 你撞到框架问题时：**该不该报、报到哪、什么格式、什么时候算修好**——本文档全讲清。
> 机制自检：\\\`proteus cobuild check\\\`（文件齐备）/ \\\`node scripts/ledger_check.mjs --check\\\`（台账合格）。

## 0. 三件事

| 问题 | 答案 |
|---|---|
| **什么时候该报** | 框架**该做到却没做到**、或**静默失败**（不报错但行为错）时——判据见 §2 |
| **报到哪** | 本工程 \\\`docs/框架问题台账.json\\\`（加一条）+ \\\`docs/实战报告_proteus接入.md\\\`（追加一节） |
| **什么格式** | §3 两个模板，照着填；**最小复现是硬要求** |

## 1. 谁负责什么（避免两边改同一份）

| 字段 | 谁维护 |
|---|---|
| \\\`id\\\` \\\`title\\\` \\\`kind\\\` \\\`severity\\\` \\\`round\\\` \\\`reported_in\\\` \\\`evidence\\\` \\\`repro\\\` | **你（外部）**——问题的定义 |
| \\\`status\\\` \\\`fix_state\\\` \\\`fixed_in\\\` | 框架方——修复的状态 |
| \\\`verification\\\` \\\`verified_by\\\` | **你（外部）优先**——验证结论 |

> ★框架方自测只能标 \\\`verified_by=framework\\\`；**只有你在自己工程里用最小复现跑通，才能标 \\\`external\\\`**。
> 你的复测是唯一能把"框架自测通过"升级为"独立验证通过"的证据——这是你的核心价值。

## 2. 什么时候该报

**该报**：框架承诺的能力没做到（\\\`onMounted(async () => {…})\\\` 丢 \\\`async\\\` 标记 → 产物语法错）/ **静默失败**（正则 \\\`/\\\\s/g\\\` 被改坏，构建却通过）/ 报错**指向无关模块** / 发布物缺件（装了包用不了）/ 文档数字与实际不符。

**不该报**：平台限制（WXML 不支持 \\\`?.\\\`）→ 这是**你的适配**，记 \\\`consumer_notes\\\`；你自己的业务逻辑；**探针本身不可靠**导致的误报（先验证探针）。

| 情形 | 归属 |
|---|---|
| 框架标 \\\`aligned\\\` 但没对齐（**有对照实验证明本可做到**） | **框架缺陷** |
| 平台本身不支持 | 平台限制 → 你适配 |
| **静默失败**（不报错但错 / 报错指错方向） | **一律归框架** |
| 产出**语法合法但语义错**的产物 | **框架缺陷（最危险）** |

## 3. 格式

### ① 报告：追加一节

\\\`docs/实战报告_proteus接入.md\\\`——**标题格式是机器对齐的锚点，必须照写**：

\\\`\\\`\\\`markdown
## 第N轮复测：\\\`<被复测的版本号>\\\`（YYYY-MM-DD）—— 一句话结论

### 一、结论速览
| 项 | 结果 | 证据 |
|---|---|---|
| <问题> | ✅ 已修 / ❌ 未修 / ⚠️ 部分 | <怎么验的> |

### 二、已验证修复（逐项实测，非源码推断）

### 三、新发现的问题（每条一节）
<!-- 每条必须：现象 / 最小复现 / 影响面 / 根因（能定位就写）/ 修复建议 -->

### 四、我方适配（平台限制，非框架缺陷）

### 五、诚实澄清（可选，如测试脚本的误报）
\\\`\\\`\\\`

**硬要求**：① 标题带**版本号**；② 每条问题带**最小复现**；③ 区分「框架缺陷」与「我方适配」。

### ② 台账：加一条

\\\`docs/框架问题台账.json\\\` 的 \\\`entries\\\` 追加：

\\\`\\\`\\\`json
{
  "id": "F-27",
  "title": "一句话说清问题（能当 issue 标题）",
  "kind": "compiler",
  "severity": "blocker",
  "round": 7,
  "reported_in": "0.3.0-beta.10",
  "found_by": "external",
  "status": "open",
  "verification": "unverified",
  "evidence": "可复制的报错/现象关键片段",
  "repro": "最小复现（命令或代码）"
}
\\\`\\\`\\\`

- \\\`id\\\` **延续编号，分配后永不变更**（跨仓库对账锚点）；
- \\\`kind\\\`：packaging | cli | compiler | runtime | router | release | process | docs；
- \\\`severity\\\`：blocker（阻断使用/构建）| major（功能受损或静默错）| minor（体验/文档）；
- 新报的 \\\`status=open\\\`、\\\`verification=unverified\\\`，**不要填** \\\`fix_state\\\`/\\\`fixed_in\\\`（框架方发布后填）。

## 4. 闭环

\\\`\\\`\\\`
你报 → 框架复现并修 → 发布新版 → 写回执（改了什么/怎么验/哪个版本）
                                    ↓
                    你 git pull 框架仓库，看台账里你那条的 fix_state=published + fixed_in
                                    ↓
                    升级到该版本 → 用你的最小复现复测 → 台账回写 verification=passed + verified_by=external
\\\`\\\`\\\`

## 5. 提交前自检

\\\`\\\`\\\`bash
proteus cobuild check                # 共建文件齐备（skill/台账/报告/校验器/AGENTS.md 指针）
node scripts/ledger_check.mjs --check  # 台账合格 + 无未收口项（未收口会列出）
\\\`\\\`\\\`

- [ ] 报告标题含 \\\`第N轮复测\\\` + **版本号**；
- [ ] 每条新问题都有**最小复现**；
- [ ] 台账加了条目，\\\`id\\\` 延续、枚举取值合法；
- [ ] 区分了「框架缺陷」与「我方适配」；
- [ ] 自己的误报/不确定处单列澄清（**诚实比数量值钱**）。

## 6. 反模式

| 反模式 | 教训 |
|---|---|
| 只报现象不给复现 | 框架方无法复核 → 只能猜；带复现通常一轮就修好 |
| 把平台限制当框架缺陷 | 用 §2 判定表先分类，省双方时间 |
| 复测时不分「全修」与「只修一条路径」 | 明确指出"修了一半"极有价值（真实案例：一个 bug 三处实现只修一处） |
| 自己误报不澄清 | 会让框架方基于错误信息改代码 |
| 台账不更新 | 收口率失真；\\\`fix_state=worktree\\\` 对 npm 用户等于没修 |

---

**一句话**：你负责"问题是真的"（带复现），框架负责"改动是真的"（带发布），**你的复测决定"修复是真的"**——三者缺一，共建就是空的。
`

/** 台账校验器（零依赖 Node，随工程存放、随工程运行） */
export const LEDGER_CHECKER = `#!/usr/bin/env node
// scripts/ledger_check.mjs —— 框架问题台账 · 对账与校验（零依赖，Node >= 18）
// 由 \\\`proteus cobuild init\\\` 生成（规范源：@proteus-vue/cli 的 cobuild-assets）。
// 收口判据：status=fixed 且 fix_state=published 且 verification=passed——三者缺一不算收口。
// 用法：node scripts/ledger_check.mjs [--check] [--json] [--file <path>]
// 退出码：0 通过 / 1 存在未收口项（仅 --check）/ 2 台账本身不合格
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_LEDGER = path.join(HERE, '..', 'docs', '框架问题台账.json')
const argv = process.argv.slice(2)
const CHECK = argv.includes('--check')
const JSON_OUT = argv.includes('--json')
const fi = argv.indexOf('--file')
const LEDGER = fi >= 0 && argv[fi + 1] ? path.resolve(argv[fi + 1]) : DEFAULT_LEDGER

const ALLOWED = {
  kind: new Set(['packaging', 'cli', 'compiler', 'runtime', 'router', 'release', 'process', 'docs']),
  severity: new Set(['blocker', 'major', 'minor']),
  status: new Set(['open', 'fixed', 'partial', 'by_design']),
  fix_state: new Set(['published', 'worktree']),
  verification: new Set(['passed', 'partial', 'unverified', 'failed', 'n_a']),
  found_by: new Set(['external', 'framework']),
}
const REQUIRED = ['id', 'title', 'kind', 'severity', 'round', 'reported_in', 'found_by', 'status', 'verification', 'evidence', 'repro']

if (!fs.existsSync(LEDGER)) {
  console.error('✗ 找不到台账：' + LEDGER + '（先跑 proteus cobuild init）')
  process.exit(2)
}
let data
try {
  data = JSON.parse(fs.readFileSync(LEDGER, 'utf8'))
} catch (e) {
  console.error('✗ 台账 JSON 解析失败：' + e.message)
  process.exit(2)
}
const entries = data.entries ?? []

const errs = []
const seen = new Set()
for (const e of entries) {
  const id = e.id ?? '(无 id)'
  for (const k of REQUIRED) if (e[k] === undefined || e[k] === null || e[k] === '') errs.push(id + ': 缺必填字段 ' + k)
  if (seen.has(id)) errs.push(id + ': id 重复（对账锚点必须唯一）')
  seen.add(id)
  for (const [k, allowed] of Object.entries(ALLOWED)) {
    if (e[k] !== undefined && e[k] !== null && !allowed.has(e[k])) errs.push(id + ': ' + k + '=' + JSON.stringify(e[k]) + ' 不在允许集合')
  }
  if (e.severity === 'blocker' && !e.repro) errs.push(id + ': blocker 必须带最小复现')
  if (e.status === 'fixed' && !['published', 'worktree'].includes(e.fix_state)) errs.push(id + ': status=fixed 必须给 fix_state')
  if (e.status === 'partial' && !(e.related && e.related.length)) errs.push(id + ': status=partial 必须带 related 指向跟踪条目')
}

const b = { resolved: [], unreleased: [], unverified: [], partial: [], open: [] }
for (const e of entries) {
  if (e.status === 'by_design') continue
  else if (e.status === 'open') b.open.push(e)
  else if (e.status === 'partial') b.partial.push(e)
  else if (e.status === 'fixed' && e.fix_state === 'worktree') b.unreleased.push(e)
  else if (e.status === 'fixed' && e.verification !== 'passed') b.unverified.push(e)
  else b.resolved.push(e)
}
const total = entries.length
const nRes = b.resolved.length

if (JSON_OUT) {
  console.log(JSON.stringify({ ledger: LEDGER, total, resolved: nRes, schema_errors: errs, unreleased: b.unreleased.map((e) => e.id), unverified: b.unverified.map((e) => e.id), partial: b.partial.map((e) => e.id), open: b.open.map((e) => e.id) }, null, 2))
} else {
  console.log('框架问题台账对账 · ' + (data.project ?? ''))
  console.log('  报 ' + total + ' 条')
  console.log('  ✅ 收口（fixed + published + 独立复测通过）：' + nRes)
  if (b.unreleased.length) console.log('  🟡 已修未发布（仅工作树）：' + b.unreleased.length + '  → ' + b.unreleased.map((e) => e.id).join(', '))
  if (b.unverified.length) console.log('  🟡 已修但验证不充分：' + b.unverified.length + '  → ' + b.unverified.map((e) => e.id).join(', '))
  if (b.partial.length) console.log('  🟠 部分修复：' + b.partial.length + '  → ' + b.partial.map((e) => e.id).join(', '))
  if (b.open.length) console.log('  🔴 未修：' + b.open.length + '  → ' + b.open.map((e) => e.id).join(', '))
  console.log('  ★ 真实收口率：' + nRes + '/' + total + '（只算"用户拿得到且被独立验证过"的）')
  if (errs.length) {
    console.log('')
    console.log('⚠️ 台账 schema 问题：')
    for (const x of errs) console.log('   · ' + x)
  }
}
if (errs.length) process.exit(2)
if (CHECK && (b.open.length || b.unreleased.length || b.partial.length || b.unverified.length)) {
  if (!JSON_OUT) console.log('\\n--check：存在未收口项 → 退出 1')
  process.exit(1)
}
process.exit(0)
`

/** 台账骨架（新工程首次 init 时写入） */
export function ledgerSkeleton(projectName: string): string {
  return (
    JSON.stringify(
      {
        version: 1,
        project: projectName,
        report: 'docs/实战报告_proteus接入.md（本工程）',
        last_verified_published: null,
        last_verified_at: null,
        schema: {
          说明: '外部实战报告 → 修复 → 验证 的逐条对账台账。目标是让「报 N 修 M」可机器核对，而不是靠散文。由 proteus cobuild init 生成。',
          字段: {
            id: '稳定编号，一旦分配不得更改（对账的锚点）',
            title: '一句话说清问题',
            kind: 'packaging | cli | compiler | runtime | router | release | process | docs',
            severity: 'blocker（阻断使用/构建） | major（功能受损或静默错误） | minor（体验/文档）',
            round: '第几轮复测',
            reported_in: '在哪个版本上发现',
            found_by: 'external（你） | framework（框架自查）',
            status: 'open | fixed | partial | by_design',
            fix_state: 'published（已上 npm） | worktree（仅工作树）——status=fixed 时必填',
            fixed_in: '修复出现在哪个版本（fix_state=published 时必填）',
            verification: 'passed（复测通过） | partial | unverified | failed | n_a',
            verified_by: 'external（你在本工程复测） | framework（框架方自证）——verification=passed 时必填',
            verification_note: '验证方式的一句话（双方视角会合并保留）',
            evidence: '现象/报错（可复制片段）',
            repro: '最小复现（命令或代码）',
            related: '关联条目 id 数组（残留问题指向原条目）',
          },
          对账规则: [
            '只有 status=fixed 且 fix_state=published 且 verification=passed 才算「收口」',
            'fix_state=worktree → 未发布：不得计入已修（npm 用户拿不到）',
            'status=partial → 必须带 related 指向跟踪条目，防止「修一半当修完」',
            'severity=blocker 的条目必须带 repro',
          ],
        },
        consumer_notes: [],
        entries: [],
      },
      null,
      2,
    ) + '\n'
  )
}

/** 报告模板（首次 init 时写入）；`{PROJECT}` 替换为工程名 */
export function reportTemplate(projectName: string): string {
  return `# ${projectName} · Proteus 实战报告

> 目的：记录使用 Proteus 框架时撞到的问题，供框架方复核与修复。
> **每轮一节**，标题格式固定（框架侧靠它做跨工程对齐）：\\\`## 第N轮复测：\\\`<版本号>\\\`（YYYY-MM-DD）—— 一句话结论\\\`
>
> 配套：\\\`docs/框架问题台账.json\\\`（对账单一事实源）+ \\\`scripts/ledger_check.mjs\\\`（校验器）。
> 规范详解见 \\\`.agents/skills/proteus-cobuild/SKILL.md\\\`。

---

## 第一轮复测：\\\`<版本号>\\\`（YYYY-MM-DD）—— 首次接入

### 一、结论速览

| 项 | 结果 | 证据 |
|---|---|---|
| （待填） |  |  |

### 二、新发现的问题

<!-- 每条一节：现象 / 最小复现 / 影响面 / 根因（能定位就写）/ 修复建议 -->

### 三、我方适配（平台限制，非框架缺陷）

<!-- 如 WXML 不支持 ?. 之类的平台限制，你的适配记这里 -->

### 四、诚实澄清（可选）

<!-- 测试脚本的误报、可疑但未证实的猜测 -->
`
}

/** 写进工程 AGENTS.md 的指针段落（幂等：靠 marker 判断是否已存在） */
export const AGENTS_MARKER_START = '<!-- proteus-cobuild:start -->'
export const AGENTS_MARKER_END = '<!-- proteus-cobuild:end -->'
export const AGENTS_SECTION = `${AGENTS_MARKER_START}
## ★ 参与 Proteus 框架共建

本工程使用 **Proteus 框架**。撞到**框架**问题（编译报错 / 静默失败 / 发布物缺件 / 文档与实际不符）时，
**先挂载 \\\`Skill(proteus-cobuild)\\\`**（等价于读 \\\`.agents/skills/proteus-cobuild/SKILL.md\\\`）——它讲清：该不该报、报到哪、什么格式、什么时候算修好。

\`\`\`
① 撞到框架问题 → docs/实战报告_proteus接入.md 追加一节（标题必带版本号 + 最小复现）
                → docs/框架问题台账.json 加一条（id 延续编号）
② 框架修复发布 → git pull 框架仓库，看台账里你那条的 fix_state/fixed_in
③ 复测新版     → 台账回写 verification=passed + verified_by=external
\`\`\`

> **你的复测是唯一能把"框架自测通过"升级为"独立验证通过"的证据**——这是共建里你的核心价值。
> 自检：\\\`proteus cobuild check\\\` + \\\`node scripts/ledger_check.mjs --check\\\`
${AGENTS_MARKER_END}
`
