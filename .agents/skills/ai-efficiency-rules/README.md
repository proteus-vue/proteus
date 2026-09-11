# ai-efficiency-rules · AI 执行效率规范 Skill

约束 AI / Agent 执行行为的效率规范，消除固定 `sleep` 盲等、高频重复拉取 GitHub、重复读文件、无归因重试、该并行却串行、输出爆炸等低效模式。

## 目录结构

```
ai-efficiency-rules/
├── SKILL.md                              # 主入口：触发描述、三条总则、六类速查、执行流程
├── references/
│   ├── anti-inefficiency-rules.md        # 完整规范正文（9 章：禁止/必须/例外）
│   ├── checklist.md                      # 执行前后自检清单 + Red Flags 速查表
│   ├── patterns.md                       # 可直接复用的代码模板
│   └── audit-rules.md                    # CI 审计规则详解与豁免方式
├── scripts/
│   ├── wait_for.sh                       # 条件探测等待，替代固定 sleep
│   ├── cache_fetch.sh                    # 远程资源缓存拉取与用完清理
│   └── audit_efficiency.py               # 静态审计：PR/CI 自动检测低效模式
└── ci/
    ├── github-actions.yml                # GitHub Actions 工作流（PR 评论 + 门禁）
    ├── gitlab-ci.yml                     # GitLab CI 片段
    ├── pre-commit-config.yaml            # pre-commit 钩子配置
    └── efficiency-audit.example.yaml     # 规则配置示例
```

## 安装

解压后把 `ai-efficiency-rules/` 整个目录放入你的 skills 目录即可，例如：

```bash
# Claude Code / 通用 Agent Skills
cp -r ai-efficiency-rules ~/.claude/skills/
# 或仅作为规则文件引用：把 references/anti-inefficiency-rules.md 内容贴入 CLAUDE.md / AGENTS.md
```

`SKILL.md` 带有标准 frontmatter（`name` + `description`），可被 Agent 自动识别与触发；也可直接阅读使用。

## 脚本速用

```bash
# 替代 sleep 10：探测健康接口，最长等 90s（指数退避 1→10s）
bash scripts/wait_for.sh --http http://localhost:8080/health --timeout 90

# 等待文件产出且大小稳定
bash scripts/wait_for.sh --file dist/bundle.js --stable --timeout 60

# 替代裸 git clone：浅层拉取入缓存，重复调用直接命中
bash scripts/cache_fetch.sh --repo https://github.com/owner/repo --ref main --subdir src

# 缓存式抓取 URL
bash scripts/cache_fetch.sh --url https://api.example.com/v1/items

# 清理
bash scripts/cache_fetch.sh --list
bash scripts/cache_fetch.sh --clean github/owner-repo-main
bash scripts/cache_fetch.sh --clean-all
```

缓存根默认为 `.cache/ai-external`（可用 `CACHE_ROOT` 环境变量覆盖），建议加入 `.gitignore`。

## CI 审计：在 PR 里自动报警

`scripts/audit_efficiency.py` 静态检测规范中禁止的低效模式，零依赖（配置文件可选，需 PyYAML）。

```bash
# 只扫增量：与主干 diff（最常用）
python3 scripts/audit_efficiency.py --diff-base origin/main
# 其他范围
python3 scripts/audit_efficiency.py --diff            # 工作区未提交改动
python3 scripts/audit_efficiency.py --staged          # 暂存区（pre-commit）
python3 scripts/audit_efficiency.py --path .          # 全量扫描
# 输出格式
--format text|md|json|sarif     # md 贴 PR 评论，sarif 接入 GitHub Code Scanning
--fail-on error|warn|none       # 默认 error：只有固定盲等、重复拉取会卡 CI
```

规则一览：

| ID | 级别 | 检测内容 |
|---|---|---|
| R001 | ❌ error | 固定时长盲等 `sleep 30` / `time.sleep(20)` |
| R002 | ⚠️ warn | `curl` / `requests.get` 缺少 timeout |
| R003 | ⚠️ warn | `git clone` 拉取全量历史（无 `--depth`） |
| R004 | ⚠️ warn | 无目标全量遍历 `ls -R` / `find /` |
| R005 | ⚠️ warn | 读取 `node_modules` / `dist` 等依赖产物 |
| R006 | ⚠️ warn | 交互式 / 破坏性命令（`npm init` 无 `-y`、`push --force`） |
| R007 | ℹ️ info | CI Job 缺少 `timeout-minutes` |
| R100 | ❌ error | 重复拉取同一远程仓库（跨文件统计） |
| R101 | ⚠️ warn | 重复执行依赖安装 / 构建 |
| R102 | ⚠️ warn | `while true` 轮询无退出条件 |

**降低误报的设计**：退避重试上下文中的 `sleep` 自动豁免；变量形式的 `sleep "$delay"` 不报；已带 `--max-time` / `--depth` / 已完成检测的命令不报；R102 在 diff 模式下自动降级为 info。

**豁免方式**：

```bash
sleep 1  # efficiency-audit: ignore          # 豁免该行
sleep 1  # efficiency-audit: ignore R001     # 只豁免 R001
# efficiency-audit: ignore-file              # 豁免整个文件
```

**接入流水线**：把 `ci/github-actions.yml` 复制到 `.github/workflows/`，把 `audit_efficiency.py` 放到 `.github/scripts/` 即可——PR 会自动贴出带修复建议的报告，`error` 级违规阻止合入。GitLab 与 pre-commit 配置同样在 `ci/` 下。

## 三条总则

1. 先判断再动手——信息已在上下文/本地就不重新获取。
2. 等待必须有条件，获取必须有缓存，重复必须有上限。
3. 能并行就并行，能批量就批量。

冲突优先级：**正确性 > 安全性 > 效率**。绝不为效率跳过校验、备份或权限确认。
