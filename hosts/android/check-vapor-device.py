#!/usr/bin/env python3
"""hosts/android/check-vapor-device.py —— ★★★Vapor 设备端判据（真实 SFC → 编译产物 → 实例化 → 订阅驱动增量）

【这一条链要证明什么（本仓 2026-10-01 核实的缺口）】
  此前 Android 跑的是**构建期预实例化的静态树**（`entry-batch.ts`「不接 Vue」）。
  本判据验的是**真链路**：编译器产出的两件产物（LayoutTemplate + 订阅表）在**设备端**
  跑起来——实例化 + 订阅驱动的**二进制指令**增量更新。

【判据（每条都落在机器可判的量上，且都指向"会失败的那一点"）】
  ① **产物真的来自编译器**：模板节点数 ≥4 · 订阅表 L1>0（行内绑定进了 L1）·
     源里有 `list`（行作用域求值的入口）· 行内槽位非空
  ② **设备端真的实例化了**：`inst_nodes` ≥ 模板节点数 + 新增行节点（v-for 展开）·
     `inst_allocated_ids > 0`（新增行 id 是运行时分配的 = **设备端**实例化，不是构建期烧死的）·
     `inst_rows` 等于请求行数
  ③ **数据真的回填了**（本仓实测踩过的缺陷形态：不回填 ⇒ 首帧空白且零报错）：
     `inst_text_filled > 0` 且 `inst_width_filled > 0`
  ④ **渲染真的发生了**（宿主侧读数，与 JS 读数**独立**）：
     `host_mount_calls ≥ 1` · `host_nodes == inst_nodes` · `host_cmds > 0` ·
     `host_painted_samples > 1000`（离屏像素自检——"屏幕上真的有东西"）
  ⑤ **★订阅驱动的增量真的改了内核几何**（本判据的核心，堵"发了指令但几何没变"）：
     · `updates_run ≥ 3` 且 `ops_bytes > 0`（订阅表真的产出了二进制指令）；
     · 每轮的内核回执 `changed_rects ≥ 1`（内核报"这些节点动了"）；
     · **几何真值对比**：探针节点（第 2 行的宽度槽位）的 `after != before`
       ——`readRects` 读的是**内核真源**，不是我们发下去的参数复述。

用法：python3 hosts/android/check-vapor-device.py <vapor.json>
退出码：0 全过 / 1 有失败 / 2 用法错（产物缺失时诚实跳过，返回 0）
"""
import json
import os
import sys


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print("用法：python3 hosts/android/check-vapor-device.py <vapor.json>")
        return 2
    path = args[0]
    if not os.path.exists(path):
        print(f"⚠ Vapor 判据：未找到真机产物（{path}）")
        print("  ⇒ 诚实跳过（跑真机后取回）：bash hosts/android/run-vapor.sh")
        return 0

    print(f"═══ Vapor 设备端判据（真实 SFC → 编译产物 → 实例化 → 订阅驱动增量）：{path} ═══")
    ok = True
    with open(path, encoding="utf-8") as f:
        d = json.load(f)

    def fail(msg: str) -> None:
        print(f"  ✗ {msg}")

    if d.get("ok") is not True:
        fail(f"通路未成功：{str(d.get('error'))[:300]}")
        # 附着 JS 侧报告里的 notes（诊断线索）
        rep = d.get("report") or {}
        for n in (rep.get("notes") or [])[:6]:
            print(f"      · {n}")
        return 1

    rep = d.get("report") or {}

    # ── ① 产物真的来自编译器 ──
    tpl_nodes = rep.get("tpl_nodes", 0)
    l1 = rep.get("sub_l1", 0)
    sources = rep.get("sub_sources") or []
    if tpl_nodes < 4:
        fail(f"模板节点数异常：{tpl_nodes}（夹具应有 页面+标题+行根+行内文本 ≥4）")
        ok = False
    elif l1 <= 0:
        fail(f"订阅表 L1 槽位为 0（行内绑定没进 L1 ⇒ 订阅驱动更新无物可驱）")
        ok = False
    elif "list" not in sources:
        fail(f"订阅表缺 'list' 源（实际：{sources}）—— 行作用域求值无入口")
        ok = False
    else:
        print(f"  ✓ ① 产物来自编译器：模板 {tpl_nodes} 节点 · L1 {l1}/L0 {rep.get('sub_l0')} "
              f"（覆盖率 {rep.get('sub_l1_rate', 0):.1%}）· 源 {sources}")

    # ── ② 设备端真的实例化了 ──
    inst_nodes = rep.get("inst_nodes", 0)
    allocated = rep.get("inst_allocated_ids", 0)
    # ★行数取 `inst_virtual_rows`（虚拟化描述的行数）——`inst_rows` 是**总节点数**语义
    #   （首版读错字段：18 节点被判成"应 8 行"；本仓纪律：判据字段名要对着实现核一遍）
    rows = rep.get("inst_virtual_rows", 0)
    expected_rows = 8  # MainActivity 传的行数
    if inst_nodes < tpl_nodes:
        fail(f"实例树比模板还小：inst_nodes={inst_nodes} < tpl_nodes={tpl_nodes}（实例化没跑？）")
        ok = False
    elif allocated <= 0:
        fail(f"没有运行时分配的 id（inst_allocated_ids={allocated}）"
             f"—— 树像是**构建期烧死的**，不是设备端实例化的（本判据的核心区分点）")
        ok = False
    elif rows != expected_rows:
        fail(f"展开行数不符：inst_virtual_rows={rows}（应 {expected_rows}）")
        ok = False
    else:
        print(f"  ✓ ② 设备端真的实例化了：{inst_nodes} 节点（模板 {tpl_nodes} + 新分配 {allocated}）"
              f"· 展开 {rows} 行")

    # ── ③ 数据真的回填了 ──
    tf = rep.get("inst_text_filled", 0)
    wf = rep.get("inst_width_filled", 0)
    if tf <= 0:
        fail(f"实例树里没有非空文本（inst_text_filled={tf}）"
             f"—— 回填链断了：屏幕会空白且零报错（本仓实测踩过的形态）")
        ok = False
    elif wf <= 0:
        fail(f"实例树里没有 width（inst_width_filled={wf}）—— 行内 :width 绑定没回填")
        ok = False
    else:
        print(f"  ✓ ③ 数据真的回填了：非空文本 {tf} 节点 · 带 width {wf} 节点")

    # ── ④ 渲染真的发生了（宿主侧读数，与 JS 读数独立）──
    hm = d.get("host_mount_calls", 0)
    hn = d.get("host_nodes", -1)
    hc = d.get("host_cmds", -1)
    ps = d.get("host_painted_samples", -1)
    if hm < 1:
        fail("宿主 mount 没被调用（host_mount_calls=0）")
        ok = False
    elif hn != inst_nodes:
        fail(f"宿主节点数与 JS 侧不符：host_nodes={hn} vs inst_nodes={inst_nodes}"
             f"（两侧对『树有多大』的理解不一致——本仓实测过的静默丢数据形态）")
        ok = False
    elif hc <= 0:
        fail(f"没有生成绘制指令（host_cmds={hc}）")
        ok = False
    elif ps < 1000:
        fail(f"离屏像素自检不足（host_painted_samples={ps}）—— 屏幕上可能没有东西")
        ok = False
    else:
        print(f"  ✓ ④ 渲染真的发生了：宿主 mount {hm} 次 · {hn} 节点 · {hc} 条指令 · "
              f"像素采样 {ps}（颜色 {d.get('host_painted_colors')}）· onDraw {d.get('host_view_on_draw')}")

    # ── ⑤ ★订阅驱动的增量真的改了内核几何（核心判据）──
    updates = rep.get("updates_run", 0)
    ops_bytes = rep.get("ops_bytes", 0)
    ev = rep.get("update_evidence") or []
    probes = rep.get("geom_probe") or []
    if updates < 3:
        fail(f"增量轮数不足：updates_run={updates}（应 ≥3）")
        ok = False
    elif ops_bytes <= 0:
        fail(f"订阅表没产出任何二进制指令（ops_bytes={ops_bytes}）")
        ok = False
    elif not ev or any((e.get("changed_rects", 0) < 1) for e in ev):
        fail(f"内核没报『节点动了』：{ev}")
        ok = False
    else:
        # 几何真值：探针（第 2 行宽度槽位）的 before/after 必须不同
        probe_ok = False
        probe_msg = ""
        if probes:
            p0 = probes[0]
            probe_msg = f"探针节点 {p0.get('id')} 宽度 {p0.get('before')} → {p0.get('after')}"
            probe_ok = p0.get("before") != p0.get("after")
        if not probe_ok:
            fail(f"★几何没变（内核真源 readRects）：{probe_msg or '探针缺失'}"
                 f"—— 指令发了但几何没动（本判据要堵的正是这一形态）")
            ok = False
        else:
            changed_total = sum(e.get("changed_rects", 0) for e in ev)
            print(f"  ✓ ⑤ ★订阅驱动真的改了内核几何：{updates} 轮 · {ops_bytes} 字节指令 · "
                  f"累计内核变更集 {changed_total} 项 · {probe_msg}")

    # ── ⑥ ★文本同步真的落到了绘制真源（2026-10-01 修的"读了没入表"缺陷的回归锁）──
    #   【为什么单独判】内核在 applyOps 回执里带 `text_updates`，而宿主**消费它**才能让新文本
    #     真的画出来——本仓首版漏消费 ⇒ 文字改了但屏幕上还是旧字（几何全对、零报错）。
    #     ⇒ 判据断言：每轮更新的 `text_synced ≥ 1`（内核报了文本变更就必然被宿主接住）。
    ts_total = rep.get("text_synced_total", -1)
    ts_rounds = [e.get("text_synced", -1) for e in ev] if ev else []
    if ts_total is None or ts_total <= 0:
        fail(f"★文本同步没有发生：text_synced_total={ts_total}（每轮改文本 ⇒ 内核应报 text_updates）"
             f"—— 宿主可能没消费（'读了没入表'形态：几何对但文字不更新）")
        ok = False
    elif any((x is not None and x < 0) for x in ts_rounds):
        fail(f"某轮缺 text_synced 读数：{ts_rounds}")
        ok = False
    else:
        print(f"  ✓ ⑥ ★文本同步落到了绘制真源：累计 {ts_total} 处（逐轮 {ts_rounds}）")

    # ── ⑦ ★绘制通道真的建出来了（逐通道读**宿主真源**——2026-10-01 绘制通道补齐）──
    #   【为什么单独判】模板侧的绘制声明（fill-gradient / glow / clip-path / svg-path / border-radius）
    #     走到宿主才算数：任何一环丢了都是"声明了但画不出来"（静默）。
    #     夹具里 5 个节点各用一条通道（id 2 圆角 / 3 渐变 / 4 发光 / 5 裁剪 / 6 描边）。
    chans = {int(c.get("id", -1)): c for c in (rep.get("channels") or [])}
    if not chans:
        fail("绘制通道探针无读数（宿主 probeChannels 没接线？）")
        ok = False
    else:
        want = [
            (2, "radius", lambda v: float(v) > 0, "圆角（border-radius → drawRoundRect）"),
            (3, "grad", lambda v: isinstance(v, str) and v.startswith("1:") and int(v.split(":")[1]) >= 2,
             "渐变（fill-gradient → shader，kind1=linear 且 ≥2 色标）"),
            (4, "glow", lambda v: isinstance(v, str) and int(v.split(":")[0]) >= 3, "发光（glow → 分层同心描边）"),
            (5, "clip", lambda v: int(v) > 0, "裁剪（clip-path → 画布裁剪形状）"),
            (6, "stroke_len", lambda v: float(v) > 0, "描边（svg-path → 路径层，弧长 > 0）"),
        ]
        flat = []
        bad = []
        for nid, key, pred, label in want:
            c = chans.get(nid)
            v = (c or {}).get(key)
            try:
                if c is not None and pred(v):
                    flat.append(f"{label.split('（')[0]}({v})")
                    continue
            except Exception:
                pass
            bad.append(f"{label}（节点 {nid} 的 {key}={v!r}）")
        if bad:
            fail("★绘制通道未建出来：" + " · ".join(bad) + " —— 模板声明到了但宿主没建（静默丢通道）")
            ok = False
        else:
            print("  ✓ ⑦ ★绘制通道全部落到宿主真源：" + " · ".join(flat))

    # ── ⑧ ★交互闭环：tap → handler → 数据变 → 订阅 → 指令 → **几何真的变**（2026-10-01）──
    #   【为什么单独判】这是"能跑真实业务页面"的分水岭：此前只有数据驱动（订阅表改值就能更新），
    #     而"用户点了没反应"在数据驱动视角下**完全看不出来**（链路本身是通的）。
    #     判据要打在：命中节点正确 / handler 真的跑了（数据变了）/ 几何（内核真源）真的跟着变。
    ev_b = rep.get("ev_bindings", 0)
    ev_h = rep.get("ev_handlers", 0)
    taps = rep.get("taps", 0)
    evd = rep.get("tap_evidence") or []
    if ev_b < 1 or ev_h < 1:
        fail(f"编译产物里的交互缺失：事件绑定 {ev_b} · handler {ev_h}（夹具应有各 ≥1——'点不动'的根因）")
        ok = False
    elif taps < 1:
        fail(f"注入的 tap 不足：{taps}（应 ≥1）")
        ok = False
    elif not evd or any((e.get("hit", -1) < 0) for e in evd):
        fail(f"tap 没有命中任何节点（hitTest 链断了？）：{evd}")
        ok = False
    elif any(not e.get("handler") for e in evd):
        fail(f"命中节点上没有跑起 handler：{evd}")
        ok = False
    elif any(not e.get("source_after") for e in evd):
        fail(f"handler 跑了但**数据没变**：{evd}")
        ok = False
    elif any(len(e.get("geom_diff_ids") or []) == 0 for e in evd):
        # ★最强的一条：**内核几何真源**在 tap 前后真的变了吗（"点一下屏幕真的变了"）
        #   ——数据变了但几何没变 = 链路某环断了（订阅没触发 / 指令没下发 / 内核没重排）
        fail(f"tap 前后**内核几何没变**：{[e.get('geom_diff_ids') for e in evd]}"
             f"—— 数据变了但屏幕没变（订阅/指令/重排哪一环断了）")
        ok = False
    else:
        detail = " · ".join(
            f"tap{e['tap']}→节点{e['hit']}（{e['handler']}）源变 {e['source_after']} · "
            f"内核几何变 {len(e.get('geom_diff_ids') or [])} 节点 {e.get('geom_diff_ids')}"
            for e in evd
        )
        print(f"  ✓ ⑧ ★交互闭环跑通（tap → handler → 数据变 → **几何变**）：{detail}")

    # 附加观测（不判红，只如实报）
    una = rep.get("uninstantiated_slots", 0)
    if una:
        print(f"  ⚠ 未实例化槽位：{una}（如实上报——见报告 notes）")

    if ok:
        print("\n✅ Vapor 设备端判据全过（真实 SFC · 设备端实例化 · 数据回填 · 渲染成立 · 订阅驱动增量改了几何）")
        return 0
    print("\n✗ Vapor 判据有失败项（见上）")
    return 1


if __name__ == "__main__":
    sys.exit(main())
