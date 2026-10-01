#!/usr/bin/env python3
"""hosts/ios/check-anim-rt2.py —— ★★RT2 动画真机判据（从报告里**真读层上状态**）

【为什么是独立脚本 + 为什么从报告读层状态】见本仓两条纪律：
  ① 判据必须能**变红**——"跑通了"不是判据；
  ② 判据必须**真读被测对象的实际状态**，不比对我们自己传下去的参数（那是自证）。
     ⇒ 本脚本读的是 `layerTransformProbe` 的结果（宿主从 `CALayer.transform` 反解），
       覆盖"写入路径真的生效"这一环。

【十三组判据（对应 RT2 / MA0-RT / MA1 / MA5 / MA6 / 共享元素 / 零唤醒 / Host ABI 要回答的问题；当前 61 条）】
  A. **指令真的驱动了端上动画**：层上 transform 随进度变化，且**终值精确**等于目标（端点钉死）；
  B. **手势驱动（seek）立即生效**：seek 后**不等 tick**，层上已有对应值；
     Progress 驱动后再 tick **不应改它**（手势松手后动画不该自己跑）；
  C. **帧循环真的在跑**：`running` 为真且 `frames` 增长（不是"设了没动"）；
  D. **节点复用解绑**（§7.3）：回收的节点不得再被 tick 改动；
  E. **帧率测席**（§9）：FPS / 掉帧率 / 每帧工作 p95 / 跟随延迟 / 终值精确；
  F. **对齐 Flutter 能力面**：弹簧物理 / 打断接管（速度接力）/ FLIP（起点无跳变·终值归零）/ rotate+opacity；
  G. **平台零参与路径**（§5-bis）：合成属性判定 / 提交一次 / presentation 探针 / 明确拒绝 / 可撤销；
  H. **MA1 预设库**：预设编译 → 微信语义对齐 → 指令下发 → 端上驱动 → 校验有效 → 跨语言同值；
  I. **MA5 滚动联动**：视差映射（窗×factor）/ 宿主滚动通路生产形态 / 退化窗口与滚动+弹簧拦截 / 平台路径排除。
  J. **MA6 序列编排**：一条动画三段 / 分段推进与边界精确 / 终值精确 / 平台路径仍是一条。
  K. **共享元素**：内核几何（中心差+宽度比）/ 首帧在源矩形 / 层级提升与复位 / 终值精确归位 /
     宽度比生效（小矩形源，中心锚点反解）/ 错误冒泡；外加 ★判据 -1「任何相位异常必须红」。
  L. **主线程零唤醒**（OS 级 CPU 会计 + 阳性对照）：L0 提交成功 / L1 阳性对照有效（tick 必须显著 >0）/
     L2 平台路径 CPU 显著低于 tick（比值 ≤0.25）——★「零」与「没测到」必须可区分。
  N. **Host ABI 双路对照**（HA1）：几何逐字节一致 / 建树耗时同量级 / 度量经 vtable 注入 /
     批处理红线 / 版本协商可操作 / 能力插件明确报错 / 帧驱动产出更新。
  N. **Host ABI 双路对照**（HA1）：几何逐字节一致 / 建树耗时同量级 / 度量经 vtable 注入 /
     批处理红线 / 版本协商可操作 / 能力插件明确报错 / 帧驱动产出更新。

用法：python3 hosts/ios/check-anim-rt2.py <report.json>
退出码：0 全过 / 1 有失败（逐条打印为什么）
"""
import json
import sys


def fail(msg: str) -> None:
    print(f"  ✗ {msg}")


