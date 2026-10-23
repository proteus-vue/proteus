#!/usr/bin/env bash
# hosts/harmony/run-doh-probe.sh —— ★★★#1202：鸿蒙 **DoH 落点**真机判据（六组对照）
#
# 【要回答什么问题】`rcp.h` 的 `Rcp_DnsOverHttps` 注释写的是
#   「the address resolved by the DOH dns server is **preferred**」——
#   这句话有两种可能语义，头文件分辨不出来，必须真机实测：
#     · 强语义：DoH 的答案被采用（含"答案不可达 ⇒ 请求失败"），失败时**不**回落系统 DNS；
#     · 弱语义：DoH 只是"先试"，失败/无答案 ⇒ **静默回落**系统 DNS。
#   两者对业务的后果完全不同（弱语义意味着"配了 DoH 也可能悄悄没生效"）。
#
# 【★为什么必须六组（单组都是恒真或恒假）】
#   | 组 | DoH | 目标 | 期望 | 这组排除什么 |
#   |---|---|---|---|---|
#   | T0 | 无 | `xxx.invalid`（RFC 2606 保留 TLD） | **失败** | 证明该域名系统 DNS 必然解析不出 ⇒ T1 成功只能是 DoH |
#   | T1 | 有（回 127.0.0.1） | 同上 | **成功 200** | 证明 DoH 的答案**真的被采用**（不是"配了不生效"） |
#   | T2a | 无 | `example.com` | **成功 200** | 基线：证明网络与宿主本身没问题 |
#   | T2b | 有（回 203.0.113.1 = TEST-NET-3） | `example.com` | **失败** | 证明 DoH **覆盖了系统 DNS**（否则系统 DNS 会给可用的 IP ⇒ 成功） |
#   | T3 | 有（回 NXDOMAIN） | `example.com` | **失败** | 证明**无答案时不静默回落**（弱语义会成功） |
#   | T4 | 有但服务端**不可达** | `example.com` | **失败 + 服务端零查询** | 证明**连不上 DoH 时也不回落**（生产风险面） |
#   ★T2b/T3/T4 是 T1 的必要补充：只有 T1 时，"DoH 被采用"与"RCP 恰好走了系统 DNS"**同形**。
#
# 【第三方证据】不只看设备端自报：本地 DoH 服务端的 `/stats` 记录**查询计数 + qname + qtype**。
#   T1/T2b/T3 必须看到服务端计数上升且 qname 匹配；T4 必须**零上升**（设备根本没连上）。
#
# 【装置】`doh-probe-server.mjs` 一个进程两个监听口：
#   · HTTPS/h2 18443（`/dns-query` RFC 8484，`/control` 切模式，`/stats` 读数）
#   · 明文 18080（T1 的目标服务端：DoH 把假域名解到 127.0.0.1 后必须真有东西在听）
#   + `hdc rport` 把设备侧两个端口回连到本机。
#
# 【诚实边界】
#   ① 服务端用**自签证书** + `skipCertificatesValidation=true` ⇒ 只证明"配置路径接通"，
#      **不**证明真实 CA 校验下同样成立（那条没法在本机做成可归因的对照）；
#   ② 只证 `Rcp_DnsOverHttps` 这一个字段的语义，**不**证明解析结果被缓存（RCP 的 DoH 缓存策略未取证）；
#   ③ 本单**不**把 DoH 做成业务 API（`useFetch({httpDns})` 是"域名→IP 表"，语义不同）⇒ 线格式零改动。
#
# 用法：
#   bash hosts/harmony/run-doh-probe.sh              # 全量六组（约 2~3 分钟，含一次 15s 超时）
#   bash hosts/harmony/run-doh-probe.sh --only T1,T3 # 只跑指定组（调试用）
#
# 前置：bash hosts/harmony/build-host-app.sh && node -v（本机跑 DoH 服务端）
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
HDC() { bash "$HERE/hdc.sh" "$@"; }

RESULTS="$HERE/results"
STATS="/tmp/proteus-doh/doh-probe-server.json"
DOH_PORT=18443
TARGET_PORT=18080
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
PROBE="$HERE/run-http-probe.sh"

