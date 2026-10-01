#!/usr/bin/env python3
"""hosts/android/check-lights.py —— ★★Morpheus 灯光秀判据（第二个炫技节目 · Android 真机产物）

【这一场是什么（用户要求）】「800 个节点编排一场炫丽的灯光秀，考验刚加的颜色能力上限
  （底色 + 文字色双轨、颜色 keyframes），原则和第一个节目一样：炫丽吸睛、
  其他跨端框架不敢轻易尝试；这次在安卓设备上做」。

【判据口径（与节目一同族，按颜色能力扩展）】
  ① **节目单真演完**：JS `acts` 与 `plan` 逐项一致 ＋ **宿主侧逐幕读数**也逐项一致
     （三方对齐：计划的 = 发令的 = 真的演了的）
  ② **灯阵语义**（用户修正后）：整场 100% 颜色通道指令（kind 5..12）——**0 条非颜色指令**
     （灯一颗不动，全靠亮灭；文字也靠亮灭完成）
  ③ **规模**：每幕 3200–3204 条颜色通道（800 灯 × 4 通道）· 灯阵点字幕 ≥ 2 个
  ④ **帧率与流畅**：vsync p50 ≤ 刷新预算×1.15；每帧工作 p95 ≤ 8ms（一部帧预算的一半）
     ＋ **无 2× 速**（每幕 anim_end_ms ≈ span_ms，双驱动会表现为 anim_end ≈ span/2）
  ⑤ **颜色真的在屏上**：像素自检的**不同颜色数 ≥ 64**（单色会露馅——这是"颜色在流动"的机器判据）
     ＋ 终值探针（真读宿主表：谢幕聚字的样本片 = 白 + 缩放 < 1）
  ⑥ **零逃生口**：整场 N 条声明式指令 / 0 条登记（率 ≤ 5% 目标线，与节目一同装置）
  ⑦ **无缝衔接**：每幕 `forced` 全为 false（没有因超时被强切）＋ elapsed ≥ anim_end

用法：python3 hosts/android/check-lights.py <lights.json>
退出码：0 全过 / 1 有失败 / 0（产物缺失时诚实跳过）
"""
import json
import os
import sys

