#!/usr/bin/env python3
"""hosts/ios/lib/summarize-paint-hint.py —— I3 A/B 复测汇总（中位 + 原始值 + 装置自证）

【为什么独立成脚本】内联 heredoc 嵌进 shell 的 while/函数体时反复触发引号错配
（本仓实测：同一文件因此改了 5 轮仍未过 `bash -n`）。独立文件没有嵌套问题，且能单独复算。

用法：summarize-paint-hint.py <results_dir> <rounds>
"""
import json
import os
import statistics
import sys


def series(res: str, variant: str, rounds: int):
    peaks, compacts, disabled = [], [], []
    for i in range(1, rounds + 1):
        f = os.path.join(res, f'paint-hint-{variant}-r{i}.json')
        if not os.path.exists(f):
            continue
        try:
            d = json.load(open(f))
        except Exception:
            continue
        ph = (d.get('js_report') or {}).get('host_raw_by_phase') or {}
        peaks.append(max([float((r or {}).get('mem_peak_mb') or 0) for r in ph.values()] or [0]))
        compacts.append(max([(r or {}).get('paint_hint_compact') or 0 for r in ph.values()] or [0]))
        disabled.append(any((r or {}).get('paint_hint_disabled') for r in ph.values()))
    return peaks, compacts, disabled


def main() -> int:
    res, rounds = sys.argv[1], int(sys.argv[2])
    on = series(res, 'on', rounds)
    off = series(res, 'off', rounds)

    if not on[0] or not off[0]:
        print('  数据不足（两个变体都要有报告）'); return 1
    mon, moff = statistics.median(on[0]), statistics.median(off[0])
    print(f"  开启（按判据设 contentsFormat）：原始 {on[0]} → 中位 {mon:.1f} MB · 紧凑层数 {on[1]}")
    print(f"  关闭（系统默认格式）：          原始 {off[0]} → 中位 {moff:.1f} MB · 紧凑层数 {off[1]}（应为 0）")

    if not any(off[2]):
        print("  ✗ 装置自证失败：关闭态 paint_hint_disabled 不为 true ⇒ 那几轮其实开着（差值必然为 0）")
        return 1
    print("  ✅ 装置自证：关闭态 disabled=true（环境变量注入生效）")

    if max(on[1]) == 0:
        print("  ✗ 接线未生效：开启态紧凑层数为 0"); return 1

    d = moff - mon
    pct = d / moff * 100 if moff else 0
    print(f"  ★净收益：{d:+.1f} MB（{pct:+.1f}%）—— 开启态更低为正收益")
    print("  ★★解释边界：本场景仅 91 节点 / 88 文本层（演示场景）；历史 −39% 来自 2000 个")
    print("     CATextLayer 的规模 ⇒ 百分比不可直接对比。本测的价值在「方向 + 接线已验证」。")
    return 0


if __name__ == '__main__':
    sys.exit(main())
