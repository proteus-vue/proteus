#!/usr/bin/env python3
# hosts/android/scroll-sync-verify.py
# ★★滚动同步核验（方案坑位 #4：「层级与滚动同步需专门设计」）
#
# 验三件事（期望由宿主机按**场景规格**独立重算，不用 app 的测量值）：
#   ① **native-host 跟随滚动**：屏幕位置 = view_origin + contentY − scrollY
#   ② **滚出视口被裁剪**：内容坐标超出视口时，屏幕上不应出现它的像素
#   ③ **与自绘内容同步不脱节**：同一滚动量下，自绘行与 native-host 的**相对位置**保持不变
#
# 用法：python3 scroll-sync-verify.py <step报告目录> <截图目录>
#   step报告目录里应是 layout-scroll-step{N}.json；截图目录里是 step{N}.png
import json
import io
import sys
import os
import glob
import re

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '.tools', 'py'))

WEBVIEW_BLUE = (0x15, 0x65, 0xC0)


def scroll_row_color(i: int):
    """★与 app 侧 `scrollRowColor(i)` 同一公式（独立重算）"""
    r = 60 + (i * 23) % 180
    g = 120 + (i * 31) % 130
    b = 180 - (i * 17) % 150
    return (r, g, b)


def close(a, b, tol=14):
    return all(abs(a[k] - b[k]) <= tol for k in range(3))


def load_rgb(path):
    from PIL import Image, ImageCms
    img = Image.open(path)
    icc = img.info.get('icc_profile')
    if icc:
        src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
        return ImageCms.profileToProfile(img, src, ImageCms.createProfile('sRGB'), outputMode='RGB')
    return img.convert('RGB')


