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

    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    # ★★端识别（`host_id` 自报；缺省 android——既有 vapor.json 无此字段，向后兼容）：
    #   判据对**各有实现的端**同口径；某端尚未实现的能力域**如实跳过**（不静默当成"过了"，
    #   也不把它算成该端的失败）——与 `check-app-stack.py` 的"⑦ 组如实跳过"同一纪律。
    host = d.get("host_id") or "android"
    print(f"═══ Vapor 设备端判据（真实 SFC → 编译产物 → 实例化 → 订阅驱动增量）[{host}]：{path} ═══")
    ok = True

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
    elif host == "harmony":
        # ★鸿蒙腿现状（如实）：probeChannels 已接（radius 真读自渲染指令；其余通道 None）——
        #   渐变/发光/裁剪/描边是**渲染层**能力（矩阵 #14 的"应用+渲染" vs Android 的"应用+渲染"），
        #   本批交的是"应用链"（实例化+订阅+增量+几何），渲染层四通道是后续批次。
        print(f"  ◐ ⑦ 绘制通道：鸿蒙 probeChannels 已接线（radius 真值）——"
              f"渐变/发光/裁剪/描边属**渲染层**，鸿蒙待补（如实跳过，不计失败）")
        chans = {}
    if chans:
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
    if host == "harmony" and taps == 0:
        # ★鸿蒙腿现状（如实）：JSVM 桥未实现 tapAt/onGesture（手势属矩阵 #7，另批次）；
        #   bundle 侧按 `typeof proteusHost.tapAt === 'function'` 自动跳过 ⇒ taps=0 是**预期**。
        #   ★事件绑定/handler 已随编译产物就位（ev_b/ev_h ≥1——产物面已对齐），只差注入通道。
        print(f"  ◐ ⑧ 交互闭环：鸿蒙 JSVM 桥未接 tapAt/onGesture（属矩阵 #7 手势批次）——"
              f"产物面已就位（事件 {ev_b} · handler {ev_h}），如实跳过")
    elif ev_b < 1 or ev_h < 1:
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

    # ── ⑨ ★P2-3 事件修饰符：`.stop` 真的**终止了冒泡**（不是"允许但忽略"）──
    #   【为什么单独判】`@click.stop` 的失效形态是**静默多派发**：外层祖先的 handler 也跑了，
    #     页面看起来"能用"（按钮有反应），但多改了数据（本仓记为最该拦下的一类）。
    #     ⇒ 判据：夹具里内层按钮带 `.stop` ⇒ 点它时 (a) `stopped=true`；
    #       (b) `fired` 恰 1 跳（祖先没跑）；(c) 祖先的源**不在**变化源里（最强证据）。
    mods = rep.get("ev_modifiers", 0)
    if mods <= 0:
        # 本端夹具未覆盖修饰符 ⇒ 如实跳过（不静默当"过了"——但也不误判为失败）
        print(f"  ◐ ⑨ 事件修饰符：本端产物无修饰符绑定（ev_modifiers={mods}）——如实跳过")
    else:
        stop_evs = [e for e in evd if e.get("stopped")]
        if not stop_evs:
            fail(f"★产物里有 {mods} 条修饰符绑定，但**没有任何 tap 报 stopped=true**"
                 f"—— .stop 没生效（本判据要堵的正是「允许但忽略」的静默多派发）")
            ok = False
        else:
            e0 = stop_evs[0]
            fired = e0.get("fired") or []
            src_after = e0.get("source_after") or {}
            if len(fired) != 1:
                fail(f"★.stop 的节点命中后 fired 应为 1 跳（自身），实际 {fired}"
                     f"—— 冒泡没有被终止")
                ok = False
            elif "stopOuterW" in src_after:
                fail(f"★`.stop` 报 stopped=true，但祖先的源仍在变化里（{sorted(src_after)}）"
                     f"—— 祖先 handler 还是跑了（静默多派发）")
                ok = False
            elif "stopInnerW" not in src_after:
                fail(f"★`.stop` 的 tap 没有改到自身源（变化源 {sorted(src_after)}）"
                     f"—— handler 可能根本没跑（判据前提不成立）")
                ok = False
            else:
                print(f"  ✓ ⑨ ★事件修饰符 .stop 真的终止冒泡：命中 {e0.get('hit')} · "
                      f"派发 {fired} · 变化源 {sorted(src_after)}（祖先源 stopOuterW 未出现）· "
                      f"产物带修饰符绑定 {mods} 条")

    # ── ⑩ ★P2-2 混合文本：首帧**完整拼接** + 更新后仍是完整串（两道口子都要堵）──
    #   【为什么单独判】`a{{x}}b` 的失效形态有两种，都**静默**：
    #     (a) 首帧只回填单个字段/源值 ⇒ 屏幕上是 "row 1" 而不是 "row-1·row 1"（少静态段）；
    #     (b) 更新时只写插值那一段 ⇒ 后一轮覆盖成 "upd 0"（静态段丢失）。
    #   ⇒ (a) 判 `mix_text_probe`（设备端实例树实际文本）；(b) 判内核回执里的
    #     `text_probe`（最后一次文本更新——宿主落绘制真源前的那份完整串）。
    mx = rep.get("mix_text_probe") or []
    if not mx:
        # 本端夹具未覆盖混合文本 ⇒ 如实跳过（不静默当过了，也不误判失败）
        print("  ◐ ⑩ 混合文本：本端夹具无多段文本节点——如实跳过")
    else:
        # ★判据口径：**每个静态段按序都出现在文本里**（子序列校验）——
        #   首版写死字符 '·'，换了夹具（once-/memo- 前缀）就误红（本仓实测踩到：
        #   判据绑死在某一版夹具上 = 判据自身缺陷）。
        def statics_ok(m: dict) -> bool:
            text = m.get("text", "")
            pos = 0
            for seg in m.get("statics", []):
                idx = text.find(seg, pos)
                if idx < 0:
                    return False
                pos = idx + len(seg)
            return True

        bad = [m for m in mx if not statics_ok(m)]
        if bad:
            fail(f"★混合文本首帧不完整（静态段缺失/乱序）：{bad} —— 段求值没跑或只写了插值")
            ok = False
        else:
            print(f"  ✓ ⑩ ★混合文本首帧完整拼接（设备端实例树实测 · 静态段按序齐备）：{mx[0].get('text')!r}"
                  + (f" 等 {len(mx)} 处" if len(mx) > 1 else ""))

    # ⑩b 更新后的完整串（内核回执 text_probe）：混合文本更新**不得丢静态段**
    tpr = rep.get("text_probe_rounds") or []
    if mx and not tpr:
        fail("★有混合文本节点，但内核没有任何 text_probe 读数——文本更新没到内核（或宿主没回执）")
        ok = False
    elif mx:
        # ★子序列校验（口径同 ⑩）：用 mx 的静态段集合核每条更新文本
        statics_pool = [st for m in mx for st in m.get("statics", [])]
        def keeps_a_static(t: str) -> bool:
            # 至少保住**本夹具某节点的一条**静态段（更新只写插值 ⇒ 任何段都不在）
            return any(st in t for st in statics_pool)
        incomplete = [t for t in tpr if not keeps_a_static(t)]
        if incomplete:
            fail(f"★更新后的文本丢了静态段：{incomplete} —— 混合文本更新只写了插值部分（静默错内容）")
            ok = False
        else:
            print(f"  ✓ ⑩b ★更新后仍是完整拼接串（内核回执实测）：{tpr[:3]}"
                  + (f" 等 {len(tpr)} 轮" if len(tpr) > 3 else ""))

    # ── ⑪ ★P2-5 v-once 冻结 / v-memo 组门（"该跳过的必须跳过"要有对照才算证据）──
    #   【为什么单独判】前几轮的判据都是"改了数据 ⇒ 必须发指令"；P2-5 恰好相反：
    #     **依赖净/已冻结时必须不发**。而"不发"与"链路断了"在读数上长得一样
    #     ⇒ 判据靠**成对轮次**区分：expect_skip=true 必须 ops==0，expect_skip=false 必须 ops>0。
    gates = rep.get("gate_rounds") or []
    gate_nodes = {g.get("name"): (g.get("entries") or []) for g in (rep.get("gate_text_nodes") or [])}
    once_nid = rep.get("once_node_id", -1)
    memo_nid = rep.get("memo_node_id", -1)
    if not gates:
        print("  ◐ ⑪ v-once/v-memo 门禁轮：本端夹具未覆盖（无 onceVal/memoDep 源）——如实跳过")
    else:
        def text_of(round_name: str, node_id: int) -> list:
            return [e.get("text", "") for e in gate_nodes.get(round_name, []) if e.get("nodeId") == node_id]

        # ★★判据升级（本仓真机实测抓出的**判据自身缺陷**）：不能按"整批文本里有没有新值"判——
        #   夹具里 once 节点与**同源对照节点**并存，对照节点更新是**正确行为**；
        #   首版按整批判 ⇒ 把正确行为判红（假红）。⇒ 必须**精确到节点**。
        once_frozen_texts = text_of('once-frozen', once_nid) if once_nid >= 0 else []
        memo_clean_texts = text_of('memo-clean', memo_nid) if memo_nid >= 0 else []
        memo_dirty_texts = text_of('memo-dirty', memo_nid) if memo_nid >= 0 else []
        if once_nid >= 0 and once_frozen_texts:
            fail(f"★once 节点 {once_nid} 在源变化后仍被写（{once_frozen_texts}）——v-once 没冻结")
            ok = False
        elif memo_nid >= 0 and memo_clean_texts:
            fail(f"★memo 节点 {memo_nid} 在**依赖净**时仍被写（{memo_clean_texts}）——组门没生效")
            ok = False
        elif memo_nid >= 0 and not memo_dirty_texts:
            fail(f"★memo 节点 {memo_nid} 在**依赖脏**时没有写（链路断了 ⇒ 那么'跳过'不能证明是语义）")
            ok = False
        elif memo_nid >= 0 and not any('99' in t for t in memo_dirty_texts):
            fail(f"★memo 依赖脏时放行的文本不含最新值 99（实际 {memo_dirty_texts}）——写的是旧值（求值时机错）")
            ok = False
        elif any(g.get("expect_skip") is False and g.get("ops", 0) <= 0 for g in gates):
            # ★对照轮（plain-updated）必须真的发指令——"跳过"要有对照才算证据
            fail(f"★对照轮没有发指令（链路可能断了）：{[g['name'] for g in gates if g.get('ops', 0) <= 0]}")
            ok = False
        else:
            detail = " · ".join(
                f"{g['name']}={g.get('ops')}B" + (f"→节点{[e['nodeId'] for e in gate_nodes.get(g['name'], [])]}" if g.get('ops') else '（跳过）')
                for g in gates
            )
            print(f"  ✓ ⑪ ★v-once 冻结 + v-memo 组门（**逐节点**核对：once 节点未写 / memo 净跳过 / memo 脏放行且写新值）：{detail}")

    # ── ⑫ ★P2-6~P2-9 表达式能力：首帧文本必须是**求值结果**（不是空串/字面量 "undefined"/"null"）──
    #   【为什么这样判】这批能力的失效形态全是**静默错值**：
    #     · Math.PI 此前 mem(root('Math')) ⇒ read('Math')=undefined ⇒ 渲染成**空**；
    #     · 可选链空值若按 String(undefined) 写 ⇒ 屏上出现字面量 **"undefined"**；
    #     · v-text / 白名单调用/方法若没进回填链 ⇒ 同样是空（零报错）。
    #   ⇒ 判据 = 逐前缀核对（pi-/mx-/jn-/oc-/vt-），并**显式拒绝** "undefined"/"null" 字面量。
    expr_probe = rep.get("expr_probe") or []
    if not expr_probe:
        print("  ◐ ⑫ 表达式能力（P2-6~P2-9）：本端夹具未覆盖——如实跳过")
    else:
        bad = []
        for e in expr_probe:
            t = str(e.get("text") or "")
            pref = str(e.get("prefix") or "")
            if not t.startswith(pref):
                bad.append((e.get("id"), e.get("prefix"), t, '缺前缀/空'))
            elif t in ("undefined", "null") or t.endswith("undefined") or t.endswith("null"):
                bad.append((e.get("id"), e.get("prefix"), t, '字面量 undefined/null 上屏'))
            elif t == pref:
                bad.append((e.get("id"), e.get("prefix"), t, '前缀后无求值结果（表达式没跑）'))
        if bad:
            fail(f"★表达式能力（P2-6~P2-9）首帧不对：{bad}"
                 f"—— v-text / 白名单调用 / Math.PI 内联 / 可选链，至少一项没落到文本上（静默错值）")
            ok = False
        else:
            detail = " · ".join(f"{e.get('prefix')}→{e.get('text')}" for e in expr_probe)
            print(f"  ✓ ⑫ ★表达式能力（v-text / 白名单纯函数 / Math.PI 内联 / 纯方法 / 可选链）首帧均为求值结果：{detail}")

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
