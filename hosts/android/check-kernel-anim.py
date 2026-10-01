#!/usr/bin/env python3
"""hosts/android/check-kernel-anim.py —— ★Android **内核驱动动画**判据（tick 路径）

【为什么要有它（本轮补齐的跨端缺口）】Android 此前只有**平台**路径（容器级 / 载体 View），
  **没有**内核驱动通路 ⇒ 序列编排（keyframes）、滚动联动、共享元素在 Android 上**根本无法运行**。
  本轮补了 JNI + 宿主渲染 + 本判据。

【与 iOS 判据的关系】语义同源（`hosts/ios/check-anim-rt2.py` 的 I/J/K 组），
  但**读数形态不同**（iOS 读 CALayer 变换，Android 读宿主侧 `animTx` 真源）——
  ⇒ 各自脚本、各自判据；**语义对齐**（同一组探针问题）。

【判据】
  M1 启动：内核真的受理（started ≥ 1）
  M2 **曲线求值发生**：固定 dt 下值按 easeOut 走（单调、且中点快于线性——不是线性跳变）
  M3 终值精确（端点钉死：120）
  M5 序列：分段定位 + 段边界精确（0.6）+ 终值 1.0
  M6 滚动联动：窗口映射（0→0 / 200→-80 / 400→-160）
  M7 共享元素：内核几何齐备（dx/dy/scale）
  M4 真帧循环：帧数 > 0 + 每帧工作 p50 有值 + **动画期间 measure/layout 增量为 0**
  M4e ★帧率达到显示器刷新率（2026-10-01 加：120Hz 设备上「120 FPS」可断言——
       fps ≥ refresh×0.90 且 vsync p50 ≤ (1000/refresh)×1.15；无刷新率基线则如实跳过）

用法：python3 hosts/android/check-kernel-anim.py <kernel-anim.json>
退出码：0 全过 / 1 有失败 / 0（产物缺失时诚实跳过）
"""
import json
import os
import sys


def fail(msg):
    print(f"  ✗ {msg}")


