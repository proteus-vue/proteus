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

    print(f"═══ Android 路由虚拟栈判据：{path} ═══")
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

    # 引擎/加载前置（缺了就报错，不静默）
    if not d.get("engine_available"):
        fail(f"QuickJS 引擎不可用：{d.get('error')}")
        print()
        print("✗ 前置不满足")
        return 1
    if d.get("error"):
        fail(f"运行报错：{d.get('error')}")
        print()
        print("✗ 前置不满足")
        return 1
    if not d.get("bundle_load_ok") or not d.get("run_ok") or not d.get("ok"):
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

    print()
    if not ok:
        print("✗ 路由虚拟栈未通过（见上方失败项）")
        return 1
    print("✅ 路由虚拟栈通过：无层数上限 + 预算冻结有界 + 树保留 + 命令守恒（真机 QuickJS 证据）")
    print(f"  规模：{depth} 层 · 屏池 {d.get('fans')} · 预算 {budget} 节点")
    return 0


if __name__ == "__main__":
    sys.exit(main())
