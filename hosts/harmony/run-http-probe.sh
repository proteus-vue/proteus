#!/usr/bin/env bash
# hosts/harmony/run-http-probe.sh —— ★★★T-app-fetch 真机判据：鸿蒙宿主 HTTP 二进制腿
#
# 【要证明什么（三层，缺一层都不算通）】
#   ① **跨语言契约在设备上成立**：帧由 **ArkTS 自己编码**（`entry/src/main/ets/runtime/InvokeWire.ts`）
#      → 交给 C++ 解（`invoke_wire.h`）→ 回程帧由 C++ 编 → JS 拿到 `Uint8Array` → C++ 再解。
#      （本机 `check:invoke-wire-parity` 已验同一性质；真机上再验一次，防"本机绿、设备端不一致"）
#   ② **JS 字节交接真的通**：走 `proteusHost.invokeBytes(Uint8Array)`，不是 JSON 回落。
#   ③ **宿主 HTTP 真的发出去**：回执里的 `status`/`bodyBytes` 来自**真实响应**（不是宿主自报常量）。
#
# 【完成信号 = 报告落盘】App 侧 `superapp-http` 场景落 `<filesDir>/http-probe.json` 并打
#   `PROTEUS_HTTP_PROBE_DONE`；本脚本**条件等待文件出现**（零 sleep / 零轮询超时链）。
#
# 【诚实边界】本探针不 boot 应用（空 VM + 只装 invokeBytes）⇒ 证明三段通路真实；
#   **不**证明 `useFetch` 的业务封装（那由 `tests/capability-app-fetch.test.ts` 等覆盖）。
#
# 前置：bash hosts/harmony/build-host-app.sh   （含 HAR native；HMS RCP 头需在 SDK 里）
# 用法：bash hosts/harmony/run-http-probe.sh [--url https://...]
#       （缺省 url = https://httpbin.org/get；国内网络不通时可用 --url 指向可达地址）
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
HDC() { bash "$HERE/hdc.sh" "$@"; }

BUNDLE="dev.proteus.host"
HAP_DIR="$HERE/host-app/entry/build/default/outputs/default"
RESULTS="$HERE/results"
FILES_DEV="/data/app/el2/100/base/$BUNDLE/haps/entry/files"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

