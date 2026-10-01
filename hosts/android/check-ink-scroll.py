#!/usr/bin/env python3
"""hosts/android/check-ink-scroll.py —— ★★Morpheus **手卷浏览**（宽卷横移）判据（真机 ink.json）

【这一段是什么（用户："对就是你说的那种比较好，现在测试横屏体验有些差"→ 第二版设计）】
  画布 **3.2 屏宽**（`scrollCanvasWidth`），山水横向铺开；手指 1:1 跟手（宿主画布
  `translate(-scrollX)`）、抛滑惯性（平台 `OverScroller`）；两端**卷轴固定**在视口边缘
  （6 条 `translateX` 0→+range 的**滚动补偿**通道，与画布的 -scrollX **正好抵消**）。
  ⇒ 用户体验 = "画比屏幕宽，手指扫过千山万水"——不是第一版的"卷筒拨开关"。

【判据（每条都落在机器可判的量上）】
  ① **宽卷形态**：plan=['scroll'] · 通道 ≥30 · **滚动驱动 = 6 条**（卷轴补偿） ·
     **无限循环 ≥20 条**（环境动效：月辉呼吸/风摆/荡漾/扇翅）
  ② **画布真的是 3.2 屏宽**（报告 scroll_range 与视口宽对账）· **手势真的驱动了**
     （scroll_max / range ≥ 60%——注入的手势覆盖行程）
  ③ **★卷轴补偿真的抵消了画布平移**（探针真读）：终态卷轴 tx ≈ scroll_max——
     补偿通道挂了滚动轴（少一条 = 轴随画漂走，观感=穿帮）
  ③b **画看得见**（painted_samples ≥ 5000——首版全黑缺陷的回归锁）
  ③c **★画面真的随滚动变了**（像素级证据 `scroll_visual_diff`——堵"数值对了但屏幕没动"）
  ④ **探针样本齐备**（卷轴/印/水/月/竹/舟——节目声明的关键节点都在读数里）
  ⑤ **零逃生口**：全部为声明式通道

用法：python3 hosts/android/check-ink-scroll.py <ink.json>
退出码：0 全过 / 1 有失败 / 2 用法错（产物缺失时诚实跳过,返回 0）
"""
import json
import os
import sys

