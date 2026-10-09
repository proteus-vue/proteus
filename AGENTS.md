# AGENTS.md —— 项目约定（新会话必读）

> 本文件是本仓库对 AI Agent / LLM 会话的**硬性约定**。开始任何工作前先遵守下方「会话启动清单」。

## 0. 会话启动清单（★★★ 每会话强制）

1. **★先挂载效率规范 Skill**：每个会话开始时**必须先执行 `Skill(ai-efficiency-rules)`**（等价于
   `/.agents/skills/ai-efficiency-rules/SKILL.md`），再开始任何工具调用。该 Skill 约束固定 `sleep` 盲等、
   重复拉取远程资源、重复读文件、无归因重试、该并行却串行、输出爆炸等低效模式，是不可协商的行为规则。
   - 若宿主未提供 Skill 工具，则读 `.agents/skills/ai-efficiency-rules/SKILL.md` 并遵守其三条总则。
   - 参考文件在同目录 `references/`（完整规范 / 自检清单 / 代码模板 / 审计规则）。
2. **读 `PROJECT_MEMORY.md`**（薄入口，~100 行）——先读顶部「当前状态速览」（只留最近 3 条，新会话以此为准），
   再按 §「会话恢复指引」顺序阅读。**详细历史在 `docs/project-memory-archive/`（按月归档 + `decisions.md` 决策链全文 #1–#465）——
   勿整读、按关键词/决策号 grep**。★维护规则见该文件 §《收纳规范》：新里程碑的详细叙事**直接写进当月归档**，
   主文件只加一行速览；跑 `pnpm check:memory` 自检（防文件再长回去——它在 2026-10-03 收整前达 2.4 MB）。
3. **★涉及外部实战报告（`docs/实战报告_proteus接入.md`）时，先挂载 `Skill(ai-cobuild)`**：
   该 Skill 是跨项目共建闭环的硬性规范（四条铁律：报了必须立项 / 修了必须发布 / 发了必须独立验证 /
   闭环必须留回执），配套机器门禁 `pnpm check:ledger`（台账自洽）+ `pnpm check:cobuild`（报告↔台账↔回执 三方对齐）。
   完整规范见 `docs/ai-cobuild-spec.md`。**处理报告 = 按该 Skill 的七步协议走，不要凭印象改代码。**
   - 若宿主未提供 Skill 工具，则读 `.agents/skills/ai-cobuild/SKILL.md` 并遵守其四条铁律。
4. 只改该改的：改动前先用 grep 定位，避免整读大文件；改完跑对应门禁（见下）。
5. **★一律用中文回复用户**（2026-10-09 用户指定）：所有对用户输出的正文（总结 / 说明 / 结论 /
   状态更新 / 提问）一律**中文**；代码、命令、标识符、日志、文件路径、报错原文等**保持原样不改写**。
   术语可用中文并保留英文原词（如「门禁 gate」「桩测 stub」），但**不得整段用英文作答**。

## 1. 效率规范要点（Skill 内三条不可协商总则）

- **先判断再动手**：信息已在上下文 / 本地磁盘 / 上次结果中，则复用，禁止重新获取。
- **等待有条件、获取有缓存、重复有上限**：无退出条件的等待、无缓存的重复拉取、无上限的重试一律视为缺陷。
- **能并行就并行，能批量就批量**：无依赖的调用合并同批发出。
- 冲突优先级：**正确性 > 安全性 > 效率**。

### ★★ 红线：禁止**任何**盲等（sleep / timeout / 轮询）—— 2026-09-30 起收紧为全禁

- **判据（用户 2026-09-30 原话）**：「**禁止任何情况下的 sleep、timeout**，只要有异步脚本全部异步执行……
  要么让 App 主动报告，要么有条件等待」。**`sleep` 任意时长一律拒绝**（含 `sleep 1`，不再有 ≥5s 阈值）。
- **两道门禁是一个整体**（工具层 hook + 静态门禁——覆盖面必须跟着实际形态走）：
  · `scripts/hooks/deny-sleep.mjs`（PreToolUse）：拦**命令字面量**里的 `sleep` / `timeout N`；
  · `pnpm check:no-blind-wait`（静态扫 `hosts/**` `scripts/**` `.agents/**` 全部 `.sh`）：
    拦**脚本内部**的 sleep（hook 的结构性盲区——实测：`bash run-selfdraw.sh` 字面无 sleep，
    而脚本内部盲等 600 秒/轮，一次测试 11 分钟里 10 分钟白等，且等的判据**永远不可能满足**）。
  · 基线棘轮 `scripts/no-blind-wait-baseline.json`：存量只减不增；改到哪个文件就把那个文件的清掉。
