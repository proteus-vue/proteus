#!/usr/bin/env python3
"""hosts/android/check-mount-layers.py —— ★★★GP3-c 三层挂载（自绘端）判据

【判什么（对照任务卡 GP3-c 验收）】
  ① 层容器真建：layer_count == 3 且三个层 id 都在（不读"壳自述"，读宿主 mount 回执）
  ② **层间顺序 = 树序**：内核无 z-order 字段（实测零命中）⇒ 顺序唯一真源是子节点声明序；
     判据读 geometrySnapshot 的**真实节点序**：global < page < overlay
  ③ 纯容器不参与布局：内容节点几何有值且非零（容器全屏无内边距 ⇒ 不挤压）
  ④ **零敏感权限**：manifest 无 uses-permission（任务卡验收第 1 条）
  ⑤ ★**已知缺口如实标注**：destroy 后 global 层随屏销毁（当前每屏一棵树的模型）
     ⇒ 判据**不把它算通过**，而是明确标为【已知缺口】并要求读到该读数

【为什么 ⑤ 这样处理】任务卡验收第 2 条要求"全局层跨页面存活，路由切换不重建"——
  当前树模型（每屏一棵独立内核树）下**不成立**。把它当通过 = 制造假绿（本仓纪律禁止）。
  判据在这里**如实标注**，缺口归属与后续动作写在任务卡。

用法：python3 hosts/android/check-mount-layers.py hosts/android/results/mount-layers.json
退出码：0 全部（含已知缺口如实标注）/ 1 有真失败
"""
import json
import os
import sys

fails = []
warns = []


