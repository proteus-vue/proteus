#!/usr/bin/env python3
"""hosts/android/check-app-stack.py —— ★★M5 路由虚拟栈判据（真机产物 app-stack.json）

【要证明什么（对齐用户决策 2026-09-30）】
  用户：「吸取小程序和 uni-app 的路由栈数量限制的经验教训，路由实现也必须是高性能的，可以参考 Flutter」
  ⇒ 三条必须各有机器判据（不能只有本机单测；端上读数才算数）：
    ① **无层数上限**：20000 层 push/pop 全成（小程序第 10 层 navigateTo 直接失败 ⇒ 差异必须到
       "不可能误判"的量级）；且 popToRoot 一条命令回根。
    ② **内存有界靠预算而非层数**：超预算冻结最旧屏；活跃节点数**守住预算**；
       冻结数 ≈ 总屏数（几乎全冻）；**over_budget 必须为 false**（冻结确实够用）。
    ③ **高性能**：push 20000 层的毫秒读数有明确上界（同机对照：本机 V8 约 13ms，真机 QuickJS
       放宽到 3000ms——判据盯的是"有没有退化成 O(n²)"这类数量级问题，不是拷打绝对性能）。
    ④ **冻结后返回 = 重建**（c_rebuild_mounts=1 且 rebuild 标记被消费）。
    ⑤ **navigate diff 最小操作集**：深栈回退一半 ⇒ **零 mount**（保留段树不动）+ unmount 数 = 弹出数。
    ⑥ **命令守恒**（执行器契约）：push N 次 ⇒ mount N；**unmount 必须为 0**（树保留）；
       exit = N-1（首个 push 无旧顶）。

【与单测的关系】tests/app-stack.test.ts（34 条）证**逻辑**；本判据证**端上行为**（QuickJS）。
  两者都绿才算 M5 有真机证据——只有单测绿 = "在本机 V8 上成立"，不能替端上说话。

用法：python3 hosts/android/check-app-stack.py hosts/android/results/app-stack.json
退出码：0 全过 / 1 有失败 / 0（产物缺失时诚实跳过）
"""
import json
import os
import sys


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print("用法：python3 hosts/android/check-app-stack.py <app-stack.json>")
        return 2
    path = args[0]
    if not os.path.exists(path):
        print(f"⚠ 路由虚拟栈判据：未找到真机产物（{path}）")
        print("  ⇒ 诚实跳过（跑真机后取回）：")
        print("     1) node hosts/android/bridge/build-batch.mjs")
        print("     2) bash hosts/android/build-and-run.sh --no-install")
        print("     3) bash hosts/android/run-app-stack.sh")
        return 0

    # ★★两平台共用本判据（2026-09-30 续：iOS 腿同款场景已接）
    #   平台由**字段形态**判别：Android 报告有 `engine_available`（Java 壳加的前置），
    #   iOS 报告是 `__proteusAppStackRun` 的原样输出（无该字段）。
    plat = "android" if "engine_available" in json.load(open(path, encoding="utf-8")) else "ios"
    print(f"═══ {plat} 路由虚拟栈判据：{path} ═══")
    ok = True
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except Exception as e:  # noqa: BLE001
        print(f"  ✗ 报告读不出：{e}")
        return 1

    def fail(msg: str) -> None:
        nonlocal ok
        print(f"  ✗ {msg}")
        ok = False

    def report(msg: str) -> None:
        print(f"  ✓ {msg}")

    # 引擎/加载前置（仅 Android——Java 壳把它放进报告；iOS 报告无该字段，由"报告存在且可解析"兜底）
    if plat == "android" and not d.get("engine_available"):
        fail(f"QuickJS 引擎不可用：{d.get('error')}")
        print()
        print("✗ 前置不满足")
        return 1
    if d.get("error"):
        fail(f"运行报错：{d.get('error')}")
        print()
        print("✗ 前置不满足")
        return 1
    if plat == "android" and (not d.get("bundle_load_ok") or not d.get("run_ok") or not d.get("ok")):
        fail(f"bundle 加载/入口执行失败：load_ok={d.get('bundle_load_ok')} run_ok={d.get('run_ok')} ok={d.get('ok')}")
        print()
        print("✗ 前置不满足")
        return 1

    depth = d.get("depth", 0)
    # ── ① 无层数上限 ──
    if d.get("a_depth_reached") != depth:
        fail(f"① 深栈未达全深：reached={d.get('a_depth_reached')} / 期望 {depth}（有截断 = 层数上限回来了）")
    else:
        report(f"① 无层数上限：push {depth} 层全成（reached={d.get('a_depth_reached')}）")
    if d.get("a_depth_after_pop_to_root") != 1:
        fail(f"① popToRoot 未回根：depth={d.get('a_depth_after_pop_to_root')}（期望 1）")
    else:
        report(f"① popToRoot 一条命令回根（{d.get('a_pop_ms')}ms 弹 {depth} 层）")

    # ── ⑥ 命令守恒（执行器契约；放在前面先证"树保留"）──
    if d.get("a_mounts") != depth:
        fail(f"⑥ mount 数 != push 次数：{d.get('a_mounts')} / {depth}")
    else:
        report(f"⑥ 命令守恒：mount == push 次数（{d.get('a_mounts')}）")
    if d.get("a_unmounts") != 0:
        fail(f"⑥ push 阶段出现 unmount={d.get('a_unmounts')} —— 退场屏树保留语义被破坏（返程会重建/丢状态）")
    else:
        report("⑥ 退场屏树保留：push 20000 层 0 unmount（栈内屏 display:none 而非销毁）")
    if d.get("a_exits") != depth - 1:
        fail(f"⑥ exit 数 != push 次数-1：{d.get('a_exits')} / {depth - 1}")
    else:
        report(f"⑥ exit 数 == N-1（首个 push 无旧顶；{d.get('a_exits')}）")
    if d.get("a_root_unmounts") != depth - 1:
        fail(f"⑥ popToRoot 销毁数 != N-1：{d.get('a_root_unmounts')} / {depth - 1}")
    else:
        report(f"⑥ popToRoot 销毁 N-1 屏（{d.get('a_root_unmounts')}）")

    # ── ② 内存有界（预算冻结）──
    budget = d.get("budget", 0)
    active = d.get("b_active_nodes")
    if not isinstance(active, int) or active > budget:
        fail(f"② 活跃节点未守住预算：active={active} > budget={budget}")
    else:
        report(f"② 活跃节点守住预算：active={active} ≤ {budget}")
    if d.get("b_over_budget") is not False:
        fail(f"② over_budget={d.get('b_over_budget')}（应为 false——冻结策略必须够用）")
    else:
        report("② over_budget=false（冻结足够，无失败点）")
    frozen = d.get("b_frozen_count", 0)
    if not isinstance(frozen, int) or frozen < depth * 0.95:
        fail(f"② 冻结数异常：{frozen}（期望 ≈ {depth}——超预算屏应几乎全部冻结）")
    else:
        report(f"② 冻结 {frozen} 屏（{depth} 层中超出预算的部分）")
    if d.get("b_freeze_unmounts") != frozen:
        fail(f"② freeze 命令数 != 冻结计数：{d.get('b_freeze_unmounts')} / {frozen}（执行器契约不一致）")
    else:
        report(f"② freeze unmount 命令与冻结计数一致（{d.get('b_freeze_unmounts')}）")
    if d.get("b_depth") != depth:
        fail(f"② 冻结后栈深变了：{d.get('b_depth')} / {depth}（冻结必须**保留栈位**）")
    else:
        report(f"② 冻结保留栈位：栈深仍为 {d.get('b_depth')}")

    # ── ④ 冻结后返回 = 重建 ──
    if d.get("c_frozen_before_pop") != 1:
        fail(f"④ 冻结前置不成立：c_frozen_before_pop={d.get('c_frozen_before_pop')}（期望 1）")
    elif d.get("c_rebuild_mounts") != 1:
        fail(f"④ 返回冻结屏未产生重建 mount：rebuild_mounts={d.get('c_rebuild_mounts')}（期望 1）")
    elif d.get("c_rebuild_stat") != 1:
        fail(f"④ rebuild 计数不一致：stat={d.get('c_rebuild_stat')}（期望 1）")
    else:
        report("④ 返回冻结屏 = mount(rebuild=true) 且计数一致")

    # ── ③ 性能（数量级判据：抓 O(n²) 退化，不拷打绝对值）──
    push_ms = d.get("a_push_ms", 0)
    if not isinstance(push_ms, (int, float)) or push_ms > 3000:
        fail(f"③ 深栈 push 耗时异常：{push_ms}ms（>3000ms——有 O(n²) 退化嫌疑；本机 V8 约 13ms）")
    else:
        report(f"③ 高性能：{depth} 层 push = {push_ms}ms（含 {d.get('b_push_ms')}ms 冻结路径版本）")
    nav_ms = d.get("d_nav_ms", 0)
    if not isinstance(nav_ms, (int, float)) or nav_ms > 3000:
        fail(f"③ navigate diff 耗时异常：{nav_ms}ms")
    else:
        report(f"③ navigate diff（5000 层回退一半）= {nav_ms}ms")

    # ── ⑤ navigate diff 最小操作集 ──
    if d.get("d_mounts") != 0:
        fail(f"⑤ navigate 回退产生了 mount={d.get('d_mounts')}（保留段应树不动、零 mount）")
    else:
        report("⑤ navigate diff 零 mount（保留段树不动——最小操作集）")
    if d.get("d_unmounts") != 2500:
        fail(f"⑤ navigate unmount 数 != 弹出数：{d.get('d_unmounts')} / 2500")
    else:
        report(f"⑤ navigate 仅销毁弹出段（{d.get('d_unmounts')} 屏）+ 1 次 enter")

    # ── ⑦★场景 E：宿主执行器（M5 命令流的消费者——**真实端口**：真内核树 + 真动画）──
    # ★数据来源：执行器结果在**第二份报告**（`app-stack-executor.json`，异步写——动画由宿主
    #   帧循环推进，不能同步取）。本组把它合并进 `d`（缺件 ⇒ 判红并指路）。
    exec_path = os.path.join(os.path.dirname(os.path.abspath(path)), "app-stack-executor.json")
    if not os.path.exists(exec_path):
        fail(f"⑦ 执行器报告缺失（{exec_path}）——跑 run-app-stack.sh（它会取回第二份报告）")
    else:
        try:
            with open(exec_path, encoding="utf-8") as f:
                e = json.load(f)
            d = {**d, **e}  # 合并（⑦ 组字段都来自执行器报告）
            if e.get("timeout") is True:
                fail(f"⑦ 执行器超时（timeout=true，轮数 {e.get('rounds')}）——动画未在 10s 内播完？")
        except Exception as ex:  # noqa: BLE001
            fail(f"⑦ 执行器报告读不出：{ex}")
    # 【要证明什么】M5 计划文档自述的剩余工作 =「宿主执行器（真实建/销毁屏子树 + Morpheus 转场接线）」。
    #   本组证明**编排层**在真机 QuickJS 上跑通（真栈 + 真执行器 + 真 animation 规划器；
    #   端口是记录桩——真机上的树操作/平台动画由宿主实现，属另一条链，不在本组声称）。
    if d.get("e_pending") is True:
        fail("⑦ 执行器两相未完成（e_pending=true）——kick 后 job 泵没把 async 链推进完？")
    elif d.get("e_fatal"):
        fail(f"⑦ 执行器场景 fatal：{d.get('e_fatal')}")
    else:
        e1_log = d.get("e1_log") or []
        e2_log = d.get("e2_log") or []
        e3_log = d.get("e3_log") or []
        e1_plays = d.get("e1_plays") or []
        e2_plays = d.get("e2_plays") or []
        e3_plays = d.get("e3_plays") or []
        estats = d.get("e_stats") or {}
        # ⑦.1 命令序（push）：mount 新屏 → 置可见 → 旧屏隐藏（树保留）
        if not (e2_log and e2_log[0].startswith("mount:detail") and "visible:detail" in " ".join(e2_log) and any(":false" in l for l in e2_log)):
            fail(f"⑦ push 命令序不符（期望 mount(detail) → visible(true) → visible(旧,false)）：{e2_log}")
        elif any(l.startswith("destroy:") for l in e2_log):
            fail(f"⑦ push 产生了销毁（虚拟栈要求树保留）：{e2_log}")
        else:
            report(f"⑦ push 命令序正确（树保留）：{len(e2_log)} 步 · {e2_log}")
        # ⑦.2 方向：push=forward / pop=back
        if (e2_plays or [{}])[0].get("direction") != "forward":
            fail(f"⑦ push 方向应为 forward：{e2_plays}")
        elif (e3_plays or [{}])[0].get("direction") != "back":
            fail(f"⑦ pop 方向应为 back：{e3_plays}")
        else:
            report("⑦ 方向推导：push=forward · pop=back（首屏=forward）")
        # ⑦.3 ★镜像对（同一转场：forward.incoming 的 from/to ↔ back.outgoing 的 to/from）
        #   ★★判据侧**独立复算**（不信 JS 自报的 e_mirror_ok——那是"自我认证"，本仓明令禁止；
        #     e_mirror_ok 仅作交叉核对：若两侧结论不一致 ⇒ 说明有一侧算错了，当场红）。
        fwd_p1 = (e2_plays or [{}])[0]
        back_p1 = (e3_plays or [{}])[0]
        mirror_recomputed = (
            fwd_p1.get("firstInFrom") == back_p1.get("firstOutTo")
            and fwd_p1.get("firstInTo") == back_p1.get("firstOutFrom")
        )
        if not mirror_recomputed:
            fail(
                "⑦ 镜像对不成立（判据侧独立复算）："
                f"forward.in {fwd_p1.get('firstInFrom')}→{fwd_p1.get('firstInTo')} 应 ↔ "
                f"back.out {back_p1.get('firstOutFrom')}→{back_p1.get('firstOutTo')}（互逆）"
            )
        elif d.get("e_mirror_ok") is not True:
            fail(f"⑦ 判据复算与 JS 自报不一致（JS e_mirror_ok={d.get('e_mirror_ok')}）——两侧必有一侧算错")
        else:
            report(
                f"⑦ 镜像对成立（判据侧独立复算）：forward.in {fwd_p1.get('firstInFrom')}→{fwd_p1.get('firstInTo')} "
                f"↔ back.out {back_p1.get('firstOutFrom')}→{back_p1.get('firstOutTo')}"
            )
        # ⑦.4 销毁时机：pop 的旧顶必须在**转场播完后**销毁（记录桩同步返回 ⇒ 顺序即证据）
        if not (e3_log and any(l.startswith("destroy:detail") and ":pop:" in l for l in e3_log)):
            fail(f"⑦ pop 未在转场后销毁旧顶：{e3_log}")
        else:
            # 可见性先于销毁（旧顶先滑出、再销毁——不是先毁后播）
            vis_idx = next((i for i, l in enumerate(e3_log) if l.startswith("visible:")), -1)
            des_idx = next((i for i, l in enumerate(e3_log) if l.startswith("destroy:")), -1)
            if vis_idx < 0 or des_idx < 0 or vis_idx > des_idx:
                fail(f"⑦ 销毁时机不对（应先置可见/播转场、再销毁）：{e3_log}")
            else:
                report(f"⑦ 销毁时机正确（转场后销毁：{e3_log}）")
        # ⑦.5 计数自洽（禁伪造：commands = 各分支之和；transitions = forward+back+skipped）
        cmds = estats.get("commands", -1)
        trans = estats.get("transitions", -1)
        fwd, backn, skip = estats.get("forward", -1), estats.get("back", -1), estats.get("skippedNone", -1)
        if cmds < 6:
            fail(f"⑦ 执行器消费命令数过少（{cmds}）——编排链没跑全？")
        elif trans != fwd + backn:
            fail(f"⑦ 转场计数不自洽：transitions={trans} != forward+back={fwd}+{backn}")
        elif not (estats.get("errors") == []):
            fail(f"⑦ 执行器报错：{estats.get('errors')}")
        else:
            report(f"⑦ 计数自洽：{cmds} 命令 → {trans} 转场（forward {fwd} / back {backn} / 跳过 {skip}）· 零错误")
        # ⑦.6 ★★宿主真动作（证据来自**宿主记账**，不是 JS 自述——与 ⑩ 组同一条纪律）
        hs = d.get("e_host_stats") or {}
        if not isinstance(hs, dict) or hs.get("error"):
            fail(f"⑦ 宿主记账缺失（screen.stats 读不到）：{hs}")
        else:
            mounts = hs.get("mount_calls", 0)
            vis = hs.get("visible_calls", 0)
            des = hs.get("destroy_calls", 0)
            anims = hs.get("anim_calls", 0)
            done = hs.get("anim_completed", 0)
            hookmiss = hs.get("anim_hook_missing", 0)
            handles = hs.get("handle_count", -1)
            if mounts < 2 or vis < 3 or des < 1:
                fail(f"⑦ 宿主真动作不足：mount={mounts}(≥2) visible={vis}(≥3) destroy={des}(≥1)——树操作没真发生？")
            elif anims < 2 or done < 2:
                fail(f"⑦ 宿主动画未真播/未真完成：anim_calls={anims}(≥2) anim_completed={done}(≥2)——帧循环没推进？")
            elif hookmiss != 0:
                fail(f"⑦ 动画完成回推钩子缺失 {hookmiss} 次（JS 侧 __proteusHostScreenAnimDone 未装？）")
            elif plat == "android" and handles < 1:
                # ★handle_count 是 Android 专有读数（`RustLayout.handleCount()`）；iOS 报告无该字段
                #   ——用"屏保留语义"（下方 screens 断言）替代，跨平台等价。
                fail(f"⑦ 宿主内核句柄数异常：handle_count={handles}（屏树应仍在册——树保留语义）")
            else:
                scale = f"在册句柄 {handles} · " if plat == "android" else ""
                report(
                    f"⑦ ★宿主真动作（宿主记账）：mount={mounts} · visible={vis} · destroy={des} · "
                    f"anim={anims}/完成 {done} · {scale}零钩子缺失"
                )
            # 屏保留语义：pop 后 detail 应**已销毁**、home 仍在册
            scrs = hs.get("screens") or []
            ids = [str(x.get("screenId", "")) for x in scrs if isinstance(x, dict)]
            if not any(i.startswith("home#") for i in ids):
                fail(f"⑦ 宿主在册屏异常（home 应保留在册——树保留语义）：{ids}")
            elif any(i.startswith("detail#") for i in ids):
                fail(f"⑦ 宿主在册屏异常（detail 应已销毁）：{ids}")
            else:
                report(f"⑦ 宿主屏保留语义正确：pop 后 detail 已销毁、home 仍在册（{ids}）")

        # ── ⑦.7★E4：**跨页面共享元素**（2026-10-01 收诚实边界）──
        #   【收的是什么】边界原文"跨页面的稳态几何回传需页面栈层配合（未做）"。
        #   本组证明页面栈层已把它接上：目标页 mount 后取节点矩形（内核算）+ 源页矩形
        #   （**另一棵树**）作起点 → 内核 `shared_element` 算 dx/dy/scale + 写首帧 →
        #   宿主帧循环推进（与转场同一条完成链）。
        #   【判据侧独立复算】不押宿主自报的 dx/dy/scale——用两个矩形自己算一遍（中心差 + 宽度比）。
        e4 = d.get("e4") or {}
        if not isinstance(e4, dict) or not e4.get("ran"):
            fail(f"⑦.7 跨页面共享元素未跑（e4={e4}）——页面栈层未接 screen.rect/screen.shared？")
        else:
            trect = e4.get("target_rect") or {}
            # ★按**实际注入**的源矩形复算（错开后的——见 entry-app-stack 的注释：
            #   两侧装置几何相同会让复算退化成恒等式，错开才真考验"按两个不同矩形算几何"）
            srect = e4.get("injected_source_rect") or {}
            frect = e4.get("from_rect") or {}
            torect = e4.get("to_rect") or {}
            if not (srect.get("w") and trect.get("w")):
                fail(f"⑦.7 几何回传不全（源 {srect} / 目标 {trect}）——screen.rect 未真读几何？")
            elif e4.get("source_screen") == e4.get("target_screen"):
                fail(f"⑦.7 不是跨页面（源/目标同屏）：{e4.get('source_screen')}")
            else:
                # 独立复算：内核几何 = 中心差 + 宽度比（与 anim.rs::shared_element_plan 同式）
                exp_dx = (srect["x"] + srect["w"] / 2) - (trect["x"] + trect["w"] / 2)
                exp_dy = (srect["y"] + srect["h"] / 2) - (trect["y"] + trect["h"] / 2)
                exp_scale = srect["w"] / trect["w"]
                # ★非退化：错开后的源 ≠ 目标 ⇒ 几何必须非零（否则"复算"没测到东西）
                degenerate = abs(exp_dx) < 0.5 and abs(exp_dy) < 0.5 and abs(exp_scale - 1) < 0.01
                # 内核回执的 fromRect / toRect 必须等于调用方给的两个矩形（原样回，几何是内核算的）
                fr_ok = abs((frect.get("x") or 0) - srect["x"]) < 0.51 and abs((frect.get("w") or 0) - srect["w"]) < 0.51
                to_ok = abs((torect.get("x") or 0) - trect["x"]) < 0.51 and abs((torect.get("w") or 0) - trect["w"]) < 0.51
                if degenerate:
                    fail(f"⑦.7 跨页面几何退化（dx={exp_dx:.1f} dy={exp_dy:.1f} scale={exp_scale:.3f}）——复算无意义")
                elif not fr_ok:
                    fail(f"⑦.7 内核回的 fromRect 与注入源矩形不符：{frect} vs 注入 {srect}")
                elif not to_ok:
                    fail(f"⑦.7 内核回的 toRect 与目标节点矩形不符：{torect} vs 目标 {trect}")
                else:
                    report(
                        f"⑦.7 ★跨页面共享元素（两棵树之间）：源 {e4.get('source_screen')}(节点 {e4.get('source_node')}, "
                        f"{srect['w']:.0f}×{srect['h']:.0f}) → 目标 {e4.get('target_screen')}(节点 {e4.get('target_node')}, "
                        f"{trect['w']:.0f}×{trect['h']:.0f})｜判据独立复算 dx={exp_dx:.1f} dy={exp_dy:.1f} scale={exp_scale:.3f}"
                        f"（非退化 ✓）"
                    )

    # ── ⑧★场景 F（2026-10-02 · App 端路由收口）：**统一路由 API**（createRouter）真机全链 ──
    #   证明"开发者不用手写各端胶水"：与 Web/MP **同一个 API**（push/back/replace）打到 App 端。
    #   ★字段缺失（旧 bundle）⇒ 如实跳过并提示（不假绿）。
    if "f_ok" not in d:
        report("⑧ 统一 API 场景（F）：报告无 f_ok 字段（旧 bundle？）——跳过（不假绿）")
    elif d.get("f_ok") is not True:
        fail(
            f"⑧ 统一 API 全链未通过：f_after_push={d.get('f_after_push')} · "
            f"f_after_back={d.get('f_after_back')} · f_after_replace={d.get('f_after_replace')}"
        )
    else:
        fp = d.get("f_after_push") or {}
        fb = d.get("f_after_back") or {}
        fr = d.get("f_after_replace") or {}
        report(
            f"⑧ ★统一 API（createRouter）真机全链：push→{fp.get('depth')}层（{fp.get('top')} · params={fp.get('params')}）· "
            f"back→{fb.get('depth')}层（{fb.get('top')}）· replace→{fr.get('depth')}层（{fr.get('top')}）"
        )

    print()
    if not ok:
        print("✗ 路由虚拟栈未通过（见上方失败项）")
        return 1
    engine_name = "QuickJS" if plat == "android" else "JavaScriptCore"
    print(f"✅ 路由虚拟栈通过：无层数上限 + 预算冻结有界 + 树保留 + 命令守恒（真机 {engine_name} 证据）")
    print(f"  规模：{depth} 层 · 屏池 {d.get('fans')} · 预算 {budget} 节点")
    return 0


if __name__ == "__main__":
    sys.exit(main())
