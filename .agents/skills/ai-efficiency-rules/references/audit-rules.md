# 审计规则详解（audit_efficiency.py）

规则 ID 按类型分段：`R0xx` 为行级规则（单行可判定），`R1xx` 为聚合规则（需跨行/跨文件统计）。

## 行级规则

### R001 固定时长盲等（error）

**检测**：`sleep <数字>`、`time.sleep(数字)`、`Start-Sleep -Seconds N`、`setTimeout(fn, ≥100ms)`。

**豁免**：`sleep "$delay"` 这类变量形式不报；若当前行 ±4 行内出现 `retry` / `Retry-After` / `backoff` / `attempt` / `deadline` / `SECONDS` / `interval` / `timeout` 等词，视为有依据的退避等待，跳过。

**修复**：改用条件探测 + 指数退避 + 总超时上限，或直接调 `scripts/wait_for.sh`。

### R002 网络请求缺少 timeout（warn）

**检测**：`curl` / `wget` / `requests.get|post|put(` / `fetch('http...')` / `axios.get|post(` 出现，但同一行不含 `--max-time` / `--connect-timeout` / `-m N` / `--timeout` / `timeout=` / `timeout:` / `AbortSignal` / `signal:`。

**修复**：`curl --connect-timeout 5 --max-time 15`；`requests.get(url, timeout=(5, 15))`。

### R003 git clone 拉取全量历史（warn）

**检测**：出现 `git clone` 但同行不含 `--depth` / `--filter=blob:none` / `--single-branch`。

**修复**：`git clone --depth 1 --filter=blob:none --no-checkout` + `sparse-checkout set <子目录>`。

### R004 无目标全量遍历（warn）

**检测**：`ls -R`、`cat **/*`、`find . ` / `find / `（且无 `--maxdepth`）、`grep -r`（且无 `--include/--exclude/-g`）。

**修复**：`rg -n -e 'A' -e 'B' --glob '*.ts' --glob '!**/node_modules/**' --max-count 20`。

### R005 读取构建产物或依赖目录（warn）

**检测**：`cat|grep|rg|head|tail|sed|awk|open|read_file` 的目标路径含 `node_modules`、`/dist/`、`/build/`、`.venv`、`/vendor/`、`package-lock.json`、`yarn.lock`、`pnpm-lock.yaml`、`.min.js`。

**修复**：排除这些目录，除非任务明确指向它们。

### R006 交互式 / 破坏性命令（warn）

**检测**：`npm init` 无 `-y`、`apt-get install` 无 `-y`、`git rebase -i`、`git push --force`（不含 `-with-lease`）、`git reset --hard`、`rm -rf /`、`DROP TABLE`。

**修复**：加非交互参数；破坏性操作先 dry-run 或备份。

### R007 CI Job 缺少 timeout-minutes（info）

**检测**：`.github/workflows/*.yml` 全文不含 `timeout-minutes`。

**修复**：为每个 job 设置 `timeout-minutes`，避免挂死后长期占用 runner。

## 聚合规则

### R100 重复拉取同一远程仓库（error）

**检测**：收集所有 `git clone|git fetch` 后的 URL（规范化：去尾斜杠、去 `.git`、转小写），同一 URL 出现 ≥2 次时，**从第二次起**逐条报警，并标注首次出现位置。

**修复**：一次拉取 → 本地缓存 → 复用 → 用完清理（`scripts/cache_fetch.sh`）。

### R101 重复执行依赖安装 / 构建（warn）

**检测**：`npm ci|npm install`、`yarn install`、`pnpm install`、`pip install`、`cargo build`、`bundle install`、`go build` 出现 ≥2 次，从第二次起报警。

**修复**：执行前检测已完成状态（`[[ -d node_modules ]] || npm ci --prefer-offline`）。

### R102 无退出条件的轮询（warn；diff 模式下降级为 info）

**检测**：文件内出现 `while true; do` / `while :; do`，且全文不含 `break` / `deadline` / `timeout` / `SECONDS` / `exit`。

**修复**：加成功条件 + 总超时上限 + 失败分支。

> diff 模式下只扫描改动行，`break` 可能落在未改动行导致误报，因此该规则在 diff 模式自动降级为 info。

## 扫描范围

**纳入**：`.sh .bash .zsh .py .js .ts .jsx .tsx .mjs .yml .yaml .toml .json .ps1 .rb .go .rs .java .mk Makefile Dockerfile`（加 `--include-docs` 时含 `.md .mdx .rst .txt`）。

**排除目录**：`.git node_modules dist build .venv venv vendor __pycache__ .next .cache target .idea .vscode coverage`。

**排除文件**：图片、音视频、归档、字体、`.lock`、`.min.js`、`.map`、`.pyc`、`.so`、`.exe` 等二进制与产物；单文件 > 1MB 跳过。

## 豁免方式

```bash
sleep 1  # efficiency-audit: ignore          # 豁免该行所有规则
sleep 1  # efficiency-audit: ignore R001     # 只豁免 R001
# efficiency-audit: ignore-file              # 文件首部：豁免整个文件
```

配置文件 `.efficiency-audit.yaml` 支持 `disable`（关闭规则）、`severity`（调整级别）、`ignore_paths`（路径正则）、`include_docs`。未安装 PyYAML 时自动忽略配置文件，不影响运行。

## 退出码与门禁

| 退出码 | 含义 |
|---|---|
| 0 | 未发现达到 `--fail-on` 级别的违规 |
| 1 | 发现达到 `--fail-on` 级别的违规 |
| 2 | 参数或环境错误（git 不可用、文件不可读） |

`--fail-on` 默认 `error`：只有 R001 固定盲等、R100 重复拉取会卡住 CI，其余仅提示，避免规则一上线就阻塞团队。团队成熟后可收紧为 `warn`。
