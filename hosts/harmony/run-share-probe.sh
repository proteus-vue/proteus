#!/usr/bin/env bash
# hosts/harmony/run-share-probe.sh —— ★★★#1336 C22 `share` 鸿蒙真机判据
#
# 【本脚本验什么（与 iOS/Android 同一份语义）】
#   ① 合法载荷 ⇒ 宿主受理（回执 `{accepted:true}`；鸿蒙走**动作队列**，不是"面板已拉起"）；
#   ② **危险 URL scheme 必须被拒**（`file://` / `javascript:` / 自定义 scheme）——
#      分享会把链接递给别的应用，`file:` 等于泄漏本机私有路径；
#   ③ 空载荷被拒；④ 超长文本（> 8 KiB）被拒。
#
# 【★口径（诚实边界，别把它读成"更强"）】
#   鸿蒙的 `invokeBytes` 在**同步 napi** 内执行，而 `ShareController.show()` 是 Promise
#   ⇒ 本层只能证明「C++ 白名单校验 + 入队」，**不证明面板真的弹出**。
#   面板是否出现由 `PROTEUS_SHARE_OK/FAIL` 日志 + 设备截图补证（脚本末尾打印查看方式）。
#
# 【为什么直调 `share` 而不走 `useShare`】
#   走 Hook 时 JS 层 `assertShareOptions` 先拦 ⇒ 宿主层即使不校验也看不出来（假绿）。
#   这里**绕过 JS 层**直打 `share`，专验宿主那一层白名单。
#   JS 层由 `tests/capability-app-share.test.ts`（9 条）+ iOS 真机 10/10（含 Hook 链）覆盖。
#
# 用法：bash hosts/harmony/run-share-probe.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 一条 case = 一次能力直通调用；回执是 `run-http-probe.sh` 打印的「能力直通回执：<json>」
# ★args 里的符号由 run-http-probe.sh 负责 base64url 编码（#1187/#1202/#1210 的三次教训）。
PASS=0
TOTAL=0
FAILED=0

# run_case <名称> <args-json> <expect: accepted|rejected> [panel]
#   ★第 4 参 `panel`：受理后**立即**查设备日志证明面板真的拉起。
#     必须在**本例刚跑完时**查——下一个 run-http-probe.sh 会 `hilog -r` 清掉本轮日志
#     （首版把这条放在全部用例之后 ⇒ 永远查不到，是**装置缺陷**不是能力缺陷）。
run_case() {
  local name="$1" args="$2" expect="$3" panel_check="${4:-}" out line
  TOTAL=$((TOTAL + 1))
  out="$(bash "$HERE/run-http-probe.sh" --cap-method=share --cap-args="$args" 2>&1)"
  line="$(printf '%s\n' "$out" | grep '能力直通回执' | tail -1)"
  if [ -z "$line" ]; then
    echo "  ❌ ${name}：无回执（可能装机/启动失败）"
    printf '%s\n' "$out" | tail -6 | sed 's/^/      /'
    FAILED=1
    return
  fi
  local verdict
  verdict="$(printf '%s' "$line" | sed 's/.*能力直通回执：//' | python3 -c '
import json, sys
raw = sys.stdin.read().strip()
try:
    d = json.loads(raw)
except Exception:
    print("bad-json"); raise SystemExit
if d.get("ok") is True and (d.get("data") or {}).get("accepted") is True:
    print("accepted")
elif d.get("ok") is False:
    print("rejected:" + str(d.get("reason") or "")[:80])
else:
    print("other:" + raw[:80])
')"
  case "$expect:$verdict" in
    accepted:accepted)
      echo "  ✅ ${name}：宿主受理（accepted）"; PASS=$((PASS + 1))
      # ★反假绿：受理回执只说明**入队**；必须有设备日志证明 ArkTS 真的执行了。
      if [ "$panel_check" = "panel" ]; then
        TOTAL=$((TOTAL + 1))
        local lg
        lg="$(bash "$HERE/hdc.sh" shell "hilog -x | grep -E 'PROTEUS_SHARE_(OK|FAIL|THROW)' | tail -5" 2>&1)"
        if printf '%s' "$lg" | grep -q 'PROTEUS_SHARE_OK'; then
          echo "    ✅ 设备日志见 PROTEUS_SHARE_OK（系统分享面板已拉起）"; PASS=$((PASS + 1))
        elif printf '%s' "$lg" | grep -qE 'PROTEUS_SHARE_(FAIL|THROW)'; then
          echo "    ❌ 设备日志报错（面板未拉起）："; printf '%s\n' "$lg" | tail -3 | sed 's/^/        /'; FAILED=1
        else
          echo "    ❌ 无 PROTEUS_SHARE_* 日志 —— 无法证明面板拉起（回执只是'已入队'）"; FAILED=1
        fi
      fi
      ;;
    rejected:rejected:*) echo "  ✅ ${name}：被拒（${verdict#rejected:}）"; PASS=$((PASS + 1)) ;;
    *) echo "  ❌ ${name}：期望 ${expect}，实得 ${verdict}"; FAILED=1 ;;
  esac
}

echo "==> 鸿蒙 share 真机判据（#1336 · 宿主层白名单 + 入队）"
echo

echo "── ① 合法载荷（应受理；★首条兼查设备日志证明面板真的拉起）"
run_case "纯文本"            '{"text":"Proteus share probe (#1336)"}' accepted panel
run_case "标题+文本+链接"    '{"title":"Proteus","text":"分享一条链接","url":"https://proteus.dev/"}' accepted
run_case "仅标题"            '{"title":"只有标题"}' accepted

echo
echo "── ② 危险 URL scheme（必须被拒）"
run_case "file:// （本机路径泄漏）" '{"url":"file:///etc/passwd"}' rejected
run_case "javascript: （可执行语义）" '{"url":"javascript:alert(1)"}' rejected
run_case "自定义 scheme myapp://"    '{"url":"myapp://deep/link"}' rejected
run_case "无 scheme 的相对地址"      '{"url":"example.com/path"}' rejected

echo
echo "── ③ 其它非法输入（必须被拒）"
run_case "空载荷 {}"                 '{}' rejected
run_case "只有空白标题"              '{"title":"   "}' rejected
run_case "超长文本（9000 字符）"     "{\"text\":\"$(printf 'x%.0s' $(seq 1 9000))\"}" rejected

echo
echo "── ④ 反假绿说明"
echo '  ★面板是否真的拉起，已在第 ① 条用例跑完时**立即**用设备日志断言（run_case 的第 4 参 panel）。'
echo '    为什么不在末尾统一查：每个 run-http-probe.sh 开头都会 hilog -r 清日志，'
echo '    最后一条是「被拒」用例（没有分享动作）⇒ 末尾查必然查不到。首版就是栽在这里（装置缺陷）。'
echo '  ★仍不证明：用户选了某个目标并发送成功（那属系统 UI 内的行为）。'

echo
echo "════════ ${PASS}/${TOTAL} 通过 ════════"
if [ "$FAILED" = "0" ]; then
  echo "⚠ 判据口径：①②③ 验**宿主白名单**（直调路由，绕过 JS 层）；④ 验**面板真的拉起**（设备日志）。"
  echo "  仍不证明：用户选了某个目标并发送成功（那属系统 UI 内的行为）。"
fi
exit "$FAILED"
