#!/usr/bin/env python3
"""生成 Studio 应用图标（决策 #1184）。

【为什么不用现成的 256×256 PNG 直接转 icns】
  macOS 的 .app 图标需要 16/32/128/256/512/1024 六档；把 256 放大到 1024 会糊。
  图形本身极简（深底 + 浅色方块），**直接按目标尺寸重画**比放大干净——
  所以这里用代码画，而不是拿位图去缩放。

输出：icons/icon.png（1024，打包入口）+ icons/AppIcon.iconset/*（iconutil 的输入）
用法：python3 icons/make-icon.py && iconutil -c icns icons/AppIcon.iconset -o icons/icon.icns
"""
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
BG = (24, 26, 32)       # 深底（与面板 --panel 同族）
FG = (230, 240, 255)    # 浅色图形
ACCENT = (76, 141, 255)  # 与 --accent 一致的一道竖线，暗示「画布/扫描」


def rounded_alpha(x, y, size, radius):
    """圆角矩形的覆盖率（简单 4x 超采样抗锯齿）。"""
    hit = 0
    for sy in range(4):
        for sx in range(4):
            px = x + (sx + 0.5) / 4
            py = y + (sy + 0.5) / 4
            cx = min(max(px, radius), size - radius)
            cy = min(max(py, radius), size - radius)
            if (px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2:
                hit += 1
    return hit / 16


def render(size):
    """画一张 size×size 的 RGBA 图：圆角深底 + 中间浅色方块 + 一条 accent 竖线。"""
    radius = size * 0.225                      # Big Sur 风格圆角
    inner = size * 0.20                        # 内方块边长占比
    x0 = (size - inner) / 2
    y0 = x0
    bar_w = max(1, int(size * 0.035))
    bar_x = size * 0.5 - bar_w / 2

    rows = []
    for y in range(size):
        row = bytearray([0])                   # PNG filter: none
        for x in range(size):
            a = rounded_alpha(x, y, size, radius)
            if a <= 0:
                row += bytes([0, 0, 0, 0])
                continue
            if x0 <= x < x0 + inner and y0 <= y < y0 + inner:
                r, g, b = FG
            elif bar_x <= x < bar_x + bar_w and size * 0.22 <= y < size * 0.78:
                r, g, b = ACCENT
            else:
                r, g, b = BG
            # 边缘乘 alpha（预乘由系统处理，这里给直通 alpha）
            row += bytes([r, g, b, int(a * 255)])
        rows.append(bytes(row))
    return b"".join(rows)


def write_png(path, size):
    raw = render(size)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    return len(png)


def main():
    iconset = os.path.join(HERE, "AppIcon.iconset")
    os.makedirs(iconset, exist_ok=True)
    # iconutil 要求的命名：icon_<size>x<size>.png 与 icon_<size>x<size>@2x.png
    spec = [16, 32, 128, 256, 512]
    total = 0
    for base in spec:
        for scale, suffix in ((1, ""), (2, "@2x")):
            px = base * scale
            total += write_png(os.path.join(iconset, f"icon_{base}x{base}{suffix}.png"), px)
    total += write_png(os.path.join(HERE, "icon.png"), 1024)
    print(f"生成完成：iconset {len(spec) * 2} 档 + icon.png(1024) 共 {total} 字节")
    print(f"下一步：iconutil -c icns {iconset} -o {os.path.join(HERE, 'icon.icns')}")


if __name__ == "__main__":
    main()
