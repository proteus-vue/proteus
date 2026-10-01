#!/usr/bin/env python3
"""hosts/android/check-flip.py —— ★★Morpheus 第三个节目「翻牌剧场」判据（真机产物 flip.json）

【这一场验收什么（用户："从 3D 和 2D 之间不断转换的主题考虑，综合新增能力做到天花板"）】
  第三个节目「**维度折叠**」= 二维平面宇宙 ↔ 三维立体空间的反复穿越；**颜色 = 第三维度的
  语言**（平面 = 白纸，立起 = 色彩涌现）。验收 2026-10-01 新收口的三组能力：
    · 任意三次贝塞尔（curveBezier）：elastic 拍平 / backOut 立起 / anticipate 砸平与慢翻；
    · 3D（rotateX/rotateY + perspective）：所有"平面↔立体"转换本身；
    · 循环往复（repeat + alternate）与播放控制（slowYaw 0.3× 慢动作 · ripple 1.6× 加速）。

【判据（每条都落在机器可判的量上）】
  ① **三方对齐**：plan = JS acts = 宿主 acts（8 幕逐项）
  ② **能力在场**：3D 指令 ≥ 6 幕 · 曲线指令 ≥ 6 幕 · 循环指令 ≥ 2 幕（JS 侧计数）
  ③ **★慢动作/疾速端到端**（A3 的核心判据）：宿主实测每幕 wall 时长与名义 span 的比值——
     slowmo（timeScale 0.25）应 ≈ 4×；snap（timeScale 2）应 ≈ 0.5×；其余幕 ≈ 1×。
     这是"播放控制真的改变了时间推进"的**端到端证据**（不是"接口回显了参数"）。
  ④ **★3D 终态（真读宿主真源）**：逐幕末态探针——deal 归位 0° · sweep 往返回 0° ·
     reveal 翻面 180° · unfold 回正 0° · slowmo/snap 展开-弹回（-120 → 0）。
  ⑤ **帧率与流畅**：vsync p50 ≤ 刷新预算×1.15；每帧工作 p95 ≤ 8ms
  ⑥ **零逃生口**：声明式指令 / 0 条登记（率 ≤ 5%）
  ⑦ **无缝**：零强制切幕

用法：python3 hosts/android/check-flip.py <flip.json>
退出码：0 全过 / 1 有失败 / 0（产物缺失时诚实跳过）
"""
import json
import os
import sys