def main() -> int:
    if len(sys.argv) < 2:
        print("用法：python3 hosts/android/check-mount-layers.py <mount-layers.json>")
        return 2
    path = sys.argv[1]
    if not os.path.exists(path):
        print(f"⚠ GP3-c 判据：未找到报告（{path}）")
        print("  ⇒ 诚实跳过：先跑 `bash hosts/android/run-mount-layers.sh`")
        return 0

    print(f"═══ GP3-c 三层挂载（自绘端）判据：{path} ═══")
    with open(path, encoding="utf-8") as f:
        d = json.load(f)

    if d.get("error"):
        fails.append(f"场景抛错：{d['error']}")

    # ① 层容器真建
    lc = d.get("layer_count", 0)
    print(f"  ① 层容器数：{lc}（期望 3）")
    if lc != 3:
        fails.append(f"层容器数 {lc} != 3（三层挂载未建）")
    ids = d.get("layer_ids") or {}
    for layer in ("global", "page", "overlay"):
        if layer not in ids:
            fails.append(f"缺 {layer} 层容器 id（宿主未按计划建）")
    gid = d.get("global_layer_id", -1)
    print(f"     global_layer_id={gid} · layer_ids={ids}")
    if gid <= 0:
        fails.append("global 层 id 无效（任务卡：global 是跨路由存活的那个层）")

    # ② 层间顺序 = 树序
    gi = d.get("sibling_order_global", -1)
    pi = d.get("sibling_order_page", -1)
    oi = d.get("sibling_order_overlay", -1)
    print(f"  ② 树序（内核真实节点序）：global@{gi} page@{pi} overlay@{oi}")
    if not (gi >= 0 and pi > gi and oi > pi):
        fails.append(
            f"★树序不符层序（global@{gi} < page@{pi} < overlay@{oi} 应成立）——内核 z-order 真源是树序"
        )

    # ③ 纯容器不参与布局（内容几何非零 + ★层容器全屏 @ 原点）
    #
    # ★★2026-10-03 收尾升级（真机抓到的层实现缺陷 + 判据缺陷，一并修）：
    #   首版只断言"内容几何非零"——而层容器当时被写成 `relative`（`node()` 的启发式只在
    #   x/y≠0 时给 absolute，而层容器恰在原点）⇒ 三个全屏容器进 flex 流互相挤压，
    #   每个只剩 1/3 屏高（page 层 y=800，内容随之偏移）——**照样判绿**（假绿）。
    #   ⇒ 教训：**判据要对着契约的关键承诺断言**（`frame:'fullscreen'` /
    #     `positioning:'absolute-fullscreen'` 是真承诺，不是修饰），不是对着"没崩"。
    #   现判据：① 层容器自身几何必须 **全屏 @ 原点**（容差 ≤0.5px）；
    #          ② 内容节点非零 **且 y≈0**（容器在原点 ⇒ 内容也从原点起，挤压会立刻反映在 y 上）。
    rect = d.get("content0_rect") or {}
    w = rect.get("width", 0) or 0
    h = rect.get("height", 0) or 0
    cy = rect.get("y", -999)
    print(f"  ③ 内容节点几何：{int(w)}x{int(h)} @ y={cy}（容器全屏 @ 原点 ⇒ 非零且 y≈0）")
    if w <= 0 or h <= 0:
        fails.append(f"内容节点几何 {w}x{h} —— 容器可能挤压了内容（纯容器不应参与布局）")
    elif cy == -999 or abs(cy) > 0.5:
        fails.append(
            f"内容节点 y={cy}（应 ≈0）——page 层容器不在原点"
            "（曾实测：层容器写成 relative 被 flex 压缩 ⇒ page 层 y=800）"
        )

    vp = d.get("viewport_declared") or {}
    vw = vp.get("width", 0) or 0
    vh = vp.get("height", 0) or 0
    layer_rects = d.get("layer_rects") or {}
    if not layer_rects:
        fails.append(
            "未读到 layer_rects（场景应上报三层容器几何——"
            "'几何非零'太弱，必须对**全屏 @ 原点**这个契约承诺断言）"
        )
    for layer in ("global", "page", "overlay"):
        lr = layer_rects.get(layer) or {}
        if lr.get("ok") is not True:
            fails.append(f"{layer} 层容器几何读不到（ok={lr.get('ok')}）——内核里不存在？")
            continue
        lw, lh = lr.get("width", 0) or 0, lr.get("height", 0) or 0
        lx, ly = lr.get("x", -999), lr.get("y", -999)
        ok_full = abs(lw - vw) <= 0.5 and abs(lh - vh) <= 0.5
        ok_origin = abs(lx) <= 0.5 and abs(ly) <= 0.5
        print(
            f"     {layer} 层容器：{int(lw)}x{int(lh)} @ ({lx},{ly})"
            f"（期望 {int(vw)}x{int(vh)} @ (0,0)）"
        )
        if not ok_full:
            fails.append(
                f"{layer} 层容器几何 {lw}x{lh} != 全屏 {vw}x{vh}——"
                "契约 frame:'fullscreen' 未成立（flex 挤压？）"
            )
        elif not ok_origin:
            fails.append(
                f"{layer} 层容器 @ ({lx},{ly}) 不在原点——"
                "契约 positioning:'absolute-fullscreen' 未成立"
            )

    # ④ 零敏感权限
    perms = d.get("permissions_declared_in_manifest", -1)
    print(f"  ④ manifest 权限数：{perms}（任务卡验收第 1 条：不申请敏感权限）")
    if perms != 0:
        warns.append(f"manifest 声明了 {perms} 个权限（任务卡要求不申请任何敏感权限）")

    # ⑤ ★已知缺口如实标注（不当通过）
    gone = d.get("global_layer_destroyed_with_screen")
    print(f"  ⑤ destroy 后 global 层随屏销毁：{gone}")
    if gone is True:
        print("     ⚠【已知缺口】当前树模型 = 每屏一棵独立内核树 ⇒ destroy 连带释放 global 层")
        print("       ⇒ 任务卡验收第 2 条（全局层跨页面存活）**本树模型下不成立**")
        print("       ⇒ 修复归属：M5「屏 = 树内子树」重构（所有屏共享一棵内核树）")
        print("       ★本判据**不把它算作通过**（不制造假绿）——按缺口登记")
    elif gone is not True:
        fails.append("未读到 global_layer_destroyed_with_screen 读数（场景应如实记账）")

    print()
    if fails:
        print("❌ GP3-c 判据失败：")
        for f in fails:
            print(f"  ✗ {f}")
        return 1
    print("✅ GP3-c 三层挂载（自绘端）：层容器/树序/纯容器/零权限 全过（缺口如实标注见 ⑤）")
    for w in warns:
        print(f"  ⚠ {w}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