URL=""
DNS_IP=""
DNS_HOST=""
SAVE_PATH=""   # ★#1187：savePath（沙箱相对路径）
STREAM=""     # ★#1187：1 = 传 stream:true（应被如实拒绝）
DOH_URL=""    # ★#1202：DoH 服务端 URL（探针专用；空 = 不启用 DoH）
DOH_SKIP_CERT=""  # ★#1202：1 = skipCertificatesValidation（自签 DoH 服务端用）
EXPECT_REJECT=""   # ★#1192：1 = 预期被拒（路径穿越/非法 savePath 的**可重放**判据）
TLS_PINS=""        # ★#1203：base64 SPKI 指纹（鸿蒙应**如实拒绝**）
TLS_PIN_ONLY=""    # ★#1203：1 = 只给 tlsPinOnly（同样应被拒）
UPLOAD_PATH=""     # ★#1205：multipart 上传的沙箱相对路径
UPLOAD_FIELD=""    # ★#1205：文件字段名（缺省 file）
UPLOAD_FILENAME="" # ★#1205：远端文件名（缺省 = 路径 basename）
UPLOAD_F1K=""      # ★#1205：一个普通表单字段（键）
UPLOAD_F1V=""      # ★#1205：同上（值）
CAP_METHOD=""      # ★#1210：能力直通（如 fs.writeBytes / fs.readBytes / fs.remove）
CAP_ARGS=""        # ★#1210：能力参数（JSON 文本）
for arg in "$@"; do
  case "$arg" in
    --url=*) URL="${arg#--url=}" ;;
    --url) shift_next=1 ;;  # 兼容 `--url <value>`：下面单独处理
    --dns-ip=*) DNS_IP="${arg#--dns-ip=}" ;;
    --dns-ip) shift_next_dns=1 ;;
    --dns-host=*) DNS_HOST="${arg#--dns-host=}" ;;
    --save-path=*) SAVE_PATH="${arg#--save-path=}" ;;   # ★#1187
    --stream) STREAM=1 ;;                              # ★#1187
    --expect-reject) EXPECT_REJECT=1 ;;                  # ★#1192
    --doh-url=*) DOH_URL="${arg#--doh-url=}" ;;          # ★#1202
    --doh-skip-cert) DOH_SKIP_CERT=1 ;;                  # ★#1202
    --tls-pins=*) TLS_PINS="${arg#--tls-pins=}" ;;       # ★#1203（应被如实拒绝）
    --tls-pin-only) TLS_PIN_ONLY=1 ;;                    # ★#1203
    --upload-path=*) UPLOAD_PATH="${arg#--upload-path=}" ;;  # ★#1205
    --upload-field=*) UPLOAD_FIELD="${arg#--upload-field=}" ;;
    --upload-filename=*) UPLOAD_FILENAME="${arg#--upload-filename=}" ;;
    --upload-form=*) UPLOAD_F1K="${arg#--upload-form=}"; UPLOAD_F1V="${UPLOAD_F1K#*=}"; UPLOAD_F1K="${UPLOAD_F1K%%=*}" ;;
    --cap-method=*) CAP_METHOD="${arg#--cap-method=}" ;;   # ★#1210
    --cap-args=*) CAP_ARGS="${arg#--cap-args=}" ;;         # ★#1210
    --dns-host) shift_next_host=1 ;;
    *) if [ "${shift_next:-0}" = "1" ]; then URL="$arg"; shift_next=0;
       elif [ "${shift_next_dns:-0}" = "1" ]; then DNS_IP="$arg"; shift_next_dns=0;
       elif [ "${shift_next_host:-0}" = "1" ]; then DNS_HOST="$arg"; shift_next_host=0; fi ;;
  esac
done
[ -n "$URL" ] || URL="https://httpbin.org/get"

[ -f "$WAIT" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
mkdir -p "$RESULTS"

HAP="$(ls -t "$HAP_DIR"/*-signed.hap 2>/dev/null | head -1)"
[ -n "$HAP" ] || { echo "✗ 缺签名 hap——先跑 bash hosts/harmony/build-host-app.sh"; exit 2; }
STATE="$(HDC list targets -v 2>/dev/null | head -1)"
case "$STATE" in *Connected*) ;; *) echo "✗ 无设备/未授权（${STATE}）"; exit 2 ;; esac
echo "==> hap=${HAP##*/}  设备=$STATE  url=$URL"

echo "==> ① 安装 + 清场 + 删旧报告"
HDC install "$HAP" 2>&1 | grep -qiE "successfully|Success" || { echo "✗ 安装失败"; exit 1; }
HDC shell "aa force-stop $BUNDLE" >/dev/null 2>&1 || true
HDC shell "hilog -r" >/dev/null 2>&1 || true
HDC shell "rm -f $FILES_DEV/http-probe.json" >/dev/null 2>&1 || true
if HDC shell "test -f $FILES_DEV/http-probe.json && echo STILL_EXISTS" 2>/dev/null | grep -q STILL_EXISTS; then
  echo "✗ 旧报告删不掉（$FILES_DEV/http-probe.json）——等待信号会命中陈旧文件，拒绝继续"; exit 1
fi