ONLY=""
for arg in "$@"; do
  case "$arg" in --only=*) ONLY="${arg#--only=}" ;; --only) : ;; esac
done

[ -f "$WAIT" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
[ -f "$HERE/doh-probe-server.mjs" ] || { echo "✗ 缺 doh-probe-server.mjs"; exit 2; }
mkdir -p "$RESULTS" /tmp/proteus-doh

HAP="$(ls -t "$HERE/host-app/entry/build/default/outputs/default"/*-signed.hap 2>/dev/null | head -1)"
[ -n "$HAP" ] || { echo "✗ 缺签名 hap——先跑 bash hosts/harmony/build-host-app.sh"; exit 2; }
STATE="$(HDC list targets -v 2>/dev/null | head -1)"
case "$STATE" in *Connected*) ;; *) echo "✗ 无设备/未授权（${STATE}）"; exit 2 ;; esac
echo "==> 设备=$STATE · hap=${HAP##*/}"

# ★★★ 锁屏预检：设备锁屏时 `aa start` 报 `10106102`，六组会**全部**失败在"启动"阶段，
#   看起来像"DoH 全失效"（本轮实测踩到，浪费一轮）。先唤醒；唤醒后仍启动不了则**明确报因**。
HDC shell "power-shell wakeup" >/dev/null 2>&1 || true
START_PROBE="$(HDC shell "aa start -a EntryAbility -b dev.proteus.host" 2>&1 | tr -d '\r')"
case "$START_PROBE" in
  *successfully*) ;;
  *) echo "✗ 设备无法启动应用（多为锁屏）：${START_PROBE:0:160}"
     echo "  ⇒ 请在设备上解锁屏幕后重跑（本脚本不能代解密码）"; exit 3 ;;
esac

# ── 证书（自签；已有则复用——每天重建没有必要，且会让"证书变了"混进变量）──
if [ ! -f /tmp/proteus-doh/cert.pem ] || [ ! -f /tmp/proteus-doh/key.pem ]; then
  echo "==> 生成自签证书（SAN=IP:127.0.0.1）"
  openssl req -x509 -newkey rsa:2048 -keyout /tmp/proteus-doh/key.pem -out /tmp/proteus-doh/cert.pem \
    -days 7 -nodes -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1" >/dev/null 2>&1 \
    || { echo "✗ 自签证书生成失败"; exit 2; }
fi

SERVER_PID=""
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  # 端口转发按"正向顺序"撤，失败不阻断收尾
  HDC fport rm tcp:$DOH_PORT tcp:$DOH_PORT >/dev/null 2>&1 || true
  HDC fport rm tcp:$TARGET_PORT tcp:$TARGET_PORT >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ── ① 起本地 DoH 服务端（完成信号 = stats 文件出现，零盲等）──
rm -f "$STATS"
node "$HERE/doh-probe-server.mjs" >/tmp/proteus-doh/server.log 2>&1 &
SERVER_PID=$!
if ! bash "$WAIT" --file "$STATS" --timeout 20 --interval 1 >/dev/null; then
  echo "✗ DoH 服务端未就绪（20s）——见 /tmp/proteus-doh/server.log"; cat /tmp/proteus-doh/server.log; exit 1
fi
echo "==> ① DoH 服务端就绪（https:$DOH_PORT · 目标 http:$TARGET_PORT · pid=${SERVER_PID}）"

# ── ② 端口转发（设备侧 → 本机）──
HDC rport tcp:$DOH_PORT tcp:$DOH_PORT >/dev/null 2>&1 || { echo "✗ rport $DOH_PORT 失败"; exit 1; }
HDC rport tcp:$TARGET_PORT tcp:$TARGET_PORT >/dev/null 2>&1 || { echo "✗ rport $TARGET_PORT 失败"; exit 1; }
echo "==> ② 端口转发就绪（设备 localhost:$DOH_PORT / :$TARGET_PORT → 本机）"

