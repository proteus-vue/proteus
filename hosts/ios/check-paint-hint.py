#!/usr/bin/env python3
"""hosts/ios/check-paint-hint.py —— ★I3 判据：绘制提示**真的落到了层上**

【为什么单独成脚本（不是内联在 sh 里）】判据要能**单独跑**（对已有报告复判，不重跑模拟器）；
内联在 heredoc 里则每次都要重跑一遍模拟器才能判。
（本仓已因"判据藏在流程里、无法单独复算"吃过亏——如 A/B 逐轮读数不落盘。）

【判据（三条，缺一条就说明接线在某个环节断了）】
  ① 报告里**有** paint_hint 读数 —— 否则宿主没上报（接线断在宿主侧）
  ② compact > 0 —— 否则判据把该紧凑的也判否了（"接线通了但收益为零"）
  ③ 场景里同时存在 compact 与 generic —— 证明判据**在真实数据上做了区分**，
     而不是"全放行"或"全拒绝"（后者会让① ② 都满足却毫无意义）

用法：python3 hosts/ios/check-paint-hint.py <report.json>
退出码：0 通过 / 1 未通过
"""
import json
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print('用法：check-paint-hint.py <report.json>', file=sys.stderr)
        return 2
    d = json.load(open(sys.argv[1]))
    js = d.get('js_report') or {}

    compact = generic = None
    for name, r in (js.get('host_raw_by_phase') or {}).items():
        r = r or {}
        if 'paint_hint_compact' in r:
            compact = r['paint_hint_compact']
            generic = r['paint_hint_generic']
            print(f'    ★I3 读数（相位 {name}）：compact={compact} · generic={generic}')

    if compact is None:
        print('    ✗ 判据①失败：报告里**没有** paint_hint 读数 ⇒ 宿主没上报（接线断在宿主侧）')
        return 1
    if compact == 0:
        print('    ✗ 判据②失败：一个文本层都没用紧凑格式 ⇒ 推导/透传有问题（接线通了但收益为零）')
        return 1
    if generic == 0:
        print('    ✗ 判据③失败：所有层都判"可紧凑" ⇒ 判据没有区分力（全放行 = 等于没有判据）')
        return 1
    print(f'    ✅ 三判据通过：紧凑格式落到 {compact} 个文本层，另有 {generic} 个按判据保持通用格式')
    print('       （场景里白字 #ffffff 走紧凑；灰蓝 #9aa3b2 非中性色 ⇒ 正确保持通用）')
    print('    ★边界：模拟器只证「接线正确 + 判据有区分力」；**内存收益 −39% 须真机复测**')
    return 0


if __name__ == '__main__':
    sys.exit(main())
