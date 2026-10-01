#!/usr/bin/env python3
"""hosts/ios/selftest-showcase-judge.py —— ★判据**自己的**破坏性验证（零设备）

【为什么必须有（本仓纪律：判据要落在结果上，且"判据本身"也要被验）】
  炫技场判据（check-showcase.py）决定"这场演出算不算过"——若判据**永远不会红**，
  它给出的"✅ 通过"就毫无意义（本仓已踩过：判据读错字段把 58.46 FPS 判成 0，
  以及 16KB 门禁扫描范围漏了 build/wasm ⇒ 假绿）。
  ⇒ 本脚本构造**一份合规产物**（全绿基线）+ 逐项注入缺陷，断言判据**每次都判红**。
  "注入即红"证明的是判据有牙齿，不是自证清白。

【与真机产物的关系】合规基线由**真节目单**（`hosts/shared/bridge/showcase-program.ts`）生成幕名序列，
  其余字段按 schema 填合理值 ⇒ 基线与判据的期望形态同源；跑真机后判据判的也是同一形态。

用法：python3 hosts/ios/selftest-showcase-judge.py
退出码：0 全部符合预期 / 1 有不符合（判据有洞）
"""
import copy
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
JUDGE = os.path.join(HERE, 'check-showcase.py')

TILES = 800


def real_plan() -> list:
    """从**真节目单**取幕名序列（tsx 直跑 TS 模块）——保证 selftest 与设备端同形态"""
    js = (
        "import { createShowcaseProgram } from './hosts/shared/bridge/showcase-program';"
        f"const ids = Array.from({{length: {TILES}}}, (_, i) => 1000 + i);"
        "const prog = createShowcaseProgram({ ids, cols: 20, view: { width: 390, height: 844 },"
        " tilePx: 15, centers: () => ids.map(() => ({ x: 10, y: 10 })), soakMs: 0 });"
        "console.log(JSON.stringify(prog.plan()));"
    )
    r = subprocess.run(['npx', 'tsx', '-e', js], capture_output=True, text=True, cwd=ROOT, timeout=180)
    if r.returncode != 0:
        print(f"✗ 无法从节目单取 plan（tsx 退出 {r.returncode}）：{r.stderr[-300:]}")
        sys.exit(2)
    return json.loads(r.stdout.strip().splitlines()[-1])