ctl() { curl -s --insecure "https://127.0.0.1:$DOH_PORT/control?$1" >/dev/null; }
qcount() { python3 -c "import json;print(json.load(open('$STATS'))['queries'])" 2>/dev/null || echo 0; }
qnames() { python3 -c "import json;print(','.join(json.load(open('$STATS'))['qnames']))" 2>/dev/null || echo ''; }

HOST_INVALID="proteus-doh-probe.invalid"
DOH_URL="https://127.0.0.1:$DOH_PORT/dns-query"

run_group() {   # $1=组名 $2=是否用 DoH(1/0) $3=url
  local name="$1" use_doh="$2" url="$3"
  if [ -n "$ONLY" ] && [[ ",$ONLY," != *",$name,"* ]]; then return 0; fi
  echo "$name" >>/tmp/proteus-doh/ran.txt
  local before after
  before="$(qcount)"
  echo
  echo "───────── $name ─────────"
  # ★★★ 先删**本地**旧报告：`run-http-probe.sh` 若在"启动"阶段就失败（例：设备锁屏
  #   ⇒ `aa start` 报 10106102），它**不会**走到取回报的那一步 ⇒ 本地会留着上一轮的文件，
  #   被这里当成本轮证据（本轮实测踩到：六组全读到旧文件，误判成"DoH 全失效"）。
  rm -f "$RESULTS/http-probe.json"
  if [ "$use_doh" = "1" ]; then
    bash "$PROBE" --url="$url" --doh-url="$DOH_URL" --doh-skip-cert >"/tmp/proteus-doh/${name}.log" 2>&1
  else
    bash "$PROBE" --url="$url" >"/tmp/proteus-doh/${name}.log" 2>&1
  fi
  # ★探针自身的断言对"预期失败组"必然非零 ⇒ 退出码不作判据；但**必须**有新报告落盘。
  if [ ! -s "$RESULTS/http-probe.json" ]; then
    echo "✗ ${name}：探针没产出报告（装置失败，与本议题无关）"; tail -6 "/tmp/proteus-doh/${name}.log"; return 1
  fi
  # ★★★ 内容级核对：报告里的目标 URL 必须与本组请求一致（防"文件是新的但跑的是别的组"）
  if ! python3 -c "
import json,sys
d=json.load(open('$RESULTS/http-probe.json'))
diag=json.loads(d.get('probe_diag') or '{}')
want=sys.argv[1]
got=diag.get('targetUrl') or d.get('url') or ''
sys.exit(0 if got==want else 1)
" "$url" 2>/dev/null; then
    echo "✗ ${name}：报告的目标 URL 与本组不符（装置串组）"; return 1
  fi
  cp "$RESULTS/http-probe.json" "$RESULTS/doh-probe-$name.json"
  after="$(qcount)"
  echo "  服务端查询：$before → ${after}（Δ$((after - before))）· qnames=$(qnames | tail -c 160)"
  echo "$name $before $after" >>/tmp/proteus-doh/deltas.txt
  return 0
}

: >/tmp/proteus-doh/deltas.txt
: >/tmp/proteus-doh/ran.txt
# ★★★ 清掉上一轮的证据文件——否则 `--only` 或某组中途失败时，判据会读到**陈旧证据**
#   并把它当本轮结果（本轮实测踩到：`--only=T1` 却显示 T1 成功，而那是上一轮的文件）。
rm -f "$RESULTS"/doh-probe-t*.json "$RESULTS/doh-probe-summary.json"
RC=0
ctl "mode=a&ip=127.0.0.1"
run_group t0-no-doh-invalid 0 "http://$HOST_INVALID:$TARGET_PORT/" || RC=1
run_group t1-doh-resolves    1 "http://$HOST_INVALID:$TARGET_PORT/" || RC=1
run_group t2a-baseline       0 "http://example.com/" || RC=1
ctl "mode=unreachable"
run_group t2b-doh-overrides  1 "http://example.com/" || RC=1
ctl "mode=nxdomain"
run_group t3-doh-nxdomain    1 "http://example.com/" || RC=1
# T4：撤掉 DoH 端口转发 ⇒ 服务端不可达（服务端仍在跑，用于核对"零查询"）
ctl "mode=a&ip=127.0.0.1"
HDC fport rm tcp:$DOH_PORT tcp:$DOH_PORT >/dev/null 2>&1 || true
run_group t4-doh-unreachable 1 "http://example.com/" || RC=1
HDC rport tcp:$DOH_PORT tcp:$DOH_PORT >/dev/null 2>&1 || true   # 恢复（收尾 trap 会再撤）

