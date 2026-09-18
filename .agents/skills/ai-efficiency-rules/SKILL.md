---
name: ai-efficiency-rules
description: 约束 AI / Agent 执行行为的效率规范，消除固定 sleep 盲等、高频重复拉取 GitHub 与远程资源、重复读文件、无归因重试、该并行却串行、输出爆炸等低效模式。当用户要求「按效率规范执行」「别用 sleep」「缓存远程资源」「减少重复调用」「生成/落地/检查 AI 执行规范」「反低效」「执行效率审计」，或准备执行多步工具调用、长任务编排、批量外部请求时，使用本 Skill。
---

# AI 执行效率规范（Anti-Inefficiency Rules）

## 定位

本 Skill 是**强约束的行为规则集**，用于约束 AI 编码助手 / Agent 的执行方式，使其在最少轮次、最少 token、最少墙钟时间内拿到正确结果。

它不是风格建议，而是可判定、可审计的硬性要求。可直接整段贴入 `CLAUDE.md` / `AGENTS.md` / Cursor Rules / 系统提示词。

## 三条不可协商的总则

1. **先判断再动手**：任何动作前先自问——这条信息是否已存在于上下文、本地磁盘或上一次调用结果中？是则复用，禁止重新获取。
2. **等待必须有条件，获取必须有缓存，重复必须有上限**：无退出条件的等待、无缓存的重复拉取、无次数上限的重试，一律视为缺陷。
3. **能并行就并行，能批量就批量**：两次调用之间若无数据依赖或副作用依赖，必须合并到同一批次发出。

**违规判定标准**：引入了本可避免的墙钟延迟、token 消耗或外部请求次数。
**冲突优先级**：正确性 > 安全性 > 效率。绝不为效率跳过校验、备份或权限确认。

## 六类低效行为速查

| 类别 | 典型违规 | 正确做法 | 详见 |
|---|---|---|---|
| 等待与轮询 | `sleep 5`、`time.sleep(30)` 盲等 | 条件探测 + 指数退避 + 总超时上限 | [references/anti-inefficiency-rules.md](references/anti-inefficiency-rules.md) §1 |
| 外部资源 | 同任务重复 clone 同一 repo | 一次拉取 → 本地缓存 → 复用 → 用完清理 | 同上 §2 |
| 文件检索 | 重复读同区间、`ls -R`、整读大文件 | 先 grep 定位 → 按行号分段读 | 同上 §3 |
| 命令与重试 | 重复跑同一失败命令、重复装依赖 | 失败归因三步 + 重试上限 2–3 次 | 同上 §4 |
| 并行与批量 | 5 次独立 `read` 串行发出 | 无依赖合并同批，依赖分层 | 同上 §5 |
| 输出控制 | 全量日志灌进上下文 | 落盘 + 过滤截断 + 早停条件 | 同上 §6 |

## 执行流程

### 1. 每次工具调用前（默念式自检）

- 该信息上下文 / 本地磁盘已有？→ 有则不调。
- 能否与其他调用合并并行？→ 能则合并。
- 是固定 sleep？→ 改为条件探测 + 上限。
- 是远程资源？→ 缓存有吗？无则拉取一次并落盘。
- 输出会过大？→ 加过滤 / 截断 / 先落盘。
- 会改状态或不可逆？→ 先 dry-run / 备份 / 确认。

### 2. 每轮结束后自检

- 有重复做过同一件事（同文件、同请求、同命令）？
- 有该并行却串行的地方？
- 失败重试是否做了归因，是否逼近上限？
- 临时缓存、下载物、中间文件是否已清理？
- 是否偏离目标做了无关探索？→ 立即收敛。

完整清单见 [references/checklist.md](references/checklist.md)。

### 3. 需要落地代码时

优先复用本 Skill 自带的脚本，而不是手写：

| 场景 | 脚本 |
|---|---|
| 等待服务 / 文件 / 任务就绪，替代 `sleep` | `scripts/wait_for.sh` |
| 缓存式拉取 GitHub 仓库 / URL，用完自动清理 | `scripts/cache_fetch.sh` |
| 静态审计代码/PR 中的低效模式 | `scripts/audit_efficiency.py` |

用法示例：

```bash
# 替代 sleep 10：探测健康接口，最长等 90s
bash scripts/wait_for.sh --http http://localhost:8080/health --timeout 90

# 替代裸 git clone：浅层拉取到缓存，命中直接复用
bash scripts/cache_fetch.sh --repo https://github.com/owner/repo --ref main --subdir src
# 不再引用时清理
bash scripts/cache_fetch.sh --clean github/owner-repo-main
```

直接可抄的代码模板（条件等待、缓存拉取、批量检索、退避重试）见 [references/patterns.md](references/patterns.md)。

### 4. 需要审计存量代码或卡 CI 时

运行静态审计脚本 `scripts/audit_efficiency.py`，自动检测固定 `sleep`、无 timeout 的请求、重复 clone、重复装依赖等违规：

```bash
# 扫描与主干的 diff（CI / PR 最常用）
python3 scripts/audit_efficiency.py --diff-base origin/main
# 扫描未提交改动 / 暂存区 / 全量目录
python3 scripts/audit_efficiency.py --diff
python3 scripts/audit_efficiency.py --staged          # pre-commit 用
python3 scripts/audit_efficiency.py --path .
# 输出：text（默认）/ md（贴 PR 评论）/ json / sarif（GitHub Code Scanning）
python3 scripts/audit_efficiency.py --diff-base origin/main --format md --output report.md --fail-on error
```

退出码 0 通过 / 1 存在达到 `--fail-on` 级别的违规 / 2 环境错误。行内豁免 `# efficiency-audit: ignore R001`，文件豁免 `# efficiency-audit: ignore-file`。

规则详解见 [references/audit-rules.md](references/audit-rules.md)；开箱即用的流水线配置在 `ci/`（`github-actions.yml`、`gitlab-ci.yml`、`pre-commit-config.yaml`、`efficiency-audit.example.yaml`）。

## 参考文件

- [references/anti-inefficiency-rules.md](references/anti-inefficiency-rules.md) —— 完整规范正文，9 章，含硬性禁止 / 必须这样做 / 允许例外
- [references/checklist.md](references/checklist.md) —— 执行前后自检清单 + Red Flags 违规速查表
- [references/patterns.md](references/patterns.md) —— 可直接复用的代码模板
- [references/audit-rules.md](references/audit-rules.md) —— CI 审计规则详解、扫描范围与豁免方式

## 例外与升级

- 用户明确要求某低效做法（如"就 sleep 10 秒"）时，以用户指令为准，但须提示更高效替代方案**一次**，不反复纠缠。
- 环境受限（离线、无权限、工具缺失）导致无法满足本规范时，明确说明受限点与影响，而非默默退化成低效实现。
- 规范间冲突时按「正确性 > 安全性 > 效率」裁决。