echo "==> ② 启动（scene=superapp-http）"
DNS_ARG=""
[ -n "$DNS_IP" ] && DNS_ARG="--ps dnsIp $DNS_IP"
# ★#1169：dnsHost + dnsIp 配对 ⇒ 往帧里塞 httpDns 表（验证宿主表解析生效）
[ -n "$DNS_HOST" ] && DNS_ARG="$DNS_ARG --ps dnsHost $DNS_HOST"
# ★★★#1187：savePath（逐块落盘）/ stream（应被如实拒绝）
# ★★★#1187 真机踩坑（实测）：`aa start --ps savePath download/x.txt` 的**斜杠会被 aa 吃掉**
#   ⇒ `want.parameters` 里根本没有 `savePath` 这个键（而 scene/url 都在）。
#   加引号也无效（试过）⇒ 探针侧传 `%2F`，ArkTS 侧解回 `/`。
SAVE_PATH_ENC="$(printf '%s' "$SAVE_PATH" | sed 's|/|%2F|g')"
[ -n "$SAVE_PATH" ] && DNS_ARG="$DNS_ARG --ps savePath $SAVE_PATH_ENC"
[ "$STREAM" = "1" ] && DNS_ARG="$DNS_ARG --ps stream 1"
# ★★★#1202：DoH 落点探针（斜杠同 #1187 会被 aa 吃掉 ⇒ 传 %2F，ArkTS 侧解回）
if [ -n "$DOH_URL" ]; then
  DOH_ENC="$(printf '%s' "$DOH_URL" | sed 's|/|%2F|g')"
  DNS_ARG="$DNS_ARG --ps dohUrl $DOH_ENC"
  [ "$DOH_SKIP_CERT" = "1" ] && DNS_ARG="$DNS_ARG --ps dohSkipCert 1"
fi
# ★★★#1203：tlsPins（应被**如实拒绝**）。★pin 是 base64 串，`+`/`=` 会被 `aa start` 吃掉
#   （#1154 在 adb 上踩过同款：`+`→空格、`=` 被当 key=value 分隔）⇒ 这里用 base64url 风格
#   的**测试值**（不含 `+` `/` `=`），只验证"拒绝生效"，不需要真指纹。
[ -n "$TLS_PINS" ] && DNS_ARG="$DNS_ARG --ps tlsPins $TLS_PINS"
[ "$TLS_PIN_ONLY" = "1" ] && DNS_ARG="$DNS_ARG --ps tlsPinOnly 1"
# ★★★#1205：multipart 上传（路径斜杠同样被 aa 吃掉 ⇒ 传 %2F）
if [ -n "$UPLOAD_PATH" ]; then
  UP_ENC="$(printf '%s' "$UPLOAD_PATH" | sed 's|/|%2F|g')"
  DNS_ARG="$DNS_ARG --ps uploadPath $UP_ENC"
  [ -n "$UPLOAD_FIELD" ] && DNS_ARG="$DNS_ARG --ps uploadField $UPLOAD_FIELD"
  [ -n "$UPLOAD_FILENAME" ] && DNS_ARG="$DNS_ARG --ps uploadFilename $UPLOAD_FILENAME"
  [ -n "$UPLOAD_F1K" ] && DNS_ARG="$DNS_ARG --ps uploadField1Key $UPLOAD_F1K"
  [ -n "$UPLOAD_F1V" ] && DNS_ARG="$DNS_ARG --ps uploadField1Value $UPLOAD_F1V"
fi
# ★★★#1210：能力直通（fs.* / log.* / cookie.* 这类非 http.request 的能力）
# ★args 里含 `{}` `"` `,` `/` 等字符 ⇒ 用 base64 传（`aa start --ps` 会吃掉符号，见 #1187/#1202 教训）
if [ -n "$CAP_METHOD" ]; then
  DNS_ARG="$DNS_ARG --ps capMethod $CAP_METHOD"
  # ★★★#1210：**必须去掉 `=` 填充并把 `+`/`/` 换成 base64url**
  #   —— `aa start --ps` 会把 `=` 当 key=value 分隔、`+` 当空格（#1187/#1202/#1154 都踩过），
  #   实测现象：带 `==` 的 base64 会让 `aa start` 直接**启动失败**。
  ARGS_B64="$(printf '%s' "${CAP_ARGS:-{\}}" | base64 | tr -d '\n' | tr '+/' '-_' | sed 's/=*$//')"
  DNS_ARG="$DNS_ARG --ps capArgsB64 $ARGS_B64"
fi
HDC shell "aa start -a EntryAbility -b $BUNDLE --ps scene superapp-http --ps url $URL $DNS_ARG" 2>&1 \
  | grep -qi "successfully" || { echo "✗ 启动失败"; exit 1; }

