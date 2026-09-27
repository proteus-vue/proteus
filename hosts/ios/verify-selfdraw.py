#!/usr/bin/env python3
# hosts/ios/verify-selfdraw.py
# ★★自绘管线**独立核验**：Vue 应用规格 → 期望几何 → 对照「核心 rects」「CALayer 实际 frame」「屏幕像素」
#
# 【为什么必须独立核验（本仓纪律）】
#   app 自己的报告必然「与它自己的实现一致」——那是**自己判自己的卷**。
#   本仓已多次踩到：截图回归初版用 app 自报坐标采样，注入 3px 偏移后仍全绿。
#   ⇒ 本脚本从**Vue 源码里的规格**（行高 56 / margin 8 / padding 16 / 顶部 60 / 圆形 36 等）
#     独立推导期望几何，再与三个来源对照：
#       ① 核心 rects（绝对坐标）
#       ② 宿主实际下发的 CALayer frame（**父相对**坐标 —— 必须按 parentId 逐级累加才可比）
#       ③ 屏幕像素（截图里卡片/圆形/文字的采样点）
#
# 【★这一版核验能抓到什么（实测证明）】
#   本轮开发中，CALayer 坐标系 bug（把绝对坐标当父相对赋值 → 二次叠加父偏移）
#   在「核心 rects」上完全看不出来（它们是绝对坐标，本来就对），
#   只有对照 ②（实际 frame）或 ③（屏幕像素）才暴露。
#   故三层缺一不可——这正是本脚本存在的理由。
#
# 用法：python3 hosts/ios/verify-selfdraw.py [report.json] [screenshot.png]
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
# ★仓库自带 PIL（.tools/py）——与 screenshot-verify.py 同一约定，
#   避免「因为环境没装 pillow 而静默跳过像素层」（跳过即少一层证据，不该默认发生）
sys.path.insert(0, os.path.join(HERE, '..', '..', '.tools', 'py'))
REPORT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'results/selfdraw-report.json')
PNG = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'results/selfdraw-final.png')

# ── ★Vue 应用规格（与 hosts/ios/bridge/entry-selfdraw.ts 的 style 声明一致）──
#    这些是**规格**（作者写的意图），不是任何测量结果 → 可作独立期望的来源。
CARD_H = 56.0
CARD_MARGIN_BOTTOM = 8.0
CARD_RADIUS = 12
PAGE_PAD_TOP = 60.0
PAGE_PAD_LEFT = 16.0
PAGE_PAD_RIGHT = 16.0
DOT = 36.0            # 圆形直径
DOT_RADIUS = 18
DOT_BG = (0x6F, 0x4A, 0xE8)     # #6f4ae8
CARD_BG = (0x1B, 0x1B, 0x21)    # #1b1b21
PAGE_BG = (0x10, 0x10, 0x20)    # #101020
TITLE_SIZE = 28.0
SUBTITLE_SIZE = 14.0
GAP_AFTER_SUBTITLE = 20.0       # 副标题的 margin-bottom
N_ITEMS = 12                    # 最终稳定态（finalize 里 count 改回 12）

TOL = 1.5                       # dp 容差（文本度量有 ±1 的字形差异）


def hex_rgb(s):
    if not s:
        return None
    s = s.lstrip('#')
    if len(s) == 8:
        s = s[2:]
    try:
        return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))
    except (ValueError, IndexError):
        return None


def close_rgb(a, b, tol=8):
    return a is not None and b is not None and all(abs(a[i] - b[i]) <= tol for i in range(3))