- **两条合法形态（优先级从高到低）**：
  1. **让被测对象主动上报**（首选）：等进程退出 / 读管道 / 读事件流。本仓实例：
     iOS 宿主 `PROTEUS_EXIT_AFTER_REPORT=1` ⇒ 报告落盘后进程自退 ⇒
     `devicectl/simctl launch --console` 的**返回即完成信号**（零轮询 / 零 sleep / 零 timeout）。
  2. **有条件等待**：`bash .agents/skills/ai-efficiency-rules/scripts/wait_for.sh --cmd/--file/--http`
     （有界轮询，全仓**唯一**允许含 sleep 的原语，白名单在 check-no-blind-wait.mjs）。
- **长任务一律后台异步执行**（run_in_background），不得让用户/AI 前台干等。
- **hook 接线**：hook 脚本**已入库**（`scripts/hooks/deny-sleep.mjs`），配置在 `.zcode/config.json`
  （该目录 gitignore，属本地配置）：新 worktree/新机器请把下方 `hooks` 块加进 `.zcode/config.json`
  并**重启会话**——ZCode 在会话启动时读取 hooks 源，中途创建不生效。
  · 安装片段（`hooks.enabled` 必填，否则配置文件的 hooks 默认不运行）：
    ```json
    { "hooks": { "enabled": true, "events": { "PreToolUse": [
      { "matcher": "Bash", "hooks": [
        { "type": "process", "command": "node",
          "args": ["${ZCODE_PROJECT_DIR}/scripts/hooks/deny-sleep.mjs"], "timeoutMs": 5000 },
        { "type": "process", "command": "node",
          "args": ["${ZCODE_PROJECT_DIR}/scripts/hooks/deny-blind-tests.mjs"], "timeoutMs": 8000 },
        { "type": "process", "command": "node",
          "args": ["${ZCODE_PROJECT_DIR}/scripts/hooks/deny-blind-verify.mjs"], "timeoutMs": 9000 } ] } ] } } }
    ```
    ★**三个 hook 是一个整体**（sleep 盲等 / 全量测试重复跑 / 全量门禁链重复跑）——
      只装第一个等于三条红线只落实一条（本仓实测过：`deny-blind-tests` 在别的机器上缺失时，
      「全量跑三遍」那类浪费照样发生）。
- ★★★**输出契约：`exit 2` + stderr（2026-10-02 修复——5 天静默失效的根因）**：
  本仓三条 hook 原用 Claude 式**扁平** stdout JSON（`{hookEventName, permissionDecision}` 在顶层）；
  而 ZCode 客户端 schema 是**嵌套严格校验**（`hookSpecificOutput.hookEventName/...`，多余顶层键
  ⇒ `Hook stdout failed schema validation`）⇒ 失败被记为 `hook.run.failed`、deny 被**丢弃**。
  实测：09-27 立 hook 至 10-02，**每一次运行都失败（零成功）**；用户当场点名「钩子就是拦不住、
  你还连做了三次 sleep」——三次全跑掉了。现改用**官方退出码通道**（`exit 2` = block，
  **不经 JSON schema** ⇒ 抗格式漂移；0 = 放行）。
  ★教训：**自测必须对准消费方的契约**——旧自测只看"脚本自己 stdout 有 deny"就宣布拦住了，
  而客户端读的是另一套格式；自测通过 ≠ 契约成立。
- 自测（**必须看退出码，不是看输出文本**——`exit 2` 才是拦截成功）：
  `printf '%s' '{"tool_name":"Bash","tool_input":{"command":"sleep 1"}}' | node scripts/hooks/deny-sleep.mjs; echo "rc=$?"` → **rc=2**（拦截）；
  `printf '%s' '{"tool_name":"Bash","tool_input":{"command":"echo hi"}}' | node scripts/hooks/deny-sleep.mjs` → rc=0（放行）；
  `node scripts/check-no-blind-wait.mjs` → 绿（存量已钉）；往任意 `.sh` 注入一行 `sleep 1` → 当场红。
- ★**hooks 是否真的在跑，看客户端日志**（`~/.zcode/cli/log/zcode-<date>.jsonl`，`grep core.hooks`）：
  全部 `hook.run.failed` = 输出契约/启动失败（deny 无效）；正常形态应出现 `hook.run.blocked` / `hook.run.completed`。
  这是"hook 接线了但静默失效"的唯一可靠判据——`check:hook-wiring` 只能证明**配置在**，不能证明**运行成功**。