echo "==> ③ 等报告落盘（完成信号 = 文件存在；零盲等）"
if ! bash "$WAIT" --cmd "bash '$HERE/hdc.sh' shell 'test -f $FILES_DEV/http-probe.json && echo PROTEUS_HTTP_PROBE_READY' | grep -q PROTEUS_HTTP_PROBE_READY" --timeout 90 --interval 3; then
  echo "✗ 90s 内未见 http-probe.json" >&2
  HDC shell "hilog -x | grep -E 'HTTP_PROBE|HTTP_REQUEST|INVOKE_BYTES|cppcrash' | tail -12" 2>&1 | sed 's/^/  /' >&2
  exit 1
fi

echo "==> ④ 取回报告 + 断言"
rm -f "$RESULTS/http-probe.json"
HDC file recv "$FILES_DEV/http-probe.json" "$RESULTS/http-probe.json" >/dev/null 2>&1 \
  || { echo "✗ file recv 失败"; exit 1; }
[ -s "$RESULTS/http-probe.json" ] || { echo "✗ 报告为空"; exit 1; }
echo "    http-probe.json $(wc -c < "$RESULTS/http-probe.json" | tr -d ' ') 字节"
cat "$RESULTS/http-probe.json"; echo

EXPECT_REJECT="${EXPECT_REJECT:-}" python3 - "$RESULTS/http-probe.json" <<'PY'
import json, os, sys
EXPECT_REJECT = os.environ.get("EXPECT_REJECT") == "1"
d = json.load(open(sys.argv[1]))
ok = True
# ★★★#1187：两种**预期失败**的形态（是设计，不是错误）：
#   · 传了 savePath ⇒ 回 `{path,size}` 摘要（★注意 `kept` 是恒真式，不作判据；看 saveWritten == seen）
#   · 传了 stream   ⇒ 必须 `fetch.unsupported` 且点明根因
diag = {}
try:
    diag = json.loads(d.get("probe_diag") or "{}")
except Exception:
    pass
save_path = diag.get("savePath") or ""
stream_on = (diag.get("stream") or "") == "1"
if EXPECT_REJECT:
    # ★#1192（J-J6-2）：**预期被拒**模式——让"路径穿越被拒"这份证据可重放
    # ★#1194（J-R5）：与 save/stream 分支同口径，必须校验 host/bridge/frameSource，
    #   否则探针跑在别的宿主或非 ArkTS 帧路径上也会绿
    if d.get("host") != "harmony":
        print(f"✗ host 应为 harmony，实得 {d.get('host')}"); sys.exit(1)
    if d.get("bridge") != "invokeBytes":
        print(f"✗ bridge 应为 invokeBytes，实得 {d.get('bridge')}"); sys.exit(1)
    if d.get("frameSource") != "arkts":
        print(f"✗ frameSource 应为 arkts，实得 {d.get('frameSource')}"); sys.exit(1)
    if d.get("ok") is not False:
        print("✗ 期望被拒但请求成功了"); sys.exit(1)
    if (d.get("limit") or {}).get("saveMode") is not False:
        print("✗ 被拒却仍进了落盘分支"); sys.exit(1)
    r = str(d.get("reason") or "")
    if "savePath 非法" not in r:
        print(f"✗ 拒绝原因不是路径非法：{r[:100]}"); sys.exit(1)
    print(f"✅ 路径被如实拒绝：{r[:110]}")
    sys.exit(0)