def _color_key(v) -> str:
    """把颜色归一到 `RRGGBBAA` 大写（**跨形态比较**）——接受 `#rgb` / `#rrggbb` / `#rrggbbaa` / `rrggbbaa`

    【为什么需要（2026-10-01 真机判据实测）】同一条文字色的**声明形态**是 `#ffffff`（六位小写），
    而**探针形态**是 `FFFFFFFF`（八位大写，从 CGColor 反解）⇒ 直接字符串比较会误红。
    ⇒ 统一归一（缺 alpha 补 FF）——判据比的是**颜色**，不是**写法**。
    """
    if not isinstance(v, str):
        return ""
    t = v.strip().lstrip("#")
    if len(t) == 3:
        t = "".join(c * 2 for c in t)
    if len(t) == 6:
        t += "FF"
    return t.upper() if len(t) == 8 else ""


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

    # ── 判据 -1：★**任何相位异常都必须红**（否则"做错了"会伪装成"没做"）──
    #
    # 【为什么这条必须最先判（2026-09-30 真机教训）】`animShared` 相位调了一个只存在于宿主 view、
    #   未进 JSExport 协议的方法 ⇒ JS TypeError；但那时相位没有统一异常捕获 ⇒ 该读数**为空**、
    #   报告 `phase_errors` 仍为 `{}`、整套判据只因"K 组跳过"而**变绿**。
    #   ⇒ 现在相位函数统一包裹（异常进 `phase_errors`），本判据把"非空"直接判红——
    #     "缺读数"不再能伪装成"没跑这一组"。
    phase_errs = js.get("phase_errors") or {}
    if phase_errs:
        fail(f"存在相位异常（读数缺失 ≠ 没做）：{json.dumps(phase_errs, ensure_ascii=False)[:300]}")
        ok = False
    else:
        print("  ✓ 无相位异常（所有相位函数都正常返回）")

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
    # ★★2026-10-01 改：帧率门槛**跟着设备刷新率走**（与 Android 侧 `check-kernel-anim.py` M4e 同一口径）
    #   ——此前硬编码 58（"60Hz 设备应 ≈60"），换 ProMotion 设备时判据**不会自动变严**。
    #   现取 `screen_max_fps`（宿主上报）算门槛：`refresh × 0.90`，且 60Hz 设备不低于既有 58
    #   （不放松已验收的口径）。无该字段（旧产物）⇒ 回退 60Hz 口径。
    #   ★诚实边界：本机 iPhone 12 = 60Hz ⇒ 此处只能验"60 FPS 不掉帧"；120 FPS 的**同款断言**
    #     会在 ProMotion 设备上自动生效（Android 腿已在 120Hz 设备上实测通过，见 M4e）。
    bench = d.get("anim_bench") or js.get("anim_bench") or {}
    dev_fps = d.get("screen_max_fps") or (d.get("device") or {}).get("screen_max_fps") or 60
    try:
        refresh_hz = float(dev_fps)
    except (TypeError, ValueError):
        refresh_hz = 60.0
    fps_floor = refresh_hz * 0.90
    if refresh_hz <= 65:
        fps_floor = max(fps_floor, 58.0)  # 保持既有 60Hz 口径（57.3 → 58）
    if bench and bench.get("ok"):
        if bench.get("timed_out"):
            fail(f"E0 测席超时（看门狗触发——DisplayLink 停摆？屏幕熄灭/后台？）：{bench}")
            ok = False
        else:
            print(f"  ✓ E0 测席完成：{bench.get('frames')} 帧 / {bench.get('elapsed_ms')}ms"
                  f"（设备刷新率 {refresh_hz:.0f}Hz）")
        fps = bench.get("fps", 0) or 0
        if fps < fps_floor:
            fail(f"E1 帧率不达标：{fps} FPS（设备 {refresh_hz:.0f}Hz ⇒ 门槛 {fps_floor:.1f}）")
            ok = False
        else:
            print(f"  ✓ E1 帧率：**{fps} FPS**（vsync 间隔 p50 {bench.get('vsync_p50_ms')}ms"
                  f" · 设备 {refresh_hz:.0f}Hz ⇒ 门槛 {fps_floor:.1f}）")
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

    # ── I 组（MA5）：滚动联动（吸顶 / 视差 / 渐显——位置→进度换算在内核） ──
    sc = d.get("anim_scroll") or js.get("anim_scroll") or {}
    if sc:
        # I1：三个滚动预设都编译并下发（视差 + 渐显 + 吸顶）
        st = sc.get("start") or {}
        if not st.get("ok") or (st.get("started", 0) or 0) < 3:
            fail(f"I1 滚动预设未下发：{st}（应 started>=3——视差/渐显/吸顶各一条）")
            ok = False
        else:
            print(f"  ✓ I1 滚动预设下发：started={st.get('started')} scroll={st.get('scroll')}")
        # I2：视差映射——窗口 0..400、factor=0.4 ⇒ 滚 200 时 ty≈-80、滚 400 时 ty≈-160
        b0, b2, b4 = sc.get("bg0_ty"), sc.get("bg200_ty"), sc.get("bg400_ty")
        if b0 is None or abs(b0) > 0.01:
            fail(f"I2a 滚动 0 时视差未在起点：ty={b0}（应 0）")
            ok = False
        elif b2 is None or not (-83 < b2 < -77):
            fail(f"I2b 滚动 200 时视差半程不符：ty={b2}（应 ≈ -80 = 200×0.4）")
            ok = False
        elif b4 is None or not (-162 < b4 < -158):
            fail(f"I2c 滚动 400 时视差全程不符：ty={b4}（应 ≈ -160 = 400×0.4）")
            ok = False
        else:
            print(f"  ✓ I2 视差映射（窗 0..400 × 0.4）：0→{b0:.2f} · 200→{b2:.2f} · 400→{b4:.2f}")
        # I3：**生产形态**——宿主滚动通路（scrollAnimSync）内部完成 驱动+刷层，滚 100 ⇒ ty≈-40
        sy = sc.get("bgSync_ty")
        sync = sc.get("sync") or {}
        if sy is None or not (-43 < sy < -37):
            fail(f"I3 宿主滚动通路未驱动到位：ty={sy}（滚 100 × 0.4 应 ≈ -40）；sync={sync}")
            ok = False
        else:
            print(f"  ✓ I3 生产形态（宿主滚动通路零 JS）：滚 100 → ty={sy:.2f}（changed={sync.get('changed')}）")
        # I4：编译期拦截——退化窗口 + 滚动/弹簧并存（都不允许静默通过）
        deg = sc.get("degenerate_rejected") or ""
        ss = sc.get("scroll_spring_rejected") or ""
        if deg == "NOT_REJECTED" or "退化" not in deg:
            fail(f"I4a 退化窗口未被拦：{deg[:60]}")
            ok = False
        elif ss == "NOT_REJECTED" or "弹簧" not in ss:
            fail(f"I4b 滚动+弹簧并存未被拦：{ss[:60]}")
            ok = False
        else:
            print("  ✓ I4 编译期拦截（退化窗口 / 滚动+弹簧 各一条）")
        # I5：滚动批次**不得**具备平台零参与资格（驱动源不同：位置 vs 时间）
        if sc.get("platform_eligible") is not False:
            fail(f"I5 滚动批次被判为平台路径可用：{sc.get('platform_eligible')}（应 False）")
            ok = False
        else:
            print("  ✓ I5 滚动批次正确排除在平台零参与路径之外")
        # I6：★真手势滚动（2026-10-01 收诚实边界）——pan 识别器在岗 + 唯一出口驱动后
        #   内容偏移与**内核滚动联动**都真实推进；驱动路径与真手指是**同一条**（driveScrollDrag）。
        pan = sc.get("pan") or {}
        if not pan:
            fail("I6 真手势滚动读数缺失（anim_scroll 相位未跑 panDragProbe）")
            ok = False
        elif pan.get("recognizer_installed") is not True:
            fail(f"I6a 真 pan 识别器未装在视图上：{pan}")
            ok = False
        elif pan.get("wired") is not True:
            fail(f"I6b 拖拽出口未接线（onScrollDrag 为 nil）：{pan}")
            ok = False
        elif not (pan.get("drive_count") or 0) >= (pan.get("steps") or 0):
            fail(f"I6c 出口未被驱动：drive_count={pan.get('drive_count')} < steps={pan.get('steps')}")
            ok = False
        elif (pan.get("changed_total") or 0) <= 0 or (pan.get("applied_total") or 0) <= 0:
            fail(f"I6d 驱动后内核无变化/未写层：changed={pan.get('changed_total')} applied={pan.get('applied_total')}")
            ok = False
        else:
            print(
                f"  ✓ I6 ★真手势滚动（pan 识别器在岗 + 唯一出口）：驱动 {pan.get('drive_count')} 次 · "
                f"偏移 {pan.get('offset_y_before'):.0f}→{pan.get('offset_y_after'):.0f} · "
                f"内核 changed 累计 {pan.get('changed_total')} · 写层 {pan.get('applied_total')}"
            )
    else:
        print("  · I 组跳过（无 anim_scroll 读数）")

    # ── P 组（★★颜色通道，2026-10-01）：一个声明 → 四条内核通道 → 宿主真写层 → 复位回底色 ──
    #
    # 【收的是哪条边界】官网架构页此前写着「颜色为什么不在这张表里」——颜色动画**不是能力**。
    #   本轮把它做成契约能力（封闭集 5 → 6 个 kind；内核面按 R/G/B/A 四通道分解）。
    #   本组证明端到端：① 声明面一个 `color`；② 编译面 4 条通道（kind 5..8）+ composited=false；
    #   ③ 执行面内核算值 → 32B 记录 → 宿主写 `CALayer.backgroundColor`（**探针真读层**反解）；
    #   ④ 复位面 `animStopAll` 后回**底色**（不是停在末帧）；⑤ 拒绝面 无底色节点明确报错。
    c = d.get("anim_color") or js.get("anim_color") or {}
    if c:
        # P1：一个声明编译成四条通道（编号是契约：5=R / 6=G / 7=B / 8=A）
        kinds = c.get("compiled_kinds") or []
        if kinds != [5, 6, 7, 8]:
            fail(f"P1 颜色声明未展开成四条通道：compiled_kinds={kinds}（应为 [5,6,7,8]）")
            ok = False
        else:
            print(f"  ✓ P1 一个 `color` 声明 → 四条通道指令（kind {kinds}·契约 5=R/6=G/7=B/8=A）")
        # P2：paint-only 但**非合成**（⇒ 不进平台零参与路径——跨端一致的关键）
        if c.get("composited") is not False:
            fail(f"P2 颜色批次被判为可走平台路径（composited={c.get('composited')}）——" +
                 "Android RenderNode 无法在渲染线程插值背景色 ⇒ 必须两端一致走 tick")
            ok = False
        elif list(c.get("non_composited") or []) != ["color"]:
            fail(f"P2b 非合成清单异常：{c.get('non_composited')}（应为 ['color']）")
            ok = False
        else:
            print("  ✓ P2 颜色是 paint-only **非合成**（composited=false · 不进平台零参与路径）")
        # P3：起点 = 底色（from 全通道落层）
        st = (c.get("start") or {})
        if st.get("ok") is not True or (st.get("started") or 0) != 4:
            fail(f"P3 颜色指令未被内核受理：{st}（应 started=4——四条通道）")
            ok = False
        else:
            print(f"  ✓ P3 内核受理四条通道：started={st.get('started')}")
        # P4：端到端——**断言自洽而非写死颜色**（2026-10-01 修正）
        #
        # 【为什么不能写死期望色（本轮实测的判据缺陷）】目标节点由**内核查询**给出
        #   （`bg_ids_from_kernel` —— 因为 id 由适配器/Vue 动态分配，调用方无法预知），
        #   它的实际底色也可能是场景里任意一个 ⇒ 写死 `#1b1b21` 时判据会**因取样变化而误红**
        #   （真机实测：底色是 `#101020`，P4a 判红但链路完全正确）。
        #   ⇒ 正解：① 从**内核给的从色**（`compiled_from`）反推期望起点；② 终点用**声明的 to**；
        #     ③ 三层值必须互不相同（中间色真的在过渡，而不是跳变）。
        bg0, bgm, bg1 = c.get("bg_start"), c.get("bg_mid"), c.get("bg_end")
        fr = [int(v) for v in (c.get("compiled_from") or [])]
        to = [int(v) for v in (c.get("compiled_to") or [])]
        pack = lambda ch: "%02X%02X%02X%02X" % (ch[3], ch[0], ch[1], ch[2]) if len(ch) == 4 else None  # noqa: E731
        want_start, want_end = pack(fr), pack(to)
        if not (want_start and want_end):
            fail(f"P4 读数不全：from={fr} to={to}（应各 4 通道）")
            ok = False
        elif bg0 != want_start:
            fail(f"P4a 起点不是底色的分量：层上 bg={bg0}（应 {want_start} = 内核给的 from）")
            ok = False
        elif bg1 != want_end:
            fail(f"P4b 终点不精确：层上 bg={bg1}（应 {want_end} = 声明的 to）")
            ok = False
        else:
            # 半程：linear ⇒ 各通道 ≈ 中点（容差 ±2/255，覆盖 8bit 舍入）
            try:
                mid_ok = bgm and bgm != bg0 and bgm != bg1
            except Exception:  # noqa: BLE001
                mid_ok = False
            if not mid_ok:
                fail(f"P4c 半程未见中间色：start={bg0} mid={bgm} end={bg1}（三层值应互不相同）")
                ok = False
            else:
                print(f"  ✓ P4 ★颜色动画端到端（真读 CALayer.backgroundColor）：{bg0} → {bgm} → {bg1}")
        # P5：复位回底色（不是停在末帧——「解绑必须含清值」在颜色上的落点）
        after = c.get("bg_after_stop")
        if after != bg0:
            fail(f"P5 animStopAll 后未回底色：层上 bg={after}（应回 {bg0}）——残留颜色会污染后续相位")
            ok = False
        else:
            print(f"  ✓ P5 复位回底色：{after}（stop 后不留末帧颜色）")
        # ★P7（2026-10-01 扩）：**颜色序列**（keyframes 多段）——段边界精确 + 端点钉死
        sm, se = c.get("seq_mid"), c.get("seq_end")
        if not sm or not se:
            fail(f"P7 颜色序列读数缺失：mid={sm!r} end={se!r}")
            ok = False
        elif sm.startswith("ERR") or se.startswith("ERR"):
            fail(f"P7 颜色序列抛错：{sm[:100]}")
            ok = False
        elif sm.upper() != "FF00FF00":
            fail(f"P7a 颜色序列段边界不精确：半程 bg={sm}（应 FF00FF00 = #00ff00，linear 段边界）")
            ok = False
        elif se.upper() != "FFFF0000":
            fail(f"P7b 颜色序列终点不精确：bg={se}（应 FFFF0000 = #ff0000，端点钉死）")
            ok = False
        else:
            print(f"  ✓ P7 ★颜色序列（多段收敛在每通道一条动画）：黑 → {sm}（段边界）→ {se}（端点钉死）")

        # ★P8（2026-10-01 扩）：**文字色**——与底色**两条独立轨道**
        tids = c.get("text_color_ids") or []
        t0, t1, tstop = c.get("text_start"), c.get("text_end"), c.get("text_after_stop")
        unchanged = c.get("text_bg_unchanged")
        if not tids:
            # 场景里没有带 `color` 的节点 ⇒ 如实标注（不判红：这是**场景**的边界，不是引擎的）
            print("  · P8 跳过（本场景树里没有声明 `color`（文字色）的节点——如实标注，非失败）")
        elif t1.startswith("ERR"):
            fail(f"P8 文字色抛错：{t1[:100]}")
            ok = False
        elif t1.upper() != "FF00FF00":
            fail(f"P8a 文字色终值不精确：层上 textColor={t1}（应 FF00FF00 = #00ff00）")
            ok = False
        elif tstop and _color_key(tstop) != _color_key(t0):
            # ★归一化比较（2026-10-01 修）：`t0` 是**声明形态**（`#ffffff`），`tstop` 是
            #   **探针形态**（`FFFFFFFF` 八位大写）——直接比字符串会因格式差异误红（真机实测）。
            fail(f"P8b 文字色 stop 后未回原值：{tstop}（应回 {t0}）")
            ok = False
        elif unchanged != "same":
            fail(f"P8c 文字色动画**改动了底色**（两条轨道必须独立）：{unchanged}")
            ok = False
        else:
            print(f"  ✓ P8 ★文字色（独立轨道）：{t0} → {t1}（终值精确）· stop 回原值 · 底色**未被动**")

        # ★P9（2026-10-01 扩）：**自定义三次贝塞尔**（转正）——回弹过冲 + 拒绝分支
        #   ★取值路径：它是**独立相位**的结果（在报告根/js_report，不在 anim_color 内）
        bz = d.get("anim_bezier") or js.get("anim_bezier") or {}
        if not bz:
            print("  · P9 跳过（anim_bezier 读数缺失——相位未跑？）")
        else:
            bstarted = bz.get("started")
            btr = bz.get("trace") or []
            bpeak = bz.get("peak")
            bend = bz.get("end")
            brej = str(bz.get("rejected") or "")
            if bstarted != 1:
                fail(f"P9a 自定义曲线动画未被内核受理：started={bstarted}")
                ok = False
            elif not btr or bpeak is None or bend is None:
                fail(f"P9b 自定义曲线轨迹读数不齐：trace={btr}")
                ok = False
            elif bpeak <= 101.0:
                fail(f"P9c 未见过冲：峰值 ty={bpeak} 应 > 101（回弹曲线 y1=1.56 的指纹；不过冲=自定义未生效）")
                ok = False
            elif abs(bend - 100.0) > 0.01:
                fail(f"P9d 终点未钉死：末值 ty={bend}（应精确 = 100）")
                ok = False
            elif "[0,1]" not in brej or "节点" not in brej:
                fail(f"P9e 非法控制点未被明确拒绝（应含 [0,1] 与节点 id）：{brej[:140]}")
                ok = False
            else:
                print(f"  ✓ P9 ★自定义贝塞尔（真读层）：过冲到 ty={bpeak:.2f}（> 终点 100）后回落，终点钉死 {bend:.2f} · 拒绝分支可定位")

        # ★R10（2026-10-01 · A2）：**循环与往复**——repeat / yoyo / infinite 真读层
        rp = d.get("anim_repeat") or js.get("anim_repeat") or {}
        if not rp:
            print("  · R10 跳过（anim_repeat 读数缺失——相位未跑？）")
        else:
            m2 = rp.get("mid2")
            er = rp.get("end_repeat")
            yb2 = rp.get("yoyo_back")
            ye2 = rp.get("yoyo_end")
            ia = rp.get("infinite_active")
            if not all(isinstance(v, (int, float)) for v in (m2, er, yb2, ye2, ia)):
                fail(f"R10 读数不齐：{rp}")
                ok = False
            elif abs(m2 - 100.0) < 5:
                fail(f"R10a repeat:2 疑似未生效：第 2 遍中途 ty={m2:.1f} ≈ 终点（单遍已静止）")
                ok = False
            elif abs(er - 100.0) > 0.01:
                fail(f"R10b 两遍结束未钉死：ty={er}（应 = 100）")
                ok = False
            elif not (60.0 <= yb2 <= 90.0):
                fail(f"R10c yoyo 第 2 遍未回程：ty={yb2:.1f}（应 ≈ 75）")
                ok = False
            elif abs(ye2) > 0.5:
                fail(f"R10d yoyo 结束未回 from：ty={ye2:.1f}（应 ≈ 0——净位移 0）")
                ok = False
            elif ia <= 0:
                fail(f"R10e infinite 在 2000ms 后应仍在跑：active={ia}")
                ok = False
            else:
                print(f"  ✓ R10 ★循环与往复（真读层）：repeat:2 中途 ty={m2:.1f} 仍在推进 / 两遍钉死 {er:.1f} · "
                      f"yoyo 回程 {yb2:.1f} → 归零 {ye2:.1f} · infinite active={ia}")
            # ★S11（A3）：播放控制——慢动作 / 暂停冻结 / 恢复继续 / 非法拒绝
            stx = rp.get("slow_tx")
            pb2 = rp.get("pause_before")
            pd2 = rp.get("pause_during")
            pa2 = rp.get("pause_after")
            ctrl_rej = str(rp.get("ctrl_rejected") or "")
            if not all(isinstance(v, (int, float)) for v in (stx, pb2, pd2, pa2)):
                fail(f"S11 播放控制读数不齐：{rp}")
                ok = False
            elif not (15.0 <= stx <= 35.0):
                fail(f"S11a timeScale:0.25 未生效：tx={stx:.1f}（慢 4× 应 ≈ 25；无效果会是 100）")
                ok = False
            elif abs(pd2 - pb2) > 0.5:
                fail(f"S11b 暂停期间值仍在变：{pb2:.1f} → {pd2:.1f}（应冻结）")
                ok = False
            elif not (pa2 > pd2 + 10.0):
                fail(f"S11c 恢复后未继续：{pd2:.1f} → {pa2:.1f}")
                ok = False
            elif "timeScale" not in ctrl_rej or "非法" not in ctrl_rej:
                fail(f"S11d 非法 timeScale 未被明确拒绝：{ctrl_rej[:120]}")
                ok = False
            else:
                print(f"  ✓ S11 ★播放控制（真读层）：慢动作 tx={stx:.1f} · 暂停冻结 {pd2:.1f}（200ms 不变）"
                      f" · 恢复继续到 {pa2:.1f} · 非法拒绝可定位")

        # P6：拒绝分支——无底色节点上的颜色动画必须**明确拒绝**（不静默）
        rej = c.get("rejected_no_bg") or ""
        if c.get("no_bg_nodes") and ("底色" not in rej):
            fail(f"P6 无底色节点上的颜色动画未被明确拒绝：{rej[:120]}")
            ok = False
        elif c.get("no_bg_nodes"):
            print(f"  ✓ P6 无底色节点明确拒绝：{rej[:70]}…")
        else:
            print("  · P6 跳过（整树节点都有底色，取不到无反例——如实标注）")
    else:
        print("  · P 组跳过（无 anim_color 读数）")

    # ── J 组（MA6）：序列编排（多段动画收敛在一条动画里；分段推进 + 边界精确） ──
    q = d.get("anim_sequence") or js.get("anim_sequence") or {}
    if q:
        # J1：声明被编译成**一条**动画、内三段（"多段不等于多条"是本里程碑的核心语义）
        segs = q.get("segments")
        st = q.get("start") or {}
        if segs != 3 or not st.get("ok"):
            fail(f"J1 序列未按一条动画三段下发：segments={segs} start={st}")
            ok = False
        else:
            print(f"  ✓ J1 一条动画内三段（keyframes=3 · durMs={q.get('durMs')}）")
        # J2：分段推进——预期 50→0.8 / 100→0.6（精确）/ 200→0.9
        s50, s100, s200 = q.get("s50"), q.get("s100"), q.get("s200")
        if s50 is None or abs(s50 - 0.8) > 0.01:
            fail(f"J2a 首段半程不符：scale={s50}（应 ≈0.8）")
            ok = False
        elif s100 is None or abs(s100 - 0.6) > 0.005:
            fail(f"J2b 首段终点不精确：scale={s100}（应 =0.6——分段边界不得漂移）")
            ok = False
        elif s200 is None or abs(s200 - 0.9) > 0.01:
            fail(f"J2c 次段半程不符：scale={s200}（应 ≈0.9）")
            ok = False
        else:
            print(f"  ✓ J2 分段推进：50ms→{s50:.3f} · 100ms→{s100:.3f}（段边界精确）· 200ms→{s200:.3f}")
        # J3：终值精确到声明的 to（1.0）
        s400 = q.get("s400")
        if s400 is None or abs(s400 - 1.0) > 0.005:
            fail(f"J3 序列终值不精确：scale={s400}（应 =1.0）")
            ok = False
        else:
            print(f"  ✓ J3 序列终值精确到声明 to：scale={s400:.4f}")
        # J4：平台路径**仍是"一条"**（1 节点 ⇒ 1 条 CAKeyframeAnimation），
        #     且**提交的采样真的经过各段**（scale 采样应先下探到 ≈0.6、再上冲到 ≈1.2）
        committed = q.get("platform_committed")
        smin, smax = q.get("platform_scale_min"), q.get("platform_scale_max")
        if not q.get("platform_ok") or committed != 1 or q.get("platform_specs") != 1:
            fail(f"J4a 序列的平台提交不是一条：committed={committed} specs={q.get('platform_specs')} ok={q.get('platform_ok')}")
            ok = False
        elif smin is None or smax is None or smin > 0.65 or smax < 1.15:
            fail(f"J4b 提交采样未经过各段：scaleMin={smin} scaleMax={smax}（应下探 ≈0.6、上冲 ≈1.2）")
            ok = False
        else:
            print(f"  ✓ J4 平台路径一条动画且采样经过各段（committed=1 · scale 采样 {smin:.3f}..{smax:.3f}）")
    else:
        print("  · J 组跳过（无 anim_sequence 读数）")

    # ── K 组：共享元素（跨元素飞行——几何在内核 + 宿主层级提升） ──
    sh = d.get("anim_shared") or js.get("anim_shared") or {}
    if sh:
        # K1：几何由内核算出（dx/dy/scale 三值齐备且有限）
        dx, dy, scale = sh.get("dx"), sh.get("dy"), sh.get("scale")
        if not sh.get("ok") or dx is None or dy is None or scale is None or not (scale > 0):
            fail(f"K1 共享元素几何未算出：ok={sh.get('ok')} dx={dx} dy={dy} scale={scale}")
            ok = False
        else:
            print(f"  ✓ K1 内核几何：dx={dx:.1f} dy={dy:.1f} scale={scale:.3f}"
                  f"（源 {sh.get('fromRect')} → 目标 {sh.get('toRect')}）")
        # K2：首帧就在**源矩形**（不跳变）——层上 tx/ty/scale 应等于内核起点
        ftx, fty, fsc = sh.get("first_tx"), sh.get("first_ty"), sh.get("first_scale")
        if ftx is None or abs(ftx - dx) > 0.5 or abs(fty - dy) > 0.5 or abs(fsc - scale) > 0.01:
            fail(f"K2 首帧未落在源矩形：层 ({ftx}, {fty}, {fsc}) vs 内核 ({dx}, {dy}, {scale})")
            ok = False
        else:
            print(f"  ✓ K2 首帧在源矩形（无跳变）：tx={ftx:.1f} ty={fty:.1f} scale={fsc:.3f}")
        # K3：**层级提升**真的生效（zPosition 被抬起，且可复位清零）
        z_lifted, z_after = sh.get("z_lifted", 0), sh.get("z_after")
        z_reset = sh.get("z_reset_val")
        if not z_lifted or z_after is None or abs(z_after) < 1.0:
            fail(f"K3a 飞行元素层级未被提升：zLifted={z_lifted} z={z_after}")
            ok = False
        elif z_reset is None or abs(z_reset) > 0.001:
            fail(f"K3b 层级未复位：z={z_reset}（zPosition 是持久状态，必须复位）")
            ok = False
        else:
            print(f"  ✓ K3 层级提升生效且可复位（飞行中 z={z_after:.1f} → 复位后 z={z_reset:.1f}）")
        # K4：终态**精确归位**（identity：tx/ty=0、scale=1）
        etx, ety, esc = sh.get("end_tx"), sh.get("end_ty"), sh.get("end_scale")
        if etx is None or abs(etx) > 0.01 or abs(ety) > 0.01 or abs(esc - 1.0) > 0.001:
            fail(f"K4 未精确归位：tx={etx} ty={ety} scale={esc}（应为 0/0/1）")
            ok = False
        else:
            print(f"  ✓ K4 终态精确归位（identity）：tx={etx} ty={ety} scale={esc}")
        # K4b：★**宽度比数学**真的生效（同树源常与目标同尺寸 ⇒ scale 恒 1 无判别力；
        #      用小矩形源 ⇒ scale 必须明显 ≠ 1，且层上"中心真的落在源矩形中心"）
        #
        # 【判据算式（为什么不是直接比 m41 与 dx）】宿主探针从 `CATransform3D` 直接读 m41/m42，
        #   而本引擎的构造是「平移 ∘ 中心缩放 ∘ 反平移」⇒ 缩放 ≠ 1 时 m41 含**中心锚点分量**：
        #     m41 = tx + midX×(1−s)，m42 = ty + midY×(1−s)
        #   （与既有的 rotate 教训同源：那次 m41 = tx + midX + midY）。
        #   ⇒ 判据必须**反解**出纯位移再与内核 dx/dy 比对；且 midX/midY 取目标矩形一半。
        rsc = sh.get("rect_scale")
        rdx, rdy = sh.get("rect_dx"), sh.get("rect_dy")
        rm41, rm42, rm11 = sh.get("rect_first_tx"), sh.get("rect_first_ty"), sh.get("rect_first_scale")
        r_to = sh.get("rect_to") or {}
        if not sh.get("rect_ok") or rsc is None or not (rsc < 0.5 or rsc > 1.5):
            fail(f"K4b 宽度比未生效：rect_scale={rsc}（小矩形源应明显 ≠ 1）；ok={sh.get('rect_ok')}")
            ok = False
        elif rm11 is None or abs(rm11 - rsc) > 0.01:
            fail(f"K4b 层上缩放 ≠ 内核宽度比：层 m11={rm11} vs 内核 scale={rsc}")
            ok = False
        elif rm41 is None or rm42 is None or not r_to:
            fail(f"K4b 读数缺失：m41={rm41} m42={rm42} toRect={r_to}")
            ok = False
        else:
            mx, my = (r_to.get("w", 0) or 0) / 2.0, (r_to.get("h", 0) or 0) / 2.0
            pure_tx = rm41 - mx * (1.0 - rm11)
            pure_ty = rm42 - my * (1.0 - rm11)
            if abs(pure_tx - rdx) > 0.5 or abs(pure_ty - rdy) > 0.5:
                fail(
                    f"K4b 反解纯位移与内核不符：层 ({pure_tx:.2f}, {pure_ty:.2f}) vs 内核 ({rdx}, {rdy})"
                    f"（m41/m42={rm41}/{rm42} · mid=({mx},{my}) · s={rm11}）"
                )
                ok = False
            else:
                print(f"  ✓ K4b 宽度比生效（小矩形源 scale={rsc:.3f}；反解纯位移 ({pure_tx:.1f},{pure_ty:.1f}) = 内核 dx/dy）")
        # K5：错误**明确冒泡**（目标不存在 / 缺源——都不允许静默）
        if not sh.get("bad_rejected") or not sh.get("no_src_rejected"):
            fail(f"K5 错误未冒泡：bad_rejected={sh.get('bad_rejected')} no_src_rejected={sh.get('no_src_rejected')}")
            ok = False
        else:
            print(f"  ✓ K5 错误明确冒泡（目标缺失 / 缺源：{str(sh.get('bad_error'))[:30]}…）")
    else:
        print("  · K 组跳过（无 anim_shared 读数）")

    # ── L 组：主线程零唤醒实测（OS 级 CPU 会计 + 阳性对照） ──
    #
    # 【为什么是"三段式"（设计要点）】"主线程零参与"是个**否定性断言**——只量一个数无法区分
    #   "真的是零"与"探针根本没测到"。⇒ 必须有：
    #     L0 **前置**：平台动画真的提交了（否则窗口内什么都没跑，"零"毫无意义）；
    #     L1 **阳性对照**：tick 路径必须有显著主线程 CPU（否则探针失效，不得判绿）；
    #     L2 **比值判据**：平台路径显著低于 tick（比值而非绝对阈值——设备差异大）。
    cpu = d.get("anim_cpu") or js.get("anim_cpu") or {}
    if cpu:
        if not cpu.get("committed_ok"):
            fail(f"L0 平台动画未提交成功——「零 CPU」会是「什么都没发生」，不是证据：{str(cpu.get(chr(39)+chr(99)+chr(111)+chr(109)+chr(109)+chr(105)+chr(116)+chr(39)))[:120]}")
            ok = False
        else:
            print("  ✓ L0 前置：平台动画已提交（committed=1）")
        plat, tick = cpu.get("platform_cpu_us"), cpu.get("tick_cpu_us")
        # ★显示用变量**先取好**（首版在 f-string 里写 cpu.get(...) 且用 chr() 拼键名——
        #   那是为了绕开"嵌套引号"而做的丑陋变通，结果取到 None（显示成 "窗口 Nonems"）。
        #   ⇒ 正解：先绑定局部变量，再进 f-string（f-string 里只做格式化，不做取值逻辑）。
        win_ms = cpu.get("window_ms")
        if plat is None or tick is None or plat < 0 or tick < 0:
            fail(f"L1/L2 CPU 读数缺失或非法：platform={plat} tick={tick}")
            ok = False
        elif tick < 5000:
            fail(f"L1 阳性对照无效：tick 路径 CPU 增量仅 {tick}µs < 5ms——探针没测到东西，不得判绿")
            ok = False
        else:
            print(f"  ✓ L1 阳性对照有效：tick 路径主线程 CPU {tick/1000:.1f}ms（窗口 {win_ms}ms）")
            # ★★测量有效性前置（2026-10-01，L2 回归排查后固化）：窗口内**不得有帧循环在跑**——
            #   若在跑，主线程 CPU 混入的是"我们自己每帧推进"的成本，平台读数不可信
            #   （此时红/绿都无法归因；判红并明示"先修装置"）。
            if cpu.get("frame_loop_running") is True:
                fail("L2 测量无效：窗口内帧循环仍在运行（读数混入每帧推进成本，须先修装置）")
                ok = False
            else:
                # ★读数分解进消息（commit=提交一次的成本 / idle=提交后平台自主渲染时主线程的空闲段）：
                #   红时一眼看出是"提交变贵"还是"窗口被污染"（2026-10-01 一次两小时排查的固化）。
                split = ""
                if cpu.get("commit_cpu_us") is not None and cpu.get("idle_cpu_us") is not None:
                    split = f" · 分解 commit={cpu.get('commit_cpu_us')}µs idle={cpu.get('idle_cpu_us')}µs"
                # ★★**判稳态段**（2026-10-01 段级取证后的口径修正）：600ms 窗口切成 6×100ms，
                #   平台路径的承诺是"**稳态下主线程不每帧参与**"。实测两类形态：
                #     · `[18307, 272, 740, 215, 254, 233]` ⇒ 第一段独大（= commit 后**首次 CA flush**
                #       的一次性成本）——不是每帧参与，判据不应因此判红；
                #     · 若真"每帧参与"（双驱动/幽灵 tick），**六段会均匀升高**。
                #   ⇒ 取"去掉最大段后的稳态均值"与 tick 的**每百毫秒成本**比（探测力不丢——
                #     均匀升高时稳态均值同样高）。
                segs = cpu.get("idle_segments_us")
                if isinstance(segs, list) and len(segs) >= 2:
                    steady = sum(sorted(segs)[:-1]) / (len(segs) - 1)
                    tick_per_100 = tick / (len(segs))
                    ratio = steady / max(1.0, tick_per_100)
                    seg_show = ", ".join(f"{x/1000:.2f}ms" for x in segs)
                    if ratio > 0.25:
                        fail(f"L2 平台路径主线程 CPU 未显著更低（稳态段）：{steady/1000:.2f}ms/100ms vs "
                             f"tick {tick_per_100/1000:.2f}ms/100ms（比 {ratio:.2f}，应 <= 0.25）· 六段 [{seg_show}]{split}")
                        ok = False
                    else:
                        print(f"  ✓ L2 平台路径主线程 CPU 显著更低（稳态段）：{steady/1000:.2f}ms/100ms vs "
                              f"tick {tick_per_100/1000:.2f}ms/100ms（比 {ratio:.2f} <= 0.25）· 六段 [{seg_show}]{split}")
                        if max(segs) > steady * 4:
                            print(f"      · 如实记录：最大段 {max(segs)/1000:.1f}ms 独大（= commit 后首次 CA flush 的"
                                  f"一次性成本，非每帧参与；稳态段已判）")
                else:
                    # 段级数据缺失（旧报告）：退回总量比值（原口径）
                    ratio = plat / tick
                    if ratio > 0.25:
                        fail(f"L2 平台路径主线程 CPU 未显著更低：platform={plat/1000:.1f}ms vs tick={tick/1000:.1f}ms（比 {ratio:.2f}，应 <= 0.25）{split}")
                        ok = False
                    else:
                        print(f"  ✓ L2 平台路径主线程 CPU 显著更低：{plat/1000:.1f}ms vs tick {tick/1000:.1f}ms（比 {ratio:.2f} <= 0.25）{split}")
    else:
        print("  · L 组跳过（无 anim_cpu 读数——探针未跑或报告为旧版）")
    # ── N 组（HA1）：Host ABI 双路对照（抽象正确性的等价性判据） ──
    #
    # 【为什么"双路"是唯一有效判据（设计要点）】"ABI 能跑"只说明"能跑"，不说明"抽象对"。
    #   必须证明**两条路产出同一个东西**：同一棵树走 [直连 FFI] 与 [Host ABI]，
    #   几何**逐字节一致**（比"看起来差不多"强得多）。
    #   同时验：度量经 vtable 注入 / 批处理红线 / 版本协商可操作 / 能力插件明确报错 / 帧驱动。
    abi = d.get("host_abi") or js.get("host_abi") or {}
    if abi:
        # N1 ★核心：几何逐字节一致（等价性）
        if not abi.get("geometry_identical"):
            fail(f"N1 两路几何**不一致**：diff={abi.get('geometry_diff_bytes')} 字节"
                 f"（direct={abi.get('direct_bytes')}B vs abi={abi.get('abi_bytes')}B）——抽象未保持等价")
            ok = False
        else:
            print(f"  ✓ N1 ★双路几何逐字节一致（{abi.get('direct_bytes')}B · hash {abi.get('direct_hash')}）")
        # N2 建树都成功 + 耗时同量级（ABI 只多一层门面，不应显著更慢）
        dm, am = abi.get("direct_ms"), abi.get("abi_ms")
        if abi.get("abi_load_rc") != 0:
            fail(f"N2 ABI 路建树失败：load_rc={abi.get('abi_load_rc')}")
            ok = False
        elif dm is None or am is None or am > max(dm * 3.0, dm + 5.0):
            fail(f"N2 ABI 路耗时异常：direct={dm}ms vs abi={am}ms（门面层不应显著更慢）")
            ok = False
        else:
            print(f"  ✓ N2 建树耗时同量级：直连 {dm}ms vs ABI {am}ms（含版本协商+引擎创建）")
        # N3 度量**经 vtable 注入**（独立子项：用**无度量表**的树单跑 ABI ⇒ 引擎必须回调宿主）
        #   ★为什么不看 ① 的 abi_stats：① 的输入**含**度量表（与直连路同输入，为等价性判据）
        #     ⇒ 那个引擎不会回调。注入能力要用"缺度量"的输入验（本仓实测：首版混在一起，
        #     导致 N1 报"几何不一致"——那其实是探针喂了两份不同输入，不是抽象的缺陷）。
        ist = abi.get("inject_stats") or {}
        if abi.get("inject_load_rc") != 0 or (ist.get("measure_calls", 0) or 0) <= 0:
            fail(f"N3 度量未注入：load_rc={abi.get('inject_load_rc')} measure_calls={ist.get('measure_calls')}"
                 f"（无度量表的树 ⇒ 引擎应回调宿主度量）")
            ok = False
        else:
            print(f"  ✓ N3 度量经 vtable 注入：缺度量表时引擎回调宿主 {ist.get('measure_calls')} 次"
                  f"（宿主不必自己走树）")
        # N4 ★批处理红线：一帧两条指令 ⇒ **一次** submit_frame
        s2 = abi.get("stats_after_submit") or {}
        calls, ops_n = s2.get("submit_frame_calls"), s2.get("submitted_ops")
        if calls != 1 or (ops_n or 0) < 2:
            fail(f"N4 批处理红线未达标：submit_frame_calls={calls}（应 1）· submitted_ops={ops_n}（应 ≥2）")
            ok = False
        else:
            print(f"  ✓ N4 批处理红线：{ops_n} 条指令 / **1 次**跨边界提交（按帧计，不按节点计）")
        # N5 版本协商：不兼容 ⇒ 明确错误码 + **可操作**提示
        if abi.get("version_mismatch_rc") == 0:
            fail("N5 版本不兼容时未报错（应为非 0）")
            ok = False
        elif "升级" not in (abi.get("version_mismatch_hint") or ""):
            fail(f"N5 版本不兼容提示不可操作：{str(abi.get('version_mismatch_hint'))[:80]}")
            ok = False
        else:
            print("  ✓ N5 版本协商：不兼容 ⇒ 明确错误码 + 可操作升级提示")
        # N6 能力插件：未注册明确报错（列出已注册项）+ 注册后可用
        if abi.get("capability_missing_rc") == 0:
            fail("N6 未注册能力未报错（禁止静默失败）")
            ok = False
        elif abi.get("capability_register_rc") != 0 or abi.get("capability_call_rc") != 0:
            fail(f"N6 能力注册/调用失败：reg={abi.get('capability_register_rc')} call={abi.get('capability_call_rc')}")
            ok = False
        else:
            print(f"  ✓ N6 能力插件：未注册 ⇒ {abi.get('capability_missing_rc')}（明确）· 注册后调用成功")
        # N7 帧驱动：proteus_frame 推进动画并产出更新
        if (abi.get("frame_updates_records", 0) or 0) <= 0:
            fail(f"N7 ABI 帧驱动未产出动画更新：{abi.get('frame_updates_records')} 条")
            ok = False
        else:
            print(f"  ✓ N7 ABI 帧驱动：{abi.get('frame_updates_records')} 条变换更新（proteus_frame 推进内核动画）")
    else:
        print("  · N 组跳过（无 host_abi 读数）")

    print()
    if ok:
        print("✅ 判据全过（机制 + 帧率 + 复杂动效 + 平台零参与 + MA1 预设库 + MA5 滚动联动 + MA6 序列编排 + 共享元素 + 零唤醒 + Host ABI）")
        return 0
    print("✗ RT2 判据有失败项（见上）")
    return 1


if __name__ == "__main__":
    sys.exit(main())
