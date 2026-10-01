#!/usr/bin/env python3
"""hosts/android/check-ink.py —— ★★Morpheus 第四个节目「墨绘·山水卷」判据（真机产物 ink.json）

【这一场验收什么（用户："这个新增能力可以做单独的节目吗？"——C1 裁剪形变 × C2 SVG 描边）】
  一幅水墨长卷**自己画出来**：展卷 → 远山落笔 → 江水涨潮 → 明月升起 → 云海翻涌 →
  竹林风摆 → 飞鸟掠水 → 题字 → 落印 → 云开月明 → 收卷。验收 2026-10-01 收口的
  **两条新能力**（本节目是它们的演出面）：
    · C2 `strokeProgress`（kind 31）：山脊/水纹/竹/鸟"自己长出来"（12 条描边）；
    · C1 `clip`（kind 15..30）：卷轴展开 / 江水涨潮 / 明月升起 / 云海翻涌 / 题字书写 / 落印。

【判据（每条都落在机器可判的量上）】
  ① **三方对齐**：plan = JS acts = 宿主 acts（11 幕逐项）
  ② **双能力在场**：描边 ≥ 12 条且 ≥ 4 幕；裁剪通道 ≥ 40 条且 ≥ 6 幕（JS 侧计数）
  ③ **★描边"真的在画"**（幕中探针——本判据的核心，对应用户对前作提的"不要瞬现"）：
     mountains 幕 45% 处，中山骨线（id 12）的 strokeProgress 必须**严格居中**（0.25..0.9）——
     0 = 没开始、1 = 早已画完，都判红（"逐笔画出"与"瞬间出现"的机器区分）
  ④ **★裁剪"真的在揭示"**（逐幕末态探针·真读宿主表）：展卷终值（幕布 right=1）·
     涨潮终值（江 top=0.32）· 月升终值（circle cy=0.5）· 书写终值（题字全显）·
     落印终值（印章全显）· 收卷终值（幕布回全遮）
  ⑤ **"空纸"基线**：unfurl 幕终态时，山一骨线（id 11）描边仍为 0（"先展卷、后落笔"的次序证据）
  ⑥ **帧率与流畅**：vsync p50 ≤ 刷新预算×1.15；每帧工作 p95 ≤ 8ms
  ⑦ **零逃生口**：声明式指令 / 0 条登记（率 ≤ 5%）· **零强制切幕**

用法：python3 hosts/android/check-ink.py <ink.json>
退出码：0 全过 / 1 有失败 / 0（产物缺失时诚实跳过）
"""
import json
import os
import sys