if save_path:
    prev = d.get("preview") or ""
    if d.get("ok") is not True:
        print(f"✗ 落盘请求未成功：{d.get('error') or d.get('reason')}"); ok = False
    elif '"path"' not in prev or '"size"' not in prev:
        print(f"✗ 落盘回执不是 {{path,size}} 摘要：{prev[:120]}"); ok = False
    else:
        lim = d.get("limit") or {}
        print(f"✅ 落盘回执：{prev}")
        # ★★★#1190（独立验证 J4 修复）：`kept==0` 是**恒真式**（落盘分支不填 gate.body）
        #   ⇒ 换成可核对的三个量：saveMode / saveWritten / cap。
        if lim.get("saveMode") is not True:
            print("✗ limit.saveMode!=true（没走落盘分支）"); ok = False
        if (lim.get("saveWritten") or 0) <= 0:
            print("✗ limit.saveWritten=0（一个字节都没写进文件）"); ok = False
        if (lim.get("saveWritten") or 0) != (lim.get("seen") or 0):
            print(f"✗ saveWritten({lim.get('saveWritten')}) != seen({lim.get('seen')})（写盘量与收到量不符）"); ok = False
        # ★J5：落盘上限必须是 1 GiB，不是 32 MiB
        if (lim.get("cap") or 0) < 1024 * 1024 * 1024:
            print(f"✗ limit.cap={lim.get('cap')}（落盘应为 1 GiB；32 MiB = 硬编码错）"); ok = False
        else:
            print(f"   saveMode=1 · saveWritten={lim.get('saveWritten')}B · cap={lim.get('cap')}B（1GiB）")
    sys.exit(0 if ok else 1)
if stream_on:
    reason = str(d.get("reason") or "")
    if d.get("ok") is not False:
        print("✗ stream 未被拒绝（仍静默降级？）"); ok = False
    elif "fetch.unsupported" not in reason:
        print(f"✗ stream 拒绝码不是 fetch.unsupported：{reason[:100]}"); ok = False
    elif "一次性 VM" not in reason or "同步 napi" not in reason:
        print(f"✗ stream 拒绝信息没点明根因：{reason[:120]}"); ok = False
    else:
        print(f"✅ stream 如实拒绝：{reason[:110]}")
    sys.exit(0 if ok else 1)
# ★★★#1203：`tlsPins` / `tlsPinOnly` 在鸿蒙应被**如实拒绝**——静默放行 = 安全策略假成立。
#   ★这是本仓最坏的形态之一：业务以为配了 pin 就多了防 MITM 一道防线，实际请求不带任何校验照常发出。
#   ★必须断言三件事：① 请求没成功（未发出）② 错误码是 fetch.unsupported（不是 tlsError，
#     否则业务会去查"pin 配错了/证书不对"，方向就错了）③ 文案点明根因（RCP 无指纹校验回调）。
pins_on = (diag.get("tlsPins") or "") != "" or (diag.get("tlsPinOnly") or "") == "1"
if pins_on:
    reason = str(d.get("reason") or "")
    if d.get("ok") is not False:
        print("✗ 配了 tlsPins 但请求成功了 ⇒ pin 被静默忽略（安全策略假成立）"); ok = False
    elif "fetch.unsupported" not in reason:
        print(f"✗ pin 拒绝码应为 fetch.unsupported（避免业务误判成证书问题）：{reason[:120]}"); ok = False
    elif "pinning" not in reason:
        print(f"✗ 拒绝信息没点明是 pinning：{reason[:140]}"); ok = False
    elif "未发出任何流量" not in reason:
        print(f"✗ 拒绝信息没说清『未发出流量』（业务无法确认未被降级发出）：{reason[:140]}"); ok = False
    else:
        print(f"✅ tlsPins 如实拒绝（未发出流量）：{reason[:130]}")
    sys.exit(0 if ok else 1)
