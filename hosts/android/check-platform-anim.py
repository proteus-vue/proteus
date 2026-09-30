#!/usr/bin/env python3
"""hosts/android/check-platform-anim.py —— ★Android 平台动画判据（容器级 + 逐节点）

【为什么要有它（本轮补齐的缺口）】`platform-anim` 在 MA0-RT 落地时**只有手工读数**
（AI 在日志里看一眼"delta=0"），没有机器判据 ⇒ 回退不会被拦住。本仓纪律：
**判据必须能变红、且判据要落在结果上**——同 iOS 侧 `check-anim-rt2.py` 一个道理。

【两组判据】
  A. 容器级（`platform-anim.json`）——整页转场
     A1 贝塞尔来自内核（宿主无曲线数学）
     A2 model 值**逐帧插值**（≥2 个不同的中间读数——"设了没动"必须红）
     A3 终态精确（tx=120 / scale=0.85 / alpha=0.5）
     A4 **主线程零参与绘制**（draw_delta = 0）
  B. 逐节点（`platform-anim-node.json`）——载体 View 路径
     B1 载体接入（carriers 0 → 1）
     B2 **三个"零"**：draw / measure / layout 增量都为 0
     B3 终态精确（tx=120 / ty=300 / scale=0.6 / alpha=0.5）
     B4 拆除后恢复（carriers=0 且指令流重新绘制：draw 增量 > 0、像素非空）

用法：python3 hosts/android/check-platform-anim.py <platform-anim.json> [platform-anim-node.json]
退出码：0 全过 / 1 有失败
"""
import json
import os
import sys


def fail(msg):
    print(f"  ✗ {msg}")