# ── ③ 判据（六组一次性判定；失败即 exit 1）──
DELTAS=/tmp/proteus-doh/deltas.txt RAN=/tmp/proteus-doh/ran.txt python3 - "$RESULTS" <<'PY'
import json, os, sys, glob
R = sys.argv[1]
deltas = {}
try:
    for line in open(os.environ["DELTAS"]):
        n, a, b = line.split()
        deltas[n] = (int(a), int(b))
except Exception:
    pass

# ★★★本轮实际跑过的组：`--only` 或某组中途失败时，未跑的组必须**明确跳过**，
#   不能拿上一次留下的证据文件当真（本轮实测踩到：`--only=T1` 却把上一轮的 T1 当本轮结果）。
ran = set()
try:
    ran = {ln.strip() for ln in open(os.environ["RAN"]) if ln.strip()}
except Exception:
    pass

class Skip:
    """本轮未运行（`--only` 过滤或前面组失败中断）——已单独打印，不参与判定。"""
    def __bool__(self):
        return False


SKIP = Skip()


def load(name):
    if name not in ran:
        print(f"  ⊘ {name}：本轮未运行（跳过，不拿旧证据充数）")
        return SKIP
    p = os.path.join(R, f"doh-probe-{name}.json")
    if not os.path.exists(p):
        return None
    return json.load(open(p))

ok = True
def check(cond, msg):
    global ok
    print(("  ✅ " if cond else "  ✗ ") + msg)
    if not cond:
        ok = False

def reason(d):
    return str((d or {}).get("reason") or (d or {}).get("error") or "")

def ev(d, label):
    """"证据存在"断言——本轮未运行的组（Skip）已单独打印，这里不再重复判红。"""
    if d is SKIP:
        return
    check(d is not None, label)

print("═══ 鸿蒙 DoH 落点判据（六组对照）═══")

# T0：假域名 + 无 DoH ⇒ 必须失败（否则 T1 的成功不可归因）
d = load("t0-no-doh-invalid")
ev(d, "T0 证据存在")
if d:
    check(d.get("ok") is False, f"T0 无 DoH 时 .invalid 域名应失败（实得 ok={d.get('ok')}）")
    check((d.get("doh") or {}).get("enabled") is False, "T0 确未启用 DoH")
    check("无法解析" in reason(d) or "unreachable" in reason(d), f"T0 失败原因是解析失败：{reason(d)[:80]}")

# T1：假域名 + DoH ⇒ 必须成功（证明 DoH 答案被采用）
d = load("t1-doh-resolves")
ev(d, "T1 证据存在")
if d:
    doh = d.get("doh") or {}
    check(d.get("ok") is True, f"T1 配 DoH 后 .invalid 应成功（实得 ok={d.get('ok')} · {reason(d)[:80]}）")
    check(d.get("status") == 200, f"T1 状态码应为 200（实得 {d.get('status')}）")
    check("PROTEUS_RPORT_OK" in str(d.get("preview") or ""), "T1 响应体来自目标服务端（PROTEUS_RPORT_OK）")
    check(doh.get("enabled") is True and doh.get("installed") is True, f"T1 DoH 确实被挂上：{doh}")
    bef, aft = deltas.get("t1-doh-resolves", (0, 0))
    check(aft > bef, f"T1 服务端侧查询计数应上升（{bef}→{aft}）——第三方证据")