# ★★★#1203：HTTPDNS **表注入**组的预期形态（此前没有分支 ⇒ 跑这条必须人工判"失败是不是对的"）。
#   语义：表内域名按表解析 ⇒ 注入不可达 IP（TEST-NET-3）时请求**必须失败**，
#   且 `dns.tableHits > 0` + `lastSource == "table"`（证"表真的被用于解析"，不是碰巧失败）。
#   ★这与 #1171 的判据同口径：`tableHits` 才是"表被采用"的直接证据，失败本身只是必要条件。
table_on = (diag.get("dnsHost") or "") != "" or bool(d.get("dns", {}).get("tableRules"))
# ★★★#1205：**multipart 上传**组——只看"请求成功"说明不了任何事，
#   真正的判据是**服务端收到了什么**（由 upload-probe-server 解析后回显）：
#     · 有 boundary 且与 Content-Type 一致；
#     · 普通表单字段名/值正确；
#     · 文件字段 filename 正确；
#     · **文件字节的 sha256 与源文件逐字节相等**（长度对但内容错照样是坏的）。
upload_path = diag.get("uploadPath") or ""
if upload_path:
    if d.get("ok") is not True:
        print(f"✗ upload 请求未成功：{d.get('reason') or d.get('error')}"); sys.exit(1)
    # 服务端回显：优先用脚本注入（SRV_ECHO），否则自己从 UPLOAD_SRV 拉（本机回环）
    raw = os.environ.get("SRV_ECHO") or ""
    if not raw:
        srv = os.environ.get("UPLOAD_SRV") or ""
        if srv:
            try:
                import urllib.request
                raw = urllib.request.urlopen(srv + "/stats", timeout=5).read().decode("utf-8")
            except Exception as e:
                print(f"✗ 取服务端回显失败（{srv}）：{e}"); sys.exit(1)
    if not raw:
        print("✗ 缺服务端回显（SRV_ECHO / UPLOAD_SRV）——上传判据不能只看客户端成功"); sys.exit(1)
    try:
        echo = json.loads(raw)
    except Exception:
        print(f"✗ 服务端回显不是 JSON：{raw[:120]}"); sys.exit(1)
    st = echo.get("last") or {}
    fileinfo = st.get("file") or {}
    if not st.get("boundary"):
        print("✗ 服务端没收到 boundary（multipart 头缺失）"); sys.exit(1)
    if "boundary=" not in str(st.get("contentType") or ""):
        print(f"✗ 服务端收到的 Content-Type 没有 boundary：{st.get('contentType')}"); sys.exit(1)
    want_f1k = os.environ.get("WANT_F1K") or ""
    want_f1v = os.environ.get("WANT_F1V") or ""
    want_file_sha = os.environ.get("WANT_FILE_SHA") or ""
    fields = {f.get("name"): f.get("value") for f in (st.get("fields") or [])}
    if want_f1k and fields.get(want_f1k) != want_f1v:
        print(f"✗ 表单字段不符：期望 {want_f1k}={want_f1v!r}，实得 {fields.get(want_f1k)!r}"); sys.exit(1)
    if not fileinfo:
        print("✗ 服务端没解析到文件字段（文件根本没上传）"); sys.exit(1)
    if want_file_sha and fileinfo.get("sha256") != want_file_sha:
        print(f"✗ 文件内容不符：期望 sha256={want_file_sha[:16]}…，实得 {str(fileinfo.get('sha256'))[:16]}…"); sys.exit(1)
    print(f"✅ multipart 上传成立：boundary={st.get('boundary')[:40]} · "
          f"字段 {len(st.get('fields') or [])} 个 · 文件 {fileinfo.get('filename')} "
          f"{fileinfo.get('bytes')}B · sha256 一致")
    sys.exit(0)

if table_on:
    dn = d.get("dns") or {}
    if (dn.get("tableRules") or 0) <= 0:
        print("✗ 传了 dnsHost/dnsIp 但宿主没装上表（tableRules=0）"); ok = False
    elif (dn.get("tableHits") or 0) <= 0:
        print(f"✗ 表没被命中（tableHits=0 · lastSource={dn.get('lastSource')!r}）"); ok = False
    elif dn.get("lastSource") != "table":
        print(f"✗ lastSource 应为 table，实得 {dn.get('lastSource')!r}"); ok = False
    elif d.get("ok") is not False:
        # 注入的是不可达 IP；若仍成功 ⇒ 解析结果没被采用（表是摆设）
        print("✗ 表把域名解析到不可达 IP 但请求成功了 ⇒ 表未被采用"); ok = False
    else:
        print(f"✅ HTTPDNS 表生效：tableRules={dn.get('tableRules')} · tableHits={dn.get('tableHits')}"
              f" · lastSource=table · 请求如预期失败（不可达 IP）")
    sys.exit(0 if ok else 1)