def main() -> int:
    if len(sys.argv) < 3:
        print('用法：scroll-sync-verify.py <step报告目录> <截图目录>')
        return 2
    rep_dir, shot_dir = sys.argv[1], sys.argv[2]

    steps = sorted(glob.glob(os.path.join(rep_dir, 'layout-scroll-step*.json')))
    if not steps:
        print(f'✗ {rep_dir} 下没有 layout-scroll-step*.json')
        return 1

    print('═══ 滚动同步核验（方案坑位 #4）═══')
    failures = []
    step_results = []

    for sp in steps:
        n = int(re.search(r'step(\d+)\.json$', sp).group(1))
        d = json.load(open(sp))
        shot = os.path.join(shot_dir, f'step{n}.png')
        if not os.path.exists(shot):
            failures.append(f'步{n}: 缺截图 {shot}')
            continue

        img = load_rgb(shot)
        px = img.load()
        W, H = img.size

        sy = d['scrollY']
        ox, oy = d['view_origin_x'], d['view_origin_y']
        RH = d['row_h']
        TOFF = d['offset_top']
        host_id = d['native_host_node_id']
        host_exp = next(e for e in d['expected'] if e['nodeId'] == host_id)

        # ── ① native-host 的期望屏幕位置（宿主机独立算）──
        #   屏幕 y = view_origin_y + 内容 y − scrollY；可见条件是「与视口有交」
        vp_top, vp_bottom = oy, oy + d.get('view_height', H)
        host_top = oy + (TOFF + host_exp['contentY'] - TOFF) - sy   # contentY 已含 offset_top
        host_top = oy + host_exp['contentY'] - sy
        host_h = host_exp['h']
        host_visible_expected = (host_top + host_h > vp_top) and (host_top < vp_bottom)

        sync = (d.get('sync_dump') or [{}])[0]
        actual_translation = sync.get('translationY', None)
        actual_visible = sync.get('visible', None)

        line = f'  步{n}: scrollY={sy:<4}'
        ok_all = True

        # ① 跟随：translationY 应 == -scrollY（且 layoutTop 不变 = 零 layout 成本）
        follow_ok = actual_translation is not None and abs(actual_translation + sy) <= 1
        if not follow_ok:
            failures.append(f'步{n}: translationY({actual_translation}) ≠ -scrollY({-sy})')
            ok_all = False

        # ② 裁剪判定应与宿主机独立算的一致
        crop_ok = (actual_visible == host_visible_expected)
        if not crop_ok:
            failures.append(f'步{n}: 裁剪判定不一致（app={actual_visible} 独立算={host_visible_expected}）')
            ok_all = False

        # ③ 屏幕像素：若应可见 → 取到 WebView 蓝；若不可见 → 不应取到蓝
        pixel_check = 'skip'
        if host_visible_expected:
            # 取 native-host 区域**靠下**的位置（避开可能压在其上的自绘内容）
            sx = min(W - 1, ox + host_exp['w'] // 2)
            sy_px = min(H - 1, max(0, host_top + int(host_h * 0.8)))
            if 0 <= sy_px < H and 0 <= sx < W:
                got = px[sx, sy_px]
                if close(got, WEBVIEW_BLUE, 20):
                    pixel_check = 'blue-ok'
                else:
                    pixel_check = f'#{got[0]:02X}{got[1]:02X}{got[2]:02X}'
                    failures.append(f'步{n}: native-host 应可见但该处不是 WebView 蓝（实测 {pixel_check}）')
                    ok_all = False
        else:
            # 不可见 → 扫描原 native-host 会出现的区域，确认**没有**大块蓝色
            blue_count = 0
            total = 0
            for yy in range(max(vp_top, 0), min(H, vp_bottom), 8):
                for xx in range(ox, min(W, ox + host_exp['w']), 8):
                    c = px[xx, yy]
                    total += 1
                    if close(c, WEBVIEW_BLUE, 20):
                        blue_count += 1
            if total > 0 and blue_count > total * 0.05:
                pixel_check = f'blue-leak {blue_count}/{total}'
                failures.append(f'步{n}: native-host 应已裁剪，但屏幕上仍有蓝色（{blue_count}/{total} 采样点）')
                ok_all = False
            else:
                pixel_check = 'no-blue-ok'

        print(f'{line} translationY={actual_translation:<7.0f} visible={str(actual_visible):<5} '
              f'预期可见={str(host_visible_expected):<5} 像素={pixel_check} {"✓" if ok_all else "✗"}')

        # ── ③ 与自绘内容同步：取一行自绘（若可见）核验其屏幕位置 ──
        selfdraw = [e for e in d['expected'] if e['kind'] == 'self-draw']
        checked_rows = 0
        sync_rows_ok = 0
        for e in selfdraw:
            yy = oy + e['contentY'] - sy
            if yy + 5 < vp_top or yy + e['h'] - 5 > vp_bottom:
                continue          # 该行不在视口内
            yy_mid = yy + e['h'] // 2
            xx = min(W - 1, ox + e['w'] // 2)
            if not (0 <= yy_mid < H and 0 <= xx < W):
                continue
            got = px[xx, yy_mid]
            want = scroll_row_color(e['seq'])
            checked_rows += 1
            if close(got, want, 16):
                sync_rows_ok += 1
            else:
                failures.append(f'步{n}: 自绘行 seq{e["seq"]} 位置不符（屏幕 y={yy_mid}，'
                                f'实测 #{got[0]:02X}{got[1]:02X}{got[2]:02X}，期望 #{want[0]:02X}{want[1]:02X}{want[2]:02X}）')
        print(f'         自绘行核验：{sync_rows_ok}/{checked_rows} 通过'
              f'（屏幕位置 = 原点 + 内容 y − scrollY）')

        step_results.append({
            'step': n, 'scrollY': sy, 'translationY': actual_translation,
            'visible': actual_visible, 'visible_expected': host_visible_expected,
            'pixel': pixel_check, 'selfdraw_rows_ok': sync_rows_ok, 'selfdraw_rows_checked': checked_rows,
        })

    print()
    print(f'  失败 {len(failures)}')
    for f in failures[:10]:
        print(f'    ✗ {f}')

    out = {'ok': len(failures) == 0, 'failures': failures, 'steps': step_results}
    out_path = os.path.join(shot_dir, 'scroll-sync-verify.json')
    with open(out_path, 'w') as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print(f'  结果已写入 {out_path}')
    return 0 if out['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
