#!/usr/bin/env python3
# hosts/android/native-host-verify.py
# ★★M3 原生组件混用核验（方案 L3：「map / webview / 广告 / 第三方 SDK 以原生 View 嵌入」）
#
# 验证三件事（每条都有独立的期望来源，不依赖 app 自报）：
#   ① **位置由 Rust 几何决定**：native-host 子 View 的位置/尺寸 == Rust 算出的几何
#      （对照 `native_host_layout` 与 `expected` 里 native-host 行的坐标）
#   ② **原生 View 真的在渲染**：截图在该区域取到 WebView 的颜色（不是空白/透明）
#   ③ **z-order 实测**：与 native-host **重叠**的自绘色块，屏幕上显示哪个
#      → 结论：Android 子 View 由 dispatchDraw 在 onDraw 之后绘制 ⇒ **原生在上**
#
# 【为什么单独一个脚本】截图回归（screenshot-verify.py）验的是「自绘几何 → 像素」；
# 本脚本验的是「**原生 View 与自绘内容共存**」——含 z-order 这条 Android 固有约束。
# 两者场景与判据都不同，混在一起会让失败原因难以定位。
#
# 用法：python3 native-host-verify.py <scene.json> <screenshot.png>
import json
import io
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '.tools', 'py'))

WEBVIEW_BLUE = (0x15, 0x65, 0xC0)
OVERLAP_RED = (0xE5, 0x39, 0x35)


def row_color2(i: int):
    """★与 app 侧 `rowColor2(i)` 同一公式（宿主机独立重算）"""
    r = 30 + (i * 30) % 180
    g = 160 - (i * 20) % 120
    b = 70 + (i * 25) % 160
    return (r, g, b)


def close(a, b, tol=12):
    return all(abs(a[k] - b[k]) <= tol for k in range(3))


