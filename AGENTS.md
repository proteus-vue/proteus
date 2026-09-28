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

### ★★ 红线：禁止固定 sleep 盲等（2026-09-27 起有工具级拦截）

- **`sleep ≥ 5s` 会被 hook 拦截**（PreToolUse → `scripts/hooks/deny-sleep.mjs`，返回 deny + 替代方案）。
  · hook 脚本**已入库**（`scripts/hooks/deny-sleep.mjs`），配置在 `.zcode/config.json`（该目录 gitignore，
    属本地配置）：新 worktree/新机器请把下方 `hooks` 块加进 `.zcode/config.json` 并**重启会话**——
    ZCode 在会话启动时读取 hooks 源，中途创建不生效。
  · 安装片段（`hooks.enabled` 必填，否则配置文件的 hooks 默认不运行）：
    ```json
    { "hooks": { "enabled": true, "events": { "PreToolUse": [
      { "matcher": "Bash", "hooks": [
        { "type": "process", "command": "node",
          "args": ["${ZCODE_PROJECT_DIR}/scripts/hooks/deny-sleep.mjs"], "timeoutMs": 5000 } ] } ] } } }
    ```
  · 自测：`printf '%s' '{"tool_name":"Bash","tool_input":{"command":"sleep 100"}}' | node scripts/hooks/deny-sleep.mjs`
    → 应输出 `permissionDecision: deny`。
- **部署/线上核验**：跑一次 `pnpm check:live`（仓库自带 `website/scripts/verify-live.mjs`，带 CDN 传播重试）。
  **不要**自行写 `for i in ...; do curl ...; sleep N; done` 轮询——这正是被拦截的模式。
- **等条件就绪**：`bash .agents/skills/ai-efficiency-rules/scripts/wait_for.sh --http <url> --timeout 90`。
- **无法判定时（等 CI 队列等）**：**直接告诉用户「已触发，请刷新查看」**——用户目视验收比 AI 轮询快。
  （用户原话：「等你验证还不如我直接去看」「不用验证了，已经生效了」——已发生 3 次，记牢。）
- 禁止的三种错误验证法（均实测踩过）：① 轮询 HTML 抓 CSS 哈希（有 CDN 缓存）；
  ② grep 主 bundle 找文档标记（内容在独立 chunk）；③ 资产名已变仍判 old。

### ★★红线：全量测试禁止无目的重复跑（2026-09-28 起有工具级拦截）

- **同代码状态重复跑全量会被拦截**（hook `scripts/hooks/deny-blind-tests.mjs`，配法同 deny-sleep）。
  触发背景：AI 把 `npx vitest run` 跑了三遍、每遍 ~400s，而**第一遍输出已足够定位**——
  与 sleep 盲等同源：规则写在 markdown 拦不住，只有工具层门禁是结构性的。
- **拦**：`npx vitest run`（无文件/名称过滤）与 `pnpm test`（无参数）**且 git 指纹与上次全量相同**。
- **放行**：① 定向跑（带 `tests/xxx.test.ts` 路径）② `--changed` / `-t <名称>` 等过滤
  ③ 代码变了（指纹变 ⇒ 自动放行一次并记账）④ 显式表态 `PROTEUS_ALLOW_FULL_SUITE=1 pnpm test`。
- 自测：`PROTEUS_TEST_HOOK_STATE=/tmp/h.json printf '%s' '{"tool_name":"Bash","tool_input":{"command":"npx vitest run"},"cwd":"'"$PWD"'"}' | node scripts/hooks/deny-blind-tests.mjs`
  （先跑一次放行并记账，再跑一次应输出 `permissionDecision: deny`）。
- 另注：`pnpm test` 只跑非 e2e（`--exclude "tests/e2e-*.test.ts"`）；e2e 有专用入口
  （`test:e2e:web` / `test:e2e:showcase`），**跑它们前必须先建对应产物**——直接裸跑 vitest
  会环境性红（实测 124 条假失败），白等几百秒。

### ★★红线：**提交 ≠ 交付**——每轮收尾必须推送（2026-09-28 用户指出）

- **现象（用户原话：「今天的改动都没推送啊，全都是提交了没推送」）**：一整天的 111 个提交
  全部只在本地 `main`，`git status` 显示 `ahead 111`。AI 每轮都做了 §2 门禁、写了详细 commit message，
  **唯独漏了 push** ⇒ 从"用户的视角"看，这一天的产出**根本不存在**（远端一条都没有）。
- **为什么门禁没拦住**：§2 的所有检查（test / check:* / verify）都是**本地**门禁，
  `git status` 的 `ahead N` 也不报错——**没有任何机制会提醒"还没推"**。
  与「sleep 盲等」「全量重复跑」同源：**这类遗漏只有工具/流程层能兜住**。
- **纪律（收尾三步，缺一不可）**：
  1. `git status -sb` 看 `ahead N`；**N > 0 就必须推**（不为 0 或显示 `up to date` 才算交付完）
  2. `git push origin <branch>`（推前 `git fetch` 确认不是 `behind`——冲突要显式处理，不硬推）
  3. 推完**再跑一次 `git status -sb` 确认无 `ahead`**（"我推了"和"推上去了"是两件事，
     与"改完了"和"改对了"同理）
- **何时必须推**：① 用户说"继续/完成/收工"时的**收尾** ② 一轮功能闭环（含真机验证）自成一个提交之后
  ③ 用户明确说"推送/发布/上线"。**不要**攒一大坨再推——真机验证类的产出被攒住时，
  用户无法在 GitHub 上看到证据，也无法在另一台机器上接手。
- **反向纪律**：**不许**为了"看起来交付了"而把未验证的改动推上去。推送的前提是
  §2 门禁已过（全量 test 或对应的定向门禁）——**先验证再推，不是先推再补验证**。
- **工具化**：`pnpm check:pushed`（提醒，已接进 `pnpm verify` 末尾）·
  `pnpm check:pushed:strict`（未推则 exit 1，供收尾调用）。二者对**落后 upstream** 同样判失败
  （behind>0 直接推会被拒或产生意外合并）。★新增门禁会被 `check:gates-sync` 盯着
  （未接线且未在 `LOCAL_ONLY` 写明理由 ⇒ 当场红）——**接线不靠记忆**。

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