# ★★★#1210：**能力直通模式**的判据——`capMethod` 非空时，回执是能力方法的 JSON（不是 HTTP 响应），
#   因此**不能**套用 HTTP 状态码/bodyBytes 断言（那也是我第一次跑时判红的原因）。
#   这里只断言"回执是一个带 ok 字段的合法 JSON"，真正的业务断言由离线判据
#   （`tests/harmony-fs-capability.test.ts`）对着入库证据做。
if (diag.get("capMethod") or "") != "":
    prev = str(d.get("preview") or "")
    if not prev:
        print(f"✗ 能力探针没有回执（error={d.get('error')}）"); sys.exit(1)
    try:
        cap = json.loads(prev)
    except Exception:
        print(f"✗ 能力回执不是 JSON：{prev[:120]}"); sys.exit(1)
    if "ok" not in cap:
        print(f"✗ 能力回执缺 ok 字段：{prev[:120]}"); sys.exit(1)
    print(f"✅ 能力直通回执：{prev[:160]}")
    sys.exit(0)

if d.get("host") != "harmony":
    print(f"✗ host 应为 harmony，实得 {d.get('host')}"); ok = False
if d.get("bridge") != "invokeBytes":
    print(f"✗ bridge 应为 invokeBytes（二进制腿），实得 {d.get('bridge')}"); ok = False
if d.get("frameSource") != "arkts":
    print(f"✗ frameSource 应为 arkts（跨语言契约未真验），实得 {d.get('frameSource')}"); ok = False
if d.get("ok") is not True:
    print(f"✗ 请求未成功：{d.get('error') or d.get('reason')}"); ok = False
else:
    st = d.get("status") or 0
    n = d.get("bodyBytes") or 0
    if not (200 <= st < 300):
        print(f"✗ HTTP 状态码异常：{st}"); ok = False
    if n <= 0:
        print(f"✗ 响应体为空（bodyBytes={n}）——通路可疑"); ok = False
    if ok:
        print(f"✅ 鸿蒙 HTTP 二进制腿通：ArkTS 编帧 → C++ 解 → 真实请求 → status={st} · body={n}B")
        prev = (d.get("preview") or "")[:100]
        if prev:
            print(f"   响应体前 100 字符：{prev}")
        # ★★★#1186：**传输读数**（含 HTTPDNS 的每请求可观测面）
        #   ★为什么必须在探针侧判：鸿蒙探针走原生直调，JS 拿不到 `meta.transport`.
        tp = d.get("transport") or {}
        if not tp:
            print("✗ 回执缺 transport（#1186 未接线）"); ok = False
        else:
            print(f"   transport：{json.dumps(tp, ensure_ascii=False)}")
            # 装了表 ⇒ 必须能看到 dnsSource=table（这是"表真的生效"的每请求直接证据）
            dn = d.get("dns") or {}
            if (dn.get("tableRules") or 0) > 0:
                src = tp.get("dnsSource")
                if src != "table":
                    print(f"✗ 装了表但 dnsSource={src!r}（应为 table）"); ok = False
                if tp.get("dnsTableHit") != "1":
                    print(f"✗ dnsTableHit={tp.get('dnsTableHit')!r}（应为 \"1\"）"); ok = False
                if src == "table":
                    print("✅ 每请求可观测面成立：transport.dnsSource=table · dnsTableHit=1")
            else:
                # 没装表 ⇒ dnsSource 必须**不出现**（没发生解析 ≠ 走了系统 DNS）
                if "dnsSource" in tp:
                    print(f"✗ 未装表却报了 dnsSource={tp.get('dnsSource')!r}（伪造来源）"); ok = False
                else:
                    print("✅ 未装表：dnsSource 不出现（符合「缺键=不可得」）")
