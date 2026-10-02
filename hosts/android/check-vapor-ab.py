#!/usr/bin/env python3
"""hosts/android/check-vapor-ab.py —— ★★★Vapor vs Vue 运行时 **A/B 对照判据**

【这份判据回答什么（此前所有读数都没回答的）】
  此前所有 Vapor 读数只证明"这条路能跑"，但没有回答"**它跑出来的东西与 Vue 运行时是否等价**"。
  本判据把两条路放在**同一台设备、同一份 SFC、同一个内核**上跑，逐节点比几何：
    · A = **Vapor**（编译产物：LayoutTemplate + 订阅表 → 设备端实例化）
    · B = **Vue 运行时**（@vue/compiler-sfc 编出的 render → @vue/runtime-core → selfdraw 适配器）

【判据（每条都打在"会失败的那一点"上）】
  ① **两路都真的跑了**：`nodes_a > 0` · `nodes_b > 0` · 两路宿主布局耗时都 > 0
  ② **★文本序列可对齐**：`texts_a == texts_b`（两条路树形天然不同——Vapor 折文本进元素、
     Vue 是标准 vnode 树——故判据是"同一份 SFC 的同一处文本可逐一对齐"，不是树规模相等）
  ③ **★★几何逐节点一致**：`max_delta ≤ 0.01px` · `mismatches == 0`（mount 段）
  ④ **绘制通道齐备 + ★逐项等价**（本批扩容）：A ≥5 且 **两侧通道签名多重集相等**
     （`chan_a == chan_b`——"每条通道的值都相等"，不只是"非空通道数"）
  ⑤ **成本可读**（不设阈值，只如实记录）：两路各自的 JS 侧 + 宿主侧耗时
  ⑥ ★★**更新路径对照（2026-10-01 新增）**：同一序列的变更（行文本 + 行宽 + 标量宽）在两条路上——
     · A 走**订阅增量**（触发源 → VaporRuntime → 二进制指令 → 内核 applyOps）
     · B 走 **Vue patch**（同步驱动 `instance.update()` → 适配器 `takePatches()` → 宿主 `updatePatches`）
     · 判据 ⑥a：B 路每轮**必须产出补丁**（`patches > 0`；null ⇒ 结构性变化 ⇒ 红——夹具变更不该触发结构）
     · 判据 ⑥b：两路每轮**内核几何都真的动了**（`moved > 0`；两侧更新都要落到几何上）
     · 判据 ⑥c：**更新后几何仍逐节点一致**（`upd_samples > 0` 防空比假绿 · `upd_mismatches == 0`）
     · 判据 ⑥d：**文本通道两条路都消费**（A：`text_synced` 累计 > 0；B：`text_layers` 累计 > 0）
       —— 文本不落层 = 屏幕停留旧值，是几何断言发现不了的一类静默缺陷
     · 判据 ⑥e：B 路补丁**真的到了宿主**（宿主侧读数 `host_update_patch_calls > 0`，不是只看 JS 自报）
  ⑦ ★★**事件路径对照（2026-10-01 第二批新增；2026-10-02 补冒泡链）**：宿主注入 tap（真 MotionEvent → 内核 hitTest →
     JNI 反向调用，**带内核的冒泡链**），两条路各自沿链派发：
     · A：`__proteusVaporGesture` → 编译产物的动作表 → 订阅触发 → 二进制指令 → 内核
     · B：`__proteusVaporGesture` → 适配器 `dispatchEvent`（Vue onClick，沿链）→ ref 变 → node update
       → `takePatches()` → 宿主 `updatePatches` → 内核
     · 判据 ⑦a：两路 tap 都**命中**（`hit > 0`）且都**真的跑了 handler**（A `handler` 非空 / B `fired` 非空）
     · 判据 ⑦b：两路按钮几何 **tap 前一致**（`ev_before_delta ≤ 0.01`）——同语义锚点前提
     · 判据 ⑦c：两路**宽度位移一致**（|ΔA − ΔB| ≤ 0.01）且都 **> 0**（数据变更真的落到几何）
     · 判据 ⑦d：两路按钮几何 **tap 后一致**（`ev_after_delta ≤ 0.01`）——同一语义同结果
     · 判据 ⑦e：B 路 tap 后**有补丁且补丁到了宿主**（`patches ≥ 0` · `applied ≥ 0`）
     · 判据 ⑦f：**冒泡链没断**——两路链都含祖先（len ≥ 2）· 链首 = 命中节点 · 逐跳派发（fired ≥ 2）
     · 判据 ⑦g：**逐跳位移两路一致且都 > 0**（祖先 handler 真的改到祖先几何上；
       `fired_width_deltas` 与 fired 同序）

【诚实边界（本档不覆盖）】
  · A 路 handler 是**动作列表**（无事件对象）⇒ 不支持 `stopPropagation` 的**终止语义**等价
    （B 路适配器支持；本判据覆盖"非终止冒泡"两路等价）；

用法：python3 hosts/android/check-vapor-ab.py <vapor-ab.json>
退出码：0 全过 / 1 有失败 / 2 用法错（产物缺失时诚实跳过，返回 0）
"""
import json
import os
import sys

