#!/usr/bin/env bash
# hosts/ios/lib/probe-args.sh —— ★★★#1149：**iOS 真机探针参数的表驱动实现**（单一事实来源）
#
# 【为什么必须抽出来（不是"为过 1000 行门禁"）】
#
#   `run-selfdraw.sh` 在 #1134 与 #1149 各踩了同一类坑：给 iOS 加一个新探针要改**三处**
#   （解析分支 / `case "$PN"` 赋值 / 转发清单 + `ANY_PROBE`），漏一处就静默失效：
#     · 漏「解析分支」⇒ 参数被当成设备 UDID ⇒ 安装失败（#1149 现场表现：报"安装失败"但原因被 grep 吞掉）
#     · 漏「case」	   ⇒ 变量恒空 ⇒ 参数不转发 ⇒ App 走常驻模式、**报告永远是旧的**
#     · 漏「转发/ANY_PROBE」⇒ 探针不阻塞等报告，或根本收不到
#   `tests/host-probe-registry.test.ts` 能核对这三处同集，但**它只能核对，不能消除**——
#   核对通过也只是"三处都写对了"，下次加探针照样要记得写三处。
#
#   ⇒ 本文件把三处合并成**一张表** `IOS_PROBES`（`VAR 名:probe 名`），
#     解析与转发都由它派生。**新增探针只改这一行**（外加 Swift 侧 `ProbeConfig`，
#     那一处由判据交叉核对）。
#
# 【用法（在 run-selfdraw.sh 里）】
#   source "$HERE/lib/probe-args.sh"
#   case "$a" in
#     ...
#     --*probe=*) ios_probe_parse_arg "$a" ;;    # 表内命中 ⇒ 赋值；表外 ⇒ 退化为普通参数
#     ...
#   esac
#   ...
#   ios_probe_forward_args             # 把已设置的表内变量拼成 --xxx-probe=... 追加进 SA_ARGS
#   ANY_PROBE="$IOS_PROBE_ANY"         # 有任一探针 ⇒ 用 --console 阻塞到报告落盘自退
#
# 【诚实边界】表里**只登记"宿主会认的参数名"**；JS 探针函数名与结果键由 Swift 侧
#   `ProbeConfig` 决定（两处必须同集，判据 `tests/host-probe-registry.test.ts` 守着）。

# ── 探针表（★唯一维护点）：`变量名:probe 名` ──
#   · 变量名 = 本脚本里保存参数串的 shell 变量（解析时赋值、转发时读取）
#   · probe 名 = 命令行 `--<probe 名>=<参数>` 与 Swift `ProbeConfig.argPrefix` 的公共前缀
# ★顺序即转发顺序（与既有行为一致，勿随意调换）
IOS_PROBES=(
  "FETCH_LIMIT_ARG:fetch-limit-probe"   # #1115 响应体上限
  "STREAM_PROBE_ARG:stream-probe"       # #1118 流式通道
  "UPLOAD_PROBE_ARG:upload-probe"       # #1120 流式上传
  "CANCEL_PROBE_ARG:cancel-probe"       # #1121 取消
  "USEFETCH_PROBE_ARG:usefetch-probe"   # #1126 useFetch 门面
  "REDIRECT_PROBE_ARG:redirect-probe"   # #1134 重定向拦截
  "CACHE_PROBE_ARG:cache-probe"         # #1149 HTTP 条件请求缓存
  "STALE_PROBE_ARG:stale-probe"         # #1150 RFC 5861（SWR / SIE）
  "PERSIST_PROBE_ARG:persist-probe"     # #1151 缓存持久层（两阶段：write,read）
  "TLS_PROBE_ARG:tls-probe"             # #1153 TLS pinning（自签 HTTPS 双服务）
  "TRANSPORT_PROBE_ARG:transport-probe" # #1155 传输层事实取证（HTTP/2 + 连接复用）
  "HTTPDNS_B_PROBE_ARG:httpdns-b-probe" # #1179 iOS B 路线（本地 CONNECT 代理）真机判据
  "HTTPDNS_PROD_PROBE_ARG:httpdns-prod-probe" # #1180 HTTPDNS 生产面（useFetch({httpDns}) 走本地代理）
  "WORKER_BOUND_PROBE_ARG:worker-bound-probe" # #1251 worker 数上界（第 16 成 / 第 17 拒）
  "PHONE_PROBE_ARG:phone-probe"         # #1285 C21 拨号盘（合法受理 / 非法号码被拒）
  "SHARE_PROBE_ARG:share-probe"         # #1336 C22 分享面板（合法受理 / 危险 scheme 被拒）
)

# 所有探针参数都设置过之后，是否有**任一**非空（决定是否 `--console` 阻塞等报告）
IOS_PROBE_ANY=""

# 探针名是否在表内（大小写敏感——参数名全小写连字符）
ios_probe_known() {
  local want="$1" entry
  for entry in "${IOS_PROBES[@]}"; do
    [ "${entry#*:}" = "$want" ] && return 0
  done
  return 1
}

# 解析一个 `--<probe>=<value>` 参数：命中表则给对应变量赋值并返回 0，否则返回 1。
# ★调用方（run-selfdraw.sh 的 `case`）不需要知道有哪些探针，也不需要维护清单。
ios_probe_parse_arg() {
  local arg="$1" name value entry var
  [ "${arg#--}" != "$arg" ] || return 1
  name="${arg#--}"
  name="${name%%=*}"
  # ★★★必须按**第一个** `=` 切值（不能写 `${arg##*=}` 取"最后一个 ="之后的部分"）。
  #   真机实测：#1153 的 `--tls-probe=<baseA>,<baseB>,<pinA>,<pinB>` 里 pin 是 base64，
  #   **末尾带 `=` 填充** ⇒ `${arg##*=}` 取到的是**空串** ⇒ 整个探针参数被吞
  #   ⇒ App 走常驻模式、报告永不落盘（现象是"报告未取回"，与 #1134 的形态同族）。
  value="${arg#*=}"
  for entry in "${IOS_PROBES[@]}"; do
    var="${entry%%:*}"
    if [ "${entry#*:}" = "$name" ]; then
      printf -v "$var" '%s' "$value"
      IOS_PROBE_ANY="$IOS_PROBE_ANY$value"
      return 0
    fi
  done
  return 1
}

# 把已设置的表内变量拼成 `--probe=value` 追加进调用方传入的数组名，并刷新 IOS_PROBE_ANY。
#   用法：`ios_probe_forward_args SA_ARGS`
ios_probe_forward_args() {
  local arrayName="$1" entry var value
  IOS_PROBE_ANY=""
  for entry in "${IOS_PROBES[@]}"; do
    var="${entry%%:*}"
    value="${!var:-}"
    # ★用 eval 对调用方数组做 append：bash 3.2（macOS 自带）不支持 nameref（declare -n）
    if [ -n "$value" ]; then
      eval "$arrayName+=(\"--${entry#*:}=${value}\")"
      IOS_PROBE_ANY="$IOS_PROBE_ANY$value"
    fi
  done
}