- 部署/线上核验：跑一次 `pnpm check:live`（仓库自带 `website/scripts/verify-live.mjs`，带 CDN 传播重试）。
  **无法机器判定时（等 CI 队列等）**：直接告诉用户「已触发，请刷新查看」——用户目视验收比 AI 轮询快。
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
- 自测（**看退出码**）：`PROTEUS_TEST_HOOK_STATE=/tmp/h.json` 先喂一条 `npx vitest run`（rc=0 放行并记账），
  再喂同一条（应 **rc=2** = deny；输出理由在 stderr）。★`exit 2` 是 2026-10-02 起的唯一拦截通道（见上方输出契约）。
- 另注：`pnpm test` 只跑非 e2e（`--exclude "tests/e2e-*.test.ts"`）；e2e 有专用入口
  （`test:e2e:web` / `test:e2e:showcase`），**跑它们前必须先建对应产物**——直接裸跑 vitest
  会环境性红（实测 124 条假失败），白等几百秒。

### ★★红线：全量门禁链（`pnpm verify`）禁止无目的重复跑（2026-09-29 起有工具级拦截）

- **同代码状态重复跑整链会被拦截**（hook `scripts/hooks/deny-blind-verify.mjs`，配法同 deny-sleep）。
  · **触发背景（用户原话：「我发现我提了很多次的低效率问题一直都没有贯彻下去」）**：
    AI 在**没有任何新改动**时把 `pnpm verify` 连跑 **4 次**（每次 ≈10 分钟 = **40 分钟**）——
    ① 第 1 次在 Node 18 下**必然**假红（本仓记忆写着要用 Node ≥22）；② 第 2 次与真机构建
    **并行**（两者写同一个 APK ⇒ 桩测假红 ⇒ 又查又重跑）；③ 第 4 次只改了一句错误提示
    （影响 1 条门禁、55 秒）却整链重跑。用户看到的是「**跑了一个小时还没任何结果**」。
  · **为什么既有门禁漏了它**：`deny-blind-tests.mjs` 只认字面 `vitest` / `pnpm test`——
    而 `pnpm verify` **内部再调** test ⇒ 从外侧看那条命令**不在**判据里。
    ★**门禁的覆盖面必须跟着"实际形态"走**：形态变了（套了一层壳），旧门禁就失效。
- **拦**：`pnpm verify` / `pnpm run verify`（含 `npm`/`yarn`/`bun` 同族）**且 git 指纹与上次整链相同**。
- **放行**：① 代码变了（指纹变 ⇒ 自动放行一次并记账）② 显式表态 `PROTEUS_ALLOW_VERIFY=1 pnpm verify`。
- **★被拒时会给出"按改动文件推导的定向门禁"**——设计意图：让"正确的做法"变顺手，
  否则被拦的人会加 `PROTEUS_ALLOW_VERIFY=1` 硬跑，门禁等于没做。
- 自测（六条用例，改 hook 后必跑；**判据看退出码**——`exit 2`=拦截（deny），`exit 0`=放行）：
  ```bash
  S=/tmp/vh.json; rm -f $S
  P() { printf '%s' "$1" | PROTEUS_VERIFY_HOOK_STATE=$S node scripts/hooks/deny-blind-verify.mjs; echo "rc=$?"; }
  P '{"tool_name":"Bash","tool_input":{"command":"pnpm verify"},"cwd":"'"$PWD"'"}'   # ① 首次 → rc=0 放行
  P '{"tool_name":"Bash","tool_input":{"command":"pnpm verify"},"cwd":"'"$PWD"'"}'   # ② 同状态 → rc=2 deny
  P '{"tool_name":"Bash","tool_input":{"command":"pnpm run verify"},"cwd":"'"$PWD"'"}' # ③ 别名 → rc=2 deny
  P '{"tool_name":"Bash","tool_input":{"command":"PROTEUS_ALLOW_VERIFY=1 pnpm verify"},"cwd":"'"$PWD"'"}' # ④ 表态 → rc=0
  P '{"tool_name":"Bash","tool_input":{"command":"pnpm run check:gates-sync"},"cwd":"'"$PWD"'"}'  # ⑤ 无关 → rc=0
  ```
- **★纪律（比拦截更重要）**：
  1. **改了哪块就跑哪块的门禁**（`pnpm check:<对应的>` / 定向 vitest）——全链只在**一轮工作收尾**跑一次；
  2. **跑整链前先报预计耗时**（≈10 分钟），让用户知道要等多久；
  3. **一条命令内部别并行跑两件会写同一产物的事**（实测：verify 与真机构建都写
     `build/proteus-layoutcore.apk` ⇒ 互相破坏）；
  4. **本仓所有门禁命令都要求 Node ≥ 22**（Node 18 下 jsdom 27 会假红——已实测多次）。

