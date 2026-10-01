#!/usr/bin/env python3
"""hosts/ios/check-showcase.py —— ★★Morpheus 炫技场判据（真机产物 showcase.json + 两张截图）

【这一场要证明什么（用户要求）】「该演示就是动画引擎炫技的存在，要求酷炫，吸睛，丝滑流畅不掉帧，
  而且还能考验动画引擎性能，**在其他跨端框架不敢轻易尝试的那种**」
  ＋「做成开场语 + 几分钟演出 + 谢幕语，全部都是这 800 节点编舞完成」。

【判据口径（B7：评审点名的四子项分报 —— 按 B1 口径报数，不报单一 FPS）】
  ① **节目单真演完**：`acts` 与 `plan` 逐项一致（整场：开场语 → 演出 → 长跑 → 谢幕语）
  ② **逐幕读数**：每幕的 work p50/p95/p99 + 掉帧率（单幕异常会被全程平均掩盖）
     ＋ **无缝衔接**（tail_wait ≈ 0）＋ **动画不提前结束**（anim_end ≥ 0.75×跨度——
     防"帧驱动重复 ⇒ 2× 速"这类几何缺陷；2026-10-01 真机实证后新增）
  ③ **四条路径各报一项**（评审点名的"四项挑战全覆盖"）：
     · 弹簧（物理求值）· 波浪（相位编排）· **FLIP 全量重排**（架构差异项，单列）· 螺旋（复合变换）
  ④ **长跑**：内存采样首尾对比（泄漏的机器判据）+ 热状态
  ⑤ **真执行证据**：终值探针（真读层）+ 两张截图（谢幕语收尾 · 非纯背景）

【★与"只报一个 FPS"的差别】单看 FPS 会被"屏幕没动"骗过（静止时也是 60fps）。
  ⇒ 本判据要求 帧数 × 幕序 × 逐幕成本 × 长跑内存 × 终值 × 截图 同时成立，缺一即红。

用法：python3 hosts/ios/check-showcase.py <showcase.json> [final.png] [spiral.png]
退出码：0 全过 / 1 有失败 / 0（产物缺失时诚实跳过）
"""
import json
import os
import sys

