#!/usr/bin/env bash
# hosts/harmony/run-document-probe.sh —— ★★★#1384 C84 `openDocument` 鸿蒙真机判据
#
# 【本脚本验什么（与 iOS/Android 同一份语义）】
#   ① 沙箱内合法 PDF ⇒ 宿主受理（回执 `{accepted:true}`；鸿蒙走**动作队列**，不是"预览器已拉起"）；
#   ② **越界路径必须被拒**（绝对路径 / `..`）——安全边界；
#   ③ **非白名单扩展名必须被拒**（`.exe`，不降级 octet-stream）；
#   ④ 沙箱内不存在的文件 ⇒ 被拒（宿主层不做存在性检查，这一条由 ArkTS 侧 `canPreview` 兜——
#      见下方「诚实边界」，本脚本对它**如实标注**而不是当成"已验"）。
#
# 【★口径（诚实边界，别把它读成"更强"）】
#   鸿蒙的 `invokeBytes` 在**同步 napi** 内执行，而 `filePreview.openPreview()` 是 Promise
#   ⇒ 本层只能证明「C++ 白名单校验 + 入队」。**预览器是否真的弹出**由
#   `PROTEUS_DOC_PREVIEW_OK/FAIL/UNSUPPORTED` 设备日志补证（脚本末尾给查看方式）。
#   ★这与 #1336 的 share 探针同一形态；区别是本能力的"缺失文件"用例的**归因**：
#     C++ 层不做存在性检查（没有沙箱上下文），所以 `not-there.pdf` 会**受理并入队**，
#     失败发生在 ArkTS 的 `canPreview`/`openPreview` ⇒ 判据查 `PROTEUS_DOC_PREVIEW_*` 日志，
#     而不是期待"回执被拒"。这条差异是设计选择，写在 `proteus_document.h` 头注释的诚实边界里。
#
# 【为什么直调 `document.open` 而不走 `useOpenDocument`】
#   走 Hook 时 JS 层 `assertDocumentRequest` 先拦 ⇒ 宿主层即使不校验也看不出来（假绿）。
#   这里**绕过 JS 层**直打宿主，专验宿主那一层白名单。
#   JS 层由 `tests/capability-app-document.test.ts`（11 条）+ iOS 真机（含 Hook 链）覆盖。
#
# 用法：bash hosts/harmony/run-document-probe.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PASS=0
TOTAL=0
FAILED=0

# run_case <名称> <args-json> <expect: accepted|rejected>
#   ★args 里的符号由 run-http-probe.sh 负责 base64url 编码（#1187/#1202/#1210 的三次教训）。
run_case() {
  local name="$1" args="$2" expect="$3" out line verdict
  TOTAL=$((TOTAL + 1))
  out="$(bash "$HERE/run-http-probe.sh" --cap-method=document.open --cap-args="$args" 2>&1)"
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
if d.get("ok") is True and (d.get("data") or {}).get("accepted") is True:
    print("accepted")
elif d.get("ok") is False:
    print("rejected:" + str(d.get("reason") or "")[:90])
else:
    print("other:" + raw[:90])
')"
  case "$expect:$verdict" in
    accepted:accepted) echo "  ✅ ${name}：宿主受理（accepted）"; PASS=$((PASS + 1)) ;;
    rejected:rejected:*) echo "  ✅ ${name}：被拒（${verdict#rejected:}）"; PASS=$((PASS + 1)) ;;
    *) echo "  ❌ ${name}：期望 ${expect}，实得 ${verdict}"; FAILED=1 ;;
  esac
}

echo "==> 鸿蒙 document.open 真机判据（#1384 · 宿主层白名单 + 入队）"
echo

echo "── ① 合法载荷（应受理：沙箱内 PDF）"
# ★★先造夹具：本脚本不推文件（非 root 写不进 App 私有沙箱）⇒ 用宿主自己的 `fs.writeBytes`。
#   最小 PDF：`%PDF-1.4\n%%EOF\n`（PreviewKit 靠扩展名+系统预览器解析，不要求结构完整）。
TOTAL=$((TOTAL + 1))
FIX_OUT="$(bash "$HERE/run-http-probe.sh" --cap-method=fs.writeBytes \
  --cap-args='{"path":"__DOC_PROBE__/sample.pdf","bytes":[37,80,68,70,45,49,46,52,10,37,37,69,79,70,10]}' 2>&1)"