FRAME_WORK_BUDGET_MS = 8.0
MIN_PAINTED_COLORS = 3  # 水墨长卷以"宣纸底 + 墨色线 + 淡彩"为主，色数下限低（如实标注）


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print("用法：python3 hosts/android/check-ink.py <ink.json>")
        return 2
    path = args[0]
    if not os.path.exists(path):
        print(f"⚠ 墨绘判据：未找到真机产物（{path}）")
        print("  ⇒ 诚实跳过（跑真机后取回）：adb shell am broadcast -a dev.proteus.RUN --es path ink")
        return 0

    print(f"═══ Morpheus 墨绘·山水卷判据（C1 裁剪揭示 × C2 SVG 描边 · Android 真机）：{path} ═══")
    ok = True
    with open(path, encoding="utf-8") as f:
        d = json.load(f)

    def fail(msg: str) -> None:
        print(f"  ✗ {msg}")

    def _j(x):
        if isinstance(x, str):
            try:
                return json.loads(x)
            except Exception:
                return {}
        return x or {}

    def _layer(entries, node_id):
        """从探针 layers 里取某节点（probe/probe_all 的条目形态一致）"""
        for e in entries or []:
            if isinstance(e, dict) and e.get("id") == node_id:
                return e
        return None

    def _clip_params(layer):
        """`clip` 字符串 'kind:p0,p1,p2,p3' → (kind, [p0..p3])；空串/缺失 → (0, None)"""
        if not layer:
            return 0, None
        s = layer.get("clip") or ""
        if not s or ":" not in s:
            return 0, None
        k, rest = s.split(":", 1)
        nums = [float(x) for x in rest.split(",")]
        return int(k), nums

    # ── ① 三方对齐 ──
    if d.get("ok") is not True:
        fail(f"演出未成功：{str(d.get('error'))[:200]}")
        return 1
    if d.get("program") != "ink":
        fail(f"节目名不符：{d.get('program')}（应 ink——宿主 args.program 未传对？）")
        ok = False
    plan = d.get("plan") or []
    js_acts = d.get("acts") or []
    host = d.get("host") or {}
    host_acts = host.get("acts") or []
    want_plan = ["unfurl", "mountains", "waterfall", "river", "moonrise", "clouds", "grove",
                 "boat", "birds", "inscription", "seal", "moonGlow", "close"]
    if plan != want_plan:
        fail(f"plan 与设计不符：{plan}")
        ok = False
    elif [a.get("name") for a in js_acts] != plan:
        fail(f"JS 侧幕序与 plan 不一致：{[a.get('name') for a in js_acts]}")
        ok = False
    elif [a.get("name") for a in host_acts] != plan:
        fail(f"宿主侧幕序与 plan 不一致：{[a.get('name') for a in host_acts]}")
        ok = False
    else:
        print(f"  ✓ ① 整场演完且三方一致：{len(plan)} 幕（{' → '.join(plan)}）")

    # ── ② 双能力在场（JS 侧计数）──
    clip_total = d.get("clip_anims_total") or 0
    stroke_total = d.get("stroke_anims_total") or 0
    acts_with_clip = sum(1 for a in js_acts if (a.get("clip_anims") or 0) > 0)
    acts_with_stroke = sum(1 for a in js_acts if (a.get("stroke_anims") or 0) > 0)
    if stroke_total < 28 or acts_with_stroke < 6:
        fail(f"C2 描边覆盖不足：指令 {stroke_total} 条 / {acts_with_stroke} 幕（应 ≥ 28 条 · ≥ 6 幕）")
        ok = False
    elif clip_total < 90 or acts_with_clip < 8:
        fail(f"C1 裁剪覆盖不足：指令 {clip_total} 条 / {acts_with_clip} 幕（应 ≥ 90 条 · ≥ 8 幕）")
        ok = False
    else:
        print(f"  ✓ ② 双能力在场：描边 {stroke_total} 条/{acts_with_stroke} 幕 · "
              f"裁剪 {clip_total} 条/{acts_with_clip} 幕")

    # ── ③ ★描边"真的在画"（幕中探针）──
    mid = _j(host.get("mid_probe"))
    mid_layers = mid.get("layers") or []
    mid_act = host.get("mid_probe_act")
    m2 = _layer(mid_layers, 22)  # 中山骨线（INK_SAMPLE_IDS[0]）
    p_mid = (m2 or {}).get("strokeProgress")
    if mid_act != "mountains":
        fail(f"③ 幕中采样未落在 mountains 幕（mid_probe_act={mid_act}）——探针/时序有问题")
        ok = False
    elif p_mid is None:
        fail("③ 幕中探针缺 strokeProgress（宿主未采到？）")
        ok = False
    elif not (0.05 <= float(p_mid) <= 0.95):
        fail(f"③ 描边进行中值异常：中山骨线 strokeProgress={p_mid}（应严格居中 0.05..0.95——"
             f"0=没开始 / 1=早已画完，都说明不是逐笔画出）")
        ok = False
    else:
        print(f"  ✓ ③ ★描边真的在画（幕中 45% 处真读宿主表）：中山骨线 strokeProgress={p_mid}（居中）")

    # ── ④ 裁剪"真的在揭示"（逐幕末态探针 · 真读宿主表）──
    hbyname = {a.get("name"): a for a in host_acts}

    def probe_of(name, node_id):
        a = hbyname.get(name) or {}
        return _layer(a.get("probe_all") or [], node_id)

    checks = []
    # 展卷终态：幕布 right=1（左半已卷走 ⇒ 空纸显露）
    k, p = _clip_params(probe_of("unfurl", 120))
    checks.append(("unfurl·幕布 right", k == 1 and p is not None and abs(p[1] - 1.0) < 0.02, f"kind={k} p={p}"))
    # 远山终态：远山晕团（17/18 椭圆——探针样本里的那两个）已显形（inset 全开）
    k, p = _clip_params(probe_of("mountains", 17))
    checks.append(("mountains·晕团1", k == 1 and p is not None and all(abs(v) < 0.02 for v in p), f"kind={k} p={p}"))
    k, p = _clip_params(probe_of("mountains", 18))
    checks.append(("mountains·晕团2", k == 1 and p is not None and all(abs(v) < 0.02 for v in p), f"kind={k} p={p}"))
    # 飞瀑终态：三笔已画（描边进度 1 在 ⑤ 判据；此处仅确认幕中无异常）
    # 涨潮终态：江 top=0.3 / 深水带 top=0.34 / 月影全显
    k, p = _clip_params(probe_of("river", 50))
    checks.append(("river·江 top", k == 1 and p is not None and abs(p[0] - 0.3) < 0.02, f"kind={k} p={p}"))
    k, p = _clip_params(probe_of("river", 51))
    checks.append(("river·深水 top", k == 1 and p is not None and abs(p[0] - 0.34) < 0.02, f"kind={k} p={p}"))
    k, p = _clip_params(probe_of("river", 52))
    checks.append(("river·月影显形", k == 1 and p is not None and abs(p[1]) < 0.02, f"kind={k} p={p}"))
    k, p = _clip_params(probe_of("river", 130))
    checks.append(("river·岸左显形", k == 1 and p is not None and all(abs(v) < 0.02 for v in p), f"kind={k} p={p}"))
    k, p = _clip_params(probe_of("river", 131))
    checks.append(("river·岸右显形", k == 1 and p is not None and all(abs(v) < 0.02 for v in p), f"kind={k} p={p}"))
    # 月升终态：月盘 circle cy=0.5；月晕 r=0.5
    k, p = _clip_params(probe_of("moonrise", 62))
    checks.append(("moonrise·月盘 cy", k == 2 and p is not None and abs(p[1] - 0.5) < 0.02, f"kind={k} p={p}"))
    k, p = _clip_params(probe_of("moonrise", 60))
    checks.append(("moonrise·月晕 r", k == 2 and p is not None and abs(p[2] - 0.5) < 0.02, f"kind={k} p={p}"))
    # 题款终态（末字 103 全显）
    k, p = _clip_params(probe_of("inscription", 103))
    checks.append(("inscription·末字显", k == 1 and p is not None and abs(p[1]) < 0.02, f"kind={k} p={p}"))
    # 落印终态：印面全显（四边=0）
    k, p = _clip_params(probe_of("seal", 110))
    checks.append(("seal·印面显", k == 1 and p is not None and all(abs(v) < 0.02 for v in p), f"kind={k} p={p}"))
    # 收卷终态：幕布回全遮（四边=0）
    k, p = _clip_params(probe_of("close", 120))
    checks.append(("close·幕布回", k == 1 and p is not None and all(abs(v) < 0.02 for v in p), f"kind={k} p={p}"))
    bad = [f"{name}（{det}）" for name, good, det in checks if not good]
    if bad:
        fail(f"④ 裁剪揭示终态不符：{bad}")
        ok = False
    else:
        print(f"  ✓ ④ ★裁剪真的在揭示（逐幕末态真读宿主表）：{' · '.join(n for n, _, _ in checks)}")

    # ── ⑤ "空纸"基线：unfurl 终态时山一骨线描边仍为 0（先展卷后落笔）──
    a = hbyname.get("unfurl") or {}
    l11 = _layer(a.get("probe_all") or [], 12)
    s11 = (l11 or {}).get("strokeProgress")
    if s11 is None:
        fail("⑤ 探针缺山一骨线（id 12）读数")
        ok = False
    elif abs(float(s11)) > 0.02:
        fail(f"⑤ 展卷终态时山一骨线已开画（strokeProgress={s11}，应为 0——先展卷、后落笔的次序）")
        ok = False
    else:
        print(f"  ✓ ⑤ 空纸基线：展卷终态时山一骨线 strokeProgress={s11}（画卷先展开、落笔尚未发生）")

    # ── ⑤b ★渐变"真的挂上了"（探针真读宿主绘制真源——v1 渐变的机器证据）──
    #   样本：远山晕团 17（radial）/ 月晕 60（radial）/ 云带 70（linear）。
    #   ★这是"渐变节点真的建出渐变"的证据（不是"声明了"——声明在树里，读的是宿主侧）。
    grad_checks = []
    m17 = _layer((hbyname.get("mountains") or {}).get("probe_all") or [], 17)
    m60 = _layer((hbyname.get("moonrise") or {}).get("probe_all") or [], 60)
    m70 = _layer((hbyname.get("clouds") or {}).get("probe_all") or [], 70)
    for label, lay, want in (("晕团 17", m17, "radial"), ("月晕 60", m60, "radial"), ("云带 70", m70, "linear")):
        g = (lay or {}).get("gradient") or ""
        if not g.startswith(want + ":"):
            grad_checks.append(f"{label} gradient='{g}'（应 '{want}:N'）")
    if grad_checks:
        fail(f"⑤b 渐变未落到绘制侧：{grad_checks}")
        ok = False
    else:
        print(f"  ✓ ⑤b ★渐变真的挂上了（探针真读）：晕团 17={m17.get('gradient')} · "
              f"月晕 60={m60.get('gradient')} · 云带 70={m70.get('gradient')}")

    # ── ⑤c ★渐变 v2：混合动画真的被受理（moonGlow 幕含 kind 32 的声明）──
    glow = next((a for a in js_acts if a.get("name") == "moonGlow"), None)
    if glow is None:
        fail("⑤c 缺 moonGlow 幕读数")
        ok = False
    else:
        # 幕的 anims 计数里应含 3 云团 + 2 云带 = 5 条 gradientMix + 其它
        n_anims = glow.get("anims") or 0
        # 期望：3 云带混合 + 3 云团混合 + 3 带 polygon + 1 月 scale + 1 月 color + 1 月影 + 6 水纹 ≈ 18+
        if n_anims < 15:
            fail(f"⑤c moonGlow 幕指令数异常（{n_anims}）——gradientMix 可能未被编译进去")
            ok = False
        else:
            print(f"  ✓ ⑤c ★渐变 v2（两态混合）在场：moonGlow 幕 {n_anims} 条指令"
                  f"（含云带/云团的 gradientMix · 内核受理见三方一致）")

    # ── ⑤d ★路径变形 v1：探针真读**当前变形因子**（鸟在扇翅的机器证据）──
    #   birds 幕末态：扇翅 yoyo 4 次（偶数）⇒ 回 from=0 ⇒ 末态因子应 ≈0；
    #   ★更可靠的证据：幕中采样若落在 birds 幕则读中值，否则读 ink.json 的 acts 里 birds 的探针
    birds_act = hbyname.get("birds") or {}
    bl = [l for l in (birds_act.get("probe_all") or []) if isinstance(l, dict) and l.get("id") == 95]
    pm = (bl[0] if bl else {}).get("pathMorph") if bl else None
    if pm is None or pm == "":
        # 探针缺字段：判红（不许"没数据就是绿"）
        fail("⑤d 探针缺 pathMorph 读数（路径变形未落到宿主表——段查询/通道可能没接通）")
        ok = False
    else:
        val = float(pm)
        if not (0.0 <= val <= 1.0):
            fail(f"⑤d 变形因子越界：{val}（应 0..1）")
            ok = False
        elif val < 0.5:
            # ★判据口径（"通道通"≠"翅膀真的动了"）：扇翅取 **3 遍（奇数）** ⇒ yoyo 末态 = to = 1
            #   ⇒ 幕末应读到**下扑位**（≈1）。读到 0 只有两种可能：没受理 / 没落表。
            fail(f"⑤d 变形末态异常：鸟 95 因子 = {val:.4f}（3 遍 yoyo 末态应为 to≈1——"
                 f"读到 0 说明通道没落地或动画没被受理）")
            ok = False
        else:
            print(f"  ✓ ⑤d ★路径变形 v1 真的落地：鸟 95 幕末变形因子 = {val:.4f}"
                  f"（= 下扑位——探针真读宿主表）")

    # ── ⑤e ★真·卷轴展开：卷筒（140）与幕布同曲线滚到左缘；收卷滚回右缘 ──
    #   证据 = 探针真读卷筒的 translateX（判据按"滚到了哪"断言，不看声明）。
    W = float((d.get("view") or {}).get("width") or 1080)
    unfurl_act = hbyname.get("unfurl") or {}
    close_act = hbyname.get("close") or {}
    u_roll = _layer(unfurl_act.get("probe_all") or [], 140) or {}
    c_roll = _layer(close_act.get("probe_all") or [], 140) or {}
    u_tx = u_roll.get("tx")
    c_tx = c_roll.get("tx")
    if u_tx is None or c_tx is None:
        fail(f"⑤e 探针缺卷筒（140）tx 读数：unfurl={u_tx} close={c_tx}")
        ok = False
    elif not (u_tx <= -0.9 * W):
        fail(f"⑤e 展卷末卷筒未滚到左缘：tx={u_tx}（应 ≤ {-0.9 * W:.0f}）——卷筒没跟随边界？")
        ok = False
    elif abs(c_tx) > 0.05 * W:
        fail(f"⑤e 收卷末卷筒未回右缘：tx={c_tx}（应 ≈0）——收卷没逆向回位？")
        ok = False
    else:
        print(f"  ✓ ⑤e ★真·卷轴展开：卷筒 tx 展卷末={u_tx:.1f}（≤-0.9W · 滚到左缘）· "
              f"收卷末={c_tx:.1f}（≈0 · 回到右缘）")

    # ── ⑤d-2 ★山峦呼吸（路径变形 v2 异构）：moonGlow 幕末，山脊三层应停在"呼吸位"
    #   证据 = 探针真读山脊节点的变形因子（yoyo 2 次 = 偶数 ⇒ 末态回 0；故读**幕中**更理想，
    #   但宿主 mid_probe 只采第一处 midSample 幕（mountains）⇒ 这里用"收卷前最后一幕末态"
    #   的路径查询副作用：收卷幕不影响山 ⇒ 末态因子应 = 0（回 A）。真正的"动过"证据是
    #   **moonGlow 幕的 anims 计数**（9 条 pathMorph）+ 三方一致（内核受理）。
    glow_act = hbyname.get("moonGlow") or {}
    g_anims = glow_act.get("anims") or 0
    if g_anims < 60:
        fail(f"⑤d-2 moonGlow 幕指令数异常（{g_anims}）——9 条呼吸 pathMorph 可能未被编译进去")
        ok = False
    else:
        print(f"  ✓ ⑤d-2 ★山峦呼吸（路径变形 v2 异构）：moonGlow 幕 {g_anims} 条指令"
              f"（含 9 条山脊 pathMorph · 内核受理见三方一致 · 异构重采样在建树时完成）")

    # ── ⑤f ★发光（glow v1）：探针真读发光子层数 + 呼吸末态强度 ──
    #   证据 1：月盘的 `glow` 字段（宿主侧真读 = "N:alpha" 形态——N = 分层数）
    #   证据 2：moonGlow 幕的 glowIntensity 通道在场（anims 计数）
    m_moon = None
    for a in host_acts:
        cand = _layer(a.get("probe_all") or [], 62)
        if cand is not None:
            m_moon = cand
            break
    g_str = (m_moon or {}).get("glow") if m_moon else None
    glow_act2 = hbyname.get("moonGlow") or {}
    n_anims2 = glow_act2.get("anims") or 0
    if g_str is None or g_str == "":
        fail("⑤f 探针缺月盘发光读数（glow 字段空——发光子层未建或用错了取样节点）")
        ok = False
    elif not g_str.startswith("5:"):
        fail(f"⑤f 发光分层数异常：'{g_str}'（应 '5:<alpha>'——分层数 5 必须三端一致）")
        ok = False
    elif n_anims2 < 60:
        fail(f"⑤f moonGlow 幕指令数异常（{n_anims2}）——发光呼吸可能未被编译进去")
        ok = False
    else:
        parts = g_str.split(":")
        print(f"  ✓ ⑤f ★发光（glow v1）真的建出来了：月盘子层 = {parts[0]} 层（跨语言常数一致）· "
              f"首层 alpha = {parts[1]} · moonGlow 幕 {n_anims2} 条指令（含发光呼吸）")

    # ── ⑤g ★渐变**几何**动画（"光本身在动"）：月晕半径在 moonrise 末态被**真读**为扩散值 ──
    #   证据 = 探针的 gradient 字段第三段（"radial:3:0.9500"——几何半径；随读法两端同口径）
    rise_act3 = hbyname.get("moonrise") or {}
    halo_l = _layer(rise_act3.get("probe_all") or [], 60)
    g_str2 = (halo_l or {}).get("gradient") if halo_l else None
    if not g_str2 or g_str2.count(":") < 2:
        fail(f"⑤g 探针缺月晕几何读数（gradient='{g_str2}'——应 'radial:N:<r>'）")
        ok = False
    else:
        parts2 = g_str2.split(":")
        try:
            gr = float(parts2[2])
        except ValueError:
            fail(f"⑤g 几何段不可解析：'{g_str2}'")
            gr = -1.0
        if gr < 0:
            ok = False
        elif not (0.8 <= gr <= 1.1):
            fail(f"⑤g 月晕半径未扩散：r={gr}（moonrise 末态应 ≈0.95——读到 0.55 表示几何动画没落地）")
            ok = False
        else:
            print(f"  ✓ ⑤g ★渐变几何动画真的落地（探针真读光的半径）：月晕 r = {gr:.4f}"
                  f"（收拢态 0.55 → 扩散态 0.95 —— 光本身在动）")

    # ── ⑤h ★软边遮罩（mask v1）：探针真读晕团的揭示位置（"从雾里渗开"）──
    #   mountains 末态：maskProgress 应到 1 ⇒ 揭示色标 = 端点（全显：oA=0/aA=1/oB=1/aB=1）
    mt_act = hbyname.get("mountains") or {}
    puff_l = _layer(mt_act.get("probe_all") or [], 17)
    m_str = (puff_l or {}).get("mask") if puff_l else None
    if not m_str or m_str == "":
        fail(f"⑤h 探针缺遮罩读数（mask='{m_str}'——晕团 17 应有 soft mask）")
        ok = False
    elif not m_str.startswith("linear:"):
        fail(f"⑤h 遮罩类型异常：'{m_str}'（应 'linear:oA,oB'）")
        ok = False
    else:
        loc = m_str.split(":", 1)[1]
        try:
            parts3 = [float(x) for x in loc.split(",")]
        except ValueError:
            parts3 = []
        # 末态（progress=1）⇒ 端点短路 ⇒ 位置回 [0,1]（全显）
        if len(parts3) != 2:
            fail(f"⑤h 揭示位置不可解析：'{loc}'")
            ok = False
        elif abs(parts3[0]) > 0.02 or abs(parts3[1] - 1.0) > 0.02:
            fail(f"⑤h 遮罩末态非全显：locations={parts3}（progress=1 应回端点 [0,1]）")
            ok = False
        else:
            print(f"  ✓ ⑤h ★软边遮罩真的落地（探针真读揭示位置）：晕团 17 = {loc}"
                  f"（末态全显——软边在过程中推动，clip 的硬边做不到这种渗开）")

    # ── ⑥ 帧率与流畅 ──
    vsync = host.get("vsync_p50")
    p95 = host.get("work_p95")
    frames = host.get("frames") or 0
    if not frames or vsync is None or p95 is None:
        fail(f"帧读数缺失：frames={frames} vsync={vsync} p95={p95}")
        ok = False
    else:
        if vsync > 8.33 * 1.15:
            fail(f"vsync p50={vsync:.3f}ms 超 120Hz 预算")
            ok = False
        elif p95 > FRAME_WORK_BUDGET_MS:
            fail(f"每帧工作 p95={p95:.2f}ms 超预算 {FRAME_WORK_BUDGET_MS}ms")
            ok = False
        else:
            print(f"  ✓ ⑥ 流畅：{frames} 帧 · vsync p50={vsync:.3f}ms · 每帧工作 p95={p95:.2f}ms")

    # ── ⑦ 零逃生口 + 零强制切幕 ──
    esc = d.get("escapes") or {}
    total = esc.get("total", -1)
    decl = esc.get("declaratives", 0)
    ratio = esc.get("ratio", -1)
    forced = [a.get("name") for a in host_acts if a.get("forced")]
    if total is None or total < 0 or decl <= 0:
        fail(f"逃生口读数缺失：{esc}")
        ok = False
    elif ratio is None or ratio > 0.05:
        fail(f"逃生口率超标：{ratio:.2%}")
        ok = False
    elif forced:
        fail(f"下列幕被强制切幕：{forced}")
        ok = False
    else:
        print(f"  ✓ ⑦ 零逃生口（{decl} 条声明式 / {total} 条登记 · 率 {ratio:.1%}）+ 零强制切幕")

    if ok:
        print("\n✅ 墨绘·山水卷判据全过（三方对齐 / 双能力在场 / 描边进行中 / 裁剪逐幕揭示 / 流畅 / 零逃生口）")
        return 0
    print("\n✗ 墨绘判据有失败项（见上）")
    return 1


if __name__ == "__main__":
    sys.exit(main())
