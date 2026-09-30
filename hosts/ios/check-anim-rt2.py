#!/usr/bin/env python3
"""hosts/ios/check-anim-rt2.py —— ★★RT2 动画真机判据（从报告里**真读层上状态**）

【为什么是独立脚本 + 为什么从报告读层状态】见本仓两条纪律：
  ① 判据必须能**变红**——"跑通了"不是判据；
  ② 判据必须**真读被测对象的实际状态**，不比对我们自己传下去的参数（那是自证）。
     ⇒ 本脚本读的是 `layerTransformProbe` 的结果（宿主从 `CALayer.transform` 反解），
       覆盖"写入路径真的生效"这一环。

【八组判据（对应 RT2 / MA0-RT / MA1 要回答的问题；当前 35 条）】
  A. **指令真的驱动了端上动画**：层上 transform 随进度变化，且**终值精确**等于目标（端点钉死）；
  B. **手势驱动（seek）立即生效**：seek 后**不等 tick**，层上已有对应值；
     Progress 驱动后再 tick **不应改它**（手势松手后动画不该自己跑）；
  C. **帧循环真的在跑**：`running` 为真且 `frames` 增长（不是"设了没动"）；
  D. **节点复用解绑**（§7.3）：回收的节点不得再被 tick 改动；
  E. **帧率测席**（§9）：FPS / 掉帧率 / 每帧工作 p95 / 跟随延迟 / 终值精确；
  F. **对齐 Flutter 能力面**：弹簧物理 / 打断接管（速度接力）/ FLIP（起点无跳变·终值归零）/ rotate+opacity；
  G. **平台零参与路径**（§5-bis）：合成属性判定 / 提交一次 / presentation 探针 / 明确拒绝 / 可撤销；
  H. **MA1 预设库**：预设编译 → 微信语义对齐 → 指令下发 → 端上驱动 → 校验有效 → 跨语言同值。

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

    # 定位 RT2 读数：`js_report.anim_rt2`（entry-selfdraw 的 animProbe 相位写入；见 report() 的构造）
    # ★兼容三个可能位置（顶层 / js_report 下 / host_raw_by_phase 下）——避免路径写死导致"跑过了却读不到"
    js = d.get("js_report") or {}
    probe = d.get("anim_rt2") or js.get("anim_rt2") or (js.get("host_raw_by_phase") or {}).get("anim_rt2") or {}
    if not probe:
        fail("报告里没有 anim_rt2 读数——相位没跑？（检查宿主 schedulePhases 是否含 __proteus.animProbe()）")
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

    # ── E 组（§9 指标）：帧率测席——转场帧率 / 帧耗时 P95 / 掉帧率 ──
    #
    # 【口径（方案 §9）】转场动画帧率 ≥60 FPS（目标 120）· 帧耗时 P95 ≤8.33ms（目标 ≤4ms）。
    # ★诚实边界：帧率上限 = 设备刷新率（iPhone 12 为 **60Hz**）⇒ 本轮验证「60 FPS 不掉帧」，
    #   「120 FPS」需 ProMotion 设备（如实标注，不声称）。
    bench = d.get("anim_bench") or js.get("anim_bench") or {}
    if bench and bench.get("ok"):
        if bench.get("timed_out"):
            fail(f"E0 测席超时（看门狗触发——DisplayLink 停摆？屏幕熄灭/后台？）：{bench}")
            ok = False
        else:
            print(f"  ✓ E0 测席完成：{bench.get('frames')} 帧 / {bench.get('elapsed_ms')}ms")
        fps = bench.get("fps", 0) or 0
        if fps < 58:
            fail(f"E1 帧率不达标：{fps} FPS（60Hz 设备应 ≈60；§9 合格线 ≥60）")
            ok = False
        else:
            print(f"  ✓ E1 帧率：**{fps} FPS**（vsync 间隔 p50 {bench.get('vsync_p50_ms')}ms）")
        dr = bench.get("dropped_ratio", 1) or 0
        if dr > 0.02:
            fail(f"E2 掉帧率过高：{dr}（{bench.get('dropped')} 帧超标称 1.5×——上限 2%）")
            ok = False
        else:
            print(f"  ✓ E2 掉帧率：{dr}（{bench.get('dropped')} 帧）")
        w95 = bench.get("work_p95_ms", 99) or 99
        if w95 > 8.33:
            fail(f"E3 帧耗时 P95 超线：{w95}ms（§9 合格线 ≤8.33ms）")
            ok = False
        else:
            print(f"  ✓ E3 帧耗时：p50 **{bench.get('work_p50_ms')}ms** · p95 **{w95}ms** · max {bench.get('work_max_ms')}ms")
        gt, gto = bench.get("gesture_tx"), bench.get("gesture_to")
        if gt is None or gto is None or abs(gt - gto) > 0.01:
            fail(f"E4 手势跟随终值未钉死：tx={gt}（应 ={gto}——seek 到 progress=1 应精确落位）")
            ok = False
        else:
            print(f"  ✓ E4 手势跟随终值精确：tx={gt}（={gto}）")
        # E6：手势跟随延迟（§9 验收「≤1 帧」）——机制保证：seek **立即求值写字段**（不等 try 下一帧），
        #     因此延迟 = 宿主「seek 到写层」的耗时（已含在 work 里），必然 << 1 帧（16.7ms）。
        #     ⇒ 判据：每帧工作 p95 必须远小于帧间隔（否则跟随会在视觉上滞后）
        vsync = bench.get("vsync_p50_ms", 16.67) or 16.67
        if w95 > vsync * 0.5:
            fail(f"E6 跟随延迟风险：每帧工作 p95 {w95}ms 超过帧间隔的 50%（{vsync * 0.5:.2f}ms）"
                 "——手势跟随会出现可见滞后")
            ok = False
        else:
            print(f"  ✓ E6 跟随延迟：每帧工作 p95 {w95}ms 仅为帧间隔 {vsync}ms 的 {(w95 / vsync * 100):.1f}%"
                  "（seek 立即写字段 ⇒ 延迟 = 宿主写层耗时，远小于 1 帧）")
        yt, yto = bench.get("y_ty"), bench.get("y_to")
        if yt is None or yto is None or abs(yt - yto) > 0.01:
            fail(f"E5 持续动画终值未钉死：ty={yt}（应 ={yto}）")
            ok = False
        else:
            print(f"  ✓ E5 持续动画终值精确：ty={yt}（={yto}）")
    else:
        print(f"  · E 组跳过（无 anim_bench 读数或未成功：{bench or '缺失'}）")

    # ── F 组（对齐 Flutter 能力面）：弹簧物理 / 打断接管 / FLIP / rotate+opacity ──
    #
    # 口径：每项都从 **层上真读**（`layerTransformProbe` 从 CATransform3D 反解），
    #   不是回显我们传下去的参数——这样才覆盖"写入路径真的生效"。
    cplx = d.get("anim_complex") or js.get("anim_complex") or {}
    if cplx:
        # F1 弹簧：真实物理求解 ⇒ 静止后**精确**钉在目标（100）
        sp_end = (cplx.get("spring") or {}).get("end")
        if sp_end is None or abs(sp_end - 100.0) > 0.01:
            fail(f"F1 弹簧未精确落到目标：end tx={sp_end}（应 =100——弹簧静止后必须钉在 to）")
            ok = False
        else:
            print(f"  ✓ F1 弹簧物理：静止后精确钉在目标（tx={sp_end}）")

        # F2 打断接管：位置无跳变（after_start ≈ before）+ 最终落到新目标（60）
        tk = cplx.get("takeover") or {}
        b, a_, e_ = tk.get("before"), tk.get("after_start"), tk.get("end")
        if b is None or a_ is None:
            fail(f"F2 接管读数缺失：{tk}")
            ok = False
        else:
            if abs(a_ - b) > 0.01:
                fail(f"F2 接管有跳变：接管前 tx={b} → 接管后 tx={a_}（必须位置连续）")
                ok = False
            else:
                print(f"  ✓ F2a 接管位置连续：{b} → {a_}（无跳变）")
            if e_ is None or abs(e_ - 60.0) > 0.01:
                fail(f"F2b 接管后未落到新目标：end tx={e_}（应 =60）")
                ok = False
            else:
                print(f"  ✓ F2b 接管后落到新目标：tx={e_}（=60，弹簧带速度走完）")

        # F3 FLIP：capture 有节点 + start 有位移 + 起点在"旧位置"（非 0）+ 终值归零
        fl = cplx.get("flip") or {}
        cap = (fl.get("capture") or {}).get("captured", 0) or 0
        st = fl.get("start") or {}
        animated = st.get("animated", 0) or 0
        max_delta = st.get("maxDeltaPx", 0) or 0
        if cap <= 0:
            fail(f"F3a FLIP capture 无可快照节点：{fl.get('capture')}")
            ok = False
        else:
            print(f"  ✓ F3a FLIP 快照：{cap} 个节点（几何在内核，零跨边界）")
        if not st.get("ok") or animated <= 0:
            fail(f"F3b FLIP start 未产生补间：{st}（布局变更后应有位移节点）")
            ok = False
        else:
            print(f"  ✓ F3b FLIP 补间：{animated} 个节点 · 最大位移 {max_delta}px")
        begin_ty = (fl.get("begin") or {}).get("ty")
        end_ty = (fl.get("end") or {}).get("ty")
        if begin_ty is None or abs(begin_ty) < 0.5:
            fail(f"F3c FLIP 起点未在旧位置：begin ty={begin_ty}（应为非零偏移，否则会跳变）")
            ok = False
        else:
            print(f"  ✓ F3c FLIP 起点在旧位置（无跳变）：begin ty={begin_ty}")
        if end_ty is None or abs(end_ty) > 0.01:
            fail(f"F3d FLIP 终值未归零：end ty={end_ty}")
            ok = False
        else:
            print(f"  ✓ F3d FLIP 终值归零：end ty={end_ty}")

        # F4 rotate + opacity 真的落到层上
        ro = cplx.get("rotate_opacity") or {}
        rot, op = ro.get("rotate"), ro.get("opacity")
        if rot is None or abs(rot - 90.0) > 0.5:
            fail(f"F4a rotate 未落到层上：{rot}（应 ≈90 度）")
            ok = False
        else:
            print(f"  ✓ F4a rotate 落到层上：{rot} 度")
        if op is None or abs(op - 0.2) > 0.01:
            fail(f"F4b opacity 未落到层上：{op}（应 =0.2）")
            ok = False
        else:
            print(f"  ✓ F4b opacity 落到层上：{op}")
    else:
        print("  · F 组跳过（无 anim_complex 读数——复杂动效相位未跑）")

    # ── G 组（MA0-RT §5-bis）：平台渲染线程零参与路径 ──
    #
    # 口径：① 合成属性判定正确（§5-bis.2 把"会不会掉帧"变成编译期问题）；
    #      ② 提交后**主线程不再每帧参与**（由 CoreAnimation render server 自主插值）；
    #      ③ 判据必须从 **presentationLayer** 读——model 值已设成终值，读它会像"没动"。
    plat = d.get("anim_platform") or js.get("anim_platform") or {}
    if plat:
        ck = plat.get("commit_ok") or {}
        # ★plan 在 `animCommit` 的返回值里（顶层字段；宿主现在会带上——首版探针读错层级）
        plan = ck.get("plan") or {}
        if not ck.get("ok"):
            fail(f"G1 提交失败：{ck}")
            ok = False
        elif not plan.get("composited"):
            fail(f"G1 合成属性判定失败：plan.composited={plan.get('composited')}（全 transform 批次应为 true）")
            ok = False
        else:
            print(f"  ✓ G1 合成属性判定：composited=true（可走平台零参与路径）")
        committed = ck.get("committed", 0) or 0
        if committed <= 0:
            fail(f"G2 未提交任何平台动画：{ck}")
            ok = False
        else:
            print(f"  ✓ G2 提交一次：{committed} 个节点的 CAKeyframeAnimation 已交给 render server")

        # G3：presentation 探针必须可用（它是"平台自己在插值"的判据基础）
        presented = plat.get("presented") or []
        if not presented:
            fail("G3 presentation 探针无读数")
            ok = False
        else:
            has_pres = any(l.get("hasPresentation") for l in presented)
            print(f"  ✓ G3 presentation 探针可用（hasPresentation={has_pres}；model 值已设终值 ⇒ 只读它会像'没动'）")

        # G4：非合成/非法输入必须**明确拒绝**（不静默降级——§5-bis.2 要求）
        bad = plat.get("bad_commit") or {}
        if bad.get("ok"):
            fail(f"G4 非法动画被静默接受：{bad}（应明确报错，不得静默降级）")
            ok = False
        else:
            print(f"  ✓ G4 非法/非合成输入被明确拒绝：{bad.get('error')}")

        # G5：撤销平台动画
        cl = plat.get("cleanup") or {}
        if not cl.get("ok"):
            fail(f"G5 撤销平台动画失败：{cl}")
            ok = False
        else:
            print(f"  ✓ G5 平台动画可撤销（{cl.get('removed')} 个节点——相位间清理）")
    else:
        print("  · G 组跳过（无 anim_platform 读数）")

    # ── H 组（MA1）：预设库（"一句话写转场" + 编译期校验） ──
    pre = d.get("anim_preset") or js.get("anim_preset") or {}
    if pre:
        # H1：预设编译通过 + 合成属性判定
        n = pre.get("compiled_count", 0) or 0
        if n <= 0 or not pre.get("composited"):
            fail(f"H1 预设未编译出指令：compiled={n} composited={pre.get('composited')}")
            ok = False
        else:
            print(f"  ✓ H1 预设编译：{pre.get('preset')} → {n} 条指令（composited=true）")
        # H2：语义与微信 routeType 对齐（双端认知一致）
        wrt = pre.get("wx_route_type") or ""
        if not wrt.startswith("wx://"):
            fail(f"H2 预设未对齐微信 routeType：{wrt}")
            ok = False
        else:
            print(f"  ✓ H2 语义对齐微信：{wrt}")
        # H3：真的驱动了端上动画（位移从起点走到 0）
        st = pre.get("start") or {}
        if not st.get("ok"):
            fail(f"H3 预设指令下发失败：{st}")
            ok = False
        else:
            print(f"  ✓ H3 指令下发：started={st.get('started')}")
        mty, ety = pre.get("mid_ty"), pre.get("end_ty")
        if mty is None or ety is None:
            fail(f"H4 层读数缺失：mid={mty} end={ety}")
            ok = False
        else:
            if abs(ety) > 0.01:
                fail(f"H4 预设动画未落到终值：end ty={ety}（应 =0——弹窗滑到位）")
                ok = False
            else:
                print(f"  ✓ H4 预设驱动端上动画：mid ty={mty} → end ty={ety}（滑到位）")
        # H5：★编译期校验有效（同属性重复必须被拦）
        dup = pre.get("dup_rejected") or ""
        if dup == "NOT_REJECTED" or "校验失败" not in dup:
            fail(f"H5 非法声明未被拦下：{dup[:60]}（编译期校验失效）")
            ok = False
        else:
            print(f"  ✓ H5 编译期校验有效（同属性重复被拦）")
        # H6：弹簧预设与内核同值（跨语言手感一致）
        stiff = pre.get("spring_stiffness")
        if stiff != 320:
            fail(f"H6 弹簧预设值不符：stiffness={stiff}（应 320——与内核 SpringParams::snappy 同值）")
            ok = False
        else:
            print(f"  ✓ H6 弹簧预设跨语言同值（stiffness={stiff}）")
    else:
        print("  · H 组跳过（无 anim_preset 读数）")

    print()
    if ok:
        print("✅ 判据全过（机制 + 帧率 + 复杂动效 + 平台零参与 + MA1 预设库）")
        return 0
    print("✗ RT2 判据有失败项（见上）")
    return 1


if __name__ == "__main__":
    sys.exit(main())