### ★★工具层红线的**接线本身**也受门禁管（2026-09-29 起：`check:hook-wiring`）

- **为什么需要**：三条红线（sleep 盲等 / 全量测试重复跑 / 全量门禁链重复跑）都靠
  `.zcode/config.json` 强制，而它是 **gitignored 的本地文件** ⇒ 新机器/新 worktree 上
  **三个 hook 一个都不存在**，且**没有任何提示**——红线静默失效。
  ★这是"接线不靠记忆"的同一条纪律，只是**这次要接的线是 hook 自己**。
- **判据（`pnpm check:hook-wiring`）**：
  · 配置文件**不存在** ⇒ **不判红**（CI / 干净克隆的正常状态），但打印**可直接粘贴的安装片段**
    （并提示"补完需重启会话"）；
  · **存在** ⇒ 必须 ① `hooks.enabled === true` ② 三条 hook 全部挂上 ③ 被引用的脚本文件确实存在。
- **自测（改 hook 或 hook 配置后必跑）**：
  ```bash
  node scripts/check-hook-wiring.mjs                      # 已接线 → ✅
  mv .zcode/config.json /tmp/c && node scripts/check-hook-wiring.mjs   # 未安装 → 给片段 + 退出 0
  # 删掉 enabled / 少挂一条 / 删脚本文件 → 各自应红（退出 1）
  ```
- ★**清单唯一事实来源**在该脚本的 `REQUIRED_HOOKS` 里（加新 hook 时改那一处，
  门禁与安装片段会一起更新——不会出现"文档说三个、配置里只有两个"）。

### ★★纪律：**先取证，再断言**（2026-09-29 用户收尾时点名：「今天太多低效率的执行了」）

