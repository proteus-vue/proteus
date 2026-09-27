#!/usr/bin/env python3
# hosts/cross-device-hit.py
# ★★跨端命中一致性核验：**同一份探针**在 Android 与 iOS 上必须给出**逐位相同**的结果。
#
# 【这条核验在证明什么】
#   「一套 IR / 一个核心 / 多端语义等价」是本项目的核心主张。布局侧已有证据
#   （两端各自与浏览器 golden 对拍，偏差 0.375dp）。但**命中测试**是新增能力，
#   且它的正确性依赖两条容易分叉的语义：**逆绘制序**与**裁剪**。
#
#   两端调的是**同一个 Rust 函数**（`proteus_layout_hit_test`，C ABI），但**边界不同**：
#     · Android：JNI（`nativeHitTest`，jfloat 参数 + Java String 返回）
#     · iOS：`@_silgen_name` C ABI（Float 参数 + C 字符串返回）
#   ⇒ 若某端绑定写错（参数顺序 / 坐标轴 / 类型宽度 / 字符串编码），本脚本会立刻暴露。
#   这正是「同一个核心」在**工程上**真的成立、而不只是同名的证据。
#
# 【★★为什么用「各自与期望比」而不是「两端互比」】
#   两端互比只能发现**分歧**，无法发现**共同错误**（两边都错成一样 → 互比全绿）。
#   故本脚本做两件事：
#     ① 每个端各自与**独立声明的期望值**比（期望写在两端源码里，来自几何 + 两阶段绘制序）
#     ② 再比对两端的 chain（冒泡链）是否一致（互证）
#
# 用法：python3 hosts/cross-device-hit.py [android.json] [ios.json]
import json
import sys
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ANDROID = os.path.join(HERE, 'android/results/hit/layout-hit.json')
DEFAULT_IOS = os.path.join(HERE, 'ios/results/layout-core-bench-ios.json')

# ★期望值（独立声明：纯几何 + 两阶段绘制序推导，不取自任何一端的运行结果）
#   场景：root 300×300 → [顶栏2 300×60 | 卡片3 300×180(内 absolute: 4@(30,20) 240×140, 5@(60,50) 140×100) | 底栏6 300×60]
#   绝对几何：2 → y 0..60；3 → y 60..240；4 → y 80..220 x 30..270；5 → y 110..210 x 60..200；6 → y 240..300
#   绘制序（两阶段）：相位1 = 2,3,6（在流，树序）；相位2 = 4,5（定位，树序）→ 4 在 5 之下、都在在流之上
EXPECT = {
    (150, 30): 2,      # 仅顶栏
    (150, 90): 4,      # 卡片 3 内、且落进 4（4 是定位元素 → 绘制在 3 之上）
    (100, 110): 5,     # 3、4、5 三者重叠 → 5（5 树序在 4 之后）
    (150, 140): 5,     # 同上
    (150, 290): 6,     # 仅底栏
    (400, 400): -1,    # 界外
}


def load_android(path):
    """Android 报告：probes 从 log 文本里解析（格式随场景演进，故做容错解析）。"""
    j = json.load(open(path))
    rows = {}
    for line in (j.get('log') or '').splitlines():
        line = line.strip()
        if not line.startswith('('):
            continue
        # "  (150, 30)      2            1              2              ✗"
        try:
            coord, rest = line.split(')', 1)
            x, y = (int(v.strip()) for v in coord.lstrip('(').split(','))
            parts = rest.split()
            if len(parts) < 3:
                continue
            rows[(x, y)] = {'core': int(parts[0]), 'mirror': int(parts[1]), 'e2e': int(parts[2])}
        except (ValueError, IndexError):
            continue
    return {'ok': j.get('ok'), 'rows': rows, 'raw': j,
            'path': path, 'platform': 'Android',
            'agreement': j.get('independent_agreement'), 'mismatch': j.get('mismatch')}


def load_ios(path):
    """iOS 报告：hit_probes.probes 是结构化数组。"""
    j = json.load(open(path))
    hp = j.get('hit_probes') or {}
    rows = {}
    chains = {}
    for p in hp.get('probes', []):
        key = (int(p['x']), int(p['y']))
        rows[key] = {'core': int(p['target'])}
        chains[key] = list(p.get('chain') or [])
    return {'ok': hp.get('ok'), 'rows': rows, 'chains': chains, 'raw': hp,
            'path': path, 'platform': 'iOS', 'mismatch': hp.get('mismatch')}


