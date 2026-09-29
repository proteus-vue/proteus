#!/usr/bin/env python3
# hosts/android/check-apk-align16.py —— ★APK 内 .so 的 16 KB 对齐校验（zipalign -P 16 的等价判据）
#
# 【为什么单独一个 py 而不是内联 shell heredoc】shell 里嵌 python heredoc 与 `set -u`/引号
#   交互极易出错（本仓刚实测 parse error）。⇒ 判据逻辑落独立文件，shell 只调它。
#
# 【判据（两条，缺一不可）】
#   ① **未压缩**（Stored，compress_type=0）——压缩的 .so 无法被 loader 直接 mmap
#   ② **数据起始偏移** 16 KB 对齐（= header_offset + 30 + len(name) + len(extra)）
#      ★注意是**数据起始**而非 local header 偏移（首版误用后者 ⇒ 门禁假红）
#
# 用法：python3 check-apk-align16.py <apk> [--quiet]
# 退出码：0 全通过 / 1 有未对齐项 / 2 参数或文件问题
import sys
import zipfile

ALIGN = 16384


def main() -> int:
    if len(sys.argv) < 2:
        print('用法：python3 check-apk-align16.py <apk>')
        return 2
    apk = sys.argv[1]
    quiet = '--quiet' in sys.argv
    try:
        with zipfile.ZipFile(apk) as z:
            targets = [i for i in z.infolist() if i.filename.startswith('lib/') and i.filename.endswith('.so')]
            if not targets:
                print(f'  ⚠ {apk} 内未见 lib/**/*.so —— 跳过')
                return 0
            bad = 0
            for i in targets:
                # ★必须读**真实 local header 字节**算偏移：
                #   zip 规范允许 local header 与 central directory 的 extra field **长度不同**
                #   ⇒ 用 `i.extra`（中央目录的）算数据起始会**算错**（本仓实测：zipalign 报 OK
                #   而本脚本报"未对齐"——差异就是这里）。
                import struct
                with open(apk, 'rb') as f:
                    f.seek(i.header_offset)
                    head = f.read(30)
                if len(head) < 30 or head[:4] != b'PK\x03\x04':
                    print(f'  ✗ {i.filename}：local header 不合法（offset={i.header_offset}）')
                    bad += 1
                    continue
                name_len, extra_len = struct.unpack('<HH', head[26:30])
                data_off = i.header_offset + 30 + name_len + extra_len
                rem = data_off % ALIGN
                stored = i.compress_type == zipfile.ZIP_STORED
                if stored and rem == 0:
                    if not quiet:
                        print(f'  ✅ {i.filename}：Stored · 数据起始 {data_off}（16 KB 对齐）')
                else:
                    why = []
                    if not stored:
                        why.append(f'压缩方式 compress_type={i.compress_type}（需 Stored=0）')
                    if rem != 0:
                        why.append(f'数据起始 {data_off} 未对齐（余 {rem}）')
                    print(f'  ✗ {i.filename}：' + '；'.join(why))
                    bad += 1
            return 1 if bad else 0
    except Exception as e:
        print(f'✗ 读取 APK 失败：{e}')
        return 2


if __name__ == '__main__':
    sys.exit(main())
