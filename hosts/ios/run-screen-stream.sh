#!/usr/bin/env bash
# hosts/ios/run-screen-stream.sh —— ★★★Studio G3：iOS 真机画面 → Mac（决策 #1190）
#
# 【一条命令跑完的事】
#   ① 本机起 TCP 接收器（`packages/studio/scripts/recv-h264.py`）
#   ② 编译 + 安装 + 启动宿主（`run-selfdraw.sh --stream=<本机IP>:<port>`，App 常驻不发报告）
#   ③ 收 N 秒字节 → 落 `results/screen-stream.h264` → `ffprobe` 判「是不是合法 H.264」
#   ④ 打印结论（帧数/分辨率/码率），非 0 退出 = 真没收到
#
# 【为什么必须由**你**在自己的终端跑（不能由 AI 代跑）】
#   安装到真机要 `codesign` 访问 **login 钥匙串**。AI 执行环境有沙箱，实测被拦：
#     `[sandbox] 命令被沙箱拦截：login.keychain-db (file-write)`
#   ⇒ 脚本本身没问题，是"签名写钥匙串"这件事只能在你的交互式终端里做。
#
# 【★手机会弹授权窗】首次运行会弹「Proteus… 想要录制您的屏幕」——**必须点「允许」**。
#   不点 ⇒ 接收器收到 0 字节（脚本会明确报"0 帧"，不会假装成功）。
#
# 用法：
#   bash hosts/ios/run-screen-stream.sh                 # 自动探测本机 IP · 9001 · 30s
#   bash hosts/ios/run-screen-stream.sh --seconds 60
#   bash hosts/ios/run-screen-stream.sh --mac 192.168.1.124 --port 9100
#   bash hosts/ios/run-screen-stream.sh --skip-install  # 已装过本轮二进制，只重收（快）
#
# 【之后的两种接法】
#   · 直接用 Studio：`PROTEUS_IOS_STREAM_PORT=9001 ./target/release/proteus-studio-shell`
#     （`default_live_source()` 在没有 Android 设备时会自动 `/usr/bin/nc -l 9001`）
#   · 手动看：`nc -l 9001 | ffplay -f h264 -`
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
PORT=9001
SECONDS_ARG=10
MAC=""
SKIP_INSTALL=0
OUT=""

for a in "$@"; do
  case "$a" in
    --port=*) PORT="${a#--port=}" ;;
    --port) shift ;;
    --seconds=*) SECONDS_ARG="${a#--seconds=}" ;;
    --mac=*) MAC="${a#--mac=}" ;;
    --skip-install) SKIP_INSTALL=1 ;;
    --out=*) OUT="${a#--out=}" ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
  esac
done
# `--port 9100` / `--seconds 60` / `--mac 1.2.3.4` 的空格形态（简单两参处理）
prev=""
for a in "$@"; do
  case "$prev" in
    --port) PORT="$a" ;;
    --seconds) SECONDS_ARG="$a" ;;
    --mac) MAC="$a" ;;
  esac
  prev="$a"
done

if [ -z "$MAC" ]; then
  MAC="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
fi
[ -n "$MAC" ] || { echo "✗ 探测不到本机局域网 IP —— 用 --mac <ip> 指定（iPhone 必须能连到它）"; exit 2; }

RECV="$ROOT/packages/studio/scripts/recv-h264.py"
# ★默认落 /tmp：10s @ 8Mbps ≈ 10MB，放进 `results/` 会被入库（本仓 `hosts/*/results` 是**跟踪**的）。
#   要留证据请显式 `--out=hosts/ios/results/screen-stream.h264`，并自己确认体积值得入库。
OUT="${OUT:-/tmp/proteus-ios-stream.h264}"
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"

# ★★`$VAR` 后面一律写 `${VAR}`：macOS 自带 bash 3.2 在**非 UTF-8 locale** 下会把全角字符的
#   首字节吞进变量名（本仓已踩过多次，`run-selfdraw.sh` 文件头也写着这条）。实测报错：
#   `PORT<byte>: unbound variable` —— 就是 `$PORT` 后面直接跟全角左括号那一处。
echo "==> 目标：iPhone → ${MAC}:${PORT}（${SECONDS_ARG}s）"
echo "==> ① 起接收器（先无限等：安装/授权要几分钟，不能按秒数提前超时）"
# ★★端口预检（用户实测踩到）：上一轮的接收器是 `--seconds 0` 无限等，若没被 kill 掉就会占着端口
#   ⇒ 新接收器 `bind` 抛 `OSError: [Errno 48] Address already in use` 当场退出，
#   而脚本继续往下跑，最后报"0 字节"——把「端口被占」误诊成「手机没推流」。
# ★`|| true` 不能省：lsof 无匹配时返回 1，而 `VAR="$(cmd)"` 的退出码会传给赋值语句
#   ⇒ `set -e` 下脚本**静默退出**（实测：无占用时脚本只打印前两行就没了，退出码 1）。
OCCUPIED="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | awk 'NR==2{print $1" pid="$2}' || true)"
if [ -n "$OCCUPIED" ]; then
  echo "✗ 端口 ${PORT} 已被占用（${OCCUPIED}）—— 多半是上一轮接收器没退"
  echo "    清理：kill $(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | tr '\n' ' ')"
  echo "    换口：$0 --port=$((PORT + 1))   ★手机侧 --stream 的端口也要同步改"
  exit 4
