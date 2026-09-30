#!/usr/bin/env python3
"""hosts/ios/check-showcase.py —— ★★Morpheus 炫技场判据（真机产物 showcase.json + 收尾截图）

【这一场要证明什么（用户要求）】「该演示就是动画引擎炫技的存在，要求酷炫，吸睛，丝滑流畅不掉帧，
  而且还能考验动画引擎性能，**在其他跨端框架不敢轻易尝试的那种**」。
⇒ 判据不能只看"跑起来了"，必须回答四个问题：
  ① **真在跑吗**：三段（波浪/FLIP/螺旋）各自声明了指令且帧数在增长（不是"设了没动"）；
  ② **掉帧吗**：帧率 + 掉帧率 + 每帧成本（`work_p95` 必须显著低于一帧预算）；
  ③ **真生效吗**：终值探针（弹簧落到 0 / FLIP 归位 / 螺旋的 scale/rotate 落到目标）；
  ④ **有视觉证据吗**：收尾截图非空且像素有内容（不是纯背景）。

【★与"只报一个 FPS"的差别】单看 FPS 会被"屏幕没动"骗过（静止时也是 60fps）。
  ⇒ 本判据要求 **帧数 × 指令数 × 终值 × 截图** 四条同时成立，缺一即红。

用法：python3 hosts/ios/check-showcase.py <showcase.json> [showcase-final.png]
退出码：0 全过 / 1 有失败 / 0（产物缺失时诚实跳过）
"""
import json
import os
import sys


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print("用法：python3 hosts/ios/check-showcase.py <showcase.json> [showcase-final.png]")
        return 2
    path = args[0]
    png = args[1] if len(args) > 1 else None
    if not os.path.exists(path):
        print(f"⚠ 炫技场判据：未找到真机产物（{path}）")
        print("  ⇒ 诚实跳过（跑真机后取回）：bash hosts/ios/run-selfdraw.sh --showcase")
        return 0

    print(f"═══ Morpheus 炫技场判据：{path} ═══")
    ok = True
    with open(path, encoding="utf-8") as f:
        d = json.load(f)

    def fail(msg: str) -> None:
        nonlocal ok
        print(f"  ✗ {msg}")
        ok = False

    def report(msg: str) -> None:
        print(f"  ✓ {msg}")

    if d.get("ok") is not True:
        fail(f"场景未成功完成：{d.get('error') or d.get('parse_error') or d}")
        print()
        return 1

    tiles = d.get("tiles", 0)
    grid = d.get("grid") or {}
    plat = d.get("platform", "?")
    print(f"  规模：{tiles} 瓦片 · 网格 {grid.get('cols')}×{grid.get('rows')} · 瓦片 {grid.get('tile')}px · 平台 {plat}")
    if plat == "ios-sim":
        print("  ⚠★模拟器产物：**帧率/帧成本数字不作真机证据**（本仓纪律：模拟器可证接线，性能须真机复测）")

    # ── ① 三段都真跑了（指令数 + 帧数）──
    segs = d.get("segments") or []
    by_name = {s.get("name"): s for s in segs if isinstance(s, dict)}
    # ★性能读数在 `host_perf`（宿主侧帧循环统计：fps/p95/dropped）；`frame_stats` 只有帧数。
    #   初版写成 `frame_stats or host_perf` ⇒ 取到 frame_stats（无 fps 字段）⇒ 判据全按缺省值判红
    #   （真机读数其实是 58.46 FPS / p95 2.448ms——判据自己读错路径）。
    fs = d.get("host_perf") or d.get("frame_stats") or {}
    frames = fs.get("frames", 0)
    if len(segs) < 3:
        fail(f"三段未跑满（实得 {len(segs)} 段：{[s.get('name') for s in segs] if segs else '空'}）")
    else:
        wave = by_name.get("wave") or {}
        spiral = by_name.get("spiral") or {}
        # 波浪 = 每片 2 条声明（translateY spring + opacity）⇒ 期望 2×tiles
        if (wave.get("anims") or 0) < tiles * 2:
            fail(f"波浪段指令数异常：{wave.get('anims')}（期望 ≥ {tiles * 2} = 每片 2 条）")
        elif (spiral.get("anims") or 0) < tiles * 4:
            fail(f"螺旋段指令数异常：{spiral.get('anims')}（期望 ≥ {tiles * 4} = 每片 4 条）")
        else:
            report(
                f"三段真跑：wave {wave.get('anims')} 条 / flip（FLIP 补间，见 flip_start）/ "
                f"spiral {spiral.get('anims')} 条 · 总帧数 {frames}"
            )
    if frames < 60:
        fail(f"帧数过少（{frames}）—— 帧循环没真跑满（三段各 ~900ms ⇒ 期望 ≥100 帧）")
    else:
        report(f"帧循环真在跑：{frames} 帧")

    # ── ② 掉帧与每帧成本（丝滑的机器判据）──
    fps = fs.get("fps", 0)
    p95 = fs.get("work_p95_ms", 999)
    p50 = fs.get("work_p50_ms", 999)
    dropped = fs.get("dropped", 999)
    ratio = fs.get("dropped_ratio", 1)
    if fps < 55:
        fail(f"帧率不达标：{fps} FPS（合格线 55）")
    else:
        report(f"帧率：{fps} FPS（vsync p50 {fs.get('vsync_p50_ms')}ms）")
    if p95 > 8:
        fail(f"每帧成本过高：p95 {p95}ms（预算 16.7ms 的一半；p50 {p50}ms）")
    else:
        report(f"每帧成本：p50 {p50}ms · p95 {p95}ms · max {fs.get('work_max_ms')}ms（一帧预算 16.7ms）")
    if ratio > 0.02:
        fail(f"掉帧率过高：{dropped} 帧（{ratio * 100:.2f}%）——合格线 ≤2%")
    else:
        report(f"掉帧：{dropped} 帧（{ratio * 100:.2f}%）")

    # ── ③ 真生效（终值探针：证明指令真的驱动了层）──
    probe = d.get("probe") or {}
    layers = probe.get("layers") or []
    if not layers:
        fail(f"终值探针无读数：{probe}")
    else:
        missing = [l for l in layers if l.get("missing")]
        if missing:
            fail(f"抽查节点缺层：{missing}")
        else:
            # 螺旋段收尾：scale 应显著小于 1（0.35 目标），且 rotate 非零（转过了）
            spiraled = [l for l in layers if abs((l.get("scale") or 1) - 1) > 0.05]
            rotated = [l for l in layers if abs(l.get("rotate") or 0) > 5]
            sample = [
                {k: round(v, 2) if isinstance(v, (int, float)) else v for k, v in l.items()}
                for l in layers
            ]
            if not spiraled:
                fail(f"螺旋段未生效（抽查片 scale 仍为 1）：{sample}")
            elif not rotated:
                fail(f"螺旋段 rotate 未生效：{sample}")
            else:
                report(f"终值探针（真读层）：{sample}")

    # ── ④ FLIP 段自报（capture/start 都成功）──
    cap = d.get("flip_capture") or {}
    fs2 = d.get("flip_start") or {}
    if cap.get("ok") is not True or (cap.get("captured") or 0) < tiles:
        fail(f"FLIP capture 异常：{cap}（期望 captured ≥ {tiles}）")
    elif fs2.get("ok") is not True:
        fail(f"FLIP start 异常：{fs2}")
    else:
        report(f"FLIP：capture {cap.get('captured')} 片 → start 补间（真几何变更驱动）")

    # ── ⑤ 视觉证据（截图非空 + 有内容）──
    if png and os.path.exists(png):
        size = os.path.getsize(png)
        if size < 20_000:
            fail(f"收尾截图过小（{size} 字节）——疑空白/未渲染")
        else:
            report(f"收尾截图：{os.path.basename(png)} · {size // 1024} KB")
    elif png:
        fail(f"收尾截图缺失（{png}）")

    print()
    if not ok:
        print("✗ 炫技场未通过（见上方失败项）")
        return 1
    print(f"✅ 炫技场通过：{tiles} 瓦片三段编舞 · {fps} FPS · 掉帧 {dropped} · 每帧 p95 {p95}ms · 终值真读层")
    return 0


if __name__ == "__main__":
    sys.exit(main())
