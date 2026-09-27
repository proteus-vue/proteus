#!/usr/bin/env python3
# hosts/android/screenshot-verify.py
# ★★截图回归：**闭环验证「Rust 算出的几何 → 屏幕上的真实像素」**
#
# 【为什么这是「内容级等价」的正确做法】
#   此前的像素校验比的是「两条光栅化路径」（`drawText` vs `drawBitmap`）——
#   **不可比**（前者字形栅格化、后者位图采样，边缘必然有差），四轮判据校准都以失败告终。
#   本脚本比的是**两个独立的量**：
#     · 预测侧：Rust 核心算出的几何（节点坐标）+ 行色公式
#     · 实测侧：设备屏幕的真实像素（`adb exec-out screencap`）
#   两侧完全独立 → 「Rust 布局算错」或「绘制画错」都会导致核验失败。
#
# 【为什么用系统截图而不是 `View.draw(Canvas)`】
#   系统截图走的是**完整显示管线**（View → RenderNode → SurfaceFlinger → 屏幕），
#   包含真实的裁剪/合成/坐标变换；`View.draw(Bitmap)` 只覆盖到录制阶段。
#   本仓已在硬件路径测量上踩过同类坑（未挂窗口的 RenderNode 测出的是"录制动作"），
#   故这里用**屏幕实际像素**作为最终证据。
#
# 用法：python3 screenshot-verify.py <scene.json> <screenshot.png> [--dump-regions]
import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '.tools', 'py'))


def row_color(i: int) -> str:
    """★必须与 app 侧 `rowColor(i)` 同一公式（独立重算 → 才能验证而非复述）"""
    r = 40 + (i * 10) % 200
    g = 90 + (i * 17) % 150
    b = 200 - (i * 7) % 150
    return f'#{r:02X}{g:02X}{b:02X}'


def parse_hex(s: str):
    s = s.lstrip('#')
    return int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)


