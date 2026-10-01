#!/usr/bin/env python3
"""hosts/android/check-vapor-list.py —— ★★★Vapor 长列表虚拟化判据（1000 行 · 物化有界 · 回顶恒等）

【这一条链要证明什么（§9.3 长列表验收的端上缺口）】
  文档定义的「4000 行 / 每行 40+ 元素 / 2 万元素」端上规模此前**从未跑过**（只有 Rust 纯逻辑
  读数与 iOS 的 1000 行 V12）。本判据跑 **1000 行真实 SFC 编译产物**：
  整树进内核（几何正确），宿主**只物化可见区**。

【判据（每条都打在"会失败的那一点"上）】
  ① **产物与实例化**：`tpl_nodes ≥4` · `sub_l1 >0` · `inst_rows == 1000`（1000 行都真的实例化了）
     · `inst_nodes > inst_rows`（每行不止一个节点 ⇒ 整树规模确实远大于视口）
  ② **★物化有界**（虚拟化的唯一意义）：首帧存活行 / 指令数 **远小于**总行数/总节点数
     （阈值：存活行 ≤ 总行数 15% 且 ≤ 120 行；指令 ≤ 总节点 25%）
  ③ **滚动真的动了**：`moved_diff_pct > 0`（部分帧的像素签名有差异）
     · `final_scroll` 与首帧不同（真的滚到了别处）
  ④ **★回顶签名恒等**（堵"滚动有累积漂移/重影"）：`back_top_diff_pct ≈ 0`（阈值 ≤ 2%）
  ⑤ **物化增量有界**（堵"每帧重建整树"）：30 下 + 30 上的物化总数增量 ≤ 行数 25%
     （= 只物化了新进视野的行；不是每帧全量重建）
  ⑥ **复用池真的在动**：`released_total > 0`（有行被释放 ⇒ 不是"只建不撤"）

用法：python3 hosts/android/check-vapor-list.py <vapor-list.json>
退出码：0 全过 / 1 有失败 / 2 用法错（产物缺失时诚实跳过，返回 0）
"""
import json
import os
import sys


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print("用法：python3 hosts/android/check-vapor-list.py <vapor-list.json>")
        return 2
    path = args[0]
    if not os.path.exists(path):
        print(f"⚠ Vapor 长列表判据：未找到真机产物（{path}）")
        print("  ⇒ 诚实跳过（跑真机后取回）：bash hosts/android/run-vapor-list.sh")
        return 0

    print(f"═══ Vapor 长列表虚拟化判据（1000 行 · 物化有界 · 回顶恒等）：{path} ═══")
    ok = True
    with open(path, encoding="utf-8") as f:
        d = json.load(f)

    def fail(msg: str) -> None:
        print(f"  ✗ {msg}")

    if d.get("ok") is not True:
        fail(f"通路未成功：{str(d.get('error'))[:300]}")
        rep = d.get("report") or {}
        for n in (rep.get("notes") or [])[:6]:
            print(f"      · {n}")
        return 1

    rep = d.get("report") or {}

    # ── ① 产物与实例化 ──
    tpl_nodes = rep.get("tpl_nodes", 0)
    l1 = rep.get("sub_l1", 0)
    inst_rows = rep.get("inst_rows", 0)
    inst_nodes = rep.get("inst_nodes", 0)
    if tpl_nodes < 4:
        fail(f"模板节点数异常：{tpl_nodes}")
        ok = False
    elif l1 <= 0:
        fail(f"订阅表 L1 为 0（行内绑定没进 L1）")
        ok = False
    elif inst_rows != 1000:
        fail(f"实例化行数不符：inst_rows={inst_rows}（应 1000——1000 行都要真的实例化）")
        ok = False
    elif inst_nodes <= inst_rows:
        fail(f"实例树规模异常：inst_nodes={inst_nodes} ≤ inst_rows={inst_rows}（每行应有多个节点）")
        ok = False
    else:
        print(f"  ✓ ① 产物与实例化：模板 {tpl_nodes} 节点 · L1 {l1} · "
              f"实例树 {inst_nodes} 节点 / {inst_rows} 行")

    # ── ② ★物化有界 ──
    live_first = rep.get("rows_live_first", -1)
    cmds_first = rep.get("cmds_live_first", -1)
    live_cap = min(120, max(1, int(inst_rows * 0.15)))
    cmds_cap = max(1, int(inst_nodes * 0.25))
    if live_first < 0:
        fail("首帧存活行读数缺失")
        ok = False
    elif live_first > live_cap:
        fail(f"★物化行数没有界：首帧存活 {live_first} 行（应 ≤ {live_cap} = min(120, 15%×{inst_rows})）"
             f"—— 整树被全量物化了，虚拟化没生效")
        ok = False
    elif cmds_first > cmds_cap:
        fail(f"★指令数没有界：首帧 {cmds_first} 条（应 ≤ {cmds_cap} = 25%×{inst_nodes}）"
             f"—— 整树都在画，虚拟化没生效")
        ok = False
    else:
        print(f"  ✓ ② ★物化有界（虚拟化真的生效）：首帧存活 {live_first} 行（≤{live_cap}）· "
              f"{cmds_first} 条指令（≤{cmds_cap}，整树 {inst_nodes} 节点）")

    # ── ③ 滚动真的动了 ──
    #   ★口径修正（首版把"末态 scroll_y=0"判红——但 30 下 + 30 上 = **回顶**，
    #     末态为 0 恰恰是**正确**的（回顶成功的证据）。真正要判的是：
    #     ① 过程中确实到过别处（轨迹里有非 0 的 scroll）② 画面真的变过（签名差异 >0）。
    moved = rep.get("moved_diff_pct", -1)
    trail = rep.get("trail") or []
    max_scroll = max((p.get("scroll", 0) for p in trail), default=0)
    if moved is None or moved <= 0:
        fail(f"滚动没有产生画面变化：moved_diff_pct={moved}（应 >0）")
        ok = False
    elif max_scroll <= 0:
        fail(f"滚动没有真的到过别处：轨迹里最大 scroll_y={max_scroll}（应 >0）")
        ok = False
    else:
        print(f"  ✓ ③ 滚动真的动了：部分帧签名差异 {moved}% · 轨迹最大 scroll_y={max_scroll}"
              f" · 末态（回顶后）scroll_y={rep.get('final_scroll', 0)}")

    # ── ④ ★回顶签名恒等 ──
    back = rep.get("back_top_diff_pct", -1)
    if back is None or back < 0:
        fail("回顶签名读数缺失（capture 帧没跑？）")
        ok = False
    elif back > 2.0:
        fail(f"★回顶签名不恒等：差异 {back}%（应 ≤2%）"
             f"—— 滚动有累积漂移/重影（虚拟化最危险的静默缺陷形态）")
        ok = False
    else:
        print(f"  ✓ ④ ★回顶签名恒等：差异 {back}%（≤2%——无累积漂移，画回到顶部与初帧一致）")

    # ── ⑤ 物化增量有界 ──
    down_delta = rep.get("down_built_delta", -1)
    up_delta = rep.get("up_built_delta", -1)
    delta_cap = max(1, int(inst_rows * 0.25))
    if down_delta < 0 or up_delta < 0:
        fail(f"物化增量读数缺失：down={down_delta} up={up_delta}")
        ok = False
    elif down_delta > delta_cap or up_delta > delta_cap:
        fail(f"★物化增量没有界：下滚 +{down_delta} / 上滚 +{up_delta}（各应 ≤ {delta_cap} = 25%×{inst_rows}）"
             f"—— 每帧在全量重建（不是『只物化新进视野的行』）")
        ok = False
    else:
        print(f"  ✓ ⑤ 物化增量有界：30 下滚 +{down_delta} 行 / 30 上滚 +{up_delta} 行"
              f"（各 ≤{delta_cap}——只物化新进视野的行）")

    # ── ⑥ 复用池真的在动 ──
    rel = rep.get("released_total", 0)
    if rel <= 0:
        fail(f"复用池没有释放过行（released_total={rel}）—— 只建不撤，滚动会持续泄漏式增长")
        ok = False
    else:
        print(f"  ✓ ⑥ 复用池真的在动：累计释放 {rel} 行 · 累计物化 {rep.get('built_total')} 行 · "
              f"行-帧累计 {rep.get('row_frames_total')}")

    # 轨迹（不判红，展示"有界"的过程证据）
    if trail:
        first, last = trail[0], trail[-1]
        print(f"     物化轨迹：首帧 live={first.get('live')}/cmds={first.get('cmds')} → "
              f"末帧 live={last.get('live')}/cmds={last.get('cmds')}（应全程有界）")

    if ok:
        print("\n✅ Vapor 长列表虚拟化判据全过（1000 行 · 物化有界 · 滚动真动 · 回顶恒等 · 复用池在动）")
        return 0
    print("\n✗ Vapor 长列表判据有失败项（见上）")
    return 1


if __name__ == "__main__":
    sys.exit(main())