CANVAS_SCREENS = 3.2      # 画布 = 3.2 × 视口宽（与节目单 scrollCanvasWidth 同源）
SCROLL_COVER_MIN = 0.6    # 手势覆盖行程下限（60%）
VISUAL_DIFF_MIN = 5.0     # 画面变化单元占比下限（%）。★口径：真机两轮实测均 8.3%（首屏 vs 末屏——
                          # 长卷中段内容整体更换，但纸面/水带等全宽元素使变化率不可能很高）。
                          # 阈值取 5.0 = 留 66% 余量（8.0 会把 8.3% 压到 0.3 的边距——一发飘就假红）；
                          # 而它要堵的缺陷（"数值对了屏幕没动"/全黑）变化率 ≈ 0——5.0 仍有完整杀伤力。


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print("用法：python3 hosts/android/check-ink-scroll.py <ink.json>")
        return 2
    path = args[0]
    if not os.path.exists(path):
        print(f"⚠ 手卷判据：未找到真机产物（{path}）")
        print("  ⇒ 诚实跳过（跑真机后取回）：bash hosts/android/run-ink-scroll.sh")
        return 0

    print(f"═══ Morpheus 手卷浏览判据（宽卷横移 · 卷轴补偿 · 真机）：{path} ═══")
    ok = True
    with open(path, encoding="utf-8") as f:
        d = json.load(f)

    def fail(msg: str) -> None:
        print(f"  ✗ {msg}")

    # ── ① 宽卷形态（单幕；6 条滚动补偿 + ≥20 条环境动效）──
    if d.get("ok") is not True:
        fail(f"演出未成功：{str(d.get('error'))[:200]}")
        return 1
    if d.get("program") != "inkScroll":
        fail(f"节目名不符：{d.get('program')}（应 inkScroll）")
        ok = False
    plan = d.get("plan") or []
    js_acts = d.get("acts") or []
    act = js_acts[0] if js_acts else {}
    if plan != ["scroll"]:
        fail(f"plan 应为单幕 ['scroll']，实际：{plan}")
        ok = False
    else:
        n = act.get("anims") or 0
        driven = d.get("scroll_driven_anims_total", act.get("scroll_driven_anims"))
        inf = d.get("infinite_anims_total", act.get("infinite_anims"))
        if n < 30:
            fail(f"手卷通道数不足：{n}（应 ≥30）")
            ok = False
        elif driven != 6:
            fail(f"滚动驱动条数 = {driven}（应恰为 6 = 两轴×（筒身+上下轴头）——"
                 f"少一条 ⇒ 那个部件不随滚动「补偿」，轴会漂出视口）")
            ok = False
        elif inf is None or inf < 20:
            fail(f"环境动效（无限循环）条数 = {inf}（应 ≥20——月辉/风摆/荡漾/扇翅/云漂/水纹）")
            ok = False
        else:
            print(f"  ✓ ① 宽卷形态：plan=['scroll'] · {n} 条通道（滚动驱动 {driven} + 无限循环 {inf}）")

    # ── ② 画布 3.2 屏宽 + 手势真的驱动了 ──
    host = d.get("host") or {}
    smin = host.get("scroll_min", -1)
    smax = host.get("scroll_max", -1)
    vw = float((d.get("view") or {}).get("width") or act.get("view_width") or 1080)
    w_int = int(round(vw))
    expect_total = int(round(vw * CANVAS_SCREENS))
    expect_range = expect_total - w_int
    declared_range = act.get("scroll_range") or 0
    if smin is None or smax is None or smax < 0:
        fail("宿主未记录滚动位置（scroll_min/max 缺失——手势记账没接线？）")
        ok = False
    elif declared_range != expect_range:
        fail(f"画布宽度不符：报告行程 {declared_range}（应 {expect_range} = {CANVAS_SCREENS}×{w_int} − {w_int}）"
             f"——画布不是 3.2 屏宽？")
        ok = False
    elif smax < expect_range * SCROLL_COVER_MIN:
        fail(f"手势行程不足：scroll_max={smax}（应 ≥ {expect_range * SCROLL_COVER_MIN:.0f} = 60% 行程）"
             f"——注入的手势没驱动到位？")
        ok = False
    else:
        print(f"  ✓ ② ★宽卷被手势真的驱动：画布 {expect_total}px（3.2 屏）· 画面平移 "
              f"[{smin}, {smax}] / 行程 {expect_range}px（覆盖 {smax / expect_range:.0%}）")

    # ── ③ 卷轴补偿（探针真读：终态 tx ≈ scroll_max——补偿恒等抵消画布平移）──
    def _probe_one(node_id: int):
        for a in (host.get("acts") or []):
            for l in (a.get("probe_all") or []):
                if isinstance(l, dict) and l.get("id") == node_id:
                    return l
        return None

    roll_l = _probe_one(140)          # 左轴筒身
    roll2_l = _probe_one(143)         # 右轴筒身
    if roll_l is None or roll2_l is None:
        fail(f"探针缺卷轴读数：左={roll_l is not None} · 右={roll2_l is not None}")
        ok = False
    else:
        l_tx = float(roll_l.get("tx") or 0)
        r_tx = float(roll2_l.get("tx") or 0)
        tol = max(3.0, expect_range * 0.02)
        l_ok = abs(l_tx - smax) <= tol
        r_ok = abs(r_tx - smax) <= tol
        if not l_ok or not r_ok:
            fail(f"卷轴补偿未抵消画布平移：左轴 tx={l_tx:.1f} · 右轴 tx={r_tx:.1f} "
                 f"（应 ≈ scroll_max={smax} ± {tol:.0f}——补偿通道没挂上滚动轴？）")
            ok = False
        else:
            print(f"  ✓ ③ ★卷轴补偿真的抵消画布平移（探针真读）：左轴 tx={l_tx:.1f} · "
                  f"右轴 tx={r_tx:.1f} ≈ scroll_max={smax}（轴在视口边缘纹丝不动）")

    # ── ③b 画看得见（首版全黑缺陷的直接回归锁）──
    ps = host.get("painted_samples")
    pc = host.get("painted_colors")
    if ps is None or pc is None or int(ps) < 5000:
        fail(f"画面不可见（全黑？）：painted_samples={ps} · painted_colors={pc}")
        ok = False
    elif int(pc) < 600:
        # ★★描边可见性的像素锁（2026-10-01 真机目视抓出的缺口）：静态 svgPath 描边缺
        #   `progress:1` 声明时**一条都画不出来**（整幅画只剩色块）——当时 readings:
        #   colors=473（无描边）vs 780（有描边，修复后）。色块构图相同 ⇒ 色数差异全部来自
        #   山骨/竹/水纹/苇草的抗锯齿描边。阈值 600 = 两侧各留 ~25% 余量。
        fail(f"色数过低（描边可能没画出来）：painted_colors={pc}（应 ≥ 600——"
             f"无描边时实测 ~473、有描边 ~780）")
        ok = False
    else:
        print(f"  ✓ ③b ★画看得见（含描边）：painted_samples={ps} · painted_colors={pc}")

    # ── ③c 画面真的随滚动变了（像素级；堵"数值对了但屏幕没动"）──
    vdiff = host.get("scroll_visual_diff")
    if vdiff is None:
        fail("报告缺 scroll_visual_diff（起点/收尾视觉签名对比未接线——像素级证据缺失）")
        ok = False
    elif float(vdiff) < VISUAL_DIFF_MIN:
        fail(f"画面变化不足：scroll_visual_diff={vdiff}%（应 ≥ {VISUAL_DIFF_MIN}%）"
             f"——滚动数值变了但屏幕几乎没动？")
        ok = False
    else:
        print(f"  ✓ ③c ★画面真的随滚动变了（像素级证据）：scroll_visual_diff={vdiff}%")

    # ── ③d 抛滑惯性真的接线（2026-10-01：本仓抓到"`startFlingX` 声明了但 `onFling` 里
    #   没人调用"的同族缺陷——声明不等于接线，只有计数能现形）──
    fd = host.get("fling_drives")
    im = host.get("inertia_moved")
    if fd is None or im is None:
        fail("报告缺 fling_drives/inertia_moved（抛滑读数未接线——无法证明惯性存在）")
        ok = False
    elif int(fd) < 1:
        fail(f"抛滑一次都没触发：fling_drives={fd}（onFling → startFlingX 没接线？）")
        ok = False
    elif int(im) < 1:
        fail(f"惯性未推动画布：inertia_moved={im}（读数有但没接上通路？）")
        ok = False
    else:
        print(f"  ✓ ③d ★抛滑惯性真的接线：抛滑 {fd} 次 · 惯性活跃帧 {host.get('inertia_frames')} · "
              f"**推动画布帧 {im}**")

    # ── ④ 探针样本齐备（节目声明的关键节点——卷轴/印/水/月/竹/舟）──
    want = {140: "左卷轴", 110: "印", 50: "江水", 62: "月", 220: "竹B", 90: "舟"}
    got = []
    missing = []
    for nid, name in want.items():
        if _probe_one(nid) is not None:
            got.append(f"{name}({nid})")
        else:
            missing.append(f"{name}({nid})")
    if missing:
        fail(f"探针样本缺失：{', '.join(missing)}")
        ok = False
    else:
        print(f"  ✓ ④ 探针样本齐备：{', '.join(got)}")

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
        print("\n✅ 手卷浏览判据全过（宽卷横移 / 卷轴补偿抵消 / 画面真的变了 / 零逃生口）")
        return 0
    print("\n✗ 手卷判据有失败项（见上）")
    return 1


if __name__ == "__main__":
    sys.exit(main())