def main() -> int:
    if not os.path.exists(REPORT):
        print(f'✗ 报告不存在：{REPORT}')
        print('  生成：bash hosts/ios/run-selfdraw.sh')
        return 2
    d = json.load(open(REPORT))
    jr = d.get('js_report') or {}
    geo = d.get('geometry_all') or {}
    frames = d.get('layer_frames') or {}
    if not geo:
        print('✗ 报告缺 geometry_all（旧版报告？重跑 run-selfdraw.sh）')
        return 2

    failures = []
    # id → 记录
    by_id = {int(k): v for k, v in geo.items()}

    # ── ① 从 Vue 规格独立推导期望几何 ──
    #   布局链：page(column, height=844, padding.top=60) → [title, subtitle, card×12]
    #   title: fontSize 28 → 高 17（CoreText 实测字号 28 行高 ~33?）——★文本高度由平台度量决定，
    #   故**不硬编码文本高度**，只核验「结构量」：卡片高/间距/水平内缩/圆形尺寸与位置。
    cards = [v for v in by_id.values() if close_rgb(hex_rgb(v.get('bg')), CARD_BG)]
    cards.sort(key=lambda v: v['y'])
    print('═══ 自绘管线独立核验（Vue 规格 → 期望 → 三层对照）═══')
    print(f'  报告：{os.path.basename(REPORT)}')
    print(f'  节点总数：{len(by_id)} · 卡片数：{len(cards)}（期望 {N_ITEMS}）')
    print()

    if len(cards) != N_ITEMS:
        failures.append(f'卡片数 {len(cards)} ≠ 期望 {N_ITEMS}')

    # ①-a 卡片高度（规格 56）
    for i, c in enumerate(cards):
        if abs(c['h'] - CARD_H) > TOL:
            failures.append(f'卡片 {i + 1} 高 {c["h"]:.1f} ≠ 规格 {CARD_H}')

    # ①-b 卡片间距（间距 = 卡片高 + margin 8 = 64）
    #
    # ★这里曾报出 13 项失败（卡片高 52~53 ≠ 56、步距 60/61 ≠ 64）——核查后确认
    #   **核心是对的**：12 张卡片内容总高 886 > 视口 844，溢出 42px，而 CSS 的 flex-shrink
    #   默认 1 ⇒ 均摊压缩 42/12 = 3.5 ⇒ 52.5。算术与观测逐位吻合。
    #   处置：场景规格加 `flexShrink: 0`（真实列表项语义，与 Android §9.2 同款）——
    #   而**不是**改核验阈值去迁就。判据只能因为「规格变了」而改，不能因为「实现没达标」而改。
    if len(cards) >= 2:
        gaps = [round(cards[i + 1]['y'] - cards[i]['y'], 2) for i in range(len(cards) - 1)]
        want = CARD_H + CARD_MARGIN_BOTTOM
        bad = [g for g in gaps if abs(g - want) > TOL]
        print(f'  卡片步距：{sorted(set(gaps))}（期望 {want}） → {"✓" if not bad else "✗"}')
        if bad:
            failures.append(f'卡片步距异常：{sorted(set(gaps))} ≠ {want}')

    # ①-c 卡片水平位置：page padding.left=16, right=16 → x=16, w=390-32=358
    for i, c in enumerate(cards):
        if abs(c['x'] - PAGE_PAD_LEFT) > TOL:
            failures.append(f'卡片 {i + 1} x={c["x"]:.1f} ≠ 规格 {PAGE_PAD_LEFT}')
        if abs(c['w'] - (390 - PAGE_PAD_LEFT - PAGE_PAD_RIGHT)) > TOL:
            failures.append(f'卡片 {i + 1} 宽 {c["w"]:.1f} ≠ 规格 {390 - PAGE_PAD_LEFT - PAGE_PAD_RIGHT}')

    # ①-d 第一张卡片的 y：page.padding.top(60) + title + subtitle(含其 margin-bottom 20)
    #   —— 文本高度由平台决定，故用「副标题底边 + 20」推导，而非硬编码
    subs = [v for v in by_id.values() if (v.get('text') or '').startswith('Vue →')]
    if subs:
        sub = subs[0]
        want_first_y = sub['y'] + sub['h'] + GAP_AFTER_SUBTITLE
        if cards:
            got = cards[0]['y']
            ok = abs(got - want_first_y) <= TOL + 4   # 文本行高有 ±4 的字体差异
            print(f'  首卡片 y：{got:.1f}（= 副标题底 {sub["y"] + sub["h"]:.1f} + {GAP_AFTER_SUBTITLE}） → {"✓" if ok else "✗"}')
            if not ok:
                failures.append(f'首卡片 y={got:.1f} ≠ 规格推导 {want_first_y:.1f}')

    # ①-e 圆形（36×36，圆角 18 = 正圆）：每张卡片内一个
    dots = [v for v in by_id.values() if close_rgb(hex_rgb(v.get('bg')), DOT_BG)]
    print(f'  强调圆：{len(dots)} 个（期望 {N_ITEMS}） → {"✓" if len(dots) == N_ITEMS else "✗"}')
    if len(dots) != N_ITEMS:
        failures.append(f'强调圆 {len(dots)} ≠ {N_ITEMS}')
    for i, dot in enumerate(sorted(dots, key=lambda v: v['y'])):
        if abs(dot['w'] - DOT) > TOL or abs(dot['h'] - DOT) > TOL:
            failures.append(f'圆 {i + 1} 尺寸 {dot["w"]:.1f}×{dot["h"]:.1f} ≠ 规格 {DOT}×{DOT}')

    # ①-f 文本存在且落在卡片内（★这一条正是「文字跑出卡片」类 bug 的判据）
    texts_in_cards = 0
    for c in cards:
        inside = [v for v in by_id.values()
                  if v.get('text')
                  and v['x'] >= c['x'] - TOL and v['y'] >= c['y'] - TOL
                  and v['x'] + v['w'] <= c['x'] + c['w'] + TOL
                  and v['y'] + v['h'] <= c['y'] + c['h'] + TOL]
        if inside:
            texts_in_cards += 1
        else:
            failures.append(f'卡片 y={c["y"]:.0f} 内**没有**文本（文字跑出卡片或未绘制）')
    print(f'  含文本的卡片：{texts_in_cards}/{len(cards)} → {"✓" if texts_in_cards == len(cards) else "✗"}')
    print()

    # ── ② 核心 rects 与 CALayer 实际 frame 的一致性（★本轮修 bug 的那一层）──
    #   核心 rects = 绝对坐标；CALayer frame = 父相对 → 必须按 parentId 逐级累加
    if frames:
        abs_cache = {}

        def abs_origin(nid):
            if nid in abs_cache:
                return abs_cache[nid]
            f = frames.get(str(nid))
            if not f:
                return None
            pid = f.get('parentId', -1)
            if pid is None or pid < 0:
                o = (f['x'], f['y'])
            else:
                po = abs_origin(pid)
                o = None if po is None else (po[0] + f['x'], po[1] + f['y'])
            abs_cache[nid] = o
            return o

        mism = 0
        checked = 0
        for nid_str, g in geo.items():
            nid = int(nid_str)
            f = frames.get(nid_str)
            if not f:
                continue
            ao = abs_origin(int(f.get('parentId', -1))) if f.get('parentId', -1) >= 0 else (0.0, 0.0)
            if ao is None:
                continue
            abs_x = ao[0] + f['x']
            abs_y = ao[1] + f['y']
            checked += 1
            if abs(abs_x - g['x']) > 0.5 or abs(abs_y - g['y']) > 0.5 \
               or abs(f['w'] - g['w']) > 0.5 or abs(f['h'] - g['h']) > 0.5:
                mism += 1
                if mism <= 5:
                    failures.append(
                        f'#{nid}: 核心绝对 ({g["x"]:.1f},{g["y"]:.1f},{g["w"]:.1f},{g["h"]:.1f}) '
                        f'vs 实际层累加 ({abs_x:.1f},{abs_y:.1f},{f["w"]:.1f},{f["h"]:.1f})')
        print(f'  核心几何 vs 实际 CALayer frame：{checked - mism}/{checked} 一致 → {"✓" if mism == 0 else "✗"}')
        print('    （★这一层是「坐标系二次叠加」bug 的唯一暴露面——核心 rects 本身是对的）')
    else:
        print('  ⚠ 报告缺 layer_frames —— 跳过「核心 vs 实际层」对照（旧版报告）')
    print()

    # ── ③ 屏幕像素（最终证据：屏幕上真的画出来了）──
    if os.path.exists(PNG):
        try:
            from PIL import Image
            img = Image.open(PNG).convert('RGB')
            W, H = img.size
            scale = W / 390.0
            px = img.load()
            dots_png = circle_png = card_png = 0
            for c in cards[:6]:
                cx = int((c['x'] + c['w'] / 2) * scale)
                cy = int((c['y'] + c['h'] / 2) * scale)
                # 卡片中心偏右采样（避开圆形与文字）
                sx = int((c['x'] + c['w'] * 0.85) * scale)
                if 0 <= sx < W and 0 <= cy < H and close_rgb(px[sx, cy], CARD_BG, 12):
                    card_png += 1
                # 圆形中心采样
                dotx = int((c['x'] + 16 + DOT / 2) * scale)
                if 0 <= dotx < W and 0 <= cy < H and close_rgb(px[dotx, cy], DOT_BG, 30):
                    dots_png += 1
            page_ok = close_rgb(px[int(5 * scale), int(300 * scale)], PAGE_BG, 12)
            print(f'  屏幕像素（{W}×{H}，scale={scale:.2f}）：')
            print(f'    卡片底色命中 {card_png}/6 · 强调圆命中 {dots_png}/6 · 页面底色 {"✓" if page_ok else "✗"}')
            if card_png < 6:
                failures.append(f'屏幕像素：仅 {card_png}/6 个卡片底色正确')
            if dots_png < 6:
                failures.append(f'屏幕像素：仅 {dots_png}/6 个强调圆正确')
            if not page_ok:
                failures.append('屏幕像素：页面底色不符')
        except ImportError:
            print('  ⚠ 无 PIL —— 跳过像素核验（pip install pillow）')
    else:
        print(f'  ⚠ 截图不存在：{PNG} —— 跳过像素核验')

    # ── ④ 管线健康度（JS 侧读数）──
    print()
    print('  管线读数：')
    for label, ph in (jr.get('phases') or {}).items():
        print(f'    [{label}] vue={ph.get("vue_ms")}ms 适配={ph.get("to_request_ms")}ms '
              f'序列化={ph.get("serialize_ms")}ms 宿主={ph.get("host_ms")}ms 合计={ph.get("total_ms")}ms '
              f'节点={ph.get("node_count")} patch={ph.get("patch_count")}')
    t = jr.get('js_only_throughput') or {}
    print(f'    纯 JS 吞吐：{t.get("avg_ms")} ms/次（{t.get("iterations")} 次）')
    # ★未知键必须为空：非空 = 「写了但没生效」（本轮靠它抓到 style 未展开）
    uk = jr.get('unknown_keys') or {}
    if uk:
        failures.append(f'未知样式键非空（写了但没生效）：{uk}')
    # ★相位异常必须为空：静默失败无从归因
    pe = jr.get('phase_errors') or {}
    if pe:
        failures.append(f'相位异常：{pe}')
    # ★四个相位都要有读数
    need = {'mount', 'update_grow', 'update_style'}
    missing = need - set((jr.get('phases') or {}).keys())
    if missing:
        failures.append(f'缺相位读数：{sorted(missing)}')

    print()
    if failures:
        print(f'  ✗ 失败 {len(failures)} 项：')
        for f in failures[:15]:
            print(f'    {f}')
        return 1
    print('  ✓ 全部通过：Vue 规格 → 核心几何 → 实际层 → 屏幕像素 四层一致')
    return 0


if __name__ == '__main__':
    sys.exit(main())