# T2a：基线（无 DoH，真实域名）⇒ 必须成功，否则后续"失败"无法归因给 DoH
d = load("t2a-baseline")
ev(d, "T2a 证据存在")
if d:
    check(d.get("ok") is True and d.get("status") == 200, f"T2a 基线 example.com 应成功（实得 {d.get('status')}）")
    check("dnsSource" not in (d.get("transport") or {}), "T2a 未装表时不应报 dnsSource（缺键=不可得）")

# T2b：DoH 回不可达 IP ⇒ 必须失败（证明 DoH 覆盖系统 DNS，而不是被系统 DNS 兜住）
d = load("t2b-doh-overrides")
ev(d, "T2b 证据存在")
if d:
    check(d.get("ok") is False, f"T2b DoH 指向不可达 IP 时应失败（实得 ok={d.get('ok')}）")
    bef, aft = deltas.get("t2b-doh-overrides", (0, 0))
    check(aft > bef, f"T2b 服务端侧应收到 example.com 查询（{bef}→{aft}）")

# T3：DoH 回 NXDOMAIN ⇒ 必须失败（证明"无答案不静默回落"）
d = load("t3-doh-nxdomain")
ev(d, "T3 证据存在")
if d:
    check(d.get("ok") is False, f"T3 DoH 回 NXDOMAIN 时应失败（实得 ok={d.get('ok')}）")
    check("无法解析" in reason(d), f"T3 应为解析失败而非超时：{reason(d)[:80]}")

# T4：DoH 服务端不可达 ⇒ 必须失败 + 服务端零查询（证明"连不上也不回落"）
d = load("t4-doh-unreachable")
ev(d, "T4 证据存在")
if d:
    bef, aft = deltas.get("t4-doh-unreachable", (0, 0))
    check(d.get("ok") is False, f"T4 DoH 服务端不可达时应失败（实得 ok={d.get('ok')}）")
    check("无法解析" in reason(d), f"T4 应为解析失败：{reason(d)[:80]}")
    check(aft == bef, f"T4 服务端侧应零查询（{bef}→{aft}）——证明设备确实没连上、也没回落")

print()
if ok:
    print("✅ 结论：`Rcp_DnsOverHttps` 是**权威**语义（不是'先试再回落'）——")
    print("   ① 配了就按它解析（T1/T2b）；② 无答案不回落（T3）；③ 连不上也不回落（T4）。")
    print("   ⇒ 生产启用 DoH 必须自备兜底（多 DoH 端点/失败策略），否则 DNS 侧单点会放大成全站不可用。")
sys.exit(0 if ok else 1)
PY
RC2=$?

# 证据汇总（含服务端读数，便于离线复判）
python3 - "$RESULTS" "$STATS" <<'PY'
import json, sys, os
R, S = sys.argv[1], sys.argv[2]
try:
    stats = json.load(open(S))
except Exception:
    stats = {}
summary = {"issue": "DoH 落点（Rcp_DnsOverHttps）真机取证", "serverStats": stats, "groups": {}}
for name in ["t0-no-doh-invalid", "t1-doh-resolves", "t2a-baseline", "t2b-doh-overrides",
             "t3-doh-nxdomain", "t4-doh-unreachable"]:
    p = os.path.join(R, f"doh-probe-{name}.json")
    if not os.path.exists(p):
        continue
    d = json.load(open(p))
    summary["groups"][name] = {
        "ok": d.get("ok"), "status": d.get("status"), "bodyBytes": d.get("bodyBytes"),
        "reason": d.get("reason") or "", "doh": d.get("doh") or {},
        "transport": d.get("transport") or {},
        "preview": str(d.get("preview") or "")[:120],
    }
json.dump(summary, open(os.path.join(R, "doh-probe-summary.json"), "w"), ensure_ascii=False, indent=2)
print(f"证据汇总：hosts/harmony/results/doh-probe-summary.json（{len(summary['groups'])} 组）")
PY

[ "$RC" = "0" ] || { echo "✗ 有组未产出证据（装置问题）"; exit 1; }
[ "$RC2" = "0" ] && echo "  ✓ 鸿蒙 DoH 落点真机判据通过" || { echo "  ✗ 判据失败"; exit "$RC2"; }