def _layers(probe):
    """把 `{"ok":true,"layers":[…]}` 或裸 dict 统一成首元素（宿主探针可能被包在 JSONObject 里）"""
    if isinstance(probe, dict) and "layers" in probe:
        arr = probe.get("layers") or []
        return arr[0] if arr else {}
    if isinstance(probe, dict):
        return probe
    return {}


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print("用法：python3 hosts/android/check-kernel-anim.py <kernel-anim.json>")
        return 2
    path = args[0]
    if not os.path.exists(path):
        print(f"⚠ 内核动画判据：未找到真机产物（{path}）")
        print("  ⇒ 诚实跳过（跑真机后取回）：")
        print("     adb shell am broadcast -a dev.proteus.RUN --es path kernel-anim")
        print("     adb pull /sdcard/Android/data/dev.proteus.layoutcore/files/kernel-anim.json hosts/android/results/")
        return 0

    print(f"═══ Android 内核驱动动画判据：{path} ═══")
    ok = True
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except Exception as e:
        fail(f"报告读不出（文件存在但解析失败——产物坏了，必须拦）：{e}")
        return 1

    # ── M1：启动受理 ──
    start = d.get("start")
    if isinstance(start, str):
        try:
            start = json.loads(start)
        except Exception:
            start = {}
    started = (start or {}).get("started", 0)
    if not started:
        fail(f"M1 内核未受理动画：{d.get('start')}")
        ok = False
    else:
        print(f"  ✓ M1 内核受理：started={started}")

    # ── M2/M3：曲线求值 + 端点钉死 ──
    trace = [_layers(x) for x in (d.get("trace") or [])]
    if len(trace) < 3:
        fail(f"M2 读数不足：trace={len(trace)} 条（应 ≥3）")
        ok = False
    else:
        txs = [float(t.get("tx", 0.0)) for t in trace]
        # 单调不减（easeOut 且目标为正 ⇒ 应严格递增到 120）
        mono = all(txs[i] <= txs[i + 1] + 1e-3 for i in range(len(txs) - 1))
        if not mono:
            fail(f"M2 曲线求值异常（非单调）：{txs}")
            ok = False
        else:
            print(f"  ✓ M2 曲线求值发生（单调推进）：{[round(x, 1) for x in txs]}")
        # 关键：easeOut 在中点应**快于线性**（证明不是线性插值）
        #   t=100ms/300ms ⇒ u≈0.333；easeOut(0.333)=1-(1-0.333)³≈0.704 ⇒ 值≈84.5（线性只有 44.4）
        mid = txs[1] if len(txs) > 1 else 0.0
        if mid < 60.0:
            fail(f"M2b 曲线未体现 easeOut 特征（第 2 个采样仅 {mid:.1f}，easeOut 应 > 60）——像线性插值")
            ok = False
        else:
            print(f"  ✓ M2b 曲线形态正确（easeOut 前段快于线性：{mid:.1f} > 线性 44.4）")
    end = _layers(d.get("fixed_end"))
    et: float = float(end.get("tx", -1))
    if abs(et - 120.0) > 0.01:
        fail(f"M3 终值不精确：tx={et}（应 =120——端点钉死）")
        ok = False
    else:
        print(f"  ✓ M3 终值精确（端点钉死）：tx={et}")

    # ── M5：序列（分段定位 + 段边界精确） ──
    seq = [_layers(x) for x in (d.get("seq_trace") or [])]
    scales = [float(x.get("scale", -1.0)) for x in seq]
    if len(scales) < 4:
        fail(f"M5 序列读数不足：{scales}")
        ok = False
    else:
        # 步进 50/50/100/200 ⇒ 累计 50 / 100（**首段边界**）/ 200 / 400
        #   预期：0.8 / 0.6（精确）/ 0.9 / 1.0
        s50, s100, s200, s400 = scales[0], scales[1], scales[2], scales[3]
        if abs(s50 - 0.8) > 0.01:
            fail(f"M5a 首段半程不符：{s50}（应 ≈0.8）")
            ok = False
        elif abs(s100 - 0.6) > 0.005:
            fail(f"M5b **段边界不精确**：{s100}（应 =0.6——分段定位的硬判据）")
            ok = False
        elif abs(s200 - 0.9) > 0.01:
            fail(f"M5c 次段半程不符：{s200}（应 ≈0.9）")
            ok = False
        elif abs(s400 - 1.0) > 0.005:
            fail(f"M5d 序列终值不符：{s400}（应 =1.0）")
            ok = False
        else:
            print(f"  ✓ M5 序列分段定位正确：50ms→{s50:.3f} · 100ms→{s100:.3f}（段边界精确）· 200ms→{s200:.3f} · 400ms→{s400:.3f}")

    # ── M6：滚动联动（窗口映射） ──
    sc = [_layers(x) for x in (d.get("scroll_trace") or [])]
    tys = [float(x.get("ty", 0.0)) for x in sc]
    if len(tys) < 3:
        fail(f"M6 滚动读数不足：{tys}")
        ok = False
    else:
        if abs(tys[0]) > 0.01 or abs(tys[1] + 80.0) > 0.5 or abs(tys[2] + 160.0) > 0.5:
            fail(f"M6 窗口映射不符：0→{tys[0]} / 200→{tys[1]}（应 -80）/ 400→{tys[2]}（应 -160）")
            ok = False
        else:
            print(f"  ✓ M6 滚动联动映射正确（窗 0..400 × 0.4）：0→{tys[0]:.2f} · 200→{tys[1]:.2f} · 400→{tys[2]:.2f}")

    # ── M6b：★真手势滚动（2026-10-01 收诚实边界）──
    #   与 M6 的区别：M6 直接调 `kernelAnimSeekScroll`（只证内核映射）；
    #   本组用**真实 MotionEvent 序列**（DOWN + 3×MOVE + UP）走 `GestureDetector.onScroll`
    #   → 生产通路 `scrollDragBy`（内容偏移 + 内核 seek + 写层）——
    #   "手指拖拽"这一环真的被走到，不是合成替身。
    gse = d.get("gesture_scroll_error")
    gst = d.get("gesture_scroll_trace")
    if gse:
        fail(f"M6b 真手势滚动抛异常：{gse}")
        ok = False
    elif not isinstance(gst, list) or len(gst) != 3:
        fail(f"M6b 真手势滚动读数缺失：{gst}（应 [scrollY, ty, driveDelta]）")
        ok = False
    else:
        scroll_y, ty, drive_delta = gst[0], gst[1], gst[2]
        # ★断言写在**语义层**（不押绝对值）：手指上移 ⇒ 滚动量 > 0 ⇒ 内容上移；
        #   视差 ty 与滚动量必须满足内核窗口映射（-0.4×scroll），**且方向为负**。
        #   （不押 scrollY==100：触摸 slop 会吃掉起步的一小段——押绝对值 = 押装置细节。）
        if scroll_y <= 0:
            fail(f"M6b 真手势未驱动内容偏移：scrollY={scroll_y}（手指上移应 ⇒ 向下滚动 ⇒ >0）")
            ok = False
        elif ty == -2147483648:
            fail("M6b 视差层位读不到（探针失败——哨兵值）")
            ok = False
        elif not (ty < 0):
            fail(f"M6b 视差方向错：ty={ty}（内容上移 ⇒ 视差层应上移 ⇒ ty<0）")
            ok = False
        elif abs(ty - (-0.4 * scroll_y)) > 1.0:
            fail(f"M6b 视差与滚动量不满足内核窗口映射：ty={ty} 应 ≈ -0.4×{scroll_y}={-0.4 * scroll_y:.1f}")
            ok = False
        elif not (drive_delta and drive_delta > 0):
            fail(f"M6b 生产通路出口未被驱动：drive_delta={drive_delta}（GestureDetector.onScroll 未接线？）")
            ok = False
        else:
            print(f"  ✓ M6b ★真手势滚动（真实 MotionEvent → GestureDetector → 生产通路）："
                  f"手指上移 ⇒ scrollY={scroll_y} · 视差 ty={ty}（≈-0.4×{scroll_y}）· 出口驱动 {drive_delta} 次")

    # ── P 组（★★颜色通道，2026-10-01）：一个声明 → 四条内核通道 → 宿主写色 → 复位回底色 ──
    #
    # 【与 iOS 腿同一条链、同一套判据】声明面（kind 5..8）→ 内核算值 → 28B 记录 →
    #   宿主颜色覆盖表；本端"真读"= 宿主真源 `animColor`（经 `animTxProbe` 的 `bg` 字段报出）。
    ce = d.get("color_error")
    if ce:
        fail(f"P 颜色场景抛异常：{ce}")
        ok = False
    else:
        cs = d.get("color_start") or {}
        start_result = cs.get("data") if isinstance(cs, dict) and "data" in cs else cs
        started = (start_result or {}).get("started") if isinstance(start_result, dict) else None
        if started != 4:
            fail(f"P1 颜色指令未被内核受理：{start_result}（应 started=4——四条通道）")
            ok = False
        else:
            print(f"  ✓ P1 一个声明 → 四条通道指令（kind 5..8）· 内核受理 started={started}")

        mid = _layers(d.get("color_mid"))
        end = _layers(d.get("color_end"))
        stop = _layers(d.get("color_after_stop"))
        bg_mid = (mid.get("bg") or "").upper()
        bg_end = (end.get("bg") or "").upper()
        bg_stop = (stop.get("bg") or "").upper()
        # ② 端到端：真读宿主真源。#3366CC → #FF0000（linear）
        if not bg_mid or not bg_end:
            fail(f"P2 颜色读数缺失：mid={bg_mid!r} end={bg_end!r}（宿主未报 bg？）")
            ok = False
        elif bg_end != "FFFF0000":
            fail(f"P2 终点不精确：宿主 bg={bg_end}（应 FFFF0000 = #FF0000）")
            ok = False
        elif bg_mid == bg_end or bg_mid == "FF3366CC":
            fail(f"P2b 半程未见中间色：mid={bg_mid}（三层值应互不相同）")
            ok = False
        else:
            print(f"  ✓ P2 ★颜色端到端（真读宿主真源）：FF3366CC → {bg_mid} → {bg_end}")
        # ③ 复位回底色（不是停在末帧）
        if bg_stop != "FF3366CC":
            fail(f"P3 stop 后未回底色：bg={bg_stop}（应回 FF3366CC）——残留颜色会污染后续相位")
            ok = False
        else:
            print(f"  ✓ P3 复位回底色：{bg_stop}（stop 后不留末帧颜色）")
        # ④ 拒绝分支：无底色节点（节点 12）必须明确拒绝
        rej = d.get("color_rejected") or ""
        rej_s = json.dumps(rej, ensure_ascii=False) if isinstance(rej, dict) else str(rej)
        if "底色" not in rej_s:
            fail(f"P4 无底色节点上的颜色动画未被明确拒绝：{rej_s[:140]}")
            ok = False
        else:
            print(f"  ✓ P4 无底色节点明确拒绝：{rej_s[:80]}…")

    # ── M7：共享元素（内核几何） ──
    se = d.get("shared_element")
    if isinstance(se, str):
        try:
            se = json.loads(se)
        except Exception:
            se = {}
    se = se or {}
    if not se.get("ok") or se.get("dx") is None or se.get("scale") is None:
        fail(f"M7 共享元素几何未算出：{str(se)[:160]}")
        ok = False
    else:
        print(f"  ✓ M7 共享元素内核几何：dx={se.get('dx'):.1f} dy={se.get('dy'):.1f} scale={float(se.get('scale')):.3f}")

    # ── M4：真帧循环（帧数 + 每帧工作 + **零 measure/layout**） ──
    fl = d.get("frame_loop")
    if isinstance(fl, str):
        try:
            fl = json.loads(fl)
        except Exception:
            fl = {}
    fl = fl or {}
    frames = fl.get("frames", 0) or 0
    p50 = fl.get("work_p50_ms")
    # ★口径（与 carrierAnimStats 同一先例）：量**稳态窗口**内的 measure/layout 增量——
    #   接入 View 触发的**一次性 traversal** 不算"动画期间"（`boot_*_delta` 如实记录该成本）。
    md, ld = fl.get("measure_delta"), fl.get("layout_delta")
    first_delay = fl.get("first_frame_delay_ms")
    if frames <= 0:
        fail(f"M4 真帧循环未推进：frames={frames}（frame_loop={str(fl)[:120]}）")
        ok = False
    elif p50 is None or p50 < 0:
        fail(f"M4b 每帧工作读数缺失：p50={p50}")
        ok = False
    elif frames < 10:
        # ★帧数下限：真机实测首版 `postOnAnimation` 被"排队" ⇒ frames=1（首帧即停）。
        #   帧数太少既说明装置有问题，也不足以支撑 p50/p95 的统计意义。
        # ★本判据实测抓到两类装置缺陷（都在真机上真发生过）：
        #   ① `View.postOnAnimation` 对未 attach 的 View 会**排队**（已改用 Choreographer）；
        #   ② 测试**同步**跑在 `runAll()` 里 ⇒ 被同批重活（§9.2 采样循环）**饿死**主线程，
        #      首帧延迟 3505ms ⇒ 首帧即停。修法是 `postDelayed` 让出主线程（见宿主注释）。
        fail(f"M4d 帧数过少：frames={frames}（应 ≥10——500ms/16.7ms ≈ 30）；首帧延迟={first_delay}ms"
             f"（很大 ⇒ 帧回调被饿死/排队：检查测试是否与重活同批、或用了 postOnAnimation）")
        ok = False
    elif md != 0 or ld != 0:
        fail(f"M4c 动画期间发生了**布局**（逐节点变换不该触发）：measure_delta={md} layout_delta={ld}（都应 0）")
        ok = False
    else:
        print(f"  ✓ M4 真帧循环：{frames} 帧 · 每帧工作 p50={p50:.3f}ms p95={fl.get('work_p95_ms'):.3f}ms"
              f" · 首帧延迟={first_delay}ms"
              f" · 稳态窗口内 measure/layout 增量 = 0（逐节点变换不触发布局）")
        if fl.get("boot_measure_delta") or fl.get("boot_layout_delta"):
            print(f"     ★如实记录：接入 View 的一次性 traversal = measure {fl.get('boot_measure_delta')}"
                  f" / layout {fl.get('boot_layout_delta')}（不计入动画期）")

        # ── M4e：★★帧率**达到显示器刷新率**（2026-10-01 加：把「120 FPS」变成机器判据）──
        #
        # 【收的是哪条边界】官网原文「120 FPS 目标需 ProMotion 设备（iPhone 12 为 60Hz——
        #   如实标注，未声称）」。iOS 侧受硬件限制（iPhone 12 = 60Hz）确实达不到；
        #   但**Android 测试机是 120Hz 设备**（Redmi M098FE，支持 120/144/165/185Hz）——
        #   取证：`dumpsys display` 的 supportedRefreshRates + peak_refresh_rate=120。
        #   ⇒ 在 Android 这条腿上，"120 FPS"**可以真收**：帧率必须达到**显示器刷新率**
        #     在容差内（不是硬编码 120——报告带 `display_refresh_hz`，判据按它算）。
        #
        # 【口径】FPS 由 `vsync 间隔之和` 算（真实 vsync 帧节拍，与 iOS 侧同法）；
        #   判据：`fps ≥ refresh × 0.90` **且** `vsync_p50 ≤ (1000/refresh) × 1.15`——
        #   两条都查（fps 是均值、p50 是中位：前者会被"前半满帧后半掉帧"骗过，后者不会）。
        # 【诚实分支】取不到刷新率（`display_refresh_hz ≤ 0`）⇒ **不判红**，只如实提示
        #   （不静默假装达标；也不因装置缺字段而误伤）。
        fps_m = fl.get("fps", -1)
        vp50 = fl.get("vsync_p50_ms", -1)
        refresh = fl.get("display_refresh_hz", -1)
        if isinstance(fps_m, (int, float)) and isinstance(refresh, (int, float)) and refresh > 0:
            fps_floor = refresh * 0.90
            vp50_ceil = (1000.0 / refresh) * 1.15
            if fps_m < fps_floor or (isinstance(vp50, (int, float)) and vp50 > vp50_ceil):
                fail(
                    f"M4e 帧率未达显示器刷新率：{fps_m:.1f} FPS（应 ≥ {fps_floor:.1f} = {refresh:.0f}Hz×0.90）"
                    f" · vsync p50={vp50}ms（应 ≤ {vp50_ceil:.2f}ms）"
                    f"——检查：帧回调是否被饿死/掉帧，或应用未获高刷模式"
                )
                ok = False
            else:
                print(
                    f"  ✓ M4e ★帧率达到显示器刷新率：{fps_m:.1f} FPS（显示器 {refresh:.0f}Hz · "
                    f"vsync p50={vp50}ms ≈ {1000.0 / refresh:.2f}ms 预算 · {fl.get('vsync_samples')} 采样）"
                )
        else:
            print(
                f"  ⚠ M4e 跳过（无刷新率基线：fps={fps_m} display_refresh_hz={refresh}）"
                f"——装置需带 display_refresh_hz 字段才能断言（如实跳过，不假装达标）"
            )

    print()
    if ok:
        print("✅ Android 内核驱动动画判据全过（曲线 / 序列 / 滚动联动 / 共享元素 / 真帧循环）")
        return 0
    print("✗ Android 内核驱动动画判据有失败项（见上）")
    return 1


if __name__ == "__main__":
    sys.exit(main())