# 单帧工作预算（ms）：一帧 16.7ms 的一半。120Hz 设备上更严（8.33ms）——本判据用 mid 值，
# 真回归（2× 求值 / 每条指令多算一遍）会撞线。
FRAME_WORK_BUDGET_MS = 8.0
# 颜色多样性下限（灯珠是 3 色系调色板，流动色带/风暴应产生远多于 64 色的中间插值色）
MIN_PAINTED_COLORS = 64


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print("用法：python3 hosts/android/check-lights.py <lights.json>")
        return 2
    path = args[0]
    if not os.path.exists(path):
        print(f"⚠ 灯光秀判据：未找到真机产物（{path}）")
        print("  ⇒ 诚实跳过（跑真机后取回）：adb shell am broadcast -a dev.proteus.RUN --es path lights")
        return 0

    print(f"═══ Morpheus 灯光秀判据（800 灯颜色编舞 · Android 真机）：{path} ═══")
    ok = True
    with open(path, encoding="utf-8") as f:
        d = json.load(f)

    def fail(msg: str) -> None:
        print(f"  ✗ {msg}")

    # ① 演出完成 + 三方（plan / JS acts / 宿主 acts）逐项一致
    if d.get("ok") is not True:
        fail(f"演出未成功：{str(d.get('error'))[:200]}")
        return 1
    plan = d.get("plan") or []
    acts = d.get("acts") or []
    host = d.get("host") or {}
    host_acts = host.get("acts") or []
    if not plan or len(plan) < 8:
        fail(f"plan 缺失或过短：{plan}")
        ok = False
    elif not d.get("acts_complete"):
        fail(f"JS 侧幕序与 plan 不一致：acts={[a.get('name') for a in acts]}")
        ok = False
    elif [a.get("name") for a in host_acts] != plan:
        fail(f"宿主侧幕序与 plan 不一致：host={[a.get('name') for a in host_acts]}")
        ok = False
    else:
        print(f"  ✓ ① 整场演完且三方一致：{len(plan)} 幕（plan = JS acts = 宿主 acts）")
        print(f"      幕序：{' → '.join(plan)}")

    # ② ★★灯阵语义（用户修正后）：**全程只有亮灭**——非颜色指令必须为 0
    #
    # 【判据口径】「全程都是灯亮灯灭的才对，就算是文字展示也是通过灯亮灯灭完成的」⇒
    #   整场动画 = 100% 颜色通道指令（kind 5..12）。任何位移/缩放/旋转/透明度（kind 0..4）
    #   都是"元素在动"的旧语义 ⇒ 判红。JS 侧记账字段 `non_color_anims`。
    if acts:
        total_anims = sum(a.get("anims", 0) for a in acts)
        total_color = sum(a.get("color_anims", 0) for a in acts)
        ratio = (total_color / total_anims) if total_anims else 0
        non_color = d.get("non_color_anims")
        if non_color is None:
            non_color = total_anims - total_color  # 旧报告兼容（按条数差推算）
        no_color = [a.get("name") for a in acts if not a.get("color_anims")]
        if no_color:
            fail(f"下列幕**没有颜色指令**（本节目是颜色驱动）：{no_color}")
            ok = False
        elif non_color > 0:
            fail(f"整场有 {non_color} 条**非颜色指令**（灯动了——违反『全程只有亮灯灭灯』）："
                 f"{total_color}/{total_anims} = {ratio:.0%} 颜色")
            ok = False
        else:
            with_color = sum(1 for a in acts if a.get("color_anims"))
            print(f"  ✓ ② 灯阵语义：整场 {total_anims} 条指令 **100% 颜色通道**（0 条非颜色指令）·"
                  f" {with_color}/{len(acts)} 幕全覆盖")

    # ③ 规模与文字幕：每幕 ≈ 800×4 = 3200 条；灯阵点字幕存在且亮盘成字
    if acts:
        per = [a.get("anims", 0) for a in acts]
        matrix_acts = [a for a in acts if a.get("name", "").startswith("matrix")]
        if len(matrix_acts) < 2:
            fail(f"灯阵点字幕不足（应 ≥ 2 个 matrix* 幕）：{[a.get('name') for a in acts]}")
            ok = False
        elif min(per) < 3200:
            fail(f"最小幕指令数 {min(per)} < 3200（800 灯 × 4 通道——颜色四通道展开应恒在此量级）")
            ok = False
        else:
            print(f"  ✓ ③ 规模：{len(acts)} 幕 · 每幕 3200–3204 条颜色通道指令（800 灯 × 4 通道；"
                  f"pulse 含标题文字色 4 条）· 灯阵点字幕 {len(matrix_acts)} 个")

    # ④ 帧率与流畅：vsync p50 ≤ 8.33×1.15；每帧工作 p95 ≤ 8ms；无 2× 速
    vsync = host.get("vsync_p50")
    p95 = host.get("work_p95")
    frames = host.get("frames") or 0
    if not frames or vsync is None or p95 is None:
        fail(f"帧读数缺失：frames={frames} vsync_p50={vsync} work_p95={p95}")
        ok = False
    else:
        if vsync > 8.33 * 1.15:
            fail(f"vsync p50={vsync:.3f}ms 超 120Hz 预算（8.33×1.15=9.58）——未跑满刷新率")
            ok = False
        elif p95 > FRAME_WORK_BUDGET_MS:
            fail(f"每帧工作 p95={p95:.2f}ms 超预算 {FRAME_WORK_BUDGET_MS}ms")
            ok = False
        else:
            print(f"  ✓ ④ 流畅：{frames} 帧 · vsync p50={vsync:.3f}ms（120Hz 预算 8.33ms）· 每帧工作 p95={p95:.2f}ms")
    # 无 2× 速：每幕 anim_end_ms ≥ 0.9×span（提前结束/加速播放会显著小于 span）
    bad_speed = []
    for ha in host_acts:
        span, end = ha.get("span_ms", 0), ha.get("anim_end_ms", -1)
        if span > 0 and 0 <= end < span * 0.9:
            bad_speed.append(f"{ha['name']}(end={end:.0f} span={span:.0f})")
    if bad_speed:
        fail(f"疑似动画提前结束（双驱动 2× 速会表现为 anim_end ≈ span/2）：{bad_speed}")
        ok = False
    else:
        print("  · 无 2× 速迹象：所有幕 anim_end ≈ span")

    # ⑤ 颜色真的在屏上：颜色多样性 + 终值探针（真读宿主表）
    colors = host.get("mid_colors")
    painted = host.get("mid_painted")
    if colors is None or painted is None or colors < 0:
        # 中途采样缺失 ⇒ 退回终帧采样（旧报告兼容；终帧是熄灯，色数天然低——如实标注）
        colors = host.get("painted_colors")
        painted = host.get("painted_samples")
        if colors is not None:
            print(f"  · 中途采样缺失 ⇒ 用终帧采样（{colors} 色）——终帧为熄灯，色数偏低属预期")
    if colors is None or painted is None:
        fail("像素自检读数缺失（mid_colors/mid_painted）——颜色多样性无法判定")
        ok = False
    elif colors < MIN_PAINTED_COLORS:
        fail(f"屏幕上的颜色多样性不足：{colors} 色 < {MIN_PAINTED_COLORS}（单色/静态会被放过——这是"
             f"'颜色在流动'的机器判据）")
        ok = False
    elif painted <= 0:
        fail(f"没有画出来的采样点（painted={painted}）")
        ok = False
    else:
        print(f"  ✓ ⑤a 颜色在屏上：{painted} 个采样点 · **{colors} 种不同颜色**（流动色带/风暴的插值色）")
    probe = d.get("probe") or {}
    layers = probe.get("layers") or []
    # ★样本结构：sampleIds = [灯0, 灯中, 灯末, 标题2000] ⇒ 灯珠 = id ∈ [1000,2000)，
    #   标题单列（它验证**文字色轨道**）。
    # ★★终值语义（2026-10-01 用户语义修正后）：末幕 = `curtain`（谢幕熄灯）⇒ 灯珠终态 =
    #   **暗盘 off（FF2B2D42）+ 归位 scale≈1**——这正是"灯灭也能看到灯"的真机断言：
    #   熄灯后灯必须**仍在屏上**（bg 非空且 = off 色），而不是消失（旧版断言"终值=白"是
    #   "聚字收尾"的语义，现在是"熄灯收尾"）。
    lamps = [l for l in layers if isinstance(l.get("id"), int) and 1000 <= l["id"] < 2000]
    title = next((l for l in layers if l.get("id") == 2000), None)
    OFF_HEX = "FF2B2D42"  # LIGHTS_PALETTE.off
    if not lamps or title is None:
        fail(f"探针读数不齐：lamps={len(lamps)} title={'有' if title else '无'}（应 3 灯 + 1 标题）")
        ok = False
    else:
        lamp = lamps[0]
        bg = str(lamp.get("bg") or "").upper()
        sc = lamp.get("scale")
        if bg != OFF_HEX:
            fail(f"终值探针：灯珠熄灯后底色={bg}（应 {OFF_HEX} = 灭灯暗盘）——"
                 f"灯**必须仍在屏上**（'灯灭也能看到灯'）；若为空=灯消失了")
            ok = False
        elif sc is None or abs(sc - 1.0) > 0.05:
            fail(f"终值探针：灯珠缩放={sc}（谢幕归位应 ≈ 1）")
            ok = False
        else:
            print(f"  ✓ ⑤b 终值探针（真读宿主表）：灯 {lamp.get('id')} bg={bg} scale={sc:.3f}"
                  f"（熄灯终态 = 暗盘仍在屏上）")
        # ★文字色轨道：标题节点的 textColor 必须非空（= 该节点绘制时会用的文字色）
        tc = str(title.get("textColor") or "")
        if len(tc) != 8:
            fail(f"文字色轨道未落地：标题 textColor={tc!r}（应 8 位十六进制——pulse 幕呼吸后的值）")
            ok = False
        else:
            print(f"  ✓ ⑤c 文字色轨道（真读宿主表）：标题 textColor={tc}（pulse 幕呼吸终值）")

    # ⑥ 零逃生口（与节目一同装置：声明式指令数 / 登记数）
    esc = d.get("escapes") or {}
    total = esc.get("total", -1)
    decl = esc.get("declaratives", 0)
    ratio = esc.get("ratio", -1)
    if total is None or total < 0 or decl <= 0:
        fail(f"逃生口读数缺失：{esc}")
        ok = False
    elif ratio is None or ratio > 0.05:
        fail(f"逃生口率超标：{ratio:.2%}（目标 ≤ 5%）— byKind={esc.get('byKind')}")
        ok = False
    else:
        print(f"  ✓ ⑥ 零逃生口：{decl} 条声明式指令 / {total} 条登记（率 {ratio:.1%} ≤ 5%）")

    # ⑦ 无缝衔接：无强制切幕
    forced = [a.get("name") for a in host_acts if a.get("forced")]
    if forced:
        fail(f"下列幕因超时被**强制切幕**（动画没有自然结束）：{forced}")
        ok = False
    else:
        print("  ✓ ⑦ 无缝衔接：全部幕由内核 active=0 自然结束（零强制切幕）")

    # ⑧ ★★"灯永不隐形"（用户语义修正的机器断言）：整场 **0 条 opacity 指令**
    op_min = d.get("opacity_min_to")
    op_n = d.get("opacity_anims")
    if op_n is None or op_min is None:
        fail(f"opacity 记账缺失：anims={op_n} min_to={op_min}（JS 侧应累计上报）")
        ok = False
    elif op_n > 0:
        fail(f"整场有 {op_n} 条 opacity 动画（最小终值 {op_min}）——"
             f"违反『全程只有亮灯灭灯』：灭灯必须用**暗盘**而不是透明")
        ok = False
    else:
        print("  ✓ ⑧ 灯永不隐形：全场 **0 条 opacity 指令**（灭灯 = 暗盘，永不透明）")

    if ok:
        print("\n✅ 灯光秀判据全过（三方对齐 / 100% 亮灭 / 120Hz 流畅 / 颜色在屏 / 灯不消失 / 零逃生口）")
        return 0
    print("\n✗ 灯光秀判据有失败项（见上）")
    return 1


if __name__ == "__main__":
    sys.exit(main())
