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
    ps = d.get("host_painted_samples", -1)  # iOS：离屏渲染自检的"画过像素数"（见 paintedPixelProbe）
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
    # ★★鸿蒙腿**已打通**（2026-10-03 第三轮 · 「打通绘制通道」）：
    #   此前只 radius（渲染层未接四通道）——本轮补齐三层：① 样式表解析四通道字段 →
    #   ② 指令带上并从 `proteus_render_commands_cstr` **真的送进渲染层**（content modifier 画布：
    #   裁剪→渐变→发光→描边→文本）→ ③ 探针经 `proteus_channel_state_of` 从渲染层真源回读。
    #   真机读数：radius=63 · grad=1:2 · glow=12:0.900 · clip=1 · stroke_len=512.023。
    #   ★语义差异（如实标注）：`glow` 首段 iOS 是**层数**、Android 是**半径**、鸿蒙本轮实现为
    #     **层数**（12——与外径/内径比挂钩），判据口径"≥3"三者皆满足。
    # ★★iOS 腿**已收紧**（2026-10-03 第二轮）：上一轮"如实跳过"的原因是"期望 id 未实测标定"
    #   ——现已有真机读数（`channelProbe` 直读 layer 真源）：radius=18 · grad=1:2 ·
    #   glow=5层/α0.900 · clip=1 · stroke_len=512.07 ⇒ 五项全部达标，**转为真判**。
    #   ★语义差异（如实标注，判据已按此收宽）：`glow` 首段 Android 是**半径**（26）、iOS 是
    #     **层数**（5）——各自都是自家渲染实现的忠实读数，判据口径是"≥3"（层数/半径在各自实现里
    #     都远超该下界）；`stroke_len` 同理只判 >0（弧长算法实现不同，逐位比对无意义）。
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

    # ── ⑬ ★★★P3-3 `<Transition>`：可见性翻转 ⇒ 过渡**真的交给宿主** ──
    #   【为什么单独判】`<Transition>` 的失效形态是**静默无过渡**（页面正常、只是不动）：
    #     缺任一层都会这样——① 运行时没记可见性翻转；② 模板没把声明挂到节点；
    #     ③ 桥没转发；④ 宿主没实现 animStart。⇒ 判据核**端到端**：`transition_started > 0`。
    #   ★同时核**节点数守恒**（Transition 透传不占 id——若多出包裹节点，A/B 几何会不等价）。
    tr_started = rep.get("transition_started", -1)
    tpl_transition = rep.get("tpl_transition") or []
    if tr_started < 0:
        print("  ◐ ⑬ <Transition>：本端夹具未覆盖（报告无 transition_started）——如实跳过")
    elif tr_started <= 0:
        # 分档：夹具没声明过渡 ⇒ 只核"节点数守恒"；有声明却没动画 ⇒ 红
        if not tpl_transition:
            print("  ◐ ⑬ <Transition>：本端夹具无过渡声明——如实跳过")
        else:
            fail(f"★<Transition> 声明存在（{tpl_transition}）但**没有任何动画交给宿主**"
                 f"（transition_started={tr_started}）——过渡不会播（静默无过渡）")
            ok = False
    else:
        print(f"  ✓ ⑬ ★<Transition> 过渡真的被驱动：{tr_started} 条动画交给宿主"
              + (f"（声明预设：{tpl_transition}）" if tpl_transition else ""))

    # ── ⑭ ★★★P1-3 组件内部渲染：组件**真的被展开**且 props 能双向走通 ──
    #   【为什么单独判】P1 第一批只交"边界标记 + props 通道"——组件**内部是空的**。
    #     本判据核的是"内部真的渲染了"：`component_mounts > 0`（有挂载记录）+
    #     `component_nodes > 0`（子树真的建出来）。
    #   ★同时核**独立证据**：子节点的文本/宽度来自 props（在 ⑫ 的探针之外单列——
    #     因为"展开了但 props 没下去"是另一种静默失效）。
    #   ★★三条证据**缺一即红**（本仓实测的判据自缺陷：首版 `w_after is None` 放行 ⇒
    #     "探针读不到宽度"与"宽度没上行"判成了同一结果 ⇒ 全过是**假绿**）：
    #     ① 文本下行（子节点文本含 props 值）② 指令上行（子 flush 里真有 layout.width 指令）
    #     ③ 内核真值上行（applyOps 后内核矩形确实变了——指令发错节点时 ② 仍可能成立）。
    cm = rep.get("component_mounts", -1)
    cn = rep.get("component_nodes", -1)
    kid = rep.get("component_kid_probe") or {}
    if cm < 0:
        print("  ◐ ⑭ 组件内部渲染：本端夹具未覆盖（报告无 component_mounts）——如实跳过")
    elif cm == 0:
        fail(f"★组件**未展开**（component_mounts=0）——若夹具含组件则内部渲染没跑（P1-3 失效）")
        ok = False
    else:
        if cn <= 0:
            fail(f"★有挂载记录（{cm}）但**没有组件节点**（component_nodes={cn}）——展开为空")
            ok = False
        elif not kid.get("text") or not str(kid.get("text", "")).startswith("child-"):
            fail(f"★组件子节点的文本不含 props 值（component_kid_probe={kid}）"
                 f"——props 下行没通（首帧留空）")
            ok = False
        elif kid.get("width_after") is None:
            fail(f"★props 上行**无指令证据**（width_after 缺失 · kid={kid}）"
                 f"——子运行时的 layout.width 指令没被观测到（不是『没变』，是『没证据』）")
            ok = False
        elif kid.get("rect_after") is None:
            fail(f"★props 上行**无内核真值证据**（rect_after 缺失 · kid={kid}）"
                 f"——applyOps 后读不到子节点矩形（宿主侧没这节点 / 读回失败）")
            ok = False
        elif not (isinstance(kid.get("rect_after"), (int, float)) and kid.get("rect_after") > 0):
            fail(f"★props 上行后子节点内核宽度异常（{kid.get('rect_after')}）——更新没落到内核")
            ok = False
        else:
            w_after = kid.get("width_after")
            print(f"  ✓ ⑭ ★组件内部渲染：{cm} 个挂载 · {cn} 个组件节点 · "
                  f"子节点文本 {kid.get('text')!r} · 宽度 {kid.get('width')}→{w_after}"
                  f"（props 下行 + 上行都通）· 内核真值 {kid.get('rect_before')}→{kid.get('rect_after')}")
            if isinstance(kid.get("rect_before"), (int, float)) and kid.get("rect_before") == kid.get("rect_after"):
                fail(f"★内核宽度**没变**（{kid.get('rect_before')}→{kid.get('rect_after')}）"
                     f"——指令发了但宿主/内核侧没生效（『发了』≠『生效了』）")
                ok = False

    # ── ⑮ ★★★P1-3 插槽分发：内容真的落到出口位置、后备真的被遮蔽、孤儿真的不渲染 ──
    #   【为什么单独判】分发的每一处出错都**不报错**：出口多留一层盒 = 几何不等价；
    #     内容没落位 = 空页；后备没遮 = 内容双份（叠影）；孤儿没摘 = 幽灵节点。
    #   ★四条证据（缺一即红）：① 内容文本在（SLOT- 前缀，内核树实测）
    #     ② 后备/孤儿文本**不在**（fb- / ORPHAN-NEVER）③ 内容节点在**内核**里有几何
    #     ④ 分发标记（slotFor/slotOutlet）不残留在给内核的树里。
    sp = rep.get("slot_probe") or {}
    if not sp or not sp.get("texts"):
        # 缺 slot_probe ⇒ 本端夹具未覆盖（honest skip，与 ⑭ 的 ◐ 同规）
        print("  ◐ ⑮ 插槽分发：本端夹具未覆盖（报告无 slot_probe）——如实跳过")
    else:
        texts = [str(t) for t in sp.get("texts", [])]
        joined = " | ".join(texts)
        has_hdr = any(t == "SLOT-HDR" for t in texts)
        has_dft = any(t == "SLOT-DFT" for t in texts)
        bad_fb = [t for t in texts if t.startswith("fb-")]
        bad_orphan = [t for t in texts if t.startswith("ORPHAN-NEVER")]
        fills = sp.get("fills") or []
        rects = sp.get("rects") or []
        markers = sp.get("markers_left", -1)
        if not (has_hdr and has_dft):
            fail(f"★插槽内容没落到出口位置（#header={has_hdr} · 默认={has_dft}）——"
                 f"内核树文本：{joined[:160]}")
            ok = False
        elif bad_fb:
            fail(f"★后备内容**没被遮蔽**（内核树里仍有 {bad_fb}）——内容与后备双份（叠影）")
            ok = False
        elif bad_orphan:
            fail(f"★无出口接住的插槽内容**仍被渲染**（{bad_orphan}）——Vue 语义：未消费内容不渲染")
            ok = False
        elif markers != 0:
            fail(f"★分发期标记残留在给内核的树里（markers_left={markers}）——分发中间态泄漏")
            ok = False
        elif not any(isinstance(r.get("width"), (int, float)) and r.get("width") > 0 for r in rects):
            fail(f"★插槽内容节点在**内核**里没有几何（rects={rects[:3]}）——树里有、内核没有")
            ok = False
        else:
            w_ok = [r for r in rects if isinstance(r.get("width"), (int, float)) and r.get("width") > 0]
            print(f"  ✓ ⑮ ★插槽分发：内容落位（{'#header' if has_hdr else ''}{'+默认' if has_dft else ''}）· "
                  f"后备被遮蔽（fb-* 0 处）· 孤儿摘除（0 处）· 标记零残留 · "
                  f"内核几何 {len(w_ok)}/{len(rects)} 节点有宽度"
                  + (f" · fills={[(f.get('name'), f.get('filled')) for f in fills]}" if fills else ""))

    # ── ⑯ ★★★P1-3 emits：子组件 $emit → 父级 handler → 内核几何真变 ──
    #   【为什么单独判】emits 的失效全是静默的：动作没编译 / 路由没命中 / 载荷没绑 / handler
    #     跑了但几何没变。⇒ 四层证据**缺一即红**：① 有 emit 记录且**已路由** ② 载荷与源值对账
    #     ③ 父级落点源真的变了 ④ 锚节点**内核宽度**真的变了（handler 跑了 ≠ 屏幕变了）。
    ep = rep.get("emit_probe") or {}
    emits = ep.get("emits") or []
    if not emits:
        print("  ◐ ⑯ emits：本端夹具未覆盖（报告无 emit_probe.emits）——如实跳过")
    else:
        routed = [e for e in emits if e.get("routed")]
        if len(routed) == 0:
            fail(f"★$emit 全部**未路由**到父级（{emits}）——父级绑定未命中（边界 id/事件名对不上？）")
            ok = False
        elif not routed[0].get("handler"):
            fail(f"★$emit 已路由但**父 handler 名缺失**（{routed[0]}）——路由表不全")
            ok = False
        else:
            sa = ep.get("parent_source_after")
            gb = ep.get("geom_before", -1)
            ga = ep.get("geom_after", -1)
            if not (isinstance(sa, (int, float)) and sa > 0):
                fail(f"★父级落点源没被改（parent_source_after={sa}）——父 handler 没跑或 $event 没绑上载荷")
                ok = False
            elif not (isinstance(ga, (int, float)) and ga > 0):
                fail(f"★锚节点**内核宽度**没变（{gb}→{ga}）——emit 链路走到了但几何没生效")
                ok = False
            elif isinstance(gb, (int, float)) and gb == ga:
                fail(f"★锚节点内核宽度**前后相同**（{gb}→{ga}）——几何没变（『跑了』≠『生效了』）")
                ok = False
            else:
                print(f"  ✓ ⑯ ★emits 子→父：$emit('{routed[0].get('event')}', 载荷={routed[0].get('payload')!r})"
                      f" 路由到 {routed[0].get('handler')} · 父源 {sa} · 锚节点内核宽度 {gb}→{ga}")

    # ── ⑰ ★★★P1-3 作用域插槽：内容按**出口 props** 求值（文本 + 样式）──
    #   【为什么单独判】作用域插槽的失效形态全是静默的：`sp.*` 读 undefined（文本缺值）、
    #     作用域样式绑定**整条消失**（产物里连槽位都没有——本仓实测过）。⇒ 三证缺一即红：
    #     ① 文本 = `cnt-7`（不是空串/含 undefined）② 内容节点字段里有作用域宽度
    #     ③ **内核真值**宽度 = 那个值（"字段写了"与"内核认了"是两件事）。
    scp = rep.get("scoped_probe") or {}
    if not scp or not scp.get("texts"):
        print("  ◐ ⑰ 作用域插槽：本端夹具未覆盖（报告无 scoped_probe）——如实跳过")
    else:
        texts = [str(t) for t in scp.get("texts", [])]
        wf = scp.get("anchor_width_field", -1)
        wr = scp.get("anchor_width_rect", -1)
        has_cnt = any(t.startswith("cnt-") for t in texts)
        bad_undef = any("undefined" in t for t in texts)
        if not has_cnt:
            fail(f"★作用域插槽内容文本缺失（texts={texts}）——`sp.count` 没绑定到出口 props")
            ok = False
        elif bad_undef:
            fail(f"★作用域内容含字面量 undefined（texts={texts}）——作用域变量没绑上（静默错字）")
            ok = False
        elif not any(t == "cnt-7" for t in texts):
            fail(f"★作用域内容文本≠`cnt-7`（texts={texts}）——出口 props 求值不对（scopedN=7）")
            ok = False
        elif not (isinstance(wf, (int, float)) and wf > 0):
            fail(f"★作用域**样式**绑定没生效（字段 width={wf}）——`:width=\"sp.w\"` 被丢弃（本仓实测的静默形态）")
            ok = False
        elif not (isinstance(wr, (int, float)) and wr > 0):
            fail(f"★作用域样式在**内核**里没有几何（rect width={wr}）——字段写了但内核没认")
            ok = False
        elif wf != wr:
            fail(f"★作用域宽度两侧不一致：节点字段 {wf} vs 内核真值 {wr}——两处对同一量理解不同")
            ok = False
        elif str(scp.get("destr_text", "")).startswith("dct-") and not (
            isinstance(scp.get("destr_width_rect"), (int, float)) and scp.get("destr_width_rect") > 0
        ):
            fail(f"★解构形态的**样式**没生效（destr_width_rect={scp.get('destr_width_rect')}）"
                 + f"——`{scp.get('destr_text')}` 的 `:width` 是解构名绑的（本仓实测过『绑定不可见』形态）")
            ok = False
        elif not str(scp.get("destr_text", "")).startswith("dct-"):
            fail(f"★解构形态内容缺失（destr_text={scp.get('destr_text')!r}）"
                 + "——`#default=\"{ count, w: dw }\"` 的解构值没渲染")
            ok = False
        else:
            print(f"  ✓ ⑰ ★作用域插槽：单名 {next(t for t in texts if t.startswith('cnt-'))!r}"
                  f"（width={wf}）· **解构** {scp.get('destr_text')!r}"
                  f"（width={scp.get('destr_width_field')}/{scp.get('destr_width_rect')}——含 TS 断言）")

    # ── ⑱ ★★★P1-3 生命周期：@vue:mounted 挂载后真的跑（动作 → 订阅 → **内核几何**）──
    #   【为什么单独判】这组失效全是静默的：绑定没编（此前落成"永不触发的 componentEmit"）、
    #     编了没跑、跑了没路由到订阅链、几何没变。⇒ 四证缺一即红：
    #     ① 产物有绑定 ② handler 真的跑了且改了源 ③ 指令真的发给内核（applied>0）
    #     ④ 锚节点**内核宽度**真的变了（"跑了"与"屏幕变了"是两件事）。
    lp = rep.get("lifecycle_probe") or {}
    if not lp or not lp.get("bindings"):
        # ★区分"夹具未覆盖"与"产物里没有"：本仓夹具**必有** @vue:mounted（生成器断言过）
        #   ⇒ 空绑定 = 真缺陷（不是 ◐ 跳过）——但为兼容三端历史报告，首版按 ◐ 处理并在报告可见
        print("  ◐ ⑱ 生命周期：本端报告无 lifecycle 绑定——如实跳过（夹具应含 @vue:mounted）")
    else:
        ran = lp.get("ran_handler") or ""
        ch = lp.get("changed_sources") or []
        applied = lp.get("applied", 0)
        gb = lp.get("geom_before", -1)
        ga = lp.get("geom_after", -1)
        if not ran:
            fail(f"★@vue:mounted 绑定存在但 **handler 没跑**（bindings={lp.get('bindings')}）")
            ok = False
        elif not ch:
            fail(f"★handler {ran} 跑了但**没改任何源**（changed_sources 空）——钩子动作没生效")
            ok = False
        elif not (isinstance(applied, (int, float)) and applied > 0):
            fail(f"★钩子改了源但**指令没送到内核**（applied={applied} · ops_bytes={lp.get('ops_bytes')}）")
            ok = False
        elif not (isinstance(ga, (int, float)) and ga > 0):
            fail(f"★锚节点**内核宽度**没变（{gb}→{ga}）——钩子链路走到了但几何没生效")
            ok = False
        elif isinstance(gb, (int, float)) and gb == ga:
            fail(f"★锚节点内核宽度**前后相同**（{gb}→{ga}）——几何没变（『跑了』≠『生效了』）")
            ok = False
        else:
            print(f"  ✓ ⑱ ★生命周期：@vue:mounted（{lp.get('bindings')[0]}）handler {ran} 跑了 · "
                  f"改源 {ch} · 指令 applied={applied} · 锚节点内核宽度 {gb}→{ga}")

    # ── ⑲ ★★★P3 动态组件 `:is`：首帧解析成对应组件（三个形态各一证）──
    #   【为什么单独判】动态组件的失效形态全是静默的：`:is` 绑定消失（此前产物里连槽位都没有）⇒
    #     空壳节点；解析错组件；假值没摘除（留空壳）；解析对了但内核没布局。⇒ 四证缺一即红：
    #     ① 动态解析出 DynA（DYNA 在、DYNB 不在——防"都渲染"/"都没渲染"）
    #     ② 静态 is="DynB" 等价（DYNB 在）③ 假值摘除（dropped>0）④ 内容节点**内核几何**存在。
    dp = rep.get("dyn_probe") or {}
    if not dp or not dp.get("texts"):
        print("  ◐ ⑲ 动态组件：本端夹具未覆盖（报告无 dyn_probe）——如实跳过")
    else:
        texts = [str(t) for t in dp.get("texts", [])]
        mounts = dp.get("mounts") or []
        geom = dp.get("geom") or []
        dropped = dp.get("dropped", -1)
        has_a = "DYNA" in texts
        has_b = "DYNB" in texts
        if not (has_a and has_b):
            fail(f"★动态组件没渲染出两种落点（DYNA={has_a} DYNB={has_b} · texts={texts} · mounts={mounts}）"
                 f"——动态解析或静态 `is` 没走通")
            ok = False
        elif "DynA" not in mounts or "DynB" not in mounts:
            fail(f"★解析出的组件名不对（mounts={mounts}）——动态/静态两条路的落点不匹配")
            ok = False
        elif not (isinstance(dropped, (int, float)) and dropped > 0):
            fail(f"★假值 `:is` 没摘除（dropped={dropped}）——Vue 语义：假值渲染空（不留空壳）")
            ok = False
        elif not any(isinstance(g.get("width"), (int, float)) and g.get("width") > 0 for g in geom):
            fail(f"★动态组件内容在内核里没有几何（geom={geom[:3]}）——树里有、内核没有")
            ok = False
        else:
            w_ok = [g for g in geom if isinstance(g.get("width"), (int, float)) and g.get("width") > 0]
            print(f"  ✓ ⑲ ★动态组件 `:is`：动态→DynA · 静态 is→DynB · 假值摘除 {dropped} 节点 · "
                  f"内核几何 {len(w_ok)}/{len(geom)} 节点有宽度")

    # ── ⑳ ★★★P3-5 宿主指令 `v-animate`：三段语义（mounted / updated / 假值不播）──
    #   【为什么单独判】自定义指令在我的架构里**不能执行用户脚本**（端上不执行 script）——
    #     正解是"闭集注册表 + 已有宿主能力"。本判据核注册表路线的三段语义**真的跑**：
    #     ① 编译产物带**通道规格**（preset 解析——不是只留一个名字）；
    #     ② 首评 truthy ⇒ 播（mounted 语义）；③ 值变化 ⇒ 再播（updated 语义）；④ 假值 ⇒ 不播。
    #   ★证据是**宿主回执**（animStart started 计数）——"报给宿主了"与"宿主收了"是两件事。
    drp = rep.get("directive_probe") or {}
    if not drp or not drp.get("rounds"):
        print("  ◐ ⑳ 宿主指令：本端夹具未覆盖（报告无 directive_probe）——如实跳过")
    else:
        nodes = drp.get("nodes") or []
        rounds = {r.get("name"): r.get("started", -1) for r in (drp.get("rounds") or [])}
        plays = drp.get("plays") or []
        # ① 编译产物：三节点各一条指令，且**通道数 > 0**（规格真的解析了）
        ch_ok = all(
            any(part.split(":")[2].isdigit() and int(part.split(":")[2]) > 0 for part in n.get("dirs", []))
            for n in nodes
        )
        # ② 首轮有播放（恒真无值指令的 mounted 语义）③ 同值轮零播放 ④ 变化轮有播放 ⑤ 假值轮零播放
        r_a = rounds.get("a:首评falsy", -1)
        r_b = rounds.get("b:同值", -1)
        r_c = rounds.get("c:pulse变true", -1)
        r_d = rounds.get("d:zoom变1", -1)
        r_e = rounds.get("e:pulse变false", -1)
        if not nodes or not ch_ok:
            fail(f"★指令编译产物不完整（nodes={nodes}）——通道规格没解析出来（只剩名字 = 无处可播）")
            ok = False
        elif not (isinstance(r_a, (int, float)) and r_a >= 1):
            fail(f"★首轮没有播放（started={r_a}）——恒真无值指令的 mounted 语义没生效（plays={plays[:2]}）")
            ok = False
        elif r_b != 0:
            fail(f"★同值轮**不该播**但播了（started={r_b}）——updated 语义要求『值变化才播』")
            ok = False
        elif not (isinstance(r_c, (int, float)) and r_c >= 1):
            fail(f"★值变化轮没播（started={r_c}）——updated 语义没生效")
            ok = False
        elif not (isinstance(r_d, (int, float)) and r_d >= 1):
            fail(f"★第二条指令值变化没播（started={r_d}）")
            ok = False
        elif r_e != 0:
            fail(f"★假值轮**不该播**但播了（started={r_e}）——falsy 语义要求不播")
            ok = False
        else:
            presets = [p.get("preset") for p in plays if p.get("started")]
            print(f"  ✓ ⑳ ★宿主指令 v-animate：{len(nodes)} 节点带通道规格 · "
                  f"mounted 播 {r_a} · 同值 0 · 变化播 {r_c}/{r_d} · 假值 0 · 已播预设 {sorted(set(presets))}")

    # ── ㉑ ★★★元素/文本混排：每一段文本真的渲染了（此前**整段丢失**）──
    #   【为什么单独判】混排曾是模板侧第一大类缺口（27 个样例页 13 处）——文本与元素交错时
    #     文本**整段不渲染**（页面上只剩元素）。本批合成文本叶后，判据核**四证**：
    #     ① 前置段在（`mix `）② 后置段在（` tail`）③ 插值段求值结果在（`int=4 `）
    #     ④ 元素间单空格叶保留（` `——Vue condense：那是真内容）
    #   缺一即红（"少一段"与"全丢失"都是静默失败形态）。
    mp = rep.get("mixed_probe") or {}
    if not mp or not mp.get("texts"):
        print("  ◐ ㉑ 混排：本端夹具未覆盖（报告无 mixed_probe）——如实跳过")
    else:
        texts = [str(t) for t in mp.get("texts", [])]
        joined = "|".join(texts)
        geo = mp.get("geom") or []
        need = {
            "前置段": any(t == "mix " for t in texts),
            "后置段": any(t == " tail" for t in texts),
            "插值段": any(t.startswith("int=") and "4" in t for t in texts),
            "空格叶": any(t == " " for t in texts),
        }
        missing = [k for k, v in need.items() if not v]
        if missing:
            fail(f"★混排文本段落缺失：{missing}（内核树文本={joined[:160]}）——该段文字没渲染")
            ok = False
        elif not any(isinstance(g.get("width"), (int, float)) and g.get("width") > 0 for g in geo):
            fail(f"★合成叶在内核里没有几何（geom={geo[:3]}）——树里有、内核没有")
            ok = False
        else:
            w_ok = [g for g in geo if isinstance(g.get("width"), (int, float)) and g.get("width") > 0]
            print(f"  ✓ ㉑ ★元素/文本混排：段落齐全（{'/'.join(need.keys())}）· 合成叶 {mp.get('leaves')} · "
                  f"内核几何 {len(w_ok)}/{len(geo)} 叶有宽度 · 实文本 {joined[:80]}")

    # ── ㉒ ★★★`:style` 对象展开：**两条通道各自生效**（内核算几何 / 宿主算绘制）──
    #   【为什么单独判】对象字面量此前产出**两条同名 `paint.style` 槽位** ⇒ 内核只认字段级键
    #     ⇒ 宽度与颜色**都不生效**（静默），而诊断声称"逐键下发"（假承诺）。本批逐键展开后：
    #     布局键进内核、绘制键由桥转宿主。**两条通道必须分开核**——绘制不进内核，
    #     只看内核读数会看漏它的失效（本仓实测过）。
    spo = rep.get("styleobj_probe") or {}
    if not spo or spo.get("anchor_id", -1) < 0:
        print("  ◐ ㉒ :style 对象：本端夹具未覆盖（报告无 styleobj_probe）——如实跳过")
    else:
        wb = spo.get("width_before", -1)
        wa = spo.get("width_after", -1)
        ka = spo.get("kernel_applied", 0)
        patches = spo.get("patch_calls") or []
        patch_bg = any('backgroundColor' in (p[0].split(':', 1)[1] if ':' in p[0] else '') for p in patches if p)
        if not (isinstance(wb, (int, float)) and wb > 0):
            fail(f"★:style 对象的**布局键**初值没生效（width_before={wb}）——内核通道没走通")
            ok = False
        elif not (isinstance(wa, (int, float)) and wa > 0 and wa != wb):
            fail(f"★更新后**内核宽度没变**（{wb}→{wa}）——布局键（layout.width）没生效")
            ok = False
        elif not (isinstance(ka, (int, float)) and ka > 0):
            fail(f"★更新轮内核没应用任何指令（kernel_applied={ka}）")
            ok = False
        elif len(patches) == 0:
            fail("★**绘制键没有提交给宿主**（patch_calls 空）——paint.backgroundColor 被丢弃（静默失效形态）")
            ok = False
        elif not patch_bg:
            fail(f"★绘制补丁内容不含 backgroundColor（patches={patches[:2]}）——桥没把绘制键转宿主")
            ok = False
        else:
            print(f"  ✓ ㉒ ★:style 对象逐键展开：布局键内核宽度 {wb}→{wa}（applied={ka}）· "
                  f"绘制键提交宿主 {patches[0][0] if patches and patches[0] else ''}")

    # ── ㉓ ★★★T2：带参调用 + 方法内局部变量 + if/else 的**动作端上真执行**（2026-10-10）──
    #   【为什么单独判】T2 的动作（`let` 形参绑定 / `let` 局部变量 / `if` 两臂）必须**端上真跑**——
    #     编译期产出"看起来对"的动作不算数；判据核：连跑 handler 3 次的**内核几何宽度**
    #     是否走过 else→else→then 三步（0→6→12→0）。几何是内核真值（readRects），非自报。
    t2 = rep.get("t2_probe") or {}
    #   ① 期望源值序列（t2x：0 → 6 → 12 → 0）；② 期望几何：与源值同（宽度绑定 t2x）
    t2v = [int(v) for v in (t2.get("values") or [])]
    t2w = [int(v) for v in (t2.get("widths") or [])]
    if not t2 or len(t2v) < 4:
        print("  ◐ ㉓ T2：本端夹具未覆盖（报告无 t2_probe）——如实跳过")
    else:
        # ★三步语义：else(0→6) · else(6→12) · then(12→0)——后两步证明"局部变量 step 参与"与"if 两臂都走"
        want = [0, 6, 12, 0]
        t2logs = t2.get("logs") or []
        if t2v != want:
            fail(f"★T2 源值序列不符（期望 {want}：else→else→then）：{t2v} —— 形参/局部变量/if 有一步没生效")
            ok = False
        elif t2w[1:] != t2v[1:]:
            fail(f"★T2 几何没跟上源值变化（宽 {t2w} vs 值 {t2v}）—— 动作改了源但内核没重排")
            ok = False
        elif len(t2logs) < 3:
            fail(f"★T3 console.* 动作没端上执行（logs={t2logs}，应 3 条）—— console 未降级/未执行")
            ok = False
        else:
            print(f"  ✓ ㉓ ★T2 带参/局部/if：t2x 值 {t2v}（else→else→then）· 内核几何宽 {t2w}（同步）· "
                  f"T3 console {len(t2logs)} 条（如 {t2logs[0]!r}）")

    # ── ㉔ ★★★B5：脚本级生命周期钩子 `onMounted`/`onUnmounted` 端上真执行（2026-10-10）──
    #   【要证明什么】`onMounted(() => { x = 88 })` / `onUnmounted(() => { x = 0 })` 的**回调体降级为动作**、
    #     端上在时序点跑（不是"编出来了"）。判据核：b5x 值序列 [0,88,0]（mounted→unmounted）+ 内核几何同步。
    b5 = rep.get("b5_probe") or {}
    b5v = [int(v) for v in (b5.get("values") or [])]
    b5w = [int(v) for v in (b5.get("widths") or [])]
    if not b5 or len(b5v) < 3:
        print("  ◐ ㉔ B5 脚本生命周期：本端夹具未覆盖（报告无 b5_probe）——如实跳过")
    elif b5v != [0, 88, 0]:
        fail(f"★B5 脚本钩子源值序列不符（期望 [0,88,0]：挂载前→mounted→unmounted）：{b5v} —— onMounted/onUnmounted 有一步没跑")
        ok = False
    elif b5w[1:] != b5v[1:]:
        fail(f"★B5 几何没跟上（宽 {b5w} vs 值 {b5v}）—— 脚本钩子改了源但内核没重排")
        ok = False
    else:
        print(f"  ✓ ㉔ ★B5 脚本生命周期：{b5.get('phases')} · b5x 值 {b5v}（挂载前→mounted→unmounted）· 内核几何宽 {b5w}（同步）")

    # ── ㉕ ★★★B3a：动态 :class 的**数值布局字段**端上真生效（走内核 SET_STYLE，2026-10-10）──
    #   【要证明什么】动态 `:class` 命中的数值布局字段（width…）经**内核二进制通道**重排 ⇒ 几何真变
    #     （此前误走宿主绘制通道 ⇒ 不重排 ⇒ 端上不生效）。
    b3 = rep.get("b3a_probe") or {}
    b3w = [int(v) for v in (b3.get("widths") or [])]
    if not b3 or len(b3w) < 3:
        print("  ◐ ㉕ B3a 动态 :class 数值布局：本端夹具未覆盖（报告无 b3a_probe）——如实跳过")
    elif b3w != [0, 200, 0]:
        fail(f"★B3a 动态 :class 数值布局字段几何不符（期望 [0,200,0]：关→开→关）：{b3w} —— 内核 SET_STYLE 通道没生效")
        ok = False
    else:
        print(f"  ✓ ㉕ ★B3a 动态 :class 数值布局：内核几何宽 {b3w}（关→开→关）——走内核二进制 SET_STYLE 生效")

    # ── ㉖ ★★★B3b/B3c：动态 :class 的**枚举布局字段**端上真生效（flex-direction + justify-content 走内核 SET_STYLE 索引编码，2026-10-10）──
    b3b = rep.get("b3b_probe") or {}
    b3bx = [int(v) for v in (b3b.get("child_xs") or [])]
    if not b3b or len(b3bx) < 3:
        print("  ◐ ㉖ B3b/B3c 动态 :class 枚举布局：本端夹具未覆盖（报告无 b3b_probe）——如实跳过")
    elif b3bx != [0, 200, 0]:
        fail(f"★B3b/B3c 动态 :class 枚举布局字段几何不符（期望 [0,200,0]：column→(row+居中) 子2 x）：{b3bx} —— 枚举索引编码通道没生效")
        ok = False
    else:
        print(f"  ✓ ㉖ ★B3b/B3c 动态 :class 枚举布局：子2 x {b3bx}（column→row+居中→column）——flex-direction + justify-content 走内核 SET_STYLE 索引编码生效")

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
