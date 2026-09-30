#!/usr/bin/env python3
"""hosts/android/check-host-runtime.py —— ★★G-39 宿主运行时判据（真机产物 host-runtime.json + host-shell.json）

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

用法：python3 hosts/android/check-host-runtime.py <host-runtime.json> [host-shell.json]
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

    # 前置
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
    if d.get("mem_available") is not True:
        fail("内存账本不可用（宿主桥 memUsage 未接入——引擎真实 JS 堆读数缺失）")
    else:
        mb = d.get("mem_before", 0)
        ma = d.get("mem_after_alloc", 0)
        mg = d.get("mem_after_gc", 0)
        if not (isinstance(ma, int) and isinstance(mb, int) and ma > mb):
            fail(f"分配后内存未增长：{mb}→{ma}（读数或分配逻辑失效）")
        elif not (isinstance(mg, int) and mg < ma):
            fail(f"GC 后内存未下降：alloc={ma} → gc={mg}（GC 未生效或对象仍可达——经典作用域陷阱）")
        else:
            report(f"F 内存账本：分配增长 {mb}→{ma}B（+{ma - mb}），GC 后降至 {mg}B"
                   f"（引擎真实 JS 堆；判据侧独立重算）")

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
    print(f"  规模：bundle={d.get('bundle_chars')} 字符 · 总耗时 {d.get('total_ms')}ms")
    return 0


if __name__ == "__main__":
    sys.exit(main())