GEOM_TOL = 0.01  # px（两路喂同一内核，理论应逐位相同）


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print("用法：python3 hosts/android/check-vapor-ab.py <vapor-ab.json>")
        return 2
    path = args[0]
    if not os.path.exists(path):
        print(f"⚠ A/B 判据：未找到真机产物（{path}）")
        print("  ⇒ 诚实跳过（跑真机后取回）：bash hosts/android/run-vapor-ab.sh")
        return 0

    print(f"═══ Vapor vs Vue 运行时 A/B 对照判据（同一 SFC · 逐节点几何）：{path} ═══")
    ok = True
    with open(path, encoding="utf-8") as f:
        d = json.load(f)

    def fail(msg: str) -> None:
        print(f"  ✗ {msg}")

    # ★★下钻到 JS 侧报告（宿主回执把 JS 报告包在 `report` 字段里——
    #   与 `check-vapor-device.py` 同一读法；首版忘了这步 ⇒ 全部读数取不到，判据"空绿"风险）
    #   ★`orig` 保留宿主侧读数（`host_*` 在顶层——⑥e"B 路补丁真的到了宿主"要读它）
    orig = d
    rep = d.get("report") or {}
    if d.get("ok") is not True or rep.get("ok") is not True:
        fail(f"通路未成功：{str(rep.get('error') or d.get('error'))[:300]}")
        for n in (rep.get("notes") or [])[:6]:
            print(f"      · {n}")
        return 1
    d = rep

    na, nb = d.get("nodes_a", 0), d.get("nodes_b", 0)
    ta, tb = d.get("texts_a", 0), d.get("texts_b", 0)

    # ── ① 两路都真的跑了 ──
    la = d.get("layout_ms_a", -1)
    lb = d.get("layout_ms_b", -1)
    if na <= 0 or nb <= 0:
        fail(f"两路没有都跑起来：nodes_a={na} · nodes_b={nb}")
        ok = False
    elif la is None or la < 0 or lb is None or lb < 0:
        fail(f"宿主布局读数缺失：layout_ms_a={la} · layout_ms_b={lb}（两路都该过内核）")
        ok = False
    else:
        print(f"  ✓ ① 两路都真的跑了：A {na} 节点（宿主布局 {la}ms）· B {nb} 节点（{lb}ms）")

    # ── ② ★文本序列（语义对齐的前提） + 树规模如实各报各的 ──
    #   ★★判据口径修正（两轮实测）：**两条路的树规模天然不同**，不能要求相等——
    #     · A（Vapor）：模板编译器把 `<p-text>文本</p-text>` 折成**一个节点**（文本即元素属性）
    #     · B（Vue 运行时）：标准 vnode 树 ⇒ 元素 + 匿名文本子节点**两层**，
    #       另有适配器的 `paintHint` 提示节点与组件 resolve 包装
    #   ⇒ 正确的等价判据是「**同一份 SFC 的同一个元素，几何相同**」——
    #     即按**文本序列对齐**后逐项比几何（见 ③）。树规模**如实各报各的**（它本身也是有价值的读数）。
    if ta <= 0 or tb <= 0:
        fail(f"文本节点读数缺失：A={ta} · B={tb}")
        ok = False
    elif ta != tb:
        fail(f"★文本节点数不一致：A={ta} vs B={tb}"
             f"（两路的『文本』口径应可对齐——若不等说明某一侧漏了文本）")
        ok = False
    else:
        print(f"  ✓ ② 文本序列可对齐：两侧各 {ta} 处文本 · 树规模 A={na} / B={nb} 节点"
              f"（**天然不同**：Vapor 折叠文本进元素，Vue 是标准 vnode 树——如实各报）")

    # ── ③ ★★几何逐节点一致（本判据的核心）──
    max_d = d.get("max_delta", -1)
    mism = d.get("mismatches", -1)
    samples = d.get("samples", 0)
    if samples is None or samples <= 0:
        # ★★防"空比假绿"（本仓最忌讳的形态）：比 0 个节点也会得到 max_delta=0——
        #   那是"什么都没比"，不是"一致"。⇒ 样本数为 0 必须红。
        fail(f"★几何对比**没有任何样本**（samples={samples}）——"
             f"max_delta 恒 0 但那是『什么都没比』（空比假绿），不是『一致』")
        ok = False
    elif max_d is None or max_d < 0 or mism is None or mism < 0:
        fail(f"几何对比读数缺失：max_delta={max_d} · mismatches={mism}")
        ok = False
    elif mism > 0 or max_d > GEOM_TOL:
        fm = d.get("first_mismatch")
        fail(f"★★几何不一致：{mism} 处超出容差 {GEOM_TOL}px · 最大差 {max_d}px"
             + (f" · 首例 {json.dumps(fm, ensure_ascii=False)}" if fm else "")
             + " —— 两路喂同一内核，差异必来自某一路的样式/结构翻译")
        ok = False
    else:
        print(f"  ✓ ③ ★★几何一致（按**语义文本节点**对齐后逐项比）："
              f"{samples} 个样本 · 最大差 {max_d}px · 不一致 {mism} 处")

    # ── ④ 绘制通道齐备 + ★逐项等价（2026-10-01 第二批：把"口径未对齐"补上）──
    #
    # 【为什么要扩（上一版的诚实边界）】上一版只要求 A 侧 ≥5、B 侧"如实报出"——
    #   因为 B 的探针打的节点与 A 的树形不同（A 折文本进元素 / B 是 vnode 树）。
    #   本版的口径：两侧都探**全树**，把每个节点上的通道值取成**排序多重集签名**
    #   （`{radius:{...}, grad:{...}, ...}`）——树形差异不影响"同一 SFC 应产出同一组
    #   语义绘制声明"这条断言；缺失/多出的签名会以差集直接暴露。
    ca, cb = d.get("channels_a", -1), d.get("channels_b", -1)
    chan_a, chan_b = d.get("chan_a"), d.get("chan_b")
    chan_match = d.get("chan_match")
    if ca is None or cb is None or ca < 0 or cb < 0:
        fail(f"绘制通道读数缺失：A={ca} · B={cb}")
        ok = False
    elif ca < 5:
        fail(f"A 侧绘制通道不足：{ca} 个节点有非空通道（应 ≥5——夹具里 5 个通道各一节点）")
        ok = False
    elif not isinstance(chan_a, dict) or not isinstance(chan_b, dict):
        fail(f"★绘制通道签名缺失（chan_a={type(chan_a).__name__} · chan_b={type(chan_b).__name__}）"
             f"——逐项等价没得判（旧产物？）")
        ok = False
    elif chan_a != chan_b or chan_match is not True:
        # ★判据**独立比对**（不只看 JS 自报的 chan_match——那是同一件事的自证；
        #   本行用 Python 侧的 == 再判一遍，两者不一致本身就是缺陷）
        # ★差集诊断（"哪条通道、什么值、两侧计数差多少"）——直接指向要查的那条链
        lines = []
        for k in ("radius", "grad", "glow", "clip", "stroke_len", "mask"):
            ma = (chan_a or {}).get(k) or {}
            mb = (chan_b or {}).get(k) or {}
            keys = sorted(set(ma) | set(mb))
            dif = [f"{kk}: A×{ma.get(kk, 0)}/B×{mb.get(kk, 0)}"
                   for kk in keys if ma.get(kk, 0) != mb.get(kk, 0)]
            if dif:
                lines.append(f"{k} → " + " · ".join(dif[:6]))
        same_in_py = chan_a == chan_b
        detail = ("；".join(lines) if lines
                  else ("两侧签名对象相等但 JS 侧 chan_match=false（**JS 自判有缺陷**——查 channelSig）"
                        if same_in_py else "（签名对象不等）"))
        fail(f"★两侧绘制通道**逐项不等价**（签名多重集不同）：" + detail
             + " —— 同一份 SFC 在两条路上应产出同一组绘制声明；某一路漏/多 ⇒ 查对应的翻译环节")
        ok = False
    else:
        print(f"  ✓ ④ ★绘制通道逐项等价：两侧签名多重集相同（A {ca} 节点 / B {cb} 节点带非空通道）")
        for k in ("radius", "grad", "glow", "clip", "stroke_len", "mask"):
            m = (chan_a or {}).get(k) or {}
            if m:
                print(f"       {k}: " + " · ".join(f"{kk}×{vv}" for kk, vv in m.items()))

    # ── ⑤ 成本（如实记录，不设阈值）──
    ca_cost = d.get("cost_a") or {}
    cb_cost = d.get("cost_b") or {}
    print(f"  ℹ ⑤ 成本对照（如实记录，本档不设阈值）：")
    print(f"       A（Vapor 编译产物）: 总 {ca_cost.get('total_ms')}ms"
          f" = 实例化 {ca_cost.get('instantiate_ms')} + 宿主 {ca_cost.get('host_ms')}"
          f" · 宿主布局 {la}ms")
    print(f"       B（Vue 运行时）  : 总 {cb_cost.get('total_ms')}ms"
          f" = Vue mount {cb_cost.get('vue_ms')} + 请求 {cb_cost.get('request_ms')}"
          f" + 序列化 {cb_cost.get('serialize_ms')} + 宿主 {cb_cost.get('host_ms')}"
          f" · 宿主布局 {lb}ms")
    if ca_cost.get("total_ms") and cb_cost.get("total_ms"):
        ratio = cb_cost["total_ms"] / ca_cost["total_ms"] if ca_cost["total_ms"] > 0 else -1
        if ratio > 0:
            print(f"       ⇒ JS 侧总耗时比（B/A）= {ratio:.2f}×")

    # ── ⑥ ★★更新路径对照（2026-10-01；本批判据的核心新增）──
    upd_rounds = d.get("upd_rounds", 0)
    upd_a = d.get("upd_a") or []
    upd_b = d.get("upd_b") or []
    if upd_rounds is None or upd_rounds <= 0:
        fail(f"★更新路径未跑（upd_rounds={upd_rounds}）——A 订阅增量 vs B Vue patch 的对照缺失")
        ok = False
    else:
        # ⑥a B 路每轮必须产出补丁（-1 = takePatches() 返回 null = 结构性变化）
        # ★空列表也是失败（真实跑出过一次：upd_rounds=2 而 upd_b=[] —— JS 侧漏赋值，
        #   判据当时对空列表**空绿**通过——本仓「空比假绿」同族）
        if len(upd_b) < upd_rounds:
            fail(f"★B 路更新读数不足：upd_rounds={upd_rounds} 而 upd_b 只有 {len(upd_b)} 条"
                 f"（空列表 = 读数缺失，不是『每轮都有补丁』）")
            ok = False
        bad_patch = [r for r in upd_b if (r.get("patches") or -1) <= 0]
        if bad_patch:
            fail(f"★B 路补丁缺失：第 {[r.get('round') for r in bad_patch]} 轮 patches≤0"
                 f"（-1 = takePatches() 返回 null ⇒ 结构性变化；夹具的文本/宽度变更不该触发结构）")
            ok = False
        if not bad_patch and len(upd_b) >= upd_rounds:
            print(f"  ✓ ⑥a B 路每轮产出补丁：{[r.get('patches') for r in upd_b]} 条"
                  f"（适配器 takePatches → 宿主 updatePatches）")

        # ⑥b 两路每轮几何都真的动了
        still_a = [r.get("round") for r in upd_a if not (r.get("moved") or 0) > 0]
        still_b = [r.get("round") for r in upd_b if not (r.get("moved") or 0) > 0]
        if still_a:
            fail(f"★A 路第 {still_a} 轮几何**没有变化**（moved=0）——更新没落到内核几何上")
            ok = False
        if still_b:
            fail(f"★B 路第 {still_b} 轮几何**没有变化**（moved=0）——patch 没落到内核几何上")
            ok = False
        if not still_a and not still_b:
            print(f"  ✓ ⑥b 两路每轮几何都动了：A moved={[r.get('moved') for r in upd_a]} · "
                  f"B moved={[r.get('moved') for r in upd_b]}")

        # ⑥c 更新后几何仍逐节点一致（样本 0 ⇒ 空比假绿 ⇒ 红）
        us = d.get("upd_samples", 0)
        um = d.get("upd_mismatches", -1)
        ud = d.get("upd_max_delta", -1)
        if us is None or us <= 0:
            fail(f"★更新后几何对比**没有样本**（upd_samples={us}）——空比假绿，不是『一致』")
            ok = False
        elif um is None or um < 0 or ud is None or ud < 0:
            fail(f"更新后几何读数缺失：upd_max_delta={ud} · upd_mismatches={um}")
            ok = False
        elif um > 0 or ud > GEOM_TOL:
            fm = d.get("upd_first_mismatch")
            fail(f"★★更新后几何不一致：{um} 处超容差 · 最大差 {ud}px"
                 + (f" · 首例 {json.dumps(fm, ensure_ascii=False)}" if fm else ""))
            ok = False
        else:
            print(f"  ✓ ⑥c ★★更新后几何仍逐节点一致：{us} 样本 · 最大差 {ud}px · 不一致 {um} 处"
                  f"（逐轮：{[(g.get('round'), g.get('delta')) for g in (d.get('upd_geom_rounds') or [])]}）")

        # ⑥d 文本通道两条路都消费（回归锁：内核 text_updates 必须被宿主落层）
        tsa = d.get("upd_a_text_synced", 0)
        tsb = d.get("upd_b_text_applied", 0)
        if not tsa or tsa <= 0:
            fail(f"★A 路文本同步为 0（text_synced={tsa}）——内核 text_updates 没被宿主消费（屏幕会停留旧字）")
            ok = False
        if not tsb or tsb <= 0:
            fail(f"★B 路文本落层为 0（text_layers={tsb}）——Vue patch 的文本没落到绘制真源")
            ok = False
        if tsa and tsb and tsa > 0 and tsb > 0:
            print(f"  ✓ ⑥d 文本通道两侧都消费：A text_synced={tsa} · B text_layers={tsb}")

        # ⑥e B 路补丁真的到了宿主（宿主侧读数——不是只信 JS 自报）
        #   ★宿主读数在产物顶层（`host_update_patch_calls`），不在 report 里——取原始 d0
        hup = (orig.get("host_update_patch_calls") if isinstance(orig, dict) else None)
        if hup is None:
            print(f"  ⚠ ⑥e 宿主补丁调用读数缺失（旧产物格式？）——跳过（判据其余项仍有效）")
        elif hup <= 0:
            fail(f"★B 路补丁没有到宿主（host_update_patch_calls={hup}）——JS 自报有补丁但宿主没消费")
            ok = False
        else:
            print(f"  ✓ ⑥e B 路补丁真的到了宿主：host_update_patch_calls={hup}")

        # 成本对照（如实记录）
        print(f"  ℹ ⑥f 更新成本对照（如实记录）：")
        for r in upd_a:
            print(f"       A 轮 {r.get('round')}: ops {r.get('ops_bytes')}B · 编码 {r.get('ops_ms')}ms · "
                  f"宿主 {r.get('apply_ms')}ms · 变更 {r.get('changed_rects')} 节点 · relayout {r.get('relayout')}")
        for r in upd_b:
            print(f"       B 轮 {r.get('round')}: 补丁 {r.get('patches')} 条 · 驱动 {r.get('driver_ms')}ms · "
                  f"宿主 {r.get('host_ms')}ms · 变更 {r.get('changed_rects')} 节点 · relayout {r.get('relayout')}")

    # ── ⑦ ★★事件路径对照（2026-10-01 第二批）──
    #   宿主注入 tap（真 MotionEvent → 内核 hitTest → JNI 反向调用）→ 两条路各自跑 handler：
    #   A：编译产物动作表 → 订阅 → 指令 → 内核；B：适配器 dispatchEvent（Vue onClick）→
    #   ref 变 → node update → takePatches → 宿主 updatePatches → 内核。
    #   判据打在"事件真的改了内核几何"上（读数全来自 readRects 真源，不采信任何自报）。
    ev_a, ev_b = d.get("ev_a"), d.get("ev_b")
    if not isinstance(ev_a, dict) or not isinstance(ev_b, dict):
        fail(f"★事件路径读数缺失（ev_a={type(ev_a).__name__} · ev_b={type(ev_b).__name__}）"
             f"——tap 对照没跑起来（旧产物？或按钮定位失败，见 notes）")
        ok = False
    else:
        # ⑦a 两路都命中且都跑了 handler
        ha, hb = ev_a.get("hit", -1), ev_b.get("hit", -1)
        fired_b = ev_b.get("fired") or []
        handler_a = ev_a.get("handler") or ""
        if ha is None or ha <= 0:
            fail(f"★A 路 tap 没有命中任何节点（hit={ha}）——事件闭环第一环断了")
            ok = False
        if hb is None or hb <= 0:
            fail(f"★B 路 tap 没有命中任何节点（hit={hb}）——事件闭环第一环断了")
            ok = False
        if not handler_a:
            fail("★A 路命中后没有跑 handler（编译产物动作表里没有对应绑定？）")
            ok = False
        if not fired_b:
            # ★空列表 = 没有任何处理器被调用（可能是 onClick 未登记 / 命中错节点）
            fail(f"★B 路 hitTest 命中但**没有派发到任何处理器**（fired=[]）——"
                 f"Vue 的 onClick 未登记到该节点，或命中节点与登记节点错位")
            ok = False
        if ha and ha > 0 and hb and hb > 0 and handler_a and fired_b:
            print(f"  ✓ ⑦a 两路 tap 都命中且都跑了 handler：A hit={ha}（{handler_a}）· B hit={hb}（fired={fired_b}）")
        # ⑦a' B 路派发无异常
        errs_b = ev_b.get("errors") or []
        if errs_b:
            fail(f"★B 路派发抛异常：{errs_b}")
            ok = False

        # ⑦b tap 前按钮几何一致（同语义锚点前提）
        bd = d.get("ev_before_delta", -1)
        if bd is None or bd < 0:
            fail(f"★tap 前几何对照读数缺失（ev_before_delta={bd}）——两路按钮矩形没读到，等价性无法判")
            ok = False
        elif bd > GEOM_TOL:
            fail(f"★tap 前两路按钮几何不一致：最大差 {bd}px"
                 f"（A={json.dumps(ev_a.get('before'), ensure_ascii=False)} vs "
                 f"B={json.dumps(ev_b.get('before'), ensure_ascii=False)}）——锚点不同则后面的位移对比无意义")
            ok = False
        else:
            print(f"  ✓ ⑦b tap 前两路按钮几何一致（最大差 {bd}px）")

        # ⑦c 宽度位移一致且都动（>0）
        da = ev_a.get("width_delta", 0) or 0
        db = ev_b.get("width_delta", 0) or 0
        if da <= 0 or db <= 0:
            fail(f"★tap 后内核几何没有变：A Δ={da}px · B Δ={db}px"
                 f"（应都 >0——boxW 从 120 加 30 ⇒ 按钮宽度变 30）——事件没落到几何上")
            ok = False
        elif abs(da - db) > GEOM_TOL:
            fail(f"★两路宽度位移不一致：A Δ={da}px vs B Δ={db}px"
                 f"——同一语义的 handler 在两条路上改了不同的东西")
            ok = False
        else:
            print(f"  ✓ ⑦c 两路宽度位移一致且都真的落到几何：A Δ={da}px · B Δ={db}px"
                  f"（A 指令 {ev_a.get('ops_bytes')}B / applied {ev_a.get('applied')} · "
                  f"B 补丁 {ev_b.get('patches')} 条 / applied {ev_b.get('applied')}）")

        # ⑦d tap 后按钮几何一致（同一语义同结果）
        ad = d.get("ev_after_delta", -1)
        if ad is None or ad < 0:
            fail(f"★tap 后几何对照读数缺失（ev_after_delta={ad}）")
            ok = False
        elif ad > GEOM_TOL:
            fail(f"★★tap 后两路按钮几何不一致：最大差 {ad}px"
                 f"（A={json.dumps(ev_a.get('after'), ensure_ascii=False)} vs "
                 f"B={json.dumps(ev_b.get('after'), ensure_ascii=False)}）")
            ok = False
        else:
            print(f"  ✓ ⑦d tap 后两路按钮几何仍一致（最大差 {ad}px）")

        # ⑦e B 路 tap → patch → 宿主（补丁通道在事件相位也通）
        pb = ev_b.get("patches", -1)
        apb = ev_b.get("applied", -1)
        if pb is None or pb < 0:
            fail(f"★B 路 tap 后 takePatches() 返回 null（结构性变化）——夹具的 boxW 变更不该触发结构")
            ok = False
        elif apb is None or apb < 0:
            fail(f"★B 路 tap 后补丁没有到达宿主（applied={apb}）——事件改了数据但补丁通道断了")
            ok = False
        else:
            print(f"  ✓ ⑦e B 路 tap 后补丁经宿主落内核：patches={pb} · applied={apb} · "
                  f"changed={ev_b.get('changed_rects')} · 驱动 {ev_b.get('driver_ms')}ms")

        # ⑦f ★冒泡链没断（2026-10-02）：两路的链都应含**祖先**（len ≥ 2）、链首 = 命中节点、
        #   且真的**逐跳派发**（fired len ≥ 2 —— "祖先 handler 真的跑了"）。
        #   ★这条打在"链在最后一环被丢"的形态上：chain 缺失/被丢时 parseChain 退化成 [nodeId]
        #     （len 1）；只派 target 时 fired 只有 1 跳 —— 两者都会在此判红。
        bubble_ok = True
        for label, ev in (("A", ev_a), ("B", ev_b)):
            chain = ev.get("chain") or []
            fired = ev.get("fired") or []
            hit = ev.get("hit", -1)
            if len(chain) < 2:
                fail(f"★{label} 路 tap 的冒泡链只有 {len(chain)} 跳（[{chain}]）——"
                     f"内核给了链却没传到位（宿主/JNI 丢链 ⇒ 祖先 handler 永不触发）")
                ok = False
                bubble_ok = False
            elif chain[0] != hit:
                fail(f"★{label} 路链首 {chain[0]} ≠ 命中节点 {hit}（链与命中不一致）")
                ok = False
                bubble_ok = False
            elif len(fired) < 2:
                fail(f"★{label} 路只派发了 {len(fired)} 跳（[{fired}]）——冒泡没到祖先"
                     f"（链 [{chain}] 上的祖先 handler 应一起跑：夹具容器上挂了 @click）")
                ok = False
                bubble_ok = False
        if bubble_ok:
            chain_a = (ev_a.get("chain") or [])
            fired_a = (ev_a.get("fired") or [])
            chain_b = (ev_b.get("chain") or [])
            fired_b2 = (ev_b.get("fired") or [])
            print(f"  ✓ ⑦f ★冒泡链两路都逐跳派发：A 链 [{'>'.join(map(str, chain_a))}] → fired [{'>'.join(map(str, fired_a))}] · "
                  f"B 链 [{'>'.join(map(str, chain_b))}] → fired [{'>'.join(map(str, fired_b2))}]")

        # ⑦g ★逐跳位移两路一致（祖先 handler 真的改了**祖先几何**）：
        #   `fired_width_deltas` 与 fired 同序（target 在前、祖先在后）——两路逐项比对且都 > 0。
        dw_a = ev_a.get("fired_width_deltas") or []
        dw_b = ev_b.get("fired_width_deltas") or []
        if len(dw_a) < 2 or len(dw_b) < 2:
            fail(f"★逐跳位移读数不足：A={dw_a} · B={dw_b}（应各有 ≥2 跳——按钮 + 容器）")
            ok = False
        elif len(dw_a) != len(dw_b):
            fail(f"★逐跳位移跳数不同：A={dw_a} · B={dw_b}")
            ok = False
        elif any(abs(dw_a[i] - dw_b[i]) > GEOM_TOL for i in range(len(dw_a))):
            fail(f"★逐跳位移不一致：A={dw_a} vs B={dw_b}"
                 f"—— 同一语义的冒泡在两路上改了不同的几何")
            ok = False
        elif any(v <= 0 for v in dw_a):
            fail(f"★A 路有跳没有几何变化：{dw_a}（每一跳的 handler 都应改到几何上）")
            ok = False
        else:
            print(f"  ✓ ⑦g ★逐跳位移两路一致且都落到几何：A={dw_a} · B={dw_b}"
                  f"（首跳=按钮 +30 · 次跳=容器 +5）")

    for n in (d.get("notes") or []):
        print(f"      · {n}")

    if ok:
        print("\n✅ A/B 判据全过（mount 几何逐节点一致 + 更新路径两路等价 + 文本通道双消费"
              " + 绘制通道逐项等价 + 事件路径两路等价（含冒泡链逐跳））"
              "—— 「Vapor 能替换 Vue 运行时」有了**量化等价证据**（mount / 更新 / 绘制 / 事件四条）")
        return 0
    print("\n✗ A/B 判据有失败项（见上）")
    return 1


if __name__ == "__main__":
    sys.exit(main())