def main() -> int:
    if len(sys.argv) < 3:
        print('用法：native-host-verify.py <scene.json> <screenshot.png>')
        return 2
    scene = json.load(open(sys.argv[1]))
    png = sys.argv[2]
    if not scene.get('ok'):
        print(f'✗ 场景报告异常：{scene}')
        return 1

    from PIL import Image, ImageCms
    img = Image.open(png)
    icc = img.info.get('icc_profile')
    if icc:
        src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
        img = ImageCms.profileToProfile(img, src, ImageCms.createProfile('sRGB'), outputMode='RGB')
        print('  色彩管理：Display P3 → sRGB')
    else:
        img = img.convert('RGB')
    px = img.load()
    W, H = img.size

    ox, oy = scene.get('view_origin_x', 0), scene.get('view_origin_y', 0)
    host_id = scene.get('native_host_node_id')

    # ★★宿主机**独立重算**期望布局（不用 app 的测量结果当期望）
    #   场景规格（测试定义）→ 每行的类型/位置/高度：
    #     0/1/2 自绘（各 40）；3 native-host（200）；4 自绘（40）；5 **绝对定位**在 3 的 top 上（40）
    spec = scene['spec']
    RH, HH = spec['row_h'], spec['host_h']
    L, T = spec['offset_left'], spec['offset_top']
    expect = [
        {'seq': 0, 'kind': 'self-draw', 'x': L, 'y': T, 'w': 750, 'h': RH},
        {'seq': 1, 'kind': 'self-draw', 'x': L, 'y': T + RH, 'w': 750, 'h': RH},
        {'seq': 2, 'kind': 'self-draw', 'x': L, 'y': T + 2 * RH, 'w': 750, 'h': RH},
        {'seq': 3, 'kind': 'native-host', 'x': L, 'y': T + 3 * RH, 'w': 750, 'h': HH},
        {'seq': 4, 'kind': 'self-draw', 'x': L, 'y': T + 3 * RH + HH, 'w': 750, 'h': RH},
        # ★overlap 行与 native-host **同 top**（绝对定位）
        {'seq': 5, 'kind': 'overlap-selfdraw', 'x': L, 'y': T + 3 * RH, 'w': 750, 'h': RH},
    ]
    host_expect = next(e for e in expect if e['kind'] == 'native-host')
    node_of_seq = {e['seq']: e['nodeId'] for e in scene.get('expected', [])}
    failures = []

    print('═══ M3 原生组件混用核验 ═══')
    print(f'  截图 {W}×{H} · View 原点 ({ox},{oy}) · native-host 节点 #{host_id}')
    print()

    # ── ① native-host 的位置必须由 Rust 几何决定 ──
    layout = scene.get('native_host_layout') or []
    host_actual = next((v for v in layout if v['nodeId'] == host_id), None)
    print('  ① 位置是否由 Rust 几何驱动')
    if not host_expect or not host_actual:
        failures.append('native-host 的期望或实际布局缺失')
        print('     ✗ 数据缺失')
    else:
        # 注意：native_host_layout 是**场景内坐标**（子 View 相对宿主）
        # ★宿主机独立算出的期望（场景内坐标：L=60, T=320）
        ok = (abs(host_actual['left'] - host_expect['x']) <= 1
              and abs(host_actual['top'] - host_expect['y']) <= 1
              and abs(host_actual['width'] - host_expect['w']) <= 1
              and abs(host_actual['height'] - host_expect['h']) <= 1)
        print(f'     宿主机独立重算 ({host_expect["x"]},{host_expect["y"]}) {host_expect["w"]}×{host_expect["h"]}')
        print(f'     子 View 实际 ({host_actual["left"]},{host_actual["top"]}) '
              f'{host_actual["width"]}×{host_actual["height"]}  {"✓" if ok else "✗"}')
        if not ok:
            failures.append(f'native-host 位置与 Rust 几何不符：{host_actual} vs {host_expect}')
    print()

    # ── ② 原生 View 真的在渲染（非重叠区采样）──
    print('  ② 原生 View 是否真的渲染')
    if host_expect:
        # 取 native-host 区域的**下部**（避开可能与之重叠的自绘块）
        sy = oy + host_expect['y'] + int(host_expect['h'] * 0.85)
        sx = ox + host_expect['x'] + int(host_expect['w'] * 0.85)
        if 0 <= sx < W and 0 <= sy < H:
            got = px[sx, sy]
            ok = close(got, WEBVIEW_BLUE, 16)
            print(f'     采样 ({sx},{sy}) → #{"".join(f"{c:02X}" for c in got)}  '
                  f'期望 WebView 蓝 #{"".join(f"{c:02X}" for c in WEBVIEW_BLUE)}  {"✓" if ok else "✗"}')
            if not ok:
                failures.append(f'native-host 区域未取到原生 View 的颜色（实测 #{got[0]:02X}{got[1]:02X}{got[2]:02X}）')
    print()

    # ── ③ z-order：重叠区显示哪个 ──
    print('  ③ z-order（重叠区）')
    overlap = next((e for e in expect if e['kind'] == 'overlap-selfdraw'), None)
    zorder = None
    if overlap and host_expect:
        # 两者重叠时，取 native-host 区域内的采样点
        sy = oy + host_expect['y'] + int(host_expect['h'] * 0.2)
        sx = ox + host_expect['x'] + int(host_expect['w'] // 2)
        if 0 <= sx < W and 0 <= sy < H:
            got = px[sx, sy]
            if close(got, WEBVIEW_BLUE, 16):
                zorder = 'native-on-top'
                print(f'     采样 ({sx},{sy}) → WebView 蓝 ⇒ **原生 View 在自绘内容之上**')
                print('     ★这是 Android 固有约束：子 View 由 dispatchDraw 在 onDraw 之后绘制')
            elif close(got, OVERLAP_RED, 16):
                zorder = 'selfdraw-on-top'
                print(f'     采样 ({sx},{sy}) → 自绘红 ⇒ 自绘内容在原生 View 之上')
            else:
                zorder = 'unknown'
                print(f'     采样 ({sx},{sy}) → #{"".join(f"{c:02X}" for c in got)}（既非原生蓝也非自绘红）')
                failures.append('重叠区颜色无法判定 z-order')
    print()

    # ── 自绘行（复核场景其余部分没被破坏）──
    print('  附：自绘行复核（色号用 **seq**——与 app 侧的规格一致，宿主机独立重算）')
    for e in expect:
        if e['kind'] != 'self-draw':
            continue
        sy = oy + e['y'] + e['h'] // 2
        sx = ox + e['x'] + e['w'] // 2
        if 0 <= sx < W and 0 <= sy < H:
            got = px[sx, sy]
            want = row_color2(e['seq'])      # ★按 seq 取色（规格定义），不是"第几个自绘行"
            ok = close(got, want)
            print(f'     seq{e["seq"]} 屏幕y={sy} → #{"".join(f"{c:02X}" for c in got)}  '
                  f'期望 #{"".join(f"{c:02X}" for c in want)}  {"✓" if ok else "✗"}')
            if not ok:
                failures.append(f'自绘行 seq{e["seq"]} 颜色不符')
    print()

    print(f'  失败 {len(failures)}')
    for f in failures:
        print(f'    ✗ {f}')

    out = {
        'ok': len(failures) == 0,
        'failures': failures,
        'z_order': zorder,
        'native_host_geometry_driven_by_rust': not any('位置与' in f for f in failures),
        'screenshot': os.path.basename(png),
    }
    with open(png + '.native-verify.json', 'w') as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print(f'  结果已写入 {png}.native-verify.json')
    return 0 if out['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
