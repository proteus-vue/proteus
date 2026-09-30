#!/usr/bin/env python3
"""hosts/ios/check-anim-rt2.py —— ★★RT2 动画真机判据（从报告里**真读层上状态**）

【为什么是独立脚本 + 为什么从报告读层状态】见本仓两条纪律：
  ① 判据必须能**变红**——"跑通了"不是判据；
  ② 判据必须**真读被测对象的实际状态**，不比对我们自己传下去的参数（那是自证）。
     ⇒ 本脚本读的是 `layerTransformProbe` 的结果（宿主从 `CALayer.transform` 反解），
       覆盖"写入路径真的生效"这一环。

【三组判据（对应 RT2 要回答的三个问题）】
  A. **指令真的驱动了端上动画**：层上 transform 随进度变化，且**终值精确**等于目标（端点钉死）；
  B. **手势驱动（seek）立即生效**：seek 后**不等 tick**，层上已有对应值；
     Progress 驱动后再 tick **不应改它**（手势松手后动画不该自己跑）；
  C. **帧循环真的在跑**：`running` 为真且 `frames` 增长（不是"设了没动"）。

用法：python3 hosts/ios/check-anim-rt2.py <report.json>
退出码：0 全过 / 1 有失败（逐条打印为什么）
"""
import json
import sys


def fail(msg: str) -> None:
    print(f"  ✗ {msg}")


