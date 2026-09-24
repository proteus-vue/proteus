# AGENTS.md —— 项目约定（新会话必读）

> 本文件是本仓库对 AI Agent / LLM 会话的**硬性约定**。开始任何工作前先遵守下方「会话启动清单」。

## 0. 会话启动清单（★★★ 每会话强制）

1. **★先挂载效率规范 Skill**：每个会话开始时**必须先执行 `Skill(ai-efficiency-rules)`**（等价于
   `/.agents/skills/ai-efficiency-rules/SKILL.md`），再开始任何工具调用。该 Skill 约束固定 `sleep` 盲等、
   重复拉取远程资源、重复读文件、无归因重试、该并行却串行、输出爆炸等低效模式，是不可协商的行为规则。
   - 若宿主未提供 Skill 工具，则读 `.agents/skills/ai-efficiency-rules/SKILL.md` 并遵守其三条总则。
   - 参考文件在同目录 `references/`（完整规范 / 自检清单 / 代码模板 / 审计规则）。
2. **读 `PROJECT_MEMORY.md` 顶部「当前状态速览」**（新会话以此为准），再按 §「会话恢复指引」顺序阅读。
3. **★涉及外部实战报告（`docs/实战报告_proteus接入.md`）时，先挂载 `Skill(ai-cobuild)`**：
   该 Skill 是跨项目共建闭环的硬性规范（四条铁律：报了必须立项 / 修了必须发布 / 发了必须独立验证 /
   闭环必须留回执），配套机器门禁 `pnpm check:ledger`（台账自洽）+ `pnpm check:cobuild`（报告↔台账↔回执 三方对齐）。
   完整规范见 `docs/ai-cobuild-spec.md`。**处理报告 = 按该 Skill 的七步协议走，不要凭印象改代码。**
   - 若宿主未提供 Skill 工具，则读 `.agents/skills/ai-cobuild/SKILL.md` 并遵守其四条铁律。
4. 只改该改的：改动前先用 grep 定位，避免整读大文件；改完跑对应门禁（见下）。

## 1. 效率规范要点（Skill 内三条不可协商总则）

- **先判断再动手**：信息已在上下文 / 本地磁盘 / 上次结果中，则复用，禁止重新获取。
- **等待有条件、获取有缓存、重复有上限**：无退出条件的等待、无缓存的重复拉取、无上限的重试一律视为缺陷。
- **能并行就并行，能批量就批量**：无依赖的调用合并同批发出。
- 冲突优先级：**正确性 > 安全性 > 效率**。

## 2. 项目门禁（改代码后按需运行）

```bash
pnpm test                 # 全量单测（Node ≥ 22；jsdom 27 为 ESM-only，Node 18 会误报）
pnpm check:mp-attrs       # 端对齐属性棘轮（只增不减）
pnpm check:content        # 官网内容生成幂等
pnpm check:stats          # 官网数字 vs 源码实际值（防「数字过时」静默上线）
pnpm check:ledger         # 外部报告台账自洽（schema/枚举/repro/related）
pnpm check:cobuild        # AI 共建三方一致（报告↔台账↔回执）
pnpm ledger:check         # 收口率报告（**发布前**跑：未收口项 exit 1）
pnpm verify               # 全量门禁（较重）
```

端能力对齐的**标准作业流程（SOP v2，13 步不得跳步）**见
`docs/proteus-end-alignment-plan/04-batches.md`；参考实现 = `p-button`；
Skyline 踩坑总账见 `docs/skyline-pitfalls.md`。

## 3. 真机 / 小程序 E2E（本机 wechatide 已可用）

微信开发者工具 **已安装**，路径固定在 `/Volumes/data1/applications/wechatwebdevtools.app`
（★2026-09-24 迁移到此；旧路径 `/Volumes/data1/work/office-applications/...` 已废弃）。
**不要**再假设「本机未安装」或「无法真机验证」——先按下面跑。

```bash
# MP E2E（几何级组件断言 + 冒烟 + vue-compat + popover 全家桶）
# ★路径已写入 CLI 默认探测表（packages/cli/src/mp-e2e.ts 的 MP_IDE_DEFAULT_PATHS）→ 无需再传环境变量
npx tsx packages/cli/src/index.ts test e2e:mp showcase
# 若需显式指定（换机/换安装位）：
# PROTEUS_IDE_CLI="/Volumes/data1/applications/wechatwebdevtools.app/Contents/MacOS/wechatide" \
#   npx tsx packages/cli/src/index.ts test e2e:mp showcase
# 只跑某文件：再设 PROTEUS_E2E_ONLY=e2e-mp-components
```

★**必须用 `wechatide` 二进制，不是同目录的 `cli`**（后者是已弃用的 automator CLI →
整条 e2e:mp 链路会静默失败、报「输出非 JSON」）。首次调用会弹授权窗（clientName 须与 `-c` 一致）。
截图/元素/几何查询：`wechatide simulator_screenshot` / `automation_element_action` /
`automation_evaluate`（`wx.createSelectorQuery` 只达**页面级原生节点**，组件内部 DOM 隔离查不到）。