fi
# ★★接收器**不能**用固定时限：编译+安装+用户在手机上点「允许」可能好几分钟，
#   固定 N 秒的窗口会在 App 起来之前就到期 ⇒ 收到 0 字节，而根因是"等太短"（假失败）。
#   ⇒ 先无限等，安装完再按 `--seconds` 采集，然后显式 kill。
python3 "$RECV" --port "$PORT" --seconds 0 --out "$OUT" > "$HERE/results/screen-stream.recv.log" 2>&1 &
RECV_PID=$!
# ★不 sleep 盲等：轮询"端口已在监听"这个**事实**（最多 5s）
#   ★用 lsof 判监听而**不是** `nc -z`——后者会真的建一次连接，接收器的统计里会多一个空连接
for _ in $(seq 1 50); do
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then break; fi
  sleep 0.1
done
# ★启动后确认进程还活着（bind 失败 / 参数错会立刻退出）——否则后面的"0 字节"是假结论
if ! kill -0 "$RECV_PID" 2>/dev/null; then
  echo "✗ 接收器启动即退出，原因："
  tail -6 "$HERE/results/screen-stream.recv.log" | sed 's/^/    /'
  exit 4
fi

if [ "$SKIP_INSTALL" = "0" ]; then
  echo "==> ② 编译 + 安装 + 启动宿主（★手机弹「录制屏幕」时请点【允许】）"
  bash "$HERE/run-selfdraw.sh" --stream="$MAC:$PORT" | sed 's/^/    /'
else
  echo "==> ② 跳过安装（--skip-install）"
  echo "    ★前提：宿主**此刻正在手机上跑**，且是带 PROTEUS_SCREEN_STREAM 启动的。"
  echo "      只是「装过」不够（App 退出即断流；--skip-install 不会替你启动它）。"
fi

echo "==> ③ 采集 ${SECONDS_ARG}s"
# ★「让画面动」是**在 ProteusHost 这个 App 里**动（滑动/切页），不是滑桌面：
#   iOS 用的是 **App 内 ReplayKit**，只录本 App 窗口；滑桌面、切到别的 App 都录不到。
#   另外 iOS 的 ReplayKit 是**持续采样**（不像 Android screenrecord 静止就几乎不出帧），
#   所以静止也能收到帧；动起来只是为了确认"是实时的、不是卡住的最后一帧"。
echo "    ★请在手机的 ProteusHost 里滑动/切页（不是滑桌面）"
# 这里的 sleep 是**度量窗口**（要收多久），不是"等某个状态"——不违反本仓的 no-blind-wait 纪律。
sleep "$SECONDS_ARG"
kill -TERM "$RECV_PID" 2>/dev/null || true
wait "$RECV_PID" 2>/dev/null || true
cat "$HERE/results/screen-stream.recv.log" | sed 's/^/    /'

BYTES=0
[ -f "$OUT" ] && BYTES="$(wc -c < "$OUT" | tr -d ' ')"
echo "==> ④ 判据"
if [ "${BYTES:-0}" -lt 1000 ]; then
  echo "✗ 只收到 ${BYTES} 字节 —— 按可能性从高到低："
  echo "    a) **宿主没在跑**（--skip-install 时最常见：装了但没启动，或者上次已退出）"
  echo "       ⇒ 去掉 --skip-install 重跑（会重新编译安装并启动），或先在手机上点开 App"
  echo "    b) 手机上没点「允许录制屏幕」（首次必弹；拒绝后不再弹，需 设置→隐私→屏幕录制 里打开）"
  echo "    c) iPhone 连不到 ${MAC}:${PORT}（不同 Wi-Fi / 路由器开了 AP 隔离）"
  echo "    d) 宿主不是本轮二进制（没带 PROTEUS_SCREEN_STREAM）—— 去掉 --skip-install 重跑"
  exit 1
fi
PROBE="$(ffprobe -v error -show_entries stream=codec_name,width,height -count_frames -show_entries stream=nb_read_frames -of default=nw=1 "$OUT" 2>&1 || true)"
echo "$PROBE" | sed 's/^/    /'
if echo "$PROBE" | grep -q "codec_name=h264"; then
  W="$(echo "$PROBE" | sed -n 's/^width=//p')"
  H="$(echo "$PROBE" | sed -n 's/^height=//p')"
  F="$(echo "$PROBE" | sed -n 's/^nb_read_frames=//p')"
  echo "✅ 合法 H.264：${W}x${H} · ${F} 帧 · $(awk -v b="$BYTES" 'BEGIN{printf "%.2f", b/1048576}') MB"
  echo "    样本：${OUT}（默认 /tmp，不入库）"
  echo "    接 Studio：PROTEUS_IOS_STREAM_PORT=$PORT ./packages/studio/target/release/proteus-studio-shell"
  exit 0
fi
echo "✗ 字节收到了但 ffprobe 不认为是 H.264（编码器输出格式可能不对——看 screen-stream.swift 的 [stream] 日志）"
exit 1