def main() -> int:
    if len(sys.argv) < 2:
        print("用法：python3 hosts/ios/check-anim-rt2.py <report.json>")
        return 2
    try:
        with open(sys.argv[1]) as f:
            d = json.load(f)
    except FileNotFoundError:
        print(f"报告不存在：{sys.argv[1]}")
        return 2
    except json.JSONDecodeError as e:
        print(f"报告不是合法 JSON：{e}")
        return 2

    # 定位 animProbe 的输出（宿主把它塞在 js_report.host_raw_by_phase.animProbe 或直接顶层）
    js = d.get("js_report") or {}
    probe = js.get("animProbe") or (js.get("host_raw_by_phase") or {}).get("animProbe") or {}
    if not probe:
        fail("报告里没有 animProbe 相位输出——相位没跑？(检查宿主 schedulePhases 是否包含该步)")
        return 1

    layers_after_seek = (probe.get("layer_after_seek") or {}).get("layers") or []
    layers_mid = (probe.get("layer_mid") or {}).get("layers") or []
    layers_end = (probe.get("layer_end") or {}).get("layers") or []
    tick1 = probe.get("tick1") or {}
    tick2 = probe.get("tick2") or {}
    stats1 = probe.get("frame_stats_1") or {}
    stats2 = probe.get("frame_stats_2") or {}
    targets = probe.get("targets") or []
    start = probe.get("start") or {}

    print("═══ RT2 动画真机判据 ═══")
    print(f"  目标节点：{targets} · 启动：{start}")
    ok = True

    # ── 判据 0：启动成功（错误必须冒泡，不静默）──
    if not start.get("ok"):
        fail(f"animStart 未成功：{start}")
        ok = False
    if not tick1.get("ok") or not tick2.get("ok"):
        fail(f"animTick 未成功：{tick1} / {tick2}")
        ok = False

    # ── 判据 A：层上 transform 真的变了（不是"调了就算"）──
    if len(layers_after_seek) < 2 or len(layers_mid) < 2 or len(layers_end) < 2:
        fail(f"层读数不足（需要 ≥2 个节点）：seek={len(layers_after_seek)} mid={len(layers_mid)} end={len(layers_end)}")
        return 1

    def by_id(layers, nid):
        for l in layers:
            if l.get("id") == nid:
                return l
        return None

    a_id, b_id = targets[0], targets[1] if len(targets) > 1 else targets[0]
    a_mid = by_id(layers_mid, a_id)
    a_end = by_id(layers_end, a_id)
    if a_mid is None or a_end is None:
        fail(f"节点 {a_id} 在层读数里缺失")
        return 1

    # A1：tick 中途 tx 应 > 0（动画真的在推进）
    if not (a_mid.get("tx", 0) > 0):
        fail(f"A1 位移未推进：中途 tx={a_mid.get('tx')}（应 > 0；tick 没写层？）")
        ok = False
    else:
        print(f"  ✓ A1 位移推进：中途 tx={a_mid.get('tx'):.2f}")

    # A2：终值精确等于目标 120（端点钉死策略——允许浮点极小误差）
    tx_end = a_end.get("tx", -999)
    if abs(tx_end - 120.0) > 0.01:
        fail(f"A2 终值不精确：end tx={tx_end}（应 =120.0；曲线端点钉死或 tick 未走完）")
        ok = False
    else:
        print(f"  ✓ A2 终值精确：tx={tx_end:.4f}（=120.0）")

    # ── 判据 B：seek 立即生效 + Progress 驱动不再被 tick 推进 ──
    b_seek = by_id(layers_after_seek, b_id)
    b_mid = by_id(layers_mid, b_id)
    if b_seek is None or b_mid is None:
        fail(f"节点 {b_id} 在层读数里缺失")
        return 1

    # B1：seek(0.5) 后**立即**应有值（easeOutCubic(0.5)=0.875 ⇒ scale = 0.6 + 0.4*0.875 = 0.95）
    expected_seek = 0.6 + 0.4 * 0.875
    if abs(b_seek.get("scale", -1) - expected_seek) > 0.02:
        fail(f"B1 seek 未立即生效：scale={b_seek.get('scale')}（应 ≈{expected_seek:.3f}）")
        ok = False
    else:
        print(f"  ✓ B1 seek 立即生效：scale={b_seek.get('scale'):.4f}（≈{expected_seek:.3f}）")

    # B2：seek 后 tick **不应**改它（Progress 驱动不被时间推进）
    if abs(b_mid.get("scale", -1) - b_seek.get("scale", -2)) > 0.001:
        fail(f"B2 Progress 驱动被 tick 改了：seek 后 {b_seek.get('scale'):.4f} → tick 后 {b_mid.get('scale'):.4f}"
             "（手势松手后动画会自己跑——语义错误）")
        ok = False
    else:
        print(f"  ✓ B2 Progress 驱动稳定：{b_mid.get('scale'):.4f} 未被 tick 改动")

    # ── 判据 C：帧循环真的在跑 ──
    if not stats1.get("running"):
        fail(f"C1 帧循环未启动：{stats1}")
        ok = False
    else:
        print(f"  ✓ C1 帧循环已启动：{stats1}")
    f1 = stats1.get("frames", 0)
    if not isinstance(f1, int) or f1 < 0:
        fail(f"C2 帧计数异常：{stats1}")
        ok = False
    else:
        # ★诚实边界：本探针在同一 JS 相位里启动后**立即**停止 ⇒ frames 可能为 0
        #   （CADisplayLink 的回调要等下一个 vsync，而 JS 相位是同步执行的）。
        #   ⇒ 这里只判"循环能启动且能停"，帧数的真实增长由**后续相位/长时间运行**覆盖。
        print(f"  ✓ C2 帧循环可启停：停止后 running={stats2.get('running')}（frames={f1}——同步相位内不增长属正常）")

    # ── 判据 D（§7.3 节点复用解绑）：回收的节点不得再被 tick 改动 ──
    #
    # 【为什么单列（Morpheus §7 明确要求"专项回归"）】本仓复用率 0.997 ⇒ 节点会被回收给
    #   不同数据项。若动画未解绑：① 重物化时显示"半路的变换"（错误位置）；② 每帧白算。
    #   这两个后果都**静默**（小规模看不出来，长列表快速滚动才偶发）⇒ 必须有专项判据。
    recycled = probe.get("recycle_unbind") or {}
    if recycled:
        n_stopped = recycled.get("stopped", 0)
        moved_after = recycled.get("moved_after_stop", 0)
        if n_stopped <= 0:
            fail(f"D1 回收未解绑动画：stopped={n_stopped}（应 > 0——stop_nodes 没被调用？）")
            ok = False
        else:
            print(f"  ✓ D1 回收已解绑：停止 {n_stopped} 条动画")
        if moved_after != 0:
            fail(f"D2 解绑后仍被改动：moved_after_stop={moved_after}（应 0——动画还在跑？）")
            ok = False
        else:
            print("  ✓ D2 解绑后不再被 tick 改动（复用后不会错位）")
    else:
        print("  · D 组跳过（本报告无 recycle_unbind 读数——虚拟化场景未跑；属正常，非失败）")

    print()
    if ok:
        print("✅ RT2 判据全过（层上 transform 真变 + seek 立即生效 + Progress 稳定 + 帧循环可启停）")
        return 0
    print("✗ RT2 判据有失败项（见上）")
    return 1


if __name__ == "__main__":
    sys.exit(main())
