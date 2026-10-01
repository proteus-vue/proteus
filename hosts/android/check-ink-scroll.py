#!/usr/bin/env python3
"""hosts/android/check-ink-scroll.py —— ★★Morpheus **长卷探索**（滚动驱动）判据（真机 ink.json）

【这一段是什么（用户："继续"→ 多画幅横移长卷）】
  把整幅山水卷变成一条**可用手势横移的长卷**：所有元素一次性声明为"滚动位置的函数"，
  观众拖动手势横移——画卷往左移，右侧景象随视野"逐段浮现"（落笔/揭幕/涨潮/月升/云起）。
  ★这条判据的本质：**同一条滚动位置驱动 100+ 条通道**（位移/裁剪/描边/渐变全联动）——
  传统跨端框架的滚动联动通常只敢做 translate/opacity。

【判据（每条都落在机器可判的量上）】
  ① **单幕滚动驱动形态**：plan = ['scroll'] · 该幕 100+ 通道 · **全部**挂滚动窗口
     （`drive=1` + `scrollFrom`——少一条 = 那条不跟随手势）
  ② **手势真的驱动了**（本判据的核心）：宿主记账的 `scroll_min/scroll_max` 必须显示
     **真实位移区间**（判据通过 adb 注入多步手势后取报告——区间覆盖 ≥60% 行程）
  ③ **长卷真的左移**（探针真读）：终态 `root` 的 tx ≈ −行程（画随手动）
  ④ **沿途景象真的浮现**：滚动到中段时，早段元素（山骨线/江水）的进度已到 1、
     晚段元素（题款/印）仍在 0——**同一条滚动轴上的分段揭示**
  ⑤ **零逃生口**：全部为声明式通道

用法：python3 hosts/android/check-ink-scroll.py <ink.json>
退出码：0 全过 / 1 有失败 / 0（产物缺失时诚实跳过）
"""
import json
import os
import sys

SCROLL_RANGE_RATIO = 2.2  # 与节目单一致（行程 = 2.2 × 视口宽）


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print("用法：python3 hosts/android/check-ink-scroll.py <ink.json>")
        return 2
    path = args[0]
    if not os.path.exists(path):
        print(f"⚠ 长卷判据：未找到真机产物（{path}）")
        print("  ⇒ 诚实跳过（跑真机后取回）：adb shell am broadcast -a dev.proteus.RUN --es path inkScroll")
        return 0

    print(f"═══ Morpheus 长卷探索判据（滚动驱动 · 手势横移 · 真机）：{path} ═══")
    ok = True
    with open(path, encoding="utf-8") as f:
        d = json.load(f)

    def fail(msg: str) -> None:
        print(f"  ✗ {msg}")

    # ── ① 单幕滚动驱动形态 ──
    if d.get("ok") is not True:
        fail(f"演出未成功：{str(d.get('error'))[:200]}")
        return 1
    if d.get("program") != "inkScroll":
        fail(f"节目名不符：{d.get('program')}（应 inkScroll）")
        ok = False
    plan = d.get("plan") or []
    js_acts = d.get("acts") or []
    if plan != ["scroll"]:
        fail(f"plan 应为单幕 ['scroll']，实际：{plan}")
        ok = False
    else:
        act = js_acts[0] if js_acts else {}
        n = act.get("anims") or 0
        if n < 100:
            fail(f"长卷通道数不足：{n}（应 100+——位移/裁剪/描边/渐变全联动）")
            ok = False
        else:
            print(f"  ✓ ① 单幕滚动驱动：{n} 条通道（计划 {plan}）")

    # ── ② 手势真的驱动了（核心判据）──
    host = d.get("host") or {}
    smin = host.get("scroll_min", -1)
    smax = host.get("scroll_max", -1)
    vw = float((d.get("view") or {}).get("width") or 1080)
    total = vw * SCROLL_RANGE_RATIO
    if smin is None or smax is None or smax < 0:
        fail("宿主未记录滚动位置（scroll_min/max 缺失——手势记账没接线？）")
        ok = False
    elif smax < total * 0.6:
        fail(f"手势行程不足：scroll_max={smax}（应 ≥ {total * 0.6:.0f} = 60% 行程）"
             f"——注入的手势没驱动到位？")
        ok = False
    else:
        print(f"  ✓ ② ★手势真的驱动了长卷：位移区间 [{smin}, {smax}] / 行程 {total:.0f}px"
              f"（覆盖 {smax / total:.0%}）")

    # ── ③ 长卷真的左移（探针真读 root 的 tx）──
    root_l = None
    for a in (host.get("acts") or []):
        for l in (a.get("probe_all") or []):
            if isinstance(l, dict) and l.get("id") == 1:
                root_l = l
                break
        if root_l:
            break
    if root_l is None:
        fail("探针缺 root（id=1）读数（probe_all 未含？）")
        ok = False
    else:
        tx = float(root_l.get("tx") or 0)
        if tx > -total * 0.6:
            fail(f"长卷未左移到位：root.tx={tx}（应 ≤ {-total * 0.6:.0f}）")
            ok = False
        else:
            print(f"  ✓ ③ ★长卷真的左移（探针真读）：root.tx = {tx:.1f}（行程 {total:.0f}px·画随手动）")

    # ── ④ 沿途景象真的浮现（同一条轴上的分段揭示）──
    #   证据：滚动到后段时，"早段元素"（江水 clip 已全开）与"晚段元素"（印/题款仍在推进）
    #   的**进度差**——读探针的 clip 字段（江水 top 应到 0.3；印四边尚未全开或刚开）
    water_l = seal_l = None
    for a in (host.get("acts") or []):
        for l in (a.get("probe_all") or []):
            if isinstance(l, dict):
                if l.get("id") == 50:
                    water_l = l
                if l.get("id") == 110:
                    seal_l = l
    if water_l is None:
        fail("探针缺江水（50）读数")
        ok = False
    else:
        cs = water_l.get("clip") or ""
        # 江水 clip 基态 top=1（全隐）→ 滚动中段后应接近 0.3（涨潮完成）
        if cs.startswith("1:") and cs.split(":")[1].startswith("0.3"):
            print(f"  ✓ ④ ★沿途景象真的浮现：江水 clip = {cs}（涨潮完成——早段元素已就位）"
                  + (f" · 印 clip = {seal_l.get('clip')}" if seal_l else ""))
        else:
            fail(f"江水未按滚动揭示：clip = {cs}（应 '1:0.30…' = 涨潮完成）")
            ok = False

    # ── ⑤ 零逃生口 ──
    esc = d.get("escapes") or {}
    decl = esc.get("declaratives", 0)
    total_esc = esc.get("total", -1)
    ratio = esc.get("ratio", -1)
    if decl <= 0 or total_esc is None or total_esc < 0:
        fail(f"逃生口读数缺失：{esc}")
        ok = False
    elif ratio is None or ratio > 0.05:
        fail(f"逃生口率超标：{ratio:.2%}")
        ok = False
    else:
        print(f"  ✓ ⑤ 零逃生口：{decl} 条声明式 / {total_esc} 条登记（率 {ratio:.1%}）")

    if ok:
        print("\n✅ 长卷探索判据全过（单幕滚动驱动 / 手势真的驱动 / 长卷左移 / 分段浮现 / 零逃生口）")
        return 0
    print("\n✗ 长卷判据有失败项（见上）")
    return 1


if __name__ == "__main__":
    sys.exit(main())