# 单幕每帧成本的预算（ms）：一帧 16.7ms 的一半。★这是"任何一幕都不许超出"的线——
# 全程平均达标但某一幕爆掉（如 FLIP 重排那幕）同样判红。
FRAME_BUDGET_MS = 8.0


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print("用法：python3 hosts/ios/check-showcase.py <showcase.json> [final.png] [spiral.png]")
        return 2
    path = args[0]
    png = args[1] if len(args) > 1 else None
    png_spiral = args[2] if len(args) > 2 else None
    if not os.path.exists(path):
        print(f"⚠ 炫技场判据：未找到真机产物（{path}）")
        print("  ⇒ 诚实跳过（跑真机后取回）：bash hosts/ios/run-selfdraw.sh --showcase")
        return 0

    print(f"═══ Morpheus 炫技场判据（B7 口径）：{path} ═══")
    ok = True
    with open(path, encoding="utf-8") as f:
        d = json.load(f)

    def fail(msg: str) -> None:
        nonlocal ok
        print(f"  ✗ {msg}")
        ok = False

    def report(msg: str) -> None:
        print(f"  ✓ {msg}")

    def eq(key, env_name):
        return d.get(key) if d.get(key) is not None else d.get(env_name)

    if d.get("ok") is not True:
        fail(f"场景未成功完成：{d.get('error') or d.get('parse_error') or d}")
        print()
        return 1

    tiles = d.get("tiles", 0)
    grid = d.get("grid") or {}
    plat = d.get("platform", "?")
    soak = d.get("soak") or {}
    print(f"  规模：{tiles} 瓦片 · 网格 {grid.get('cols')}×{grid.get('rows')} · 瓦片 {grid.get('tile')}px · 平台 {plat}")
    if plat == "ios-sim":
        print("  ⚠★模拟器产物：**帧率/帧成本数字不作真机证据**（本仓纪律：模拟器可证接线，性能须真机复测）")

    # ── ① 整场真的演完了（节目单 vs 实际演出逐项一致）──
    plan = d.get("plan") or []
    acts = d.get("acts") or []
    if not plan:
        fail("报告缺 `plan`（节目单）——无法断言整场演出")
    elif len(acts) != len(plan):
        fail(f"演出未走完：实际 {len(acts)} 幕 / 节目单 {len(plan)} 幕（卡在第 {len(acts) + 1} 幕？）")
    elif [a.get("name") for a in acts] != plan:
        got = [a.get("name") for a in acts]
        mismatch = next((i for i, (g, p) in enumerate(zip(got, plan)) if g != p), None)
        fail(f"幕序与节目单不一致（第 {mismatch} 项：实际 {got[mismatch:mismatch + 1]} / 计划 {plan[mismatch:mismatch + 1]}）")
    else:
        report(f"整场演完：{len(acts)} 幕（开场语 {acts[0].get('name')} → … → 谢幕语 {acts[-1].get('name')}）")

    # ── ② 逐幕/全程帧率与每帧成本（B7：p50/p95/p99 全报）──
    fs = d.get("host_perf") or d.get("frame_stats") or {}
    frames = fs.get("frames", 0)
    fps = fs.get("fps", 0)
    p50, p95, p99 = fs.get("work_p50_ms", 999), fs.get("work_p95_ms", 999), fs.get("work_p99_ms", 999)
    ratio = fs.get("dropped_ratio", 1)
    if frames < 1000:
        fail(f"帧数过少（{frames}）——整场（含长跑）应为数千帧；演出没真跑")
    else:
        report(f"帧循环真在跑：{frames} 帧")
    if fps < 55:
        fail(f"全程帧率不达标：{fps} FPS（合格线 55）")
    else:
        report(f"全程帧率：{fps} FPS（vsync p50 {fs.get('vsync_p50_ms')}ms）· 掉帧 {fs.get('dropped')}（{ratio * 100:.2f}%）")
    if p95 > FRAME_BUDGET_MS:
        fail(f"全程每帧成本过高：p95 {p95}ms（预算 {FRAME_BUDGET_MS}ms；p50 {p50} / p99 {p99}）")
    else:
        report(f"全程每帧成本：p50 {p50} · p95 {p95} · p99 {p99} · max {fs.get('work_max_ms')}ms（一帧预算 16.7ms）")
    if ratio > 0.02:
        fail(f"掉帧率过高：{ratio * 100:.2f}%（合格线 ≤2%）")
    else:
        report(f"掉帧率：{ratio * 100:.2f}%")

    # ── ②b 逐幕读数（单幕爆掉不许被全程平均掩盖）──
    perf = d.get("acts_perf") or []
    if len(perf) != len(plan):
        fail(f"逐幕读数不全：{len(perf)}/{len(plan)}（幕边界统计没跑）")
    else:
        worst = max(perf, key=lambda a: a.get("work_p95_ms") or 0)
        over = [a for a in perf if (a.get("work_p95_ms") or 0) > FRAME_BUDGET_MS]
        frame_starved = [a for a in perf if (a.get("frames") or 0) < 8]
        if over:
            names = ", ".join(f"{a['name']}({a['work_p95_ms']}ms)" for a in over[:4])
            fail(f"有幕超出每帧成本预算：{names}")
        else:
            report(f"逐幕成本全部在预算内（最坏：{worst['name']} p95 {worst['work_p95_ms']}ms）")
        if frame_starved:
            names = ", ".join(f"{a['name']}({a['frames']}帧)" for a in frame_starved[:4])
            fail(f"有幕帧数过少（幕长与帧循环脱节？）：{names}")

    # ── ②c 无缝衔接（用户要求"每一幕丝滑衔接，不要每幕结束等会儿再开始"）──
    #   机制：宿主逐帧问内核"还有动画在动吗"（tick 回执的 `active`）——
    #   动画全部结束那一帧即切幕（`hold` 从**动画结束**起算；见 showcase-scene.swift onFrame）
    #   判据：每幕的"尾等待"≈ 零（一帧内）——即动画完成那一帧就切幕
    if perf:
        tails = [(a.get("name"), a.get("tail_wait_ms") or 0) for a in perf]
        bad = [(n, t) for n, t in tails if t > 40]  # 40ms ≈ 2.4 帧：超过即"肉眼可见的停顿"
        if bad:
            names = ", ".join(f"{n}({t}ms)" for n, t in bad[:4])
            fail(f"幕尾有空等（不是无缝衔接）：{names}——动画完成到切幕的间隔过大")
        else:
            worst_tail = max(tails, key=lambda x: x[1])
            report(f"无缝衔接：每幕尾等待 ≤ {worst_tail[1]}ms（最坏 {worst_tail[0]}；一帧 16.7ms）")

    # ── ②d 动画**不提前结束**（★2026-10-01 新增：帧驱动重复 ⇒ 2× 速的机器判据）──
    #   机制：宿主记录**内核报"没有动画在动"的真实时刻**（`anim_end_ms`，随 tick 回执取证）。
    #   1× 速下的期望：曲线/序列幕的 anim_end ≈ 名义跨度（≤ 一帧误差）；弹簧幕（gather）
    #    = 自然静止时间（最大位移 · smooth 弹簧 ≈ 0.86×窗口）⇒ 下限取 **0.75×span**：
    #      · 2× 速（双帧驱动各推进一个 dt）⇒ ≈0.5×span ⇒ **判红**；
    #      · 1.5× 速 ⇒ ≈0.67×span ⇒ **判红**；
    #      · 缺 `anim_end_ms`（宿主未接入该取证）⇒ **判红**（判据不许"没有数据就是绿"）。
    #   ★背景：旧口径（只测 tail_wait）对"提前结束"**完全不可见**——双驱动 bug 就是这样
    #     在"✅ 无缝衔接"下放过了一整轮（真机录屏 55% 时间静止、11/11 幕逐帧吻合 2× 模型）。
    if perf:
        bad_early, missing_end = [], []
        for a in perf:
            span = a.get("span_ms") or 0
            end = a.get("anim_end_ms")
            if end is None:
                missing_end.append(a.get("name"))
            elif span > 0 and end < span * 0.75:
                bad_early.append(f"{a.get('name')}(结束于 {end}ms = {end / span:.2f}×跨度 {span}ms)")
        if missing_end:
            fail(f"缺动画结束取证 `anim_end_ms`：{missing_end[:4]}（宿主未记录内核 active 归零时刻）")
        if bad_early:
            fail("动画提前结束（疑帧驱动重复 ⇒ 播放加速）：" + "、".join(bad_early[:4]))
        if not missing_end and not bad_early:
            ratios = [a["anim_end_ms"] / a["span_ms"] for a in perf if a.get("span_ms") and a.get("anim_end_ms") is not None]
            worst_ratio = min(ratios) if ratios else float("nan")
            report(f"动画不提前结束：逐幕 anim_end/名义跨度 ≥ {worst_ratio:.2f}（1× 速；2× 速约 0.5）")

    # ── ③ 四条路径各报一项（评审点名的"四项挑战全覆盖"）──
    seg_names = {a.get("name"): a for a in acts if isinstance(a, dict)}
    paths = [
        ("弹簧/物理求值", "gather" if "gather" in seg_names else None),
        ("相位编排", "ripple" if "ripple" in seg_names else None),
        ("FLIP 全量重排", "flip-condense" if "flip-condense" in seg_names else None),
        ("复合变换", "spiral" if "spiral" in seg_names else None),
    ]
    missing = [label for label, name in paths if name is None]
    if missing:
        fail(f"四条路径的幕缺失：{missing}（报告里的幕：{list(seg_names)[:8]}…）")
    else:
        parts = []
        for label, name in paths:
            a = seg_names[name]
            parts.append(f"{label} {a.get('anims')} 条指令")
        report("四条路径全覆盖：" + " · ".join(parts))

    # FLIP 幕**单列**（架构差异项）：capture → patch → start 三段齐全 + 内核重排读数
    flip_cap = d.get("flip_flip-condense") or {}
    cap = flip_cap.get("capture") or {}
    patch = flip_cap.get("patch") or {}
    start = flip_cap.get("start") or {}
    if cap.get("ok") is not True or (cap.get("captured") or 0) < tiles:
        fail(f"FLIP capture 异常：{cap}（期望 captured ≥ {tiles}）")
    elif (patch.get("patch_count") or 0) < tiles or patch.get("ok") is not True:
        fail(f"FLIP 全量重排补丁异常：patch_count={patch.get('patch_count')} ok={patch.get('ok')}")
    elif start.get("ok") is not True:
        fail(f"FLIP start 异常：{start}")
    else:
        relayout = patch.get("relayout_count") or 0
        relayout_ms = patch.get("relayout_ms")
        report(
            f"★FLIP 全量重排（单列）：capture {cap.get('captured')} 片 → 全量重排 {relayout} 片"
            f"（内核 {relayout_ms}ms）→ start 补间 {start.get('animated')} 片（maxΔ {start.get('maxDeltaPx')}px）"
        )

    # ── ④ 长跑：内存首尾对比（泄漏的机器判据）+ 热状态 ──
    sm = d.get("soak_mem") or {}
    growth = sm.get("growth_mb")
    soak_ms = soak.get("ms") or 0
    if soak_ms == 0:
        # ★默认形态（用户要求"不用为了时长去一直重复"）：演出**一遍到底**，长跑压力测量未启用。
        #   这是**如实跳过**（不是失败）——压力测量按需开启：PROTEUS_SHOWCASE_SOAK_MS=300000
        print("  ⚠ 长跑未启用（soakMs=0）——内存泄漏/热节流压力测量未测（按需开启，见 README）")
    elif soak_ms < 60_000:
        print(f"  ⚠ 长跑时长短（{soak_ms}ms）——**冒烟值不作为验收结论**（压力测量建议 ≥60000ms）")
    if growth is None:
        print(f"  ⚠ 长跑内存采样不足（{sm.get('samples')} 个）——跳过泄漏判据（不误判）")
    elif growth > 8:
        fail(f"长跑内存增长过大：{growth}MB（{sm.get('head_mb')} → {sm.get('tail_mb')}，采样 {sm.get('samples')} 个）——疑泄漏")
    else:
        report(f"长跑内存：{sm.get('head_mb')} → {sm.get('tail_mb')}MB（增长 {growth}MB · {sm.get('samples')} 采样）")
    thermal = d.get("thermal") or {}
    if thermal.get("end") in ("serious", "critical"):
        fail(f"设备热节流：{thermal.get('start')} → {thermal.get('end')}（读数受节流影响，须冷却后复测）")
    elif thermal.get("end"):
        report(f"热状态：{thermal.get('start')} → {thermal.get('end')}（无节流）")

    # ── ⑤ 真生效（终值探针）+ 视觉证据 ──
    probe = d.get("probe") or {}
    layers = probe.get("layers") or []
    if not layers:
        fail(f"终值探针无读数：{probe}")
    else:
        missing_layers = [l for l in layers if l.get("missing")]
        uninvolved = [l for l in layers if (l.get("scale") or 1) > 0.9]
        if missing_layers:
            fail(f"抽查节点缺层：{missing_layers}")
        elif uninvolved:
            # 谢幕语 = 聚字：**每一片**都该缩到 0.42（亮像素）或 0.18–0.32（星尘）
            # ⇒ 抽查片 scale 仍 ≈1 = 指令没真驱动到层（"帧率好看但屏幕没动"这类假绿）
            fail(f"谢幕语未生效（抽查片 scale 仍 ≈1，真读层）：{uninvolved}")
        else:
            sample = [
                {k: round(v, 2) if isinstance(v, (int, float)) else v for k, v in l.items()}
                for l in layers
            ]
            report(f"终值探针（谢幕语终态·真读层）：{sample}")
    if png and os.path.exists(png):
        size = os.path.getsize(png)
        if size < 20_000:
            fail(f"收尾截图过小（{size} 字节）——疑空白/未渲染")
        else:
            report(f"收尾截图（谢幕语）：{os.path.basename(png)} · {size // 1024} KB")
    elif png:
        fail(f"收尾截图缺失（{png}）")
    if png_spiral and os.path.exists(png_spiral):
        report(f"中场面截图（漩涡定格）：{os.path.basename(png_spiral)} · {os.path.getsize(png_spiral) // 1024} KB")

    print()
    if not ok:
        print("✗ 炫技场未通过（见上方失败项）")
        return 1
    print(
        f"✅ 炫技场通过（B7 口径）：{len(acts)} 幕 · {tiles} 瓦片 · {fps} FPS · 掉帧 {ratio * 100:.2f}% · "
        f"每帧 p50 {p50} / p95 {p95} / p99 {p99}ms · 长跑内存增长 {growth}MB · 四条路径全覆盖"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