def _obj(x):
    """Java 侧 `mids` 的元素是 JSON **字符串**（宿主拼的），统一解析成 dict；已是 dict 则原样返回。
    （判据脚本的健壮性也会影响判定——本轮真机就撞到 `'str' object has no attribute 'get'`。）"""
    if isinstance(x, dict):
        return x
    if isinstance(x, str):
        try:
            return json.loads(x)
        except Exception:
            return {}
    return {}


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print("用法：python3 hosts/android/check-platform-anim.py <platform-anim.json> [<platform-anim-node.json>]")
        return 2
    ok = True

    # ★产物缺失 ⇒ **诚实跳过**（不是失败）：判据的输入是真机产物，开发机/CI 上没有属正常。
    #   本仓既有惯例同此（如 check:mp-attrs 离线时诚实跳过并告警，不误红）。
    #   ★但"文件存在却读不出/格式错"仍判红——那是产物坏了，必须拦。
    present = [p for p in args if os.path.exists(p)]
    if not present:
        print("⚠ 平台动画判据：未找到真机产物（" + " · ".join(args) + "）")
        print("  ⇒ 诚实跳过（跑真机后取回产物再验）：")
        print("     adb shell am broadcast -a dev.proteus.RUN --es path platform-anim-node")
        print("     adb pull /sdcard/Android/data/dev.proteus.layoutcore/files/platform-anim-node.json hosts/android/results/")
        return 0
    if len(present) < len(args):
        missing = [p for p in args if p not in present]
        print(f"⚠ 缺少部分产物（{', '.join(missing)}）——只验存在的：{', '.join(present)}")

    for path in present:
        print(f"═══ Android 平台动画判据：{path} ═══")
        try:
            with open(path, encoding="utf-8") as f:
                d = json.load(f)
        except Exception as e:
            fail(f"报告读不出（文件存在但解析失败——产物坏了，必须拦）：{e}")
            print()
            ok = False
            continue

        # ★分组按**内容**判（"有没有 carriers 键"），不按文件名——
        #   破坏性验证当场抓出：按文件名判时，临时文件路径不含 "node" ⇒ 走错分支、B 组根本没被验。
        #   判据的**路由**也会错，路由错了判据就等于不存在。
        is_node = any(k.startswith("carriers") for k in d.keys())
        if is_node:
            # ── B 组：逐节点 ──
            cb, ca = d.get("carriers_before"), d.get("carriers_after")
            if cb != 0 or ca != 1:
                fail(f"B1 载体未接入：before={cb} after={ca}（应 0 → 1）")
                ok = False
            else:
                print("  ✓ B1 载体接入（0 → 1：目标节点被提升为独立 View）")

            end = _obj(d.get("end"))
            # ★判据口径（真机读数换来的）：量**动画窗口内**的增量，不含"接入载体"那一次
            #   —— `addView` 引发的一次布局/绘制是 Android 集成新子 View 的**固有一次性成本**，
            #   把它算作"主线程参与了动画"是口径错误。窗口基线在动画中途取（见宿主 winBase）。
            wd, wm, wl = d.get("win_draw_delta"), d.get("win_measure_delta"), d.get("win_layout_delta")
            if wd is None or wm is None or wl is None:
                fail(f"B2 窗口内增量读数缺失：win_draw={wd} win_measure={wm} win_layout={wl}")
                ok = False
            elif wd != 0 or wm != 0 or wl != 0:
                fail(f"B2 动画期间主线程未零参与：窗口内 draw={wd} measure={wm} layout={wl}（都应 0）")
                ok = False
            else:
                # 中间采样点的计数必须彼此一致（更强的证据：动画全程没动过）
                counts = {(_obj(m).get("on_draw_count"), _obj(m).get("on_measure_count"),
                           _obj(m).get("on_layout_count")) for m in (d.get("mids") or [])}
                if len(counts) != 1:
                    fail(f"B2b 动画期间计数发生变化：{sorted(counts)}（应全程恒定）")
                    ok = False
                else:
                    print(f"  ✓ B2 三个零（动画窗口内）：draw/measure/layout 增量都为 0，"
                          f"且 {len(d.get('mids') or [])} 个采样点计数恒定 {sorted(counts)[0]}")
                    att = (end.get("draw_delta"), end.get("measure_delta"), end.get("layout_delta"))
                    print(f"     ★如实记录：接入载体的一次性成本 draw/measure/layout = {att}（不计入动画期）")

            tx, ty, sc, al = end.get("tx"), end.get("ty"), end.get("scale"), end.get("alpha")
            if tx is None or abs(tx - 120.0) > 0.5 or abs(ty - 300.0) > 0.5 \
                    or sc is None or abs(sc - 0.6) > 0.01 or al is None or abs(al - 0.5) > 0.01:
                fail(f"B3 终态不精确：tx={tx} ty={ty} scale={sc} alpha={al}（应 120/300/0.6/0.5）")
                ok = False
            else:
                print(f"  ✓ B3 终态精确：tx={tx} ty={ty} scale={sc} alpha={al}")

            # 逐帧推进（模型值须出现不同读数；本条是"设了没动"的判别）
            mids = d.get("mids") or []
            txs = {round(float(_obj(m).get("tx", 0)), 2) for m in mids}
            if len(txs) < 2:
                fail(f"B3b model 值未逐帧推进：{sorted(txs)}（应出现 ≥2 个不同读数）")
                ok = False
            else:
                print(f"  ✓ B3b model 值逐帧推进（{len(txs)} 个不同读数：{sorted(txs)[:4]}…）")

            cr = d.get("carriers_after_reset")
            dres = d.get("draw_after_reset_delta")
            pix = d.get("reset_pixel_nonempty")
            if cr != 0 or dres is None or dres <= 0 or not pix:
                fail(f"B4 拆除后未恢复：carriers={cr} draw_after_reset_delta={dres} pixel={pix}")
                ok = False
            else:
                print(f"  ✓ B4 拆除后恢复（carriers=0 · 指令流重新绘制 +{dres} 次 · 像素非空）")
        else:
            # ── A 组：容器级 ──
            bz = _obj(d.get("bezier"))   # ★同为 JSON 字符串（Java 侧拼的）
            if not (bz.get("ok") and isinstance(bz.get("bezier"), list)):
                fail(f"A1 贝塞尔未来自内核：{bz}")
                ok = False
            else:
                print(f"  ✓ A1 贝塞尔来自内核：{bz.get('bezier')}")

            end = _obj(d.get("end"))
            tx, al = end.get("tx"), end.get("alpha")
            if tx is None or abs(tx - 120.0) > 0.5 or al is None or abs(al - 0.5) > 0.01:
                fail(f"A3 终态不精确：tx={tx} alpha={al}（应 120 / 0.5）")
                ok = False
            else:
                print(f"  ✓ A3 终态精确：tx={tx} alpha={al}")

            dd = d.get("draw_delta")
            if dd is None or dd != 0:
                fail(f"A4 主线程未零参与绘制：draw_delta={dd}（应 0）")
                ok = False
            else:
                print(f"  ✓ A4 主线程零参与绘制（draw_delta=0 · on_draw_count={end.get('on_draw_count')}）")

            mids = d.get("mids") or []
            txs = {round(float(_obj(m).get("tx", 0)), 2) for m in mids}
            if len(txs) < 2:
                fail(f"A2 model 值未逐帧推进：{sorted(txs)}（应出现 ≥2 个不同读数）")
                ok = False
            else:
                print(f"  ✓ A2 model 值逐帧推进（{len(txs)} 个不同读数）")
        print()

    if ok:
        print("✅ 平台动画判据全过（容器级 + 逐节点）")
        return 0
    print("✗ 平台动画判据有失败项（见上）")
    return 1


if __name__ == "__main__":
    sys.exit(main())