def compliant_report(plan: list, soak_cycles: int) -> dict:
    """合规产物（判据应全绿）——字段按 showcase-scene.swift + entry-showcase.ts 的真实形态填"""
    acts = []
    for name in plan:
        anims = 0
        if name in ('gather', 'title', 'settle-title', 'spiral', 'finale'):
            anims = 2400 if name == 'gather' else 3200
        elif name == 'ripple' or name == 'domino':
            anims = 1600
        elif name.startswith('storm') or name.startswith('soak-storm') or name.startswith('settle') or name.startswith('soak-settle'):
            anims = 4000
        acts.append({'name': name, 'anims': anims, 'issue_ms': 12.0, 'duration_ms': 2000.0, 'note': '', **({'flip': True} if name.startswith('flip') else {})})
    acts_perf = [
        {
            'name': name,
            'frames': 120,
            'span_ms': 2000.0,
            'hold_ms': 0.0,
            'act_ms': 2000.0,
            'fps': 59.5,
            'work_p50_ms': 0.2,
            'work_p95_ms': 2.5,
            'work_p99_ms': 4.0,
            'work_max_ms': 5.5,
            'dropped': 1,
            'dropped_ratio': 0.008,
            'tail_wait_ms': 8.0,
            # ★动画结束时刻（内核 active 首次归零）——合规基线 = 名义跨度（1× 速）。
            #   gather 是弹簧幕（自然静止 ≈0.86×窗口）这是**允许下限 0.75×**
            #   仍留出的余量；基线取 1.0× 表示"曲线幕满窗"的最健康形态。
            'anim_end_ms': 2000.0,
        }
        for name in plan
    ]
    return {
        'ok': True,
        'build_id': 'selftest',
        'platform': 'ios',
        'tiles': TILES,
        'cols': 20,
        'grid': {'cols': 20, 'rows': 40, 'tile': 15},
        'view': {'w': 390, 'h': 844},
        'mount_ms': 14.0,
        'plan': plan,
        'acts': acts,
        'acts_complete': True,
        'soak': {'ms': 0, 'cycles': 0},
        'frame_stats': {'ok': True, 'frames': 10800, 'running': False, 'frame_ms': 16.86},
        'host_perf': {
            'frames': 10800,
            'fps': 59.4,
            'vsync_p50_ms': 16.861,
            'work_p50_ms': 0.21,
            'work_p95_ms': 2.6,
            'work_p99_ms': 4.1,
            'work_max_ms': 6.2,
            'dropped': 42,
            'dropped_ratio': 0.0039,
            'elapsed_ms': 181800.0,
        },
        'acts_perf': acts_perf,
        'flip_flip-condense': {
            'note': '全量重排',
            'capture': {'ok': True, 'captured': 841},
            'patch': {'ok': True, 'patch_count': 800, 'relayout_count': 840, 'relayout_ms': 2.86, 'update_ms': 15.2},
            'start': {'ok': True, 'animated': 760, 'maxDeltaPx': 361, 'updates_len': 760},
        },
        'soak_mem': {'samples': 30, 'head_mb': 42.0, 'tail_mb': 43.1, 'growth_mb': 1.1},
        'thermal': {'start': 'nominal', 'end': 'nominal'},
        'mem_start_mb': 40.0,
        'mem_end_mb': 43.1,
        'device': {'model': 'iPhone12,1', 'screen_max_fps': 60, 'os': 'iOS 18.0'},
        'probe': {
            'ok': True,
            'layers': [
                {'id': 1000, 'tx': 10.0, 'ty': 20.0, 'rotate': 0.0, 'scale': 0.42, 'opacity': 1.0},
                {'id': 1400, 'tx': -30.0, 'ty': 60.0, 'rotate': 0.0, 'scale': 0.42, 'opacity': 1.0},
                {'id': 1799, 'tx': 50.0, 'ty': -40.0, 'rotate': 0.0, 'scale': 0.42, 'opacity': 1.0},
            ],
        },
        'snapshot': {'ok': True, 'path': '/tmp/showcase-final.png'},
    }


def run_judge(report_path: str, png: str, png2: str = '') -> int:
    cmd = ['python3', JUDGE, report_path, png] + ([png2] if png2 else [])
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode


