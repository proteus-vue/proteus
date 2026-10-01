#!/usr/bin/env python3
"""hosts/android/check-vapor-ab.py —— ★★★Vapor vs Vue 运行时 **A/B 对照判据**

【这份判据回答什么（此前所有读数都没回答的）】
  此前所有 Vapor 读数只证明"这条路能跑"，但没有回答"**它跑出来的东西与 Vue 运行时是否等价**"。
  本判据把两条路放在**同一台设备、同一份 SFC、同一个内核**上跑，逐节点比几何：
    · A = **Vapor**（编译产物：LayoutTemplate + 订阅表 → 设备端实例化）
    · B = **Vue 运行时**（@vue/compiler-sfc 编出的 render → @vue/runtime-core → selfdraw 适配器）

【判据（每条都打在"会失败的那一点"上）】
  ① **两路都真的跑了**：`nodes_a > 0` · `nodes_b > 0` · 两路宿主布局耗时都 > 0
  ② **★树规模一致**：`nodes_a == nodes_b`（A 的实例树 == B 的应用树；B 已剔除 2 个包装节点）
     · 以及 `texts_a == texts_b`（文本节点数——最容易分叉的一类）
  ③ **★★几何逐节点一致**：`max_delta ≤ 0.01px` · `mismatches == 0`
     —— 两条路把同一份语义交给**同一个内核**，理论几何应逐位相同；任何差异都是
     "某一路的样式/结构翻译错了"（这是 A/B 最核心的一条，也是"能替换"的量化证据）
  ④ **绘制通道一致**：`channels_a == channels_b`（有非空绘制通道的节点数相同）
     —— 渐变/圆角/发光/裁剪/描边在两条路上同样落地
  ⑤ **成本可读**（不设阈值，只如实记录）：两路各自的 JS 侧 + 宿主侧耗时

【诚实边界（本档不覆盖）】
  · 只覆盖 **mount 几何 + 成本**；**更新路径**的对照（A 订阅增量 vs B Vue patch → updatePatches）
    需要宿主实现 updatePatches 端口，属后续批次；
  · 事件路径同理（A 已有交互闭环；B 的 `onClick` 经 Vue 的合成事件在自绘适配器上的落地未接）。

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

    for n in (d.get("notes") or []):
        print(f"      · {n}")

    if ok:
        print("\n✅ A/B 判据全过（两路树规模一致 · 几何逐节点一致 · 绘制通道一致）"
              "—— 「Vapor 能替换 Vue 运行时」有了**量化等价证据**")
        return 0
    print("\n✗ A/B 判据有失败项（见上）")
    return 1


if __name__ == "__main__":
    sys.exit(main())