当天账（如实记录，不是"以后注意"）：
| 现象 | 代价 | 根因 |
|---|---|---|
| `pnpm verify` 同状态**连跑 4 次** | **≈40 分钟** | hook 只认字面 `vitest`/`pnpm test`，而 verify **内部再调**它们 ⇒ 外层形态漏网 |
| Node 18 下 verify **必然假红** | ~10 分钟 | 记忆写着"需 Node ≥22"，我没先读就跑 |
| verify 与**真机构建并行** | 1 轮排查 | 两者写**同一个 APK**；"构建与安装必须串行"没推广到"verify 与构建" |
| **误判"本机无可用 Xcode"** | ≈1 小时绕路 | 只查 `/Applications` 与 `mdfind` 首个结果，漏了第二个安装位（26.5 有 devicectl） |
| **模拟器两次闪退**（我引入） | 2 轮排查 | 同一字典字面量插了两组**相同键** ⇒ Swift 字典重复键是运行时 fatalError |
| 一个 shell 脚本**改 5 轮**才过 `bash -n` | 若干往返 | `\` 续行 + 空行 / 内联他语言引号冲突；且当时**没有门禁做 shell 语法检查**（现已补） |
| **没查设备就下"做不了"的结论** | 用户当场纠正 | 从"没有 Xcode"直接推"没法真机验证"，中间没跑一条 `devicectl list devices` |

⇒ **可执行的四条（不写"决心"，写操作）**：
1. **下否定结论前先跑一条取证命令**（设备列表 / 工具位置 / 版本 / 文件是否存在）。
   ★当天最刺眼的一条：我说了两次"本机做不到"，而设备一直连着、Xcode 也一直都在。
2. **多候选环境按"能力完备度"排序**，不按枚举顺序（`xcode-env.sh` 已改为两级偏好）。
3. **改完只跑对应门禁**；整链只在收尾跑一次（`deny-blind-verify.mjs` 强制），且**跑前先报预计耗时**。
4. **一条命令内不并行两件写同一产物的事**。
5. **注释里的经验也要验证**：当天我把"注释里反引号会被执行"写进记忆，实测**是错的**
   （真因是 `\` 续行 + 空行）。⇒ **5 秒能验的事不要凭推断**。

### ★★纪律：测试装置与生产产物**文件系统级隔离**（2026-09-29 两次故障链的总结）

- **两次同源故障（都是"跑完记得还原/清理"被中断击穿）**：
  1. 桩测用**占位 APK** 走流程，写的是**生产路径** ⇒ `pnpm verify`（内含桩测）被中断 ⇒
     生产路径留下 45 字节占位；**下一次桩测把占位当"真包"备份回去** ⇒ 真包**永久毁掉**。
  2. 桩测的 run 目录落在**生产结果目录** ⇒ 同样被中断 ⇒ 留下 `results/acceptance/<时间戳>/`
     ——**比残留 APK 更危险**：它长得像验收证据，**可能被当成真数据引用**。
- **根治方式（不是"下次记得清理"）**：把路径做成**可注入**，
  桩测只写自己的临时目录，**生产路径零接触**：
  · `PROTEUS_APK=<path>`（`hosts/android/acceptance.sh`）
  · `PROTEUS_RESULTS_DIR=<dir>`（同上）
- **破坏性验证**（改这两处后必跑）：跑完桩测后 ——
  ① 生产 APK 仍在且是 ZIP（`file` 显示 Zip archive）；② 结果目录项数**零新增**；
  ③ 拆掉注入（让脚本忽略 `PROTEUS_APK`）⇒ 桩测必须**当场红**（`E-device` 那条）。
- ★**通用原则**：**能靠隔离消除的副作用，不要靠"记得还原"来管理**——
  中断、超时、被取消都会让"还原"这一步不执行，而隔离让副作用**根本不存在**。
- ★**同理：一条命令内部别并行跑两件会写同一产物的事**（实测：`pnpm verify` 与真机构建
  都写 `build/proteus-layoutcore.apk` ⇒ 互相破坏，排查一轮）。

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

### ★★红线：官网内容改动必须触发部署（`[deploy]` 标记，2026-09-29 用户指出）

- **机制**：`.github/workflows/pages.yml` 的**触发门**——push 到 main 时，**只有 HEAD 提交消息含
  `[deploy]` 才真部署**；否则整条 run 只显示 success、**所有 step 全 skipped**（极易误判为"已部署"）。
- **现象（用户原话：「我注意到官网没有做发布推送」）**：上次真部署 `e6c5c565`（2026-09-27）之后
  改动 `website/**` 的 **9 个提交**（含 Vapor 更新路径 / Rust 排版核心 / Vue 兼容性三页）**全部无标记**
  ⇒ 线上仍是旧版。与「提交 ≠ 交付」**同源**：本地门禁全绿、`git status` 也不报错，没有任何提醒。
- **纪律**：凡改动 `website/**` 的轮次，收尾时最后推一个**带 `[deploy]` 的提交**（可空提交：
  `git commit --allow-empty -m "chore(deploy): 触发官网部署 [deploy]"`），或把 `[deploy]` 写进本轮
  **最后一个**提交的消息里；亦可在 Actions 手动 `workflow_dispatch`（等效）。
- **★顺序禁止**：部署提交推上去后**不要再 push**——`concurrency: pages` 的 run 会被后续普通 push
  **取消**（那次普通 run 仍显示 success 但步骤全 skipped）。判别部署真假**看 job steps 是否真 ran**，
  不看 run conclusion。
- **工具化**：`pnpm check:deploy-pending`（提醒，已接进 `pnpm verify` 末尾）·
  `pnpm check:deploy-pending:strict`（有未上线内容则 exit 1，供发布收尾）。
  **上线证据** = pages.yml 的「部署后核验」（verify-live 产物 hash）+ 本机 `pnpm check:live`。

### ★红线：坐标舍入只在**内核**发生（卡 I2，2026-09-29 起有静态门禁）

- **规则**：几何坐标的吸附**只在** `packages/layout-core/src/pixel-snap.ts` 与
  `packages/layout-core-rust/src/snap.rs`（唯一实现，策略 = 边缘吸附 `floor(v+0.5)`）；
  **平台层（`hosts/**`）不得再做任何几何舍入**——各端各自舍入 = 三端差 1px（golden 全绿也照样差）。
- **落点**：吸附在**导出边界**（TS `emitRenderCmds` / Rust FFI 导出）；求解器内部保持亚像素。
  命中测试走吸附几何（视觉边界 = 可点边界）。
- **工具化**：`pnpm check:host-rounding`（静态扫描 `hosts/`；合法例外必须写 `// I2-ALLOW: 理由`，
  且**理由要具体**——`I2-ALLOW` 是给"测量/位图/报告"三类用的，不是让几何舍入蒙混过关的开关）。
  `pnpm check:pixel-snap`（TS ⇄ Rust golden 一致，改策略必须显式重生成）。
- **★改宿主代码（`hosts/**`）必须先过零设备编译检查**，别把编译错留到真机：
  `pnpm check:android-host-compile`（javac + android.jar）· `bash hosts/ios/check-selfdraw-compile.sh`
  （swiftc -typecheck）。二者都在 `pnpm verify` 链上，但**改完立刻单跑**比等全量快得多。

### ★★★内核改动的「配套断言」必须顺手同步（2026-10-04 起工具化：`pnpm test:coupled`）

- **用户原话（这条纪律的由来）**：「我发现一个问题就是**编译器内核运行时规则修改总是忘了同步配套的断言**，
  这个也是低效率方式，带来的后果就是**花大量的时间跑全量来为这些低效率债务买单**」。
- **实证（这个债务多贵）**：S56b 双类名发射改完（ed4da92c）配套断言忘了同步 ——
  `compiler-mp-probe` 7 条 + `compiler-dispatch` 1 条 + `golden` 快照 + 规则数/官网数字 4 处，
  **在全量里连爆两轮**（每轮 ≈2-3 分钟）才逐个发现；而按配套表定向跑 = **~10 秒**。
- **为什么旧机制漏了**：`deny-blind-verify` 的建议表是命令级粗粒度，`packages/compiler/` 只建议
  `npx vitest run tests/compiler` —— 而债务重灾区（`golden`/`mp-transform`/`svg-spike-compiler-gaps`）
  文件名**不含 "compiler"**，永远建议不到（建议表的结构性盲区）。
- **纪律（操作）**：改 `packages/{compiler,runtime,plugin-vite}/src/**` 后、提交前，**先跑**：
  ```bash
  pnpm test:coupled            # 按 git diff 推导配套断言并**真跑**（通常 5~15 秒）
  pnpm test:coupled -- --list  # 只看会跑什么（先看后跑）
  pnpm test:coupled -- --wide  # 改的内核文件未命中精化表时：跑包级 import 面兜底
  ```
  红了就地修（修断言或修实现）——**别把发现推迟到全量**（全量只是再发现一次，且贵 10 倍）。
- **映射表 SSOT**：`scripts/test-coupling.mjs` 的 `COUPLING`（含`--explain` 查看）。
  **新增/改名内核源文件或新增产物形态断言类测试时，把配对加进去**；漏加不致命（会落进宽面提示，不静默），
  但会让定向退化为提示。表本身有自检（表中测试文件不存在 ⇒ 当场红，防表腐化后静默失效）。
- **同源工件**：规则注册表（`transforms/`）类改动还会带出「规则数快照 + 官网数字 + 参考页」三处
  —— `test:coupled` 会在报告里提示顺跑（`pnpm check:stats` / `gen-reference`）。
- **接线位置（不靠记忆）**：`pnpm test:coupled`（package.json）· `deny-blind-verify`
  被拦时的定向建议（`packages/{compiler,plugin-vite,runtime}/` → 建议本工具）· 本段纪律。

### ★★★CSS 多端一致性的**基准 = Web（浏览器真值）**——不是「三端内部自洽」（2026-10-04 用户指定：「以后就按这个来，以 web 为基准对齐」）

- **规则**：App/MP/Web 三端的 CSS 语义，**一律以 Web（浏览器真 CSS）为对齐基准**。
  「三端彼此一致」**不等于**「与 Web 一致」——三端都是**自研/原生绘制**（Web 浏览器 CSS 引擎 ·
  Skyline 微信容器 · App 自绘 Rust 引擎 + 宿主），**容易互相看齐却集体偏离 Web**。
  ⇒ 判定多端一致性，**只认 Web 真值**；三端内部自洽不构成证据。
- **操作（每个 CSS 特性，无论新增还是已实现）**：
  1. 先查 Web 标准语义（行高半行距 / 命名色 / 继承属性 / 简写展开 / 默认值…），把它当**唯一判据**；
  2. 再逐端对照实现，凡与 Web 不符的 ⇒ **诊断或修正**（**不得静默近似**——静默画成实线/顶对齐那类
     会让"看起来对、其实差"的偏差溜过去）；
  3. 用 Web 可复现的样例（真项目 CSS 片段）做破坏性验证。
- **落点（工具/工件）**：能力清单 `docs/generated/css-capability-alignment.{json,md}`（源 =
  `docs/generated/css-capability-sources/app-profile-features.json`，含 `auditNote` 审计口径），
  门禁 `pnpm check:css-capability-alignment`；编译器折叠面 `packages/compiler/src/vapor/template.ts`
  + 判据 `tests/vapor-class-styles.test.ts`；引擎面 `packages/layout-core-rust`。
- **实证两次（都写进记忆）**：
  · 批 13 `line-height` 首版做成**顶对齐**（理由"iOS/鸿蒙本就顶对齐"**没验证**）⇒
    与 Web 的**半行距居中**不符，被用户当场抓出（决策 #507）；
  · 批 14 多端一致性审计（决策 #508）：命名色 148 色被整条丢弃、非 solid 边框静默画实线、
    `text-align` 漏继承、`box-sizing:content-box` 静默忽略、枚举大小写 —— 五项都是
    「App 与 Web 不符」的偏差。
- ★**同一"基准"纪律的推广**：任何"多端对齐"任务，先问一句「**Web/标准的真值是什么**」，
  再问「各端差在哪」——顺序反了就会拿"三端自洽"当绿灯。
### ★★★红线：CSS 逐项全端对齐**不得以"别批次未落地"为由跳过端**（2026-10-07 用户明令）

- **用户原话**：「鸿蒙和 iOS 的必须解决才行，鸿蒙把缺口补齐，**以后的铁律不能这个任务因为其他批次
  没落地就跳过去**，iOS 的案例 C 也要解决」。
- **规则**：一个 CSS 能力项验收，**四端（Web/MP/App-iOS/App-Android/App-鸿蒙）必须全过**才算完成。
  不得把某端的缺口标成"pre-existing / 属别批次 / 具名边界"就**跳过收口**——那等于用"别的批次没落地"
  当免死金牌，把本项做成**假绿**。
- **正确做法（本项实证）**：遇到端侧缺口就**就地补齐**——① 鸿蒙 app-content 的 cmd 流不产梯度键
  ⇒ 在 appScreenCommands 补该通路；② iOS 的 CAGradientLayer 无 tile ⇒ 用栅格化 tile（draw(byTiling:)）
  实现平铺。**两项都在本项内解决**（不是"留给下一批"）。
- **★区分两种"边界"**（唯一允许具名豁免的情形）：
  · **引擎锁死、改不动的**（如 Skyline 无 Grid 容器 ⇒ justify-self 在该端无意义）——可具名，但**须先
    穷尽"主流端怎么做"再拍板**（见下方 UA 自定标准纪律），不得图省事；
  · **"本端能实现、只是别的批次没接线"**——**禁止**具名跳过，**必须本项补齐**。
- **铁律落点**：CSS 能力验收判据（css:verify <id> 的 endsMapped + 四端真机截图 + 子代理终评）
  **任一端缺口 = 本项未完成**；门禁与记忆均以此为准。

## ★★★三端同步纪律（2026-10-03 用户指定：「后面的 vapor 推进就三端同步走」）

**判据（机器强制）**：`pnpm check:vapor-three-end`（已接 `verify` 链 + CI）——
① **证据齐**（三端 `hosts/{android,harmony,ios}/results/vapor.json` 都在；
缺一端即红：陈旧证据会冒充新证据）② **同一份判据三端全过**（`check-vapor-device.py`，
◐ 如实跳过会列出而不是静默当"过"）③ **指纹逐项一致**（模板/源/槽位/实例化/增量/事件/
混合文本/门禁轮/表达式探针 17 项——不一致会报出**是哪端哪个字段**）。

**含义（改 Vapor 相关代码时的义务）**：凡是动到 Vapor 面的改动（编译器 `vapor/*` ·
`slot-runtime/*` · 桥 `hosts/android/bridge/entry-vapor.ts` · 夹具 `gen-vapor-fixture.mjs`），
**必须三端重跑并提交结果**——只跑 Android 会被这道门禁当场拦下。

**三端重跑入口**（真机/模拟器，CI 跑不了）：
```bash
bash hosts/android/run-vapor.sh                 # Android（USB 设备）
bash hosts/harmony/run-vapor.sh                 # 鸿蒙（hdc 设备）——含 gen-fixtures 同源复制
bash hosts/ios/run-selfdraw.sh --vapor           # iOS（真机；模拟器见 run-selfdraw.sh 帮助）
```
三端跑完各产生一份 `results/vapor.json`（已入库）⇒ 提交后 CI 复算判据 + 比对指纹。

★**为什么必须工具化**（本仓教训同源）：Vapor 能力全在**平台无关共享包**里（构造上三端共享），
而验证只跑一端时，另一端是**推断**不是**证据**——与「提交 ≠ 交付」同族：没有任何机制会提醒
"另外两端还没重跑"，于是旧证据会冒充新证据。

## 2. 项目门禁（改代码后按需运行）

```bash
pnpm test                 # 全量单测（Node ≥ 22；jsdom 27 为 ESM-only，Node 18 会误报）
pnpm check:mp-attrs       # 端对齐属性棘轮（只增不减）
pnpm check:content        # 官网内容生成幂等
pnpm check:stats          # 官网数字 vs 源码实际值（防「数字过时」静默上线）
pnpm check:vapor-three-end # ★★★三端同步（证据齐 + 同一判据三端全过 + 指纹逐项一致）
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

## 4. Android 真机验收：**先预检，再跑；跑完自检**（★2026-09-29 用户反馈后固化）

```bash
# ① 快速冒烟（≈1.7 分钟）——**改装置后先跑这个**，确认整条链路可用
bash hosts/android/acceptance.sh --quick --skip-build
# ② 正式验收（≈4.5 分钟）——预检自动先跑（零成本，≈5 秒）
bash hosts/android/acceptance.sh --runs 3 --skip-build
# 单独跑预检 / 解析自测
bash hosts/android/acceptance.sh --preflight
bash hosts/android/acceptance.sh --selftest
```

**为什么要这样**（真实教训，别再踩）：
- 用户原话：「**测试时间太长了**，手机屏幕刚才锁屏了」「**每次都是测试完才发现自己的测试装置有问题**，
  时间全浪费在测试装置的反复修改上」。⇒ 同一个脚本迭代一天，白跑 6 次全流程（每次 ~5 分钟）。
- **装置缺陷必须在跑之前发现**，所以有三道机器判据（都不是"靠人翻产物"）：
  | 判据 | 时机 | 抓什么 |
  |---|---|---|
  | `--preflight` ① 产物契约 | 跑前 5 秒 | 谁写/谁读/谁拉不自洽（例：汇总在读一个**从来没人写**的文件；**两个场景写同一个文件名**⇒run 目录里拿到另一种数据） |
  | `--preflight` ② 解析自测 | 跑前 5 秒 | gfxinfo 字段错位（例：p50 取成 `$4` ⇒ **恒为 0**，中位永远是 0） |
  | `--preflight` ③ 设备状态 | 跑前 5 秒 | **屏幕是否点亮**（灭屏时 app 只渲染个位数帧，读数全废）；USB 供电（否则 stayon 不生效） |
  | `check-run-artifacts.mjs` | 跑完自动 | 本次数据可不可信（帧数 0/个位数、p50=0 但帧>0、A/B 两侧不齐、对照没真跑） |
- **耗时归因**：脚本每阶段打印本段/累计耗时，跑完给**按耗时排序**的表（`═══ 耗时归因 ═══`）。
  ★没有归因就别谈优化——实测"感觉 sleep 太多"是**错的**：静态 sleep 仅 71 秒，
  真正的大头是 **Perfetto 分析 106 秒**（二进制未缓存 → 下载超时 → 产出零，历史产物 0 个）。
- 已知可省项与代价：`--quick` 把内存对照降为 1 轮（默认 5 轮 × 2 通路 ≈ 124 秒，是单项最大）；
  Perfetto 在 `trace_processor` 未缓存时**跳过采集与分析**（自动探测，省 ~106 秒）。

**红线**：`--quick` 只用于"确认装置可用"，**不可作为验收结论**（§9.2 要求 5 轮取均值）。

### ★★★ 红线：**改过脚本/宿主源码，必须先过桩测再上真机**（2026-09-29 用户明令）

- **禁止**「改 acceptance.sh → 直接跑真机验收 → 发现 bug → 再改 → 再跑」这个循环。
  用户原话：「又是反复修改测试脚本又是四十多分钟过去了!!!!! …… 以后**禁止这样低效测试验证的方式**！！！！！！」
- **实测账**（为什么这条必须工具化）：当天 acceptance.sh 改了 **8 轮**，为验证**自己的脚本改动**
  跑了 **7 次真机全流程**（每次 4–6 分钟）⇒ 40 分钟里绝大多数不是在测框架，是在测这个脚本。
- **根因**：脚本没有"不接设备的自测" ⇒ bash 逻辑 bug（`declare -A` 在 bash 3.2 崩、
  删文件写在广播之后、变量展开、阶段标签错位）只能用真机全流程发现。
- **门禁（自动化，不靠自觉）**：
  ```bash
  node hosts/android/acceptance-stub.mjs        # 桩测：假 adb 跑完整流程，45 秒、零设备
  ```
  它断言：退出码 / shell 级错误 / **命令顺序**（删旧报告须在广播前）/ 产物齐备 / 跑后自检 /
  bash 3.2 兼容（`declare -A` 等静态扫描，CI 的 bash 5 抓不到运行时）。
  **真机验收启动前自动校验指纹**（脚本+宿主源码），不一致直接 `exit 4` 并指向桩测；
  确需绕过用 `SKIP_STUB_GATE=1`（例：只改注释）。
- **破坏性验证过**：注入 `declare -A` → 红；把删文件挪到广播后 → 红（两条都是当天真实踩过的 bug）。

