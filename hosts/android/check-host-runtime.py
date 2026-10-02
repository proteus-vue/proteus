#!/usr/bin/env python3
"""hosts/android/check-host-runtime.py —— ★★G-39 宿主运行时判据（真机产物 host-runtime.json + host-shell.json）

【★两个平台共用本判据（2026-09-30）】Android（QuickJS 壳）与 iOS（JSC 壳）跑**同一份**
  `hosts/shared/bridge/entry-host-runtime.ts`（平台中立入口），产物字段同名 ⇒ 同一判据。
  平台差异以 `host_id` 自报（'android' / 'ios'）并对内存口径分档：
    · `mem_scope="engine"`（Android/QuickJS：`JS_ComputeMemoryUsage` 引擎真实 JS 堆）
    · `mem_scope="process"`（iOS/JSC：`phys_footprint`——本轮取证确认 JSC **无公开
      per-context 内存 API**，故用进程口径；分配规模相应更大，IoT 判据按"增长/回落"方向断言）
  两者共同断言：分配后读数增长、GC 后读数回落（**方向**判据，避免跨口径绝对值比较）。

【要证明什么（G-39 宿主运行时 SPI 与职责边界，四块拼图的可执行判据）】
  A/B 生命周期唯一拥有：状态机走 created→running→suspended→running；**非法转换被拒绝且记账**
    （bootstrap 于 suspended / 未挂起 resume / 销毁后 enqueue / 重复 destroy 四条都必须拒绝）。
  C **真实宿主壳转发**（第二份产物 host-shell.json）：Android onPause/onResume（HOME 键触发）
    → JS 运行时 ⇒ suspend/resume **真被应用**（这是"壳把生命周期交给 runtime"的端上证据；
    判据脚本不接受"只在 JS 里手动调"——那种只能证明状态机，不能证明归属）。
  D 事件循环归属：挂起时不推进（pump=0）；恢复后消费；帧内自排队同帧消化；
    ★**await/Promise 续体经宿主 job 泵执行**（jobs_pumped>0 且 async_resolved=true——
    缺 job 泵时该条恒红，这正是本轮补的实缺）。
  E 职责边界：threads.background=false 诚实拒绝；未注册原生调用被拒（不静默）；
    注册后调用成功且值正确。
  F 内存账本：引擎真实 JS 堆读数（memUsage）——分配后增长、GC 后下降；无宿主桥时诚实标注。
  G G-41 宿主 conformance 用**本运行时**替换 stub：32/32 PASS（H-01~H-08）。
  J App 端原生能力通道（10 能力经壳转发：真调用成功 / 诚实 Err）——**Android 腿**（iOS 显式待办）。
  K 应用级生命周期事件源（安卓腿）：系统事件由脚本真驱动，证据链**三环对齐**
    （Java 真回调 attempts → Java 推送 pushes → JS 收到 seen），读同目录 host-app-events.json
    （Java 在未捕获异常处理器里、进程死前落盘）。无该文件 ⇒ 判红指向 run-host-runtime.sh。

用法：python3 hosts/android/check-host-runtime.py <host-runtime.json> [host-shell.json]
  （K 证据文件按主报告同目录推导：host-app-events.json）
退出码：0 全过 / 1 有失败 / 0（产物缺失时诚实跳过）
"""
import json
import os
import sys


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print("用法：python3 hosts/android/check-host-runtime.py <host-runtime.json> [host-shell.json]")
        return 2
    path = args[0]
    shell_path = args[1] if len(args) > 1 else None
    if not os.path.exists(path):
        print(f"⚠ 宿主运行时判据：未找到真机产物（{path}）")
        print("  ⇒ 诚实跳过（跑真机后取回）：")
        print("     1) node hosts/android/bridge/build-batch.mjs")
        print("     2) bash hosts/android/build-and-run.sh --no-install")
        print("     3) bash hosts/android/run-host-runtime.sh")
        return 0

    print(f"═══ Android 宿主运行时判据：{path} ═══")
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

    def warn(msg: str) -> None:
        """显式待办标注（非失败：平台分档的诚实边界——不静默，也不误判）"""
        print(f"  ⚠ {msg}")

    # 前置
    host_id = d.get("host_id")
    if host_id:
        print(f"  平台：{host_id}（壳自报；帧驱动={d.get('frame_driver')}）")
    if not d.get("engine_available"):
        fail(f"QuickJS 引擎不可用：{d.get('error')}")
        print()
        return 1
    if d.get("error"):
        fail(f"运行报错：{d.get('error')}")
        print()
        return 1
    if not d.get("bundle_load_ok") or not d.get("run_ok") or not d.get("ok"):
        fail(f"bundle/入口失败：load={d.get('bundle_load_ok')} run={d.get('run_ok')} ok={d.get('ok')} finish={d.get('finish_ok')}")
        print()
        return 1

    # ── A/B 生命周期状态机 ──
    expect_states = [
        ("state_created", "created"),
        ("state_running", "running"),
        ("state_suspended", "suspended"),
        ("state_resumed", "running"),
        ("state_destroyed", "destroyed"),
    ]
    bad = [f"{k}={d.get(k)}（期望 {v}）" for k, v in expect_states if d.get(k) != v]
    if bad:
        fail("A/B 生命周期状态机：" + " · ".join(bad))
    else:
        report("A/B 状态机：created→running→suspended→running→destroyed 全链正确")

    # ── 非法转换拒绝（四条） ──
    refusals = [
        ("refuse_bootstrap_when_suspended", "挂起态 bootstrap"),
        ("refuse_double_resume", "未挂起/重复 resume"),
        ("refuse_enqueue_after_destroy", "销毁后 enqueue"),
        ("refuse_destroy_twice", "重复 destroy"),
    ]
    badr = [name for key, name in refusals if d.get(key) is not True]
    if badr:
        fail("非法转换未被拒绝（G-39 纪律：非法操作必须拒绝且记账）：" + " / ".join(badr))
    else:
        report("非法转换四条全被拒绝（挂起 bootstrap / 重复 resume / 销毁后 enqueue / 重复 destroy）")
    ops = d.get("refusal_ops") or []
    if len(ops) < 4:
        fail(f"拒绝日志不足：{ops}（拒绝必须**被记账**——治理证据）")
    else:
        report(f"拒绝日志记账 {len(ops)} 条：{', '.join(ops)}")

    # ── C 真实宿主壳转发（host-shell.json） ──
    if not shell_path or not os.path.exists(shell_path):
        fail("壳转发产物缺失（host-shell.json）——Activity onPause/onResume 未被转发进 JS 运行时"
             "（G-39 动机第一条：壳把生命周期交给 runtime）")
    else:
        try:
            with open(shell_path, encoding="utf-8") as f:
                sh = json.load(f)
            if not sh.get("hook_loaded"):
                fail("壳转发钩子未加载（bundle 未 eval 或钩子未挂全局）")
            elif sh.get("suspend_applied", 0) < 1:
                fail(f"真实 onPause 未被应用：suspend_applied={sh.get('suspend_applied')}（期望 ≥1）")
            elif sh.get("resume_applied", 0) < 1:
                fail(f"真实 onResume 未被应用：resume_applied={sh.get('resume_applied')}（期望 ≥1）")
            else:
                report(f"C 真实壳转发：onPause/onResume 各被应用 ≥1 次（events={sh.get('events')}，终态={sh.get('final_state')}）")
        except Exception as e:  # noqa: BLE001
            fail(f"壳转发报告解析失败：{e}")

    # ── D 事件循环归属 ──
    if d.get("pump_while_suspended") != 0:
        fail(f"挂起时仍在推进队列：pump_while_suspended={d.get('pump_while_suspended')}（帧预算应归还宿主）")
    else:
        report("D 挂起时不推进队列（pumpFrame=0）")
    if d.get("pump_after_resume") != 1 or d.get("ran_after_resume") is not True:
        fail(f"恢复后队列未推进：pump_after_resume={d.get('pump_after_resume')} ran={d.get('ran_after_resume')}")
    else:
        report("D 恢复后队列被消费（1 条）")
    if d.get("pump_self_queued") != 2:
        fail(f"帧内自排队未同帧消化：pump_self_queued={d.get('pump_self_queued')}（期望 2）")
    else:
        report("D 帧内自排队同帧消化（防饥饿语义）")
    jobs = d.get("jobs_pumped", 0)
    # ★证据链（真机首版判据写错过一次，这是修正后的形态）：
    #   `async_resolved_at_run` 必须为 **false**（续体不可能是"同步完成"的假象），
    #   finish 相位 `async_resolved` 必须为 **true** —— 中间的转换只能由**宿主侧的 job 泵**
    #   推动（QuickJS 语义：Promise 续体进 pending job 队列，只有 JS_ExecutePendingJob 能跑它）。
    #   ★`jobs_pumped` 允许为 0：C 桥在每次 eval 尾自动泵一次（防 await 半执行的地基），
    #     显式调用通常拿 0——**0 不代表泵失效**（若拿它当判据会误红；若 job 泵整体缺失，
    #     async_resolved 会恒 false，判据在下一行抓到）。
    if d.get("async_resolved_at_run") is not False:
        fail(f"run 相位续体已解析（async_resolved_at_run={d.get('async_resolved_at_run')}）——"
             "Promise 续体不应在同步相位完成；此读数说明断言时机错了（假阳性风险）")
    elif d.get("async_resolved") is not True:
        fail("job 泵未生效：run 相位未解析 → finish 相位仍未解析（await/Promise 续体不会跑——"
             "这正是本仓此前的真实状态）")
    else:
        report(f"D ★job 泵证据链：run 相位未解析(false) → finish 相位已解析(true)"
               f"（显式泵读数 jobs_pumped={jobs} 可为 0——eval 尾已自动泵；pending_after_run={d.get('pending_after_run')}）")
    if d.get("pending_after_finish") is True:
        fail("finish 后仍有挂起 job（事件循环未收敛——队列清空是结束语义）")
    else:
        report("D finish 后无挂起 job（队列收敛）")

    # ── E 职责边界 ──
    if d.get("refuse_background_thread") is not True:
        fail("runOnThread('background') 未被拒绝（单线程宿主必须诚实拒绝，不假排队）")
    else:
        report("E 后台线程请求被诚实拒绝（threads.background=false）")
    if d.get("refuse_unregistered_native") is not True:
        fail("未注册的原生调用未被拒绝（静默失败最致命）")
    else:
        report("E 未注册原生调用被拒绝（可操作信息）")
    if d.get("registered_native_ok") is not True or d.get("registered_native_value") != '{"v":1}':
        fail(f"注册后的原生调用异常：ok={d.get('registered_native_ok')} value={d.get('registered_native_value')}")
    else:
        report("E 注册后的原生调用成功且值正确（echo {v:1}）")

    # ── F 内存账本 ──
    # ★判据侧**独立重算**（不采信 JS 侧算好的 mem_ok——破坏性验证抓出过这个漏洞：
    #   只改原始读数不改 mem_ok 时旧版判据放行 ⇒ 判据必须落在**原始结果**上）
    #
    # ★★按口径分档断言（2026-09-30 两次 iOS 实测得出的必要修正）：
    #   · engine（Android/QuickJS）：「GC 后下降」是**稳定**的（实测 -319984/+320264 ≈ 全回收）⇒ 强制；
    #   · process（iOS/JSC）：同一条判据**不稳定**——两次真机运行分别降 147KB 与 **0**（1 字节未降）。
    #     根因（取证）：JSC 的 `JSGarbageCollect` 是**提示性 GC**，回收后把页留在自身 free pool、
    #     不即时归还 OS；`phys_footprint` 只看 OS 侧 ⇒ **降不降取决于回收时机**，不是缺陷信号。
    #   ⇒ process 口径下强制两条**稳定**的断言（分配增长 / GC 不导致增长），把"是否归还 OS"
    #     作为**观测项**输出（含明确说明）——不让一个会随机红的判据变成噪声。
    if d.get("mem_available") is not True:
        fail("内存账本不可用（宿主桥 memUsage 未接入——引擎真实 JS 堆读数缺失）")
    else:
        mb = d.get("mem_before", 0)
        ma = d.get("mem_after_alloc", 0)
        mg = d.get("mem_after_gc", 0)
        scope = d.get("mem_scope", "unknown")
        scope_note = {
            "engine": "引擎真实 JS 堆（QuickJS JS_ComputeMemoryUsage）",
            "process": "进程口径 phys_footprint（JSC 无公开 per-context API——诚实标注）",
        }.get(scope, f"口径={scope}")
        ok_alloc = isinstance(ma, int) and isinstance(mb, int) and ma > mb
        ok_no_grow = isinstance(mg, int) and mg <= ma
        if not ok_alloc:
            fail(f"分配后内存未增长：{mb}→{ma}（读数或分配逻辑失效）")
        elif not ok_no_grow:
            fail(f"GC 后内存反而增长：alloc={ma} → gc={mg}（GC 本身不该让占用上升）")
        elif scope == "engine" and not (mg < ma):
            fail(f"GC 后内存未下降：alloc={ma} → gc={mg}（engine 口径下回收应稳定生效——"
                 f"QuickJS 实测 ≈100% 回收；不降说明对象仍可达或 GC 未接线）")
        else:
            grow = ma - mb
            shrink = ma - mg
            if scope == "process":
                # 观测项（判据不强制——见上方注释的实测依据）
                observed = "已归还" if shrink > 0 else "未归还 OS（提示性 GC 保留在 free pool——预期形态之一）"
                report(f"F 内存账本：分配增长 {mb}→{ma}B（+{grow}）· GC 后 {mg}B（-{shrink}，{observed}）"
                       f"（{scope_note}；判据侧独立重算；过程口径强制项=分配增长+GC 不增）")
            else:
                report(f"F 内存账本：分配增长 {mb}→{ma}B（+{grow}），GC 后降至 {mg}B（-{shrink}）"
                       f"（{scope_note}；判据侧独立重算）")

    # ── I 应用与生命周期能力开放（C23/C24/C25——App 宿主腿）──
    # 【要证明什么】三个 Hook 在**设备上**真的被事件驱动（不是"桥存在"就算）：
    #   ① 冷启动补 launch（app:launch 在首个 app:show 之前）；② 真实栈命令驱动页面生命周期；
    #   ③ 系统事件面（内存警告/主题）真分发；④ 壳真实事件（pause/resume）进了应用生命周期。
    cap_log = d.get("cap_log") or []
    if not d.get("cap_launch_before_any_show"):
        fail(f"① 冷启动未补 launch（cap_log={cap_log}）——wx 语义：onLaunch 恰好一次且先于 onShow")
    else:
        report("① C23 冷启动语义：app:launch 前置且恰好一次（launches=%s）" % d.get("cap_launches"))
    if (d.get("cap_page_after_pop") or "") != "home":
        fail(f"② 真实栈命令未驱动页面生命周期：pop 后 currentScreen={d.get('cap_page_after_pop')}（期望 home）")
    else:
        report("② C24 页面生命周期：真实 app-stack 命令流驱动（push→load/show，pop→hide/unload，回到 home）")
    bg_events = d.get("cap_bg_events") or []
    if d.get("cap_bg_ready") is not True:
        fail("③ useBackground 的异步部分未完成（getLaunchOptions 的 Promise 未解析——job 泵？）")
    elif (d.get("cap_launch_options") or {}).get("path") != "pages/detail":
        fail(f"③ 启动参数未读到：{d.get('cap_launch_options')}（期望 path=pages/detail——深链数据源）")
    else:
        report(f"③ C25 启动参数经 Promise 读到（job 泵链）：{d.get('cap_launch_options')}")
    # ★④ 读**壳报告**（后置证据：壳事件发生之后写出的状态）
    #   为什么不在主报告读：主报告写于场景相位（生命周期往返**之前**）⇒ 那时壳历史必为空。
    #   判据要落在"壳事件真的驱动了能力总线"上 ⇒ 用后置报告里的 cap_app_phase。
    sh_d = None
    if shell_path and os.path.exists(shell_path):
        try:
            with open(shell_path, encoding="utf-8") as f:
                sh_d = json.load(f)
        except Exception:  # noqa: BLE001
            sh_d = None
    sh_app = (sh_d or {}).get("cap_app_phase")
    # ★强判据（不是"终态是 SHOW"这么弱）：逐条查 shellLog 的 cap_phase ——
    #   pause 必须留下 HIDE、resume 必须留下 SHOW。**HIDE 只能由真实 hide 事件产生**
    #   （总线初始态是 PENDING，且场景的冷启动补发只发 show）⇒ 这条绑定证明"壳事件驱动了能力总线"。
    sh_log = (sh_d or {}).get("log") or []
    pause_entry = next((e for e in sh_log if e.get("evt") == "pause" and e.get("applied")), None)
    resume_entry = next((e for e in sh_log if e.get("evt") == "resume" and e.get("applied")), None)
    if d.get("cap_shell_driven_events") is None and not sh_log:
        fail("④ 壳报告缺失或为空——无法验证壳事件→能力总线链路")
    elif not pause_entry or pause_entry.get("cap_phase") != "HIDE":
        fail(f"④ pause 未驱动能力总线到 HIDE：条目={pause_entry}（期望 cap_phase=HIDE）")
    elif not resume_entry or resume_entry.get("cap_phase") != "SHOW":
        fail(f"④ resume 未驱动能力总线到 SHOW：条目={resume_entry}（期望 cap_phase=SHOW）")
    else:
        report(f"④ 壳事件逐条驱动能力总线：pause→{pause_entry.get('cap_phase')} "
               f"→ resume→{resume_entry.get('cap_phase')}（HIDE 只能由真实 hide 事件产生）")
    if d.get("cap_app_phase") not in ("SHOW", "HIDE") or d.get("cap_page_phase") not in ("LOAD", "SHOW", "HIDE"):
        fail(f"⑤ 阶段快照异常：app={d.get('cap_app_phase')} page={d.get('cap_page_phase')}")
    else:
        report(f"⑤ 阶段快照：app={d.get('cap_app_phase')} · page={d.get('cap_page_phase')} · 订阅 {d.get('cap_subscribers')}")

    # ── J App 端原生能力通道（用户要求：App 也要落地）──
    # 【要证明什么】10 个能力经壳转发：**已实现的真调用成功、未实现的诚实 Err**（不伪造能力位）。
    # ★★平台对齐（2026-09-30 续）：iOS 腿已落地（`host-capabilities.swift` 镜像同一 invoke 契约）
    #   ⇒ 本组对两平台**真验**（provider 按 host_id 分档；差异只在该端"平台约束"的诚实档）。
    app_native = d.get("app_native") or {}
    expected_provider = "ios" if host_id == "ios" else "android"
    # ★分档条件按**能力缺失**判（不是"探针是否跑过"）：鸿蒙的 JS 探针会跑完（done=true），
    #   但宿主桥尚无 `invoke` 通道 ⇒ 能力面为空。将来鸿蒙实现 invoke（capabilities 非空）
    #   自动回到严格档——分档随能力面自动开合，不靠人工记得改判据。
    _caps_pre = (app_native.get("hostContext") or {}).get("capabilities") or []
    if host_id == "harmony" and not _caps_pre:
        warn("J 组（App 原生能力通道 10 项）：鸿蒙 invoke 通道属能力开放批次——如实跳过；"
             "核心组（状态机/生命周期/队列/职责边界/内存/job 泵/壳转发/conformance）已真验")
    elif not app_native.get("done"):
        fail(f"App 原生能力组未完成（app_native.done={app_native.get('done')}，fatal={app_native.get('fatal')}）")
    else:
        # ① 已实现的能力：真实成功 + 数据正确
        hc = app_native.get("hostContext") or {}
        # ★内容判据（破坏性验证暴露：只看 ok 会放过"退回桩"）：
        #   provider 必须是环境自报的（android/ios），且 capabilities 非空（壳真声明了能力）
        caps = hc.get("capabilities") or []
        if hc.get("provider") != expected_provider or len(caps) < 5:
            fail(f"① C48 宿主上下文内容不实（provider={hc.get('provider')} capabilities={caps}）"
                 f"——期望 provider={expected_provider} 且 ≥5 个能力（壳真读）")
        else:
            report(f"① C48 宿主上下文：provider={hc.get('provider')} version={hc.get('version')} caps={len(caps)} 项")
        uc = app_native.get("updateCheck") or {}
        if uc.get("ok") is not True:
            fail(f"② C51 checkUpdate 应成功（壳已实现）：{uc}")
        elif (app_native.get("updateApply") or {}).get("ok") is not True:
            fail(f"② C51 applyUpdate 应成功：{app_native.get('updateApply')}")
        else:
            # ★内容判据：currentVersion 由宿主读**真实 versionName**（PackageManager）
            #   —— 桩实现给不出它（破坏性验证：把实现退回 "STUB" 时本判据当场红）
            cv = (uc.get("data") or {}).get("currentVersion")
            if not cv or cv == "STUB" or cv == "None":
                fail(f"② C51 的 currentVersion 不是真实版本名（{cv}）——疑宿主实现退回桩")
            else:
                src_of_cv = "Info.plist CFBundleShortVersionString" if host_id == "ios" else "PackageManager versionName"
                report(f"② C51 热更新：check/apply 真实调用成功（currentVersion={cv} 读自 {src_of_cv}）")
        ws = app_native.get("windowSetSize") or {}
        wd = ws.get("data") or {}
        # ★真实宿主返回 {requested:{w,h}, applied:bool, decorSize:[w,h]}（两个壳同形）
        req = wd.get("requested") or {}
        if ws.get("ok") is not True or req.get("w") != 1024:
            fail(f"③ C74 窗口设置应成功且回显请求尺寸：{ws}")
        else:
            # ★平台诚实档：Android 分屏下 applied 可真；iOS 全屏 App 不可程序化改窗口 ⇒ applied=False 属**预期**
            applied_note = "" if host_id != "ios" else "（★iOS 全屏 App 不可程序化改窗口——applied=False 属平台约束）"
            report(f"③ C74 窗口：setSize(1024,768) 经真实宿主（applied={wd.get('applied')} decorSize={wd.get('decorSize')}）{applied_note}")
        wp = app_native.get("workerPost") or {}
        if wp.get("ok") is not True:
            fail(f"④ C53 Worker postMessage 应成功：{wp}")
        else:
            # ★诚实标注：桥的 WorkerHandle.postMessage 按接口契约返回 Result<void>（不透传宿主细节），
            #   "是否真线程"的证据在**宿主侧**（workerPost 的 ranOnThread）。
            #   ⇒ 判据改为：post/terminate 均成功（真实宿主执行）+ 宿主调用记录里含 worker.*
            hp = app_native.get("__hostCalls")
            worker_calls = [c for c in (hp if isinstance(hp, list) else []) if str(c).startswith("worker.")]
            if len(worker_calls) < 3:
                fail(f"④ C53 Worker 宿主调用不完整（{worker_calls}）—— create/post/terminate 应各有一次")
            else:
                impl_of_worker = "HostCapabilities.swift（GCD 队列）" if host_id == "ios" else "HostCapabilities（线程池）"
                report(f"④ C53 Worker：真实宿主执行 {len(worker_calls)} 次调用（{', '.join(worker_calls)}）——线程实现于 {impl_of_worker}")
        if app_native.get("idleCallbackRan") is not True:
            fail(f"⑤ C73 空闲回调未执行：{app_native.get('idleRequest')}")
        else:
            report(f"⑤ C73 空闲：request 返回 id={((app_native.get('idleRequest') or {}).get('data'))} 且回调已执行")
        if (app_native.get("preloadAssets") or {}).get("ok") is not True:
            fail(f"⑥ C67 预加载 assets 应成功：{app_native.get('preloadAssets')}")
        else:
            report("⑥ C67 预加载：assets 成功")
        ge = app_native.get("guardEnable") or {}
        if ge.get("ok") is not True:
            fail(f"⑦ C75 导航守卫 enable 应成功（框架内实现）：{ge}")
        else:
            report("⑦ C75 导航守卫：enable/disable 均成功（虚拟栈 pop 拦截——**无需原生 API**）")
        # ② ★诚实 Err 分档（未实现的必须明确失败，不假装成功）
        honest = []
        for key, label in [
            ("preloadSubpackage", "C67 subpackage（App 无分包概念）"),
            ("extensionLoad", "C50 扩展加载（壳未实现）"),
            ("navigateMiniProgram", "C47 跳小程序（壳未实现）"),
        ]:
            v = app_native.get(key) or {}
            if v.get("ok") is False:
                honest.append(f"{label} → Err")
            else:
                fail(f"⑧ {label} 应诚实 Err（不伪造能力位），实得：{v}")
        if honest:
            report("⑧ 未实现能力诚实降级：" + " · ".join(honest))
        # ③ wasm（引擎内置——真验证）
        # ★判据按**引擎能力**分档（真机实测：QuickJS 只有 instantiate，无 compile/validate）：
        #   实现了 ⇒ 必须返回正确结果；未实现 ⇒ 必须**诚实 Err**（不崩、不假装通过）。
        # ★★C82 WebAssembly 真执行判据（宿主侧 wasm3 —— QuickJS 内建无 WASM，本轮补的宿主引擎）
        #   判据链：① add(2,40) 必须 = 42（真跑 i32.add 指令序列）
        #           ② 空模块也须可校验（说明解析器工作）
        #           ③ 宿主调用记录里应有 wasm.*（证明经宿主执行）
        # ★形态兼容（真机实测：宿主返回的 data 直接是**数字**，不是 {result:N} 对象——
        #   初版判据按 .get("result") 读 ⇒ 落到"未接入"分支，**判据自身读错路径**）
        wa = app_native.get("wasmAddResult")
        res = wa if isinstance(wa, (int, float)) else (wa.get("result") if isinstance(wa, dict) else None)
        wasm_type = wa.get("type") if isinstance(wa, dict) else None
        if isinstance(wa, dict) and wa.get("ok") is False:
            fail(f"⑨ C82 wasm 执行失败：{wa}")
        elif res == 42:
            # ★引擎分档：Android = 宿主 wasm3（QuickJS 无内建）；iOS = JSC 内建 WebAssembly（真执行）
            engine = wa.get("engine") if isinstance(wa, dict) else None
            via = "宿主 wasm3" if not engine or engine == "host-wasm3" else "JSC 内建 WebAssembly"
            report(f"⑨ C82 WebAssembly：**{via} 真执行** add(2,40)={res}"
                   f"{f'（type={wasm_type}）' if wasm_type else ''}——手写 41 字节模块，真跑 i32.add 指令")
        elif res is None:
            report("⑨ C82 WebAssembly：宿主 wasm 运行时未接入 ⇒ 诚实 Err（不假装支持）")
        else:
            fail(f"⑨ C82 wasm 结果错误（期望 42，实得 {res}）：{wa}")
        # ② 空模块校验（解析器工作）
        wv = app_native.get("wasmValidateEmptyModule") or {}
        if wv.get("ok") is True and wv.get("data") is True:
            report("⑨ C82 空模块校验通过（wasm 解析器工作）")
        elif wv.get("ok") is False:
            code = wv.get("code")
            if code == "webassembly.unsupported":
                report("⑨ C82 空模块校验：引擎未实现 validate ⇒ 诚实 Err（能力差异）")
            else:
                fail(f"⑨ C82 空模块校验失败：{wv}")

        # ④ ★★壳调用记录（**由真实 Java 宿主自报**——证明能力经宿主执行，不是桥自造数据）
        #   初版读 JS 侧桩的 `__calls`（自我闭环）；现读 `HostCapabilities.callLog`。
        host_calls_raw = app_native.get("__hostCalls")
        # ★形态：`invokeHost('native.calls')` 返回 {ok:true, data:[...]}（data 直接是数组——
        #   初版按 .data.data 读 ⇒ 判据自身读错路径，真机实测暴露）
        calls = None
        if isinstance(host_calls_raw, list):
            calls = host_calls_raw
        elif isinstance(host_calls_raw, dict):
            inner = host_calls_raw.get("data")
            calls = inner if isinstance(inner, list) else None
        if not isinstance(calls, list) or len(calls) < 8:
            fail(f"⑩ 真实宿主未报告足够的调用记录（{host_calls_raw}）——疑宿主未实现 invoke 或桥未转发")
        else:
            host_lang = "Swift" if host_id == "ios" else "Java"
            report(f"⑩ 真实 {host_lang} 宿主自报调用 {len(calls)} 次：{', '.join(str(c) for c in calls[:6])}…（证据来自宿主记账，非桥自述）")

    # ── K 应用级生命周期事件源（用户要求「再检查下安卓是否真的实现了应用生命周期相关的能力落地」）──
    # 【★★2026-09-30 重做：初版是**假绿**】初版由 JS 探针**自触发**六个事件 ⇒ 把宿主侧
    #   来源整类删掉也全绿（与 J 组"自我认证"同款缺陷，本仓禁止）。现在证据链=**三环对齐**：
    #     ① attempts——宿主侧真系统回调发生（只在真回调入口 +1；JS 侧无法写入）
    #     ② pushes  ——宿主侧成功推入 JS（壳推通道回执 ok 才 +1）
    #     ③ seen    ——JS 总线订阅者实际收到（探针**只被动记录**，不再自触发任何系统事件）
    #   证据由宿主在**未捕获异常处理器里**（进程死前）落盘：host-app-events.json（与本报告同目录）。
    # ★★平台分档（2026-09-30 续：iOS 腿落地）：
    #   · Android：四个事件由 **adb 外部驱动**（send-trim-memory / uimode / rotation / CRASH）
    #   · iOS：devicectl 无外部事件注入通道 ⇒ theme/memory 走**应用内探针**（真 UIKit trait 回调 /
    #     真 NotificationCenter 通知路径——见 HostLifecycleEvents.driveKProbes 的诚实说明），
    #     error 仍是真未捕获异常；resize/audio 只验"观察者已注册"（需真旋转/真来电，不假装）。
    ae = d.get("app_events") or {}
    evidence_path = os.path.join(os.path.dirname(path), "host-app-events.json")
    if host_id == "harmony" and not os.path.exists(evidence_path) and not ae.get("driver"):
        # ★分档条件按**证据面缺失**判：K 组的三个真来源（全局未捕获异常钩子 / 音频中断观察者 /
        #   系统事件面）需要鸿蒙宿主侧事件装配（errorManager 全局钩子、音频焦点事件等）——
        #   属后续批次。core 组的壳转发（C 组）已真验 ⇒ 本组如实跳过。
        #   （将来鸿蒙接了事件装配 ⇒ 证据文件出现 ⇒ 自动回到严格档）
        warn("K 组（App 级事件源 三环对齐）：鸿蒙事件装配属后续批次（证据文件未出现）——如实跳过；"
             "C 组壳转发（真 onBackground/onForeground → 运行时）已真验")
        _skip_k = True
    else:
        _skip_k = False
    if not _skip_k and not ae.get("done"):
        fail(f"K 应用级事件源未完成（done={ae.get('done')} fatal={ae.get('fatal')}）")
    elif not _skip_k and ae.get("hostChannelInstalled") is not True:
        fail("K 壳推通道未装（__proteusHostAppEvent 缺失）——宿主侧系统回调无处可去")
    elif not _skip_k:
        report(f"K 壳推通道已装（订阅 {ae.get('subscribed')} 个应用级事件）")
        ev = None
        try:
            with open(evidence_path, encoding="utf-8") as f:
                ev = json.load(f)
        except Exception as e:  # noqa: BLE001
            runner = "run-selfdraw.sh --host-runtime" if host_id == "ios" else "run-host-runtime.sh"
            fail(f"K 证据文件读不出（{evidence_path}）：{e} —— 跑 {runner}（它驱动真事件并取回证据）")
        if ev is not None:
            # ★字段双形态：Android 落 `java` 节（Java 语言）/ iOS 落 `native` 节（Swift）——同构内容
            java = ev.get("java") or ev.get("native") or {}
            js = ev.get("jsProbe") or {}
            crash = ev.get("crash") or {}
            attempts = java.get("attempts") or {}
            pushes = java.get("pushes") or {}
            lp = java.get("lastPayload") or {}
            history = java.get("history") or []
            seen = js.get("seen") or {}

            # ① 装配面（真来源存在的前提；两条独立）
            if java.get("errorHandlerInstalled") is not True:
                fail("K 全局未捕获异常钩子未装（error 事件无真来源）")
            if java.get("audioReceiverRegistered") is not True:
                recv = "AVAudioSession 通知观察者" if host_id == "ios" else "音频信号接收器（BECOMING_NOISY / HEADSET_PLUG）"
                fail(f"K {recv}未注册——audio-interruption 无真来源")

            # ② 三环对齐（**必须真驱动的事件**按平台分档）
            driven = ["memory-warning", "theme-change", "error"] if host_id == "ios" \
                else ["memory-warning", "theme-change", "resize", "error"]
            broken = []
            for e in driven:
                a, p, s = (attempts.get(e) or 0, pushes.get(e) or 0, seen.get(e) or 0)
                if a < 1 or p < 1 or s < 1:
                    broken.append(f"{e}(回调{a}/推送{p}/收到{s})")
            if broken:
                fail("K 三环未对齐（真回调→壳推送→JS 收到）：" + " · ".join(broken))
            else:
                detail = " · ".join(
                    f"{e} {attempts.get(e)}/{pushes.get(e)}/{seen.get(e)}" for e in driven)
                report(f"K 三环对齐（回调/推送/收到）：{detail}")

            # ③ 驱动载荷内容（历史环里必须能找到**本次驱动**的具体载荷——自动触发的替代不了它）
            def hist_has(evt: str, pred) -> bool:
                for h in history:
                    if not isinstance(h, dict) or h.get("evt") != evt:
                        continue
                    pl = h.get("payload")
                    try:
                        if pred(pl if isinstance(pl, dict) else {}):
                            return True
                    except Exception:  # noqa: BLE001
                        continue
                return False

            if host_id == "ios":
                # iOS 驱动面：theme（真 trait 回调）+ memory（真通知路径）
                drives = java.get("drives") or {}
                if drives.get("theme") != "dark" or (lp.get("theme-change") or {}).get("theme") != "dark":
                    fail(f"K theme-change 内容不实（期望终态 dark；探针记录 drives={drives}）：{lp.get('theme-change')}")
                else:
                    report("K theme-change 内容：终态 theme=dark（真 UIKit trait 回调，overrideUserInterfaceStyle light→dark）")
                if not hist_has("memory-warning", lambda p: p.get("source") == "didReceiveMemoryWarning"):
                    fail(f"K memory-warning 载荷不实（期望 source=didReceiveMemoryWarning）：{lp.get('memory-warning')}")
                else:
                    report("K memory-warning 内容：source=didReceiveMemoryWarning（真通知路径）")
                # resize：无驱动通道（需真旋转）⇒ 诚实标注（iOS 的设备旋转无脚本通道）
                report("K resize：观察者已注册，★iOS 无脚本驱动通道（需真旋转）——诚实标注未驱动")
            else:
                if not hist_has("memory-warning", lambda p: p.get("rawLevel") == 10):
                    fail("K 历史环里没有 send-trim-memory RUNNING_LOW(rawLevel=10) 的载荷"
                         "—— memory-warning 不是真驱动（自动触发的其它等级替代不了）")
                else:
                    report("K memory-warning 内容：rawLevel=10（RUNNING_LOW——脚本驱动的真实等级）")
                if (lp.get("theme-change") or {}).get("theme") != "dark":
                    fail(f"K theme-change 终态应为 dark（脚本最后一步为 uimode night yes）：{lp.get('theme-change')}")
                else:
                    report("K theme-change 内容：终态 theme=dark（uimode night no→yes 真驱动）")
                rz = lp.get("resize") or {}
                if not (isinstance(rz.get("windowWidth"), int) and isinstance(rz.get("windowHeight"), int)
                        and rz.get("windowWidth", 0) > 0 and rz.get("windowHeight", 0) > 0
                        and rz.get("windowWidth") != rz.get("windowHeight")):
                    fail(f"K resize 载荷异常（应为正且宽高不等的真实窗口尺寸）：{rz}")
                else:
                    report(f"K resize 内容：{rz.get('windowWidth')}x{rz.get('windowHeight')}dp（wm user-rotation 真驱动）")
            if "proteus-test-crash" not in str(crash.get("error") or "") or crash.get("jsAck") != "ok":
                fail(f"K error 链证据不实（期望真未捕获异常 + JS 回执 ok）：{crash}")
            else:
                report(f"K error 链：真未捕获异常（线程 {crash.get('thread')}）→ JS 回执 ok → 进程死前落盘")

            # ④ 音频两条：★诚实验证面——**不可脚本驱动**（Android：保护广播 adb 注入被拒；
            #    iOS：需真实来电/音频抢占）⇒ 按"来源已注册"验，**不驱动、不假装**。
            audio_src = "AVAudioSession 通知观察者（真 iOS 音频会话语义）" if host_id == "ios" \
                else "接收器已注册（★保护广播不可注入）"
            report(f"K audio-interruption：{audio_src} ⇒ 不驱动，诚实标注")

            # ⑤ 平台确实没有的两条：如实不触发，且**不得伪造**（宿主不该硬发）
            fabricated = [e for e in ("unhandled-rejection", "page-not-found") if (attempts.get(e) or 0) > 0]
            if fabricated:
                fail(f"K 宿主伪造了平台不存在的事件：{fabricated}（两平台均无此概念——引擎/框架语义）")
            else:
                report("K 平台无概念两条（unhandled-rejection / page-not-found）如实未触发（未伪造）")

            # ⑥ 白名单校验（非法事件名必须被拒——不是"什么都收"）
            bad = js.get("emitBadEvent", ae.get("emitBadEvent"))
            if bad != "unknown-event:not-a-real-event":
                fail(f"K 白名单未生效（非法事件名应被拒并回执）：{bad}")
            else:
                report("K 白名单校验生效（非法事件名被拒 + 可读回执）")

    # ── G 宿主 conformance ──
    total = d.get("conf_total", 0)
    if d.get("conf_fail", -1) != 0 or total != 32:
        fail(f"G-41 宿主 conformance 未全过：PASS={d.get('conf_pass')}/{total} FAIL={d.get('conf_fail')} "
             f"失败项={d.get('conf_fail_ids')}")
    else:
        report(f"G G-41 宿主 conformance（本运行时替换 stub）：{d.get('conf_pass')}/{total} 全过（FAIL=0）")

    print()
    if not ok:
        print("✗ 宿主运行时未通过（见上方失败项）")
        return 1
    print("✅ 宿主运行时通过：生命周期唯一拥有 + 真实壳转发 + 事件循环/job 泵 + 职责边界 + 内存账本")
    # ★平台专有字段容错（bundle_chars/total_ms 由 Android Java 壳写入；iOS 壳不写这两个——不是缺失）
    scale = "bundle=%s 字符 · 总耗时 %sms" % (d.get("bundle_chars", "n/a（iOS 壳不写）"), d.get("total_ms", "n/a"))
    print(f"  规模：{scale} · 平台={host_id or '未自报'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