if printf '%s' "$FIX_OUT" | grep '能力直通回执' | grep -q '"ok":true'; then
  echo "  ✅ 夹具写入（fs.writeBytes → __DOC_PROBE__/sample.pdf）"; PASS=$((PASS + 1))
else
  echo "  ❌ 夹具写入失败："; printf '%s\n' "$FIX_OUT" | tail -5 | sed 's/^/      /'; FAILED=1
fi
# ★★首条兼查设备日志：证明 ArkTS 真的执行了（回执只是"已入队"）
run_case "沙箱内 PDF" '{"path":"__DOC_PROBE__/sample.pdf","mimeType":"application/pdf","title":"sample"}' accepted
TOTAL=$((TOTAL + 1))
LG="$(bash "$HERE/hdc.sh" shell "hilog -x | grep -E 'PROTEUS_DOC_PREVIEW_(OK|FAIL|UNSUPPORTED|URI_FAIL|THROW)' | tail -6" 2>&1)"
if printf '%s' "$LG" | grep -q 'PROTEUS_DOC_PREVIEW_OK'; then
  echo "    ✅ 设备日志见 PROTEUS_DOC_PREVIEW_OK（系统预览器已拉起）"; PASS=$((PASS + 1))
elif printf '%s' "$LG" | grep -qE 'PROTEUS_DOC_PREVIEW_(FAIL|UNSUPPORTED|URI_FAIL|THROW)'; then
  echo "    ❌ 设备日志报错（预览器未拉起）："; printf '%s\n' "$LG" | tail -3 | sed 's/^/        /'; FAILED=1
else
  # ★这条最容易被当成"能力没做"：先看 hilog 配额是否被打满（#1344 的 LOGLIMIT 教训）
  echo "    ⚠ 无 PROTEUS_DOC_PREVIEW_* 日志 —— 无法证明预览器拉起（回执只是'已入队'）"
  echo "      排查顺序：① 该文件是否真在沙箱（本脚本不推文件，需先跑一次写夹具）"
  echo "               ② hilog 配额是否被打满（hilog -r 后重跑）"
  echo "               ③ ArkTS 侧 drainDeviceActions 是否被调用（探针场景不渲染 ⇒ 见 HttpProbe.ets 头注释）"
  FAILED=1
fi

echo
echo "── ② 越界路径（必须被拒）"
run_case "绝对路径 /etc/passwd.pdf" '{"path":"/etc/passwd.pdf","mimeType":"application/pdf"}' rejected
run_case "目录穿越 ../escape.pdf"    '{"path":"../escape.pdf","mimeType":"application/pdf"}' rejected
run_case "中间穿越 a/../../b.pdf"    '{"path":"a/../../b.pdf","mimeType":"application/pdf"}' rejected

echo
echo "── ③ 非白名单扩展名（必须被拒，不降级 octet-stream）"
run_case ".exe"        '{"path":"__DOC_PROBE__/evil.exe","mimeType":"application/pdf"}' rejected
run_case ".html"       '{"path":"__DOC_PROBE__/x.html","mimeType":"text/html"}' rejected
run_case "无扩展名"     '{"path":"__DOC_PROBE__/README"}' rejected

echo
echo "── ④ 路径形态非法（必须被拒）"
run_case "空 path"      '{"path":""}' rejected
run_case "只有空白"     '{"path":"   "}' rejected

echo
echo "── ⑤ 诚实边界（本条**不断言**，只打印实得值）"
echo '  ★「沙箱内不存在的文件」：C++ 层没有沙箱上下文，不做存在性检查 ⇒ 它会**受理并入队**，'
echo '    失败发生在 ArkTS 的 canPreview/openPreview。因此本条不进判据（进就是假红/假绿）。'
echo '    真机取证方式：hilog 里应见 PROTEUS_DOC_PREVIEW_UNSUPPORTED 或 FAIL（而不是 OK）。'

echo
echo "════════ ${PASS}/${TOTAL} 通过 ════════"
if [ "$FAILED" = "0" ]; then
  echo "⚠ 判据口径：①②③④ 验**宿主白名单 + 入队**（直调路由，绕过 JS 层）；① 另附**设备日志**证明预览器真拉起。"
  echo "  仍不证明：用户真的看了文档（QuickLook/PreviewKit 都没有「看完」回调）。"
fi
exit "$FAILED"