sys.exit(0 if ok else 1)
PY
RC=$?
# ★★★#1190（独立验证 J6 修复）：**设备侧 stat 校验**——不能只信探针自报的摘要。
#   原判据全程只读 `preview.size`，写入 0 字节但摘要报 219 也能全绿。
#   ⇒ 传了 savePath 时，用 hdc 在**设备上**核对文件真实存在且大小等于摘要。
# ★#1192：expect-reject 模式没有落盘文件可核对 ⇒ 跳过 stat
# ★★★#1205：**上传组的设备侧 sha256 对拍**——判据不能只断言"服务端有个 64 位 sha256 字段"，
#   必须证明"服务端收到的字节 == 设备上那个源文件的字节"。这里用设备 OS 的 `sha256sum`
#   （第三方测量，不是我们自报）算出基准，写进证据，离线判据再与**服务端回显**比对。
if [ "$RC" = "0" ] && [ -n "$UPLOAD_PATH" ]; then
  DEV_UPLOAD_SHA="$(HDC shell "sha256sum '$FILES_DEV/$UPLOAD_PATH' 2>/dev/null | cut -d' ' -f1" 2>/dev/null | tr -d ' \r\n')"
  if [ -z "$DEV_UPLOAD_SHA" ]; then
    echo "  ✗ 设备侧算不出源文件 sha256（$UPLOAD_PATH）——上传证据无法对拍"; RC=1
  else
    echo "  ✓ 设备侧源文件 sha256=${DEV_UPLOAD_SHA:0:16}…（第三方基准，供离线对拍）"
    HDC_SHA="$DEV_UPLOAD_SHA" python3 - "$RESULTS/http-probe.json" <<'PY'
import json, os, sys
p = sys.argv[1]
try:
    d = json.load(open(p))
except Exception:
    sys.exit(0)
d["deviceSourceSha256"] = os.environ.get("HDC_SHA") or ""
d["deviceSourcePath"] = d.get("probe_diag") and json.loads(d.get("probe_diag")).get("uploadPath") or ""
json.dump(d, open(p, "w"), ensure_ascii=False)
PY
  fi
fi
if [ "$RC" = "0" ] && [ -n "$SAVE_PATH" ] && [ -z "$EXPECT_REJECT" ]; then
  SIZE_REPORTED="$(python3 -c "
import json,sys,re
d=json.load(open('$RESULTS/http-probe.json'))
m=re.search(r'\"size\":(\d+)', d.get('preview') or '')
print(m.group(1) if m else '')" 2>/dev/null)"
  SIZE_ON_DEVICE="$(HDC shell "stat -c %s '$FILES_DEV/$SAVE_PATH'" 2>/dev/null | tr -d ' \r\n')"
  if [ -z "$SIZE_ON_DEVICE" ]; then
    echo "  ✗ 设备上找不到落盘文件：$FILES_DEV/$SAVE_PATH"; RC=1
  elif [ "$SIZE_ON_DEVICE" != "$SIZE_REPORTED" ]; then
    echo "  ✗ 设备文件大小($SIZE_ON_DEVICE) != 回执 size($SIZE_REPORTED)——摘要不可信"; RC=1
  else
    echo "  ✓ 设备侧核对：$SAVE_PATH 真实存在且大小 = $SIZE_ON_DEVICE B（与回执一致）"
  fi
  # ★★★#1198（第五轮自查）：**把设备侧 stat 结果写进证据文件**，且**失败也要如实记**。
  #   上一轮我在校验**之前**就写 ⇒ `match:false` 的坏证据也会被写成一个正常字段，
  #   下游判据只看 `deviceStat` 存在就以为"验过了"。
  #   ⇒ 现在写全三态：`verified`（校验通过与否）+ `match` + 两个 size；判据要求 `verified:true`。
  python3 - "$RESULTS/http-probe.json" "$SIZE_ON_DEVICE" "$SIZE_REPORTED" "$RC" <<'PY'
import json, sys
p, on_dev, reported, rc = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
try:
    d = json.load(open(p))
except Exception:
    sys.exit(0)
d["deviceStat"] = {
    "sizeOnDevice": int(on_dev) if on_dev.isdigit() else None,
    "sizeReported": int(reported) if reported.isdigit() else None,
    "match": on_dev == reported,
    "verified": rc == "0",   # ★只有整条判据通过才算"已验证"
}
json.dump(d, open(p, "w"), ensure_ascii=False)
PY
fi
[ "$RC" = "0" ] && echo "  ✓ 鸿蒙 T-app-fetch 真机判据通过" || { echo "  ✗ 判据失败"; exit "$RC"; }
