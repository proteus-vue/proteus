#!/usr/bin/env python3
"""hosts/android/embed-demo/check-embed-demo.py —— ★HA5 嵌入 demo 的判据（客户视角）

【为什么这批判据与其它宿主判据**不同**】其它判据验的是"引擎行为对不对"；
  本批验的是"**客户拿 AAR 能不能用**"——即 ABI 对第三方是否真的够用：
   ① 建引擎成功（宿主回调齐全 ⇒ 引擎接受这个宿主）
   ② **度量回调真的被引擎调用**（`measure_calls ≥ 1`）——"我们说引擎会调"不算证据
   ③ **能力校验两侧都对**：满足 ⇒ OK；缺失 ⇒ **明确错误码**（不是静默通过）
   ④ **批处理红线**：一帧两条指令 ⇒ `submit_frame_calls == 1`
   ⑤ 几何/更新真的产出了（客户能画出东西）
   ⑥ 输入可用（tap 返回命中 id 或 0）
   ⑦ **界面没崩**（`last_error` 为空）

用法：python3 hosts/android/embed-demo/check-embed-demo.py <embed-demo.json>
退出码：0 全过 / 1 有失败 / 0（产物缺失时诚实跳过）
"""
import json
import os
import sys


def fail(msg):
    print(f"  ✗ {msg}")


def main() -> int:
    if len(sys.argv) < 2:
        print("用法：python3 hosts/android/embed-demo/check-embed-demo.py <embed-demo.json>")
        return 2
    path = sys.argv[1]
    if not os.path.exists(path):
        print(f"⚠ 嵌入 demo 判据：未找到报告（{path}）")
        print("  ⇒ 诚实跳过：先跑 `bash hosts/android/embed-demo/build.sh`")
        return 0

    print(f"═══ HA5 嵌入 demo 判据（客户视角 · 只用 AAR）：{path} ═══")
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except Exception as e:
        fail(f"报告读不出（文件存在但解析失败）：{e}")
        return 1

    ok = True

    # ⑦ 先判"没崩"——后面的读数才有意义
    if not d.get("ok"):
        fail(f"demo 未成功：{d.get('error')}")
        return 1
    if d.get("last_error"):
        fail(f"引擎 last_error 非空（客户会看到失败）：{d.get('last_error')}")
        ok = False

    # ① 建引擎（AAR 的 API 可用 + 宿主回调被接受）
    if not d.get("created"):
        fail("ProteusEngine.create 未成功")
        ok = False
    else:
        print("  ✓ ① 建引擎成功（AAR 的 ProteusEngine.create(host) 可用）")

    # ② 度量回调**真的**被调用（引擎 → Java 的蹦床通路成立）
    mc = d.get("measure_calls", 0) or 0
    if mc <= 0:
        fail(f"度量回调未被调用（measure_calls={mc}）——引擎→Java 的蹦床没通")
        ok = False
    else:
        print(f"  ✓ ② 度量回调被引擎调用 {mc} 次（**C 蹦床 → Java.measureText** 通路成立）")

    # ③ 能力校验两侧
    okrc = d.get("capability_check_ok_rc")
    missrc = d.get("capability_check_missing_rc")
    if okrc != 0:
        fail(f"能力校验（满足侧）未通过：rc={okrc}")
        ok = False
    elif missrc == 0:
        fail("能力缺失时**未报错**（静默通过 —— 禁止）")
        ok = False
    else:
        print(f"  ✓ ③ 能力校验两侧正确（满足 ⇒ 0 · 缺失 ⇒ {missrc}，明确非静默）")

    # ④ 批处理红线
    calls = d.get("stats_submit_frame_calls")
    if calls != 1:
        fail(f"批处理红线未达标：submit_frame_calls={calls}（一帧两条指令应恰好 1 次）")
        ok = False
    else:
        print("  ✓ ④ 批处理红线：一帧两条指令 / **1 次**跨边界提交")

    # ⑤ 几何与更新
    boxes = d.get("box_count", 0) or 0
    upd = d.get("update_records_seen", 0) or 0
    if boxes < 4:
        fail(f"几何产出不足：box_count={boxes}（客户画不出东西）")
        ok = False
    elif upd <= 0:
        fail("帧更新为空（客户拿不到任何变换）")
        ok = False
    else:
        print(f"  ✓ ⑤ 几何 {boxes} 个盒子 · 帧更新 {upd} 条（客户能画出东西）")

    # ⑥ 输入
    hit = d.get("tap_hit_id")
    if hit is None or hit < 0:
        fail(f"tap 失败：hit={hit}")
        ok = False
    else:
        print(f"  ✓ ⑥ 输入可用：tap 命中节点 {hit}（0 = 未命中，也属正常）")

    print()
    if ok:
        print("✅ HA5 嵌入 demo 判据全过（**只用 AAR 的第三方 App** 能建引擎 / 量文本 / 校验能力 / 提交帧 / 收更新 / 收输入）")
        return 0
    print("✗ HA5 嵌入 demo 判据有失败项（见上）")
    return 1


if __name__ == "__main__":
    sys.exit(main())