def main() -> int:
    print('═══ 炫技场判据 · 破坏性验证（零设备）═══')
    plan = real_plan()
    soak_cycles = len([n for n in plan if n.startswith('soak-storm#')])
    print(f"  真节目单：{len(plan)} 幕（长跑 {soak_cycles} 循环）")

    tmp = tempfile.mkdtemp(prefix='showcase-selftest-')
    # PNG 素材：合规用真截图（存在即用），小图用 dd 造
    big_src = os.path.join(HERE, 'results', 'showcase-final.png')
    big_png = os.path.join(tmp, 'final.png')
    if os.path.exists(big_src):
        shutil.copy(big_src, big_png)
    else:
        # 无真截图时造一个"够大"的文件（判据只看体积）
        with open(big_png, 'wb') as f:
            f.write(b'\x89PNG\r\n\x1a\n' + b'\0' * 30000)
    small_png = os.path.join(tmp, 'small.png')
    with open(small_png, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + b'\0' * 1000)
    spiral_png = os.path.join(tmp, 'spiral.png')
    shutil.copy(big_png, spiral_png)

    def write_report(d: dict, name: str) -> str:
        p = os.path.join(tmp, name)
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(d, f)
        return p

    base = compliant_report(plan, soak_cycles)
    cases = []

    # ① 基线：合规产物 → 应 exit 0
    cases.append(('合规基线（应全绿）', base, big_png, 0))

    def inject(fn, name):
        d = copy.deepcopy(base)
        fn(d)
        cases.append((name, d, big_png, 1))

    # ② 帧数造假（帧率好看但几乎没跑）
    inject(lambda d: (d['host_perf'].update(frames=20, fps=59.9), d['frame_stats'].update(frames=20)), '帧数造假（20 帧撑全场）')
    # ③ 单幕爆预算（全程平均达标掩盖不了单幕——FLIP 幕 12ms）
    inject(lambda d: [a.update(work_p95_ms=12.0) for a in d['acts_perf'] if a['name'] == 'flip-condense'], 'FLIP 幕每帧成本超预算（12ms）')
    # ④ 掉帧率高
    inject(lambda d: d['host_perf'].update(dropped_ratio=0.05), '掉帧率 5%')
    # ⑤ 长跑内存泄漏（压力测量形态：soak>0 + 首尾增长）
    def leak(d):
        d['soak'].update(ms=300000, cycles=68)
        d['soak_mem'].update(growth_mb=52.0, tail_mb=94.0, samples=30)
    inject(leak, '长跑内存泄漏（+52MB）')
    # ⑥ 幕序不全（演出卡在中途）
    inject(lambda d: d.update(acts=d['acts'][:-2]), '演出未走完（少 2 幕）')
    # ⑦ 谢幕语未生效（终值探针全是基线姿态）
    inject(lambda d: [l.update(scale=1.0) for l in d['probe']['layers']], '谢幕语未生效（抽查片 scale 仍 1）')
    # ⑧ FLIP 未真跑（补丁数为 0）
    inject(lambda d: d['flip_flip-condense']['patch'].update(patch_count=0), 'FLIP 未真跑（patch_count=0）')
    # ⑨ 热节流（读数不可信）
    inject(lambda d: d['thermal'].update(end='serious'), '设备热节流（end=serious）')
    # ⑨b 幕尾空等（不是无缝衔接）
    inject(lambda d: d['acts_perf'][2].update(tail_wait_ms=180.0), '幕尾空等 180ms（非无缝）')
    # ⑩ 某幕帧数过少（幕边界与帧循环脱节）
    inject(lambda d: d['acts_perf'][3].update(frames=3), '某幕帧数过少（3 帧）')
    # ⑩b ★帧驱动重复 ⇒ 播放 2× 速（anim_end ≈ 0.5×跨度）——2026-10-01 真机实证的缺陷形态
    inject(lambda d: [a.update(anim_end_ms=a['span_ms'] * 0.5) for a in d['acts_perf']], '动画 2× 速播完（anim_end = 0.5×跨度）')
    # ⑩c ★缺动画结束取证（宿主未记录 active 归零时刻）——判据不许"没数据就是绿"
    inject(lambda d: [a.pop('anim_end_ms', None) for a in d['acts_perf']], '缺 anim_end_ms 取证（全幕）')
    # ⑪ 四条路径有幕缺失（把 spiral 改名）
    inject(lambda d: [d['acts'].__setitem__(i, {**a, 'name': 'x-spiral'}) for i, a in enumerate(d['acts']) if a['name'] == 'spiral'], '四条路径缺"螺旋"幕')

    failures = []
    for name, d, png, expect in cases:
        p = write_report(d, f"case-{abs(hash(name)) % 10**6}.json")
        rc = run_judge(p, png, spiral_png)
        ok = rc == expect
        mark = '✓' if ok else '✗'
        want = '绿' if expect == 0 else '红'
        print(f"  {mark} {name}：判据 exit={rc}（期望 {want}）")
        if not ok:
            failures.append(name)

    # ⑫ 小截图（体积不足）→ 红
    p = write_report(base, 'case-small-png.json')
    rc = run_judge(p, small_png, spiral_png)
    print(f"  {'✓' if rc == 1 else '✗'} 收尾截图过小（<20KB）：判据 exit={rc}（期望 红）")
    if rc != 1:
        failures.append('截图过小')

    shutil.rmtree(tmp, ignore_errors=True)
    print()
    if failures:
        print(f"✗ 判据存在漏洞：{failures}")
        return 1
    print(f"✅ 破坏性验证通过：{len(cases) + 1} 条用例全部符合预期（合规绿 · 注入红）")
    return 0


if __name__ == '__main__':
    sys.exit(main())