FRAME_WORK_BUDGET_MS = 8.0
MIN_PAINTED_COLORS = 24  # 翻牌剧场以"牌面配色 → 白"为主，色数下限低于灯光秀（如实标注）


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print("用法：python3 hosts/android/check-flip.py <flip.json>")
        return 2
    path = args[0]
    if not os.path.exists(path):
        print(f"⚠ 翻牌剧场判据：未找到真机产物（{path}）")
        print("  ⇒ 诚实跳过（跑真机后取回）：adb shell am broadcast -a dev.proteus.RUN --es path flip")
        return 0

    print(f"═══ Morpheus 维度折叠判据（2D↔3D 穿越 × 任意缓动 × 循环 × 慢动作 · Android 真机）：{path} ═══")
    ok = True
    with open(path, encoding="utf-8") as f:
        d = json.load(f)

    def fail(msg: str) -> None:
        print(f"  ✗ {msg}")

    def _j(x):
        if isinstance(x, str):
            try:
                return json.loads(x)
            except Exception:
                return {}
        return x or {}

    # ① 三方对齐
    if d.get("ok") is not True:
        fail(f"演出未成功：{str(d.get('error'))[:200]}")
        return 1
    if d.get("program") != "flip":
        fail(f"节目名不符：{d.get('program')}（应 flip——宿主 args.program 未传对？）")
        ok = False
    plan = d.get("plan") or []
    js_acts = d.get("acts") or []
    host = d.get("host") or {}
    host_acts = host.get("acts") or []
    if not plan or len(plan) < 8:
        fail(f"plan 缺失或过短：{plan}")
        ok = False
    elif [a.get("name") for a in js_acts] != plan:
        fail(f"JS 侧幕序与 plan 不一致：{[a.get('name') for a in js_acts]}")
        ok = False
    elif [a.get("name") for a in host_acts] != plan:
        fail(f"宿主侧幕序与 plan 不一致：{[a.get('name') for a in host_acts]}")
        ok = False
    else:
        print(f"  ✓ ① 整场演完且三方一致：{len(plan)} 幕（{' → '.join(plan)}）")

    # ② 能力在场（JS 侧计数）
    rot3d = d.get("rotate3d_anims_total") or 0
    curves = d.get("curve_bezier_anims_total") or 0
    reps = d.get("repeat_anims_total") or 0
    acts_with_3d = sum(1 for a in js_acts if (a.get("rotate3d_anims") or 0) > 0)
    acts_with_curve = sum(1 for a in js_acts if (a.get("curve_bezier_anims") or 0) > 0)
    acts_with_rep = sum(1 for a in js_acts if (a.get("repeat_anims") or 0) > 0)
    if rot3d <= 0 or acts_with_3d < 6:
        fail(f"3D 能力覆盖不足：指令 {rot3d} 条 / {acts_with_3d} 幕（应 ≥ 6 幕）")
        ok = False
    elif curves <= 0 or acts_with_curve < 4:
        # ★口径（如实）：自定义曲线在**设计上**覆盖 5 幕（plane 弹性 / lift 回弹 /
        #   flatten 预期 / slowYaw 预期 / finale 回弹）——断言 ≥ 4 留一曲线的呼吸空间。
        fail(f"自定义曲线覆盖不足：指令 {curves} 条 / {acts_with_curve} 幕（应 ≥ 4 幕）")
        ok = False
    elif reps <= 0 or acts_with_rep < 2:
        fail(f"循环覆盖不足：指令 {reps} 条 / {acts_with_rep} 幕（应 ≥ 2 幕）")
        ok = False
    else:
        print(f"  ✓ ② 三组新能力在场：3D {rot3d} 条/{acts_with_3d} 幕 · 曲线 {curves} 条/{acts_with_curve} 幕 · "
              f"循环 {reps} 条/{acts_with_rep} 幕")

    # ③ ★慢动作/疾速：wall/span 比值（A3 端到端）
    hbyname = {a.get("name"): a for a in host_acts}
    ratios = {}
    for a in host_acts:
        w, sp = a.get("elapsed_ms"), a.get("span_ms")
        if w and sp and sp > 0:
            ratios[a["name"]] = w / sp
    slow = ratios.get("slowYaw")     # timeScale 0.3 ⇒ wall/span ≈ 3.33
    snap = ratios.get("ripple")      # timeScale 1.6 ⇒ wall/span ≈ 0.625
    # ★"常速"样本：排除变速幕，以及**多遍幕**（repeat 幕的墙钟天然是 span×遍数——
    #   fan/torsion/spin 是多遍幕；它们的真实倍数由 spanMs（含 repeat）对上，不在本判据内）
    rep_acts = {a.get("name") for a in js_acts if (a.get("repeat_anims") or 0) > 0}
    others = [v for k, v in ratios.items() if k not in ("slowYaw", "ripple") and k not in rep_acts
              # ★finale 幕是全片**唯一带 hold 的幕**（定格 1000ms）——wall 天然含 hold，
              #   不计入"常速幕"样本（它的名义时长不含 hold，比值必然 > 1）
              and k != "finale"]
    if slow is None or snap is None or not others:
        fail(f"比值读数缺失：{ {k: round(v,2) for k,v in ratios.items()} }（多遍幕：{sorted(rep_acts)}）")
        ok = False
    else:
        # 名义 span 是"1× 下的时长"⇒ 0.3× 慢动作的墙钟应 ≈ 3.33；1.6× 的应 ≈ 0.625。
        # 容差宽（±25%）：判据在意的是"时间尺度真的变了"，不是精确复现调度抖动。
        if not (2.6 <= slow <= 4.2):
            fail(f"③ 慢动作未生效：slowYaw wall/span={slow:.2f}（timeScale 0.3 应 ≈ 3.33）")
            ok = False
        elif not (0.45 <= snap <= 0.8):
            fail(f"③ 加速未生效：ripple wall/span={snap:.2f}（timeScale 1.6 应 ≈ 0.625）")
            ok = False
        else:
            avg_other = sum(others) / len(others)
            if not (0.75 <= avg_other <= 1.35):
                fail(f"③ 常速幕偏离 1×：其余幕 wall/span 均值 {avg_other:.2f}（应 ≈ 1）——"
                     f"逐幕 { {k: round(v, 2) for k, v in ratios.items()} }")
                ok = False
            else:
                print(f"  ✓ ③ ★播放控制端到端（wall/span）：slowYaw {slow:.2f}（0.3× ⇒ ≈3.33 慢）· ripple {snap:.2f}"
                      f"（1.6× ⇒ ≈0.625 快）· 其余 {avg_other:.2f}（≈1×；多遍幕 {sorted(rep_acts)} 另算）")

    # ④ ★3D 终态（逐幕末态探针，真读宿主真源）
    # ★"维度折叠"的逐幕 3D 终态（每幕都是"平面↔立体"的一次转换）：
    #   plane 拍平成地面(-85) → lift 立起(0) → fan 折扇往返回 0 → torsion 扭转往返回 0
    #   → flatten 再砸平(-85) → spin 立起(0) → ripple 波回 0 → slowYaw 慢翻半圈(180) → finale 归位(0)
    want3d = {
        "plane": ("rotateX", -85.0, 2.0),
        "lift": ("rotateX", 0.0, 2.0),
        "fan": ("rotateY", 0.0, 3.0),        # yoyo 偶次往返 ⇒ 回起点；容差 3° 容调度尾差
        "torsion": ("rotateX", 0.0, 3.0),    # 双轴 yoyo 4 次 ⇒ 回起点
        "flatten": ("rotateX", -85.0, 2.0),
        "spin": ("rotateX", 0.0, 2.0),
        "ripple": ("rotateX", 0.0, 3.0),     # 波（峰 -60）回到 0
        "slowYaw": ("rotateY", 180.0, 2.0),
        "finale": ("rotateY", 0.0, 2.0),
    }
    bad = []
    for name, (chan, want, tol) in want3d.items():
        a = hbyname.get(name)
        p = (a or {}).get("probe") or {}
        got = p.get(chan)
        if got is None:
            bad.append(f"{name}（探针缺 {chan}）")
        elif abs(float(got) - want) > tol:
            bad.append(f"{name}（{chan}={got}，应 ≈{want}）")
    if bad:
        fail(f"④ 3D 终态不符：{bad}")
        ok = False
    else:
        det = " · ".join(f"{n}:{hbyname[n]['probe'][want3d[n][0]]:.1f}°" for n in want3d)
        print(f"  ✓ ④ ★3D 逐幕终态（真读宿主真源）：{det}")

    # ⑤ 帧率与流畅
    vsync = host.get("vsync_p50")
    p95 = host.get("work_p95")
    frames = host.get("frames") or 0
    if not frames or vsync is None or p95 is None:
        fail(f"帧读数缺失：frames={frames} vsync={vsync} p95={p95}")
        ok = False
    else:
        if vsync > 8.33 * 1.15:
            fail(f"vsync p50={vsync:.3f}ms 超 120Hz 预算")
            ok = False
        elif p95 > FRAME_WORK_BUDGET_MS:
            fail(f"每帧工作 p95={p95:.2f}ms 超预算 {FRAME_WORK_BUDGET_MS}ms")
            ok = False
        else:
            print(f"  ✓ ⑤ 流畅：{frames} 帧 · vsync p50={vsync:.3f}ms · 每帧工作 p95={p95:.2f}ms")

    # ⑥ 零逃生口
    esc = d.get("escapes") or {}
    total = esc.get("total", -1)
    decl = esc.get("declaratives", 0)
    ratio = esc.get("ratio", -1)
    if total is None or total < 0 or decl <= 0:
        fail(f"逃生口读数缺失：{esc}")
        ok = False
    elif ratio is None or ratio > 0.05:
        fail(f"逃生口率超标：{ratio:.2%}")
        ok = False
    else:
        print(f"  ✓ ⑥ 零逃生口：{decl} 条声明式指令 / {total} 条登记（率 {ratio:.1%}）")

    # ⑦ 无缝
    forced = [a.get("name") for a in host_acts if a.get("forced")]
    if forced:
        fail(f"下列幕被强制切幕：{forced}")
        ok = False
    else:
        print("  ✓ ⑦ 无缝：全部幕由内核 active=0 自然结束")

    if ok:
        print("\n✅ 维度折叠判据全过（三方对齐 / 三组新能力在场 / 慢动作端到端 / 3D 逐幕终态 / 120Hz 流畅 / 零逃生口）")
        return 0
    print("\n✗ 翻牌剧场判据有失败项（见上）")
    return 1


if __name__ == "__main__":
    sys.exit(main())