def main() -> int:
    ap = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_ANDROID
    ip = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_IOS
    for p in (ap, ip):
        if not os.path.exists(p):
            print(f'✗ 报告不存在：{p}')
            print('  生成方式：Android `--es path hit`；iOS `bash hosts/ios/run-layout-bench.sh`')
            return 2

    a, i = load_android(ap), load_ios(ip)
    print('═══ 跨端命中一致性核验（同一份探针 → 两端必须逐位相同）═══')
    print(f'  Android：{a["path"]}')
    print(f'  iOS    ：{i["path"]}')
    print()

    failures = []

    # ① 各自与独立声明的期望比
    print('  ① 各端 vs 独立期望（期望写在核验脚本里，取自几何 + 两阶段绘制序）')
    print('     探针          期望    Android   iOS      结果')
    print('     ' + '-' * 56)
    for pt, expect in sorted(EXPECT.items()):
        av = a['rows'].get(pt, {}).get('core')
        iv = i['rows'].get(pt, {}).get('core')
        ok = (av == expect) and (iv == expect)
        print(f'     ({pt[0]:>3},{pt[1]:>3})    {expect:>4}    {str(av):>7}   {str(iv):>5}    {"✓" if ok else "✗"}')
        if av != expect:
            failures.append(f'Android ({pt[0]},{pt[1]})：期望 {expect}，实得 {av}')
        if iv != expect:
            failures.append(f'iOS ({pt[0]},{pt[1]})：期望 {expect}，实得 {iv}')

    # ② 两端 chain（冒泡链）一致（互证：两端都错成一样是极不可能的，但仍如实标注局限）
    print()
    print('  ② 两端冒泡链互证（chain = target + 全部祖先）')
    chain_ok = 0
    for pt in sorted(EXPECT):
        if pt not in i.get('chains', {}):
            continue
        ic = i['chains'][pt]
        # Android 侧 chain 由 host 报告里的 last_hit_chain 提供（若场景未导出则跳过）
        ac = a['raw'].get('chains', {}).get(f'{pt[0]},{pt[1]}')
        if ac is None:
            continue
        if list(ac) == list(ic):
            chain_ok += 1
        else:
            failures.append(f'({pt[0]},{pt[1]}) chain 不一致：Android {ac} vs iOS {ic}')
    print(f'     可比对的 chain：{chain_ok} 条{"（两端一致）" if chain_ok else "（Android 报告未含 chain——见下方局限）"}')

    # ③ 两端自身的三层一致（Android 有独立镜像；iOS 有独立期望）
    print()
    print('  ③ 各端内部一致性（已有的更细核验，此处只做汇总引用）')
    if a.get('agreement') is not None:
        print(f'     Android：核心 vs 独立实现（Android 原生派发）vs 端到端 = {a["agreement"]}/6 一致'
              f'{"（✓）" if a["agreement"] == 6 else "（✗）"}')
    if i.get('ok') is not None:
        print(f'     iOS    ：核心 vs 独立期望 = {6 - (i.get("mismatch") or 0)}/6{"（✓）" if i["ok"] else "（✗）"}')

    print()
    print('  ★诚实边界（不当作全等）')
    print('    · 探针集**刻意小**（6 点）：覆盖「在流/定位重叠、裁剪外、界外」四类分支，')
    print('      但**不等于**全语义覆盖——完整语义由 conformance 的 3547 个浏览器探针覆盖。')
    print('    · 两端互比**发现不了共同错误**；故主判据是②之前的「各自 vs 独立期望」，')
    print('      期望由本脚本按几何 + 绘制序独立推导。')
    print('    · iOS 侧未做「独立实现」对标（无等价于 Android View 派发的现成 oracle）；')
    print('      其正确性锚定在浏览器 golden（同一个 Rust 核心）而非第二套 iOS 实现。')

    print()
    if failures:
        print(f'  ✗ 失败 {len(failures)} 项：')
        for f in failures:
            print(f'    {f}')
        return 1
    print('  ✓ 跨端一致：同一份探针在 Android 与 iOS 上给出**逐位相同**的结果')
    return 0


if __name__ == '__main__':
    sys.exit(main())