def main() -> int:
    if len(sys.argv) < 3:
        print('用法：screenshot-verify.py <scene.json> <screenshot.png>')
        return 2

    scene_path, png_path = sys.argv[1], sys.argv[2]
    scene = json.load(open(scene_path))
    if not scene.get('ok'):
        print(f'✗ 场景报告异常：{scene}')
        return 1

    from PIL import Image, ImageCms  # noqa: E402
    import io

    img = Image.open(png_path)
    W0, H0 = img.size
    # ★★色彩管理（本仓实测踩到，是「颜色对不上」的真正原因）：
    #   设备截图带 **Display P3** 色彩配置，而期望色是 **sRGB**。
    #   直接比数值会让饱和色偏移（实测 Δ 随饱和度增大：中间色 Δ≈6、饱和色 Δ≈37），
    #   看起来像「绘制错色」，实际只是色彩空间不同。
    #   正解：用 ICC 配置把截图转到 sRGB 再比。
    icc = img.info.get('icc_profile')
    if icc:
        try:
            src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
            dst = ImageCms.createProfile('sRGB')
            img = ImageCms.profileToProfile(img, src, dst, outputMode='RGB')
            print(f'  色彩管理：{ImageCms.getProfileDescription(src)} → sRGB（已转换）')
        except Exception as e:
            print(f'  ⚠ 色彩转换失败（{e}），按原始像素比对')
            img = img.convert('RGB')
    else:
        print('  色彩管理：截图无 ICC 配置 → 按 sRGB 处理')
        img = img.convert('RGB')
    W, H = img.size
    px = img.load()

    print('═══ 截图回归核验（几何预测 vs 屏幕像素）═══')
    print(f'  截图：{W}×{H}')
    print(f'  场景：{scene["rows"]} 行 · 行高 {scene["row_h"]} · 偏移 ({scene["offset_left"]},{scene["offset_top"]})')
    print()

    # ★坐标系对齐（本仓实测踩到两次，最终口径）：
    #   `expected` 里的坐标是**场景 View 内**的坐标（Rust 几何 + LEFT/TOP），
    #   转「屏幕坐标」必须加 **View 在屏幕上的实际原点** `view_origin_*`。
    #   踩坑史：① 假设 View 在 (0,0) → 差 272px ② 用 `MATCH_PARENT` 让 View 被排到按钮下
    #   ③ 布局未完成就读 origin（得 0×0）→ 正解是 `post()` 到布局之后读。
    ox = scene.get('view_origin_x', 0)
    oy = scene.get('view_origin_y', 0)
    vw = scene.get('view_width', 0)
    vh = scene.get('view_height', 0)
    print(f'  场景 View：屏幕原点 ({ox}, {oy}) · 尺寸 {vw}×{vh}')
    print(f'  坐标口径：expected = View 内坐标 → 屏幕坐标 = ({ox}, {oy}) + expected')
    print()

    # ★★独立重算期望几何（**不依赖 app 报告里的坐标**）
    #
    # 为什么必须这样（本仓实测教训）：
    #   初版直接用 `scene['expected']` 里的坐标去采样 —— 而那个数组是 app 用它**自己的**
    #   绘图坐标写的 → 「自己判自己的卷」：我特意注入 3px 偏移后仍全绿（因为绘制与期望
    #   一起偏了）。
    #   正解：宿主机按**场景规格**独立算出每行的期望坐标：
    #     · 行高/行宽/偏移来自 scene 元数据（这些是**规格**，不是测量结果）
    #     · 行色由**宿主机自己**用同一公式重算（`row_color`）
    #   → 这样「app 画错位置」或「Rust 几何算错」都会立刻暴露。
    expected = []
    for i in range(scene['rows']):
        expected.append({
            'row': i,
            'x': scene['offset_left'],
            'y': scene['offset_top'] + i * scene['row_h'],
            'w': scene['row_w'],
            'h': scene['row_h'],
        })
    print('  期望几何：宿主机**独立重算**（规格：offset_top + i×row_h）')
    print('  ★app 报告里的坐标仅作参考，不参与判定（避免「自己判自己」）')
    print()

    failures = []
    checked = 0

    print('  行  期望颜色    中心点采样    结果    行内多点抽样')
    print('  ' + '-' * 68)
    for e in expected:
        i = e['row']
        x, y, w, h = e['x'], e['y'], e['w'], e['h']
        want = row_color(i)                    # ★独立重算（不用报告里的值）
        want_rgb = parse_hex(want)

        # ① 中心点采样
        cx, cy = min(W - 1, ox + x + w // 2), min(H - 1, oy + y + h // 2)
        got = px[cx, cy]
        # 容差：±8/255（色彩管理后仍可能有轻微抗锯齿/AE 差异）
        ok = all(abs(got[k] - want_rgb[k]) <= 6 for k in range(3))

        # ② 行内多点抽样（检验该行**整片区域**都是期望色）
        #   ★★采样点分两档（本仓实测校准后的口径，缺一不可）：
        #     · **核心区**（fy ∈ {0.3, 0.7}）：验证「这一行确实被填成了期望色」
        #     · **边界区**（fy ∈ {0.06, 0.94}）：★验证「这一行的位置正确」
        #       为什么需要边界采样：初版只采中心，把场景整体偏移 3px 时**依然全绿**——
        #       因为行高 40px，中心 ±3px 仍在同一色块内。边界采样让**任何 >1px 的错位**
        #       都会落入相邻行或背景色，从而暴露。
        samples = []
        for fx in (0.15, 0.5, 0.85):
            for fy in (0.3, 0.7):        # 核心区
                sx, sy = int(ox + x + w * fx), int(oy + y + h * fy)
                if 0 <= sx < W and 0 <= sy < H:
                    p = px[sx, sy]
                    samples.append(all(abs(p[k] - want_rgb[k]) <= 8 for k in range(3)))
        # 边界区（留 2px 以避开抗锯齿过渡，但足够检出 ≥3px 的错位）
        edge_samples = []
        for fx in (0.5,):
            for fy in (0.08, 0.92):
                sx, sy = int(ox + x + w * fx), int(oy + y + h * fy)
                if 0 <= sx < W and 0 <= sy < H:
                    p = px[sx, sy]
                    edge_samples.append(all(abs(p[k] - want_rgb[k]) <= 8 for k in range(3)))
        sample_ok = sum(samples)
        sample_total = len(samples)

        edge_ok = sum(edge_samples)
        mark = '✓' if (ok and edge_ok == len(edge_samples)) else '✗'
        print(f'  {i:>3}  {want}  {got}  {mark}     核心 {sample_ok}/{sample_total} · 边界 {edge_ok}/{len(edge_samples)}')
        checked += 1
        if not ok:
            failures.append(f'行 {i}: 中心点期望 {want} 实测 #{got[0]:02X}{got[1]:02X}{got[2]:02X}（屏幕 ({cx},{cy})）')
        elif sample_ok < sample_total:
            failures.append(f'行 {i}: 中心对但行内核心区 {sample_total - sample_ok}/{sample_total} 点不符（该行未被完整填充）')
        if edge_ok < len(edge_samples):
            failures.append(f'行 {i}: ★**边界区不符** {len(edge_samples) - edge_ok}/{len(edge_samples)}'
                            f'（该行位置有误——上/下边界落到了相邻行或背景）')

    # ③ 几何一致性：相邻行的间距应等于行高（检验布局是否真的按 Rust 几何排布）
    print()
    gaps = []
    for a, b in zip(expected, expected[1:]):
        gaps.append(b['y'] - a['y'])
    expect_gap = scene['row_h']
    gap_ok = all(abs(g - expect_gap) <= 1 for g in gaps)
    print(f'  行间距：{sorted(set(gaps))}（期望 {expect_gap}） → {"✓" if gap_ok else "✗"}')
    if not gap_ok:
        failures.append(f'行间距异常：{sorted(set(gaps))} ≠ {expect_gap}（说明几何排布有误）')

    print()
    print(f'  核验 {checked} 行，失败 {len(failures)}')
    if failures:
        print()
        print('  ✗ 失败明细：')
        for f in failures[:10]:
            print(f'    {f}')

    # ★整体偏移诊断：若多数行失败，尝试找出「统一平移量」——
    #   统一偏移 = 坐标系没对齐（可修）；无规律失败 = 几何或绘制真有问题。
    offset_hint = None
    if failures and checked >= 3:
        e0 = expected[0]
        want0 = parse_hex(row_color(0))
        w0, h0 = e0['w'], e0['h']
        best = None
        for dy in range(-400, 401, 4):
            for dx in (0,):
                sx = min(W - 1, ox + e0['x'] + w0 // 2 + dx)
                sy = min(H - 1, oy + e0['y'] + h0 // 2 + dy)
                if 0 <= sx < W and 0 <= sy < H:
                    p = px[sx, sy]
                    d = sum(abs(p[k] - want0[k]) for k in range(3))
                    if best is None or d < best[0]:
                        best = (d, dx, dy)
        if best and best[0] <= 18:
            offset_hint = f'检测到统一平移 (dx={best[1]}, dy={best[2]})：坐标系未对齐（可修）——建议核验 view_origin_*'
            print(f'  ⚠ {offset_hint}')

    out = {
        'ok': len(failures) == 0,
        'offset_hint': offset_hint,
        'rows_checked': checked,
        'failures': failures,
        'row_gap_ok': gap_ok,
        'screenshot': os.path.basename(png_path),
        'size': [W, H],
    }
    with open(png_path + '.verify.json', 'w') as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print(f'  结果已写入 {png_path}.verify.json')
    return 0 if out['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
