#!/usr/bin/env python3
"""hosts/shared/check-cross-end-geometry.py —— ★★双端几何一致性判据（iOS ⇄ Android 真机产物）

【收的是哪条诚实边界】官网「跨端视觉一致性」原文：
  "指令流保证'画什么'一致，**不保证'画出来一样'**（圆角裁剪/阴影/文本基线各平台不同）
   ——靠 conformance 与浏览器真值基准兜底。"

其中**可机器判定的那一半**（布局几何是否两端一致）此前只有**间接**证据：
  双端各自跑 `proteus_layout_conformance(browser-layout.json)`，各报一个 `max_delta_dp`。
  ★但那不能推出"两端相同"——A 距基准 0.3、B 距基准 0.3 时，A 与 B 可以朝**相反方向**偏
  （甚至 A=+0.3 / B=-0.3 差 0.6dp，各自却都"达标"）。
⇒ 本判据直接比 **内核算出的几何指纹**（`geometry_digest`，FNV-1a over f32 位模式）：
  两端指纹相同 ⇔ 两端几何**逐字节一致**（比"各自距基准达标"强得多）。

【为什么可信（不是自证）】
  · 指纹由**同一段内核代码**算出（双端链接同一个 `layout-core-rust`），
    且吃的是**引擎实际算出的 rects**（不含 golden 期望值）——见 `ffi.rs::run_conformance`；
  · 内核单测钉了**确定性**（同输入两次同值）与**敏感性**（输入改 1dp 必变）——
    `geometry_digest_is_deterministic_and_sensitive`（含破坏性验证）；
  · 本判据还交叉核对：两端 `compared_nodes`/`cases` 必须相同（防"一方少算了节点"的假一致）。

【诚实边界（本判据**不**声称什么）】只覆盖**布局几何**。"画出来一样"还取决于光栅化
  （圆角裁剪 / 阴影 / 文本基线 / 字体 hinting）——那部分不在本判据范围，仍按官网原文
  "靠 conformance 与浏览器真值基准兜底"。

【输入】两端真机产物（各自跑过 conformance 且 json 里含 `geometry_digest`）：
  hosts/ios/experiments/device/results/layout-conformance.json      （iPhone · JavaScriptCore 无关，纯 Rust）
  hosts/android/results/layout-conformance.json                     （Android · 纯 Rust）

用法：
  python3 hosts/shared/check-cross-end-geometry.py [ios.json] [android.json]
退出码：0 一致 / 1 不一致或缺字段 / 0（产物缺失时诚实跳过，打印怎么跑）
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))

DEFAULT_IOS = os.path.join(ROOT, 'hosts/ios/experiments/device/results/layout-core-conformance.json')
DEFAULT_ANDROID = os.path.join(ROOT, 'hosts/android/results/layout-conformance.json')


def load(path, label):
    if not os.path.exists(path):
        return None, f"{label} 产物缺失：{path}"
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f), None
    except Exception as e:  # noqa: BLE001
        return None, f"{label} 产物读不出：{e}"


def main() -> int:
    args = sys.argv[1:]
    ios_path = args[0] if len(args) > 0 else DEFAULT_IOS
    and_path = args[1] if len(args) > 1 else DEFAULT_ANDROID

    ios, ios_err = load(ios_path, 'iOS')
    andr, and_err = load(and_path, 'Android')

    print("═══ 双端几何一致性判据（iOS ⇄ Android）═══")
    if ios is None or andr is None:
        # ★诚实跳过（与其它真机判据同款）：产物缺失时**不判红**，但把怎么跑说清楚
        if ios_err:
            print(f"  ⚠ {ios_err}")
            print("    ⇒ 跑：bash hosts/ios/experiments/device/run-layout-core.sh")
        if and_err:
            print(f"  ⚠ {and_err}")
            print("    ⇒ 跑：bash hosts/android/acceptance.sh --runs 1（含 conformance 步）")
        print("  （诚实跳过：至少一端无产物——两都跑到才能比对）")
        return 0

    ok = True

    def fail(msg: str) -> None:
        nonlocal ok
        print(f"  ✗ {msg}")
        ok = False

    def report(msg: str) -> None:
        print(f"  ✓ {msg}")

    # ① 两端各自对基准达标（前置：都没达标时"相互一致"无意义）
    for label, d in (('iOS', ios), ('Android', andr)):
        if d.get('ok') is not True:
            fail(f"{label} 自报 conformance 未达标：failures={(d.get('failures') or [])[:2]}")

    # ② 覆盖面对齐（防"一方少算节点"的假一致）
    ni, na = ios.get('compared_nodes'), andr.get('compared_nodes')
    ci, ca = ios.get('cases'), andr.get('cases')
    if ni != na:
        fail(f"两端比对节点数不同：iOS {ni} vs Android {na}——覆盖面不一致，指纹不可比")
    elif ci != ca:
        fail(f"两端 case 数不同：iOS {ci} vs Android {ca}")
    else:
        report(f"覆盖面一致：{ci} case · {ni} 节点（两端同 golden）")

    # ③ ★指纹比对（核心判据）
    gi, ga = ios.get('geometry_digest'), andr.get('geometry_digest')
    if not gi or not ga:
        fail(
            f"缺 geometry_digest（iOS={gi!r} / Android={ga!r}）——"
            "两端内核需含 2026-10-01 的指纹实现（重新构建 .so/.a 后重跑）"
        )
    elif gi != ga:
        fail(
            f"★两端几何**不一致**：iOS {gi} vs Android {ga}"
            f"（同一份 golden、同一段内核代码 ⇒ 出现差异说明构建/精度/平台分支有别）"
        )
    else:
        di = ios.get('max_delta_dp')
        da = andr.get('max_delta_dp')
        report(
            f"★几何指纹一致：{gi}（两端逐字节相同）· 各自距浏览器基准 iOS {di}dp / Android {da}dp"
        )

    print()
    if not ok:
        print("✗ 双端几何一致性未通过（见上方失败项）")
        return 1
    print("✅ 双端几何一致性通过：同一份 golden 下，两端内核算出的布局几何**逐字节一致**")
    print("   诚实边界：本判据只覆盖**布局几何**；光栅化（圆角/阴影/文本基线）不在范围内。")
    return 0


if __name__ == '__main__':
    sys.exit(main())
