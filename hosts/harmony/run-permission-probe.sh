#!/usr/bin/env bash
# hosts/harmony/run-permission-probe.sh —— ★★★C16 `permission.check` 鸿蒙真机判据
#
# 【本脚本验什么（与 Android/iOS 同一份语义）】
#   ① 三个 scope（camera / microphone / geolocation）都查得回来，且是**两态之一**
#      （`granted` / `denied`，**永不返回 prompt**——鸿蒙分不出"未询问"，见 proteus_device.h 注释）；
#   ② 回执带 `declared` 位；
#   ③ 未知 scope / 缺 scope ⇒ **宿主拒绝**（不是回 denied）；
#   ④ 可用性探测（`{probe:true}`）回 ok。
#
# 【★为什么直调 `permission.check` 而不走 `usePermission`】
#   走 Hook 时 JS 层 `normalizePermissionScope` 先拦 ⇒ 宿主层即使不校验也看不出来（假绿）。
#   这里**绕过 JS 层**直打宿主，专验宿主那一层。JS 层由
#   `tests/capability-app-permission.test.ts`（8 条）+ iOS 真机（含 Hook 链）覆盖。
#
# 【★★鸿蒙的特殊口径（必须写在前面，否则会被误读成"更强"）】
#   鸿蒙的 `invokeBytes` 在**同步 napi** 内执行，`abilityAccessCtrl` 的查询需要 ArkTS 的
#   `context` / `accessTokenId` ⇒ 本能力走**快照**：值由 ArkTS 在**渲染前**采集
#   （`DeviceSnapshot.ets::collectPermissionSnapshot`），C++ 侧只读快照。
#   ⇒ 本层证明「C++ 分派 + 快照读数正确映射」，**不证明"查询瞬间"的实时性**
#     （延迟上界 = 一次渲染间隔，与设备域其它快照项同一诚实边界）。
#   ★★「查不了」≠「没授权」：快照缺字段时宿主回 `missing`（JS 层报 unsupported），
#     不伪造成 denied——本脚本专门验这一条（`permission.check` 在快照未注入时的分档）。
#
# 【不证明什么】不证明授权态会随系统设置翻转——鸿蒙没有 `pm grant/revoke` 等价命令，
#   需人工在系统设置里改；Android 侧已用 `pm grant/revoke` 做了翻转取证（见
#   `hosts/android/run-permission-probe.sh` ⑤）。
#
# 用法：bash hosts/harmony/run-permission-probe.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PASS=0
TOTAL=0
FAILED=0

# run_case <名称> <args-json> <expect: ok|rejected>
#   ★args 由 run-http-probe.sh 负责 base64url 编码（#1187/#1202/#1210 的三次教训）
run_case() {
  local name="$1" args="$2" expect="$3" out line verdict
  TOTAL=$((TOTAL + 1))
  out="$(bash "$HERE/run-http-probe.sh" --cap-method=permission.check --cap-args="$args" 2>&1)"
  line="$(printf '%s\n' "$out" | grep '能力直通回执' | tail -1)"
  if [ -z "$line" ]; then
    echo "  ❌ ${name}：无回执（可能装机/启动失败）"
    printf '%s\n' "$out" | tail -6 | sed 's/^/      /'
    FAILED=1
    return
  fi
  verdict="$(printf '%s' "$line" | sed 's/.*能力直通回执：//' | python3 -c '
import json, sys
raw = sys.stdin.read().strip()
try:
    d = json.loads(raw)
except Exception:
    print("bad-json"); raise SystemExit
data = d.get("data") or {}
if d.get("ok") is True and data.get("state") in ("granted", "denied"):
    print("ok:" + data.get("state"))
elif d.get("ok") is True:
    print("ok-other:" + json.dumps(data)[:90])
elif d.get("ok") is False:
    print("rejected:" + str(d.get("reason") or "")[:90])
else:
    print("other:" + raw[:90])
')"
  case "$expect" in
    ok)
      case "$verdict" in
        ok:*) echo "  ✅ ${name}：${verdict}"; PASS=$((PASS + 1)) ;;
        *) echo "  ❌ ${name}：期望 ok，实得 ${verdict}"; FAILED=1 ;;
      esac ;;
    rejected)
      case "$verdict" in
        rejected:*) echo "  ✅ ${name}：被拒（$(printf '%s' "$verdict" | cut -c10-)）"; PASS=$((PASS + 1)) ;;
        *) echo "  ❌ ${name}：期望被拒，实得 ${verdict}"; FAILED=1 ;;
      esac ;;
  esac
}

echo "==> ① 可用性探测"
run_case 'probe（appPermissionAvailable 依赖）' '{"probe":true}' ok

echo "==> ② 三个 scope"
run_case 'camera' '{"scope":"camera"}' ok
run_case 'microphone' '{"scope":"microphone"}' ok
run_case 'geolocation' '{"scope":"geolocation"}' ok

echo "==> ③ 拒绝路径（宿主必须自己拒，不是回 denied）"
run_case '未知 scope notifications' '{"scope":"notifications"}' rejected
run_case '未知 scope bluetooth' '{"scope":"bluetooth"}' rejected
run_case '缺 scope' '{}' rejected

echo ""
echo "==> ④ 判定"
if [ "$FAILED" -ne 0 ]; then
  echo "❌ ${PASS}/${TOTAL} 通过"
  echo "   排查：bash hosts/harmony/hdc.sh shell \"hilog -x | grep PROTEUS_\" | tail -20"
  exit 1
fi
echo "✅ 全部 ${TOTAL} 条通过"
echo ""
echo "★诚实边界：本层证明「C++ 分派 + 快照读数映射」正确，不证明查询瞬间的实时性"
echo "  （延迟上界 = 一次渲染间隔，见 proteus_device.h 的 permission.check 注释）。"
echo "★授权态翻转未验：鸿蒙无 pm grant/revoke 等价命令（Android 侧已验，见 run-permission-probe.sh）。"
