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
  ④ **绘制通道齐备**（A 侧 ≥5：夹具里 5 个通道各一节点）
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

【诚实边界（本档不覆盖）】
  · 事件路径（A 已有交互闭环；B 的 `onClick` 经 Vue 的合成事件在自绘适配器上的落地未接）；
  · B 侧绘制通道的**逐项等价**（探针口径未按 B 的 paintHint 形态对齐，只报"非空通道数"）。

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

    # ── ④ 绘制通道一致 ──
    ca, cb = d.get("channels_a", -1), d.get("channels_b", -1)
    if ca is None or cb is None or ca < 0 or cb < 0:
        fail(f"绘制通道读数缺失：A={ca} · B={cb}")
        ok = False
    elif ca < 5:
        # A 侧必须 ≥5（夹具里 5 个通道各一节点）；B 侧**探针口径不同**（适配器把绘制属性
        # 放在 paintHint 上，且探针按 id 查 Cmd 表），故只要求 A 达标，B 如实报出——
        # ★诚实边界：两侧绘制通道的**逐项等价**需要 B 侧的探针口径对齐（后续批次）
        fail(f"A 侧绘制通道不足：{ca} 个节点有非空通道（应 ≥5——夹具里 5 个通道各一节点）")
        ok = False
    else:
        print(f"  ✓ ④ A 侧绘制通道齐备（{ca} 个节点）；B 侧 {cb} 个"
              f"（★诚实边界：B 侧探针口径未对齐——绘制通道的逐项等价属后续批次）")

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

    for n in (d.get("notes") or []):
        print(f"      · {n}")

    if ok:
        print("\n✅ A/B 判据全过（mount 几何逐节点一致 + 更新路径两路等价 + 文本通道双消费）"
              "—— 「Vapor 能替换 Vue 运行时」有了**量化等价证据**（含更新路径）")
        return 0
    print("\n✗ A/B 判据有失败项（见上）")
    return 1


if __name__ == "__main__":
    sys.exit(main())
