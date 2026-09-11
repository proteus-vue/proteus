# 可直接复用的效率模式模板

以下模板用于替换常见的低效写法，可直接抄用。

---

## 1. 条件等待（替代固定 sleep）

### Bash 通用版

```bash
# ❌ sleep 10
# ✅ 条件探测 + 指数退避 + 总超时上限 + 失败分支
deadline=$((SECONDS+90)); interval=1
until curl -sf http://localhost:8080/health >/dev/null; do
  (( SECONDS >= deadline )) && { echo "TIMEOUT: service not ready in 90s" >&2; exit 1; }
  sleep "$interval"; (( interval = interval*2 > 10 ? 10 : interval*2 ))
done
```

### 等待文件产出且大小稳定

```bash
wait_file_stable() {
  local f=$1 timeout=${2:-60} last=-1
  local deadline=$((SECONDS+timeout))
  while (( SECONDS < deadline )); do
    [[ -s $f ]] || { sleep 1; continue; }
    local cur; cur=$(stat -c%s "$f" 2>/dev/null || echo 0)
    [[ $cur -eq $last && $cur -gt 0 ]] && return 0
    last=$cur; sleep 1
  done
  echo "TIMEOUT: $f not stable in ${timeout}s" >&2; return 1
}
```

### 优先使用原生阻塞能力

```bash
kubectl wait --for=condition=Ready pod -l app=api --timeout=90s
docker wait <container_id>
gh run watch <run-id> --exit-status      # GitHub Actions
npm run build -- --watch=false
```

### Python 版

```python
import time, requests

def wait_ready(url, timeout=90, base=1.0, cap=10.0):
    deadline = time.monotonic() + timeout
    delay = base
    while time.monotonic() < deadline:
        try:
            if requests.get(url, timeout=3).ok:
                return True
        except requests.RequestException:
            pass
        time.sleep(delay)
        delay = min(delay * 2, cap)
    raise TimeoutError(f"{url} not ready in {timeout}s")
```

---

## 2. 缓存式远程资源拉取

### 生命周期

```
检查本地缓存 → 命中直接用 → 未命中则拉取一次并落盘 →
后续全部走缓存 → 不再引用即删除
```

### GitHub 仓库（浅层 + 稀疏）

```bash
CACHE=.cache/ai-external/github/repo-main
if [[ ! -d $CACHE ]]; then
  git clone --depth 1 --filter=blob:none --no-checkout \
      --branch main https://github.com/owner/repo "$CACHE"
  git -C "$CACHE" sparse-checkout set src docs
  git -C "$CACHE" checkout
fi
# ... 使用 ...
# 不再引用时
rm -rf "$CACHE"
```

锁定版本（避免内容漂移）：

```bash
git -C "$CACHE" fetch --depth 1 origin <commit-sha> && git -C "$CACHE" checkout <commit-sha>
```

### URL / API 响应缓存

```bash
fetch_cached() {
  local url=$1 cache=".cache/ai-external/web/$(printf '%s' "$url" | md5sum | cut -d' ' -f1)"
  [[ -s $cache ]] && { cat "$cache"; return; }
  mkdir -p "$(dirname "$cache")"
  curl -fsSL --connect-timeout 5 --max-time 15 --retry 2 --retry-delay 1 "$url" | tee "$cache"
}
```

### 带退避的限流处理

```bash
http_get() {  # 尊重 Retry-After，重试上限 3 次
  local url=$1 i delay=1
  for ((i=1;i<=3;i++)); do
    if out=$(curl -fsS --max-time 10 -w '\n%{http_code}' "$url"); then
      echo "$out"; return 0
    fi
    delay=$(curl -sSI --max-time 5 "$url" | awk -F': ' 'tolower($1)=="retry-after"{print $2; exit}')
    [[ -z $delay ]] && delay=$(( 2**i ))
    sleep "$delay"
  done
  echo "FAIL: $url after 3 attempts" >&2; return 1
}
```

---

## 3. 批量化检索（替代串行多次调用）

```bash
# ❌ 三次搜索
rg 'foo'; rg 'bar'; rg 'baz'
# ✅ 一次覆盖
rg -n -e 'foo' -e 'bar' -e 'baz' --glob '*.ts' --glob '!**/node_modules/**' --max-count 20

# 定位后按行号区间精确读取
sed -n '120,180p' src/server.ts
```

大文件只读需要的区间：

```bash
rg -n 'class OrderService' src/          # 先拿行号
sed -n '840,920p' src/order/service.ts   # 再读区间
```

---

## 4. 依赖与环境的"已完成检测"

```bash
# 依赖未装才装
[[ -d node_modules ]] || npm ci --prefer-offline --no-audit --no-fund
command -v jq >/dev/null || echo "MISSING: jq" >&2

# 幂等 + dry-run 优先
terraform plan -out=tfplan && terraform apply tfplan
kubectl diff -f deploy.yaml
git apply --check patch.diff && git apply patch.diff
```

---

## 5. 输出过滤与早停

```bash
# 只取需要的字段
curl -s "$API" | jq -r '.items[] | "\(.id)\t\(.name)"' | head -50
# 日志取关键行
npm test 2>&1 | rg -n 'FAIL|Error|✗' | head -30
# 早停
rg -n --max-count 5 'TODO|FIXME' src/
git log --oneline -20
```

---

## 6. 并行编排范式

```
第 1 层（无依赖，同批并行发出）：
  read A.md / read B.md / rg 'pattern' / test -d node_modules
第 2 层（依赖第 1 层结果，同批并行发出）：
  按命中行号读区间 / 安装缺失依赖
第 3 层：
  汇总结论
```

判断口诀：**这一步需要上一步的输出吗？不需要 → 并行；需要 → 串行，但串行链要尽量短。**

顺序敏感例外（允许且必须串行）：先写后读、先迁移后校验、部署流水线的强顺序步骤。须在注释中写明原因。
