#!/usr/bin/env python3
"""hosts/shared/dactyl/measure-latency.py —— ★★Dactyl 输入延迟**量具**（D0 量具先行 · 15-dactyl-demo.md）

【它是什么】把**原始触摸采样**（每条：T0 官方触摸事件时间戳 → T1 首帧提交时间戳）聚合成
  15 §6.1 契约里的 `input_latency_p50/p95/p99_ms`，产出 `hosts/<end>/results/dactyl-metrics.json`。
  三端同一份判据/口径（对齐 `check-cross-end-geometry.py` 范式）。

【口径铁律（bench spec §2.5 / 15 §6.2）】
  · T0 = **官方触摸事件时间戳**（Android `MotionEvent.getEventTime()` / iOS `UITouch.timestamp`）；
    **禁用 JS 侧时钟**（`Date.now()`）。
  · T1 = **首帧提交时间戳**（该触摸引起的首个可见变化被提交的时刻）。
  · 主指标 = **work time**（Perfetto）；本量具的 `input_latency_*` 是**T1−T0**（端到端）；
    帧预算可用 gfxinfo 的百分位**代理**（S6 已落 `input-latency.json`）。

【输入（都可缺省）】
  · `--samples <path>`：`{end, samples:[{t0_touch_ms, t1_commit_ms, ...}]}`（生产者=宿主；D1 起接）。
  · `--gfxinfo-report <path>`：S6 产出的 `input-latency.json`（补 jank_rate / 帧百分位代理）。
【输出】`hosts/<end>/results/dactyl-metrics.json`（契约见 `dactyl-metrics.schema.json`）。
     无采样 ⇒ `input_latency_*` 记 null（**如实，不假定 0**——15 §3.3 反作弊第 2 条）。

用法：
  python3 hosts/shared/dactyl/measure-latency.py --end android [--samples s.json] [--gfxinfo-report r.json]
  python3 hosts/shared/dactyl/measure-latency.py --selftest     # 合成采样验证百分位（装置自测）
退出码：0 成功 / 1 入参/采样非法 / 2 环境错
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SCHEMA = os.path.join(HERE, 'dactyl-metrics.schema.json')


def percentile(sorted_vals, p):
    """最近秩百分位（与 gfxinfo / 对标 Checklist 同口径：ceil(p/100*N) 取第 k 小，1 基）。"""
    if not sorted_vals:
        return None
    n = len(sorted_vals)
    # 最近秩：k = ceil(p/100 * n)，取 sorted[k-1]
    import math
    k = max(1, math.ceil(p / 100.0 * n))
    return sorted_vals[k - 1]


def aggregate(samples):
    """采样列表 → input_latency 百分位（ms）。缺字段的采样**跳过并计数**（不静默混入）。"""
    lat = []
    skipped = 0
    for s in samples:
        t0 = s.get('t0_touch_ms')
        t1 = s.get('t1_commit_ms')
        if not isinstance(t0, (int, float)) or not isinstance(t1, (int, float)):
            skipped += 1
            continue
        d = t1 - t0
        if d < 0:  # 时间戳倒挂 ⇒ 非法（不静默）
            skipped += 1
            continue
        lat.append(round(float(d), 4))
    lat.sort()
    return {
        'input_latency_p50_ms': percentile(lat, 50),
        'input_latency_p95_ms': percentile(lat, 95),
        'input_latency_p99_ms': percentile(lat, 99),
        'samples_used': len(lat),
        'samples_skipped': skipped,
    }


def build(end, samples_path, gfxinfo_report_path):
    metrics = {}
    note = []
    # ① 端到端输入延迟（需采样）
    if samples_path and os.path.exists(samples_path):
        with open(samples_path, encoding='utf-8') as f:
            raw = json.load(f)
        samples = raw.get('samples') or []
        if not isinstance(samples, list):
            raise ValueError('samples 必须是数组')
        metrics.update(aggregate(samples))
    else:
        metrics.update({'input_latency_p50_ms': None, 'input_latency_p95_ms': None,
                        'input_latency_p99_ms': None, 'samples_used': 0, 'samples_skipped': 0})
        note.append('无触摸采样（--samples 未提供）⇒ input_latency_* 记 null（如实，不假定 0）')

    # ② 帧侧代理（复用 S6 的 gfxinfo 报告；非端到端，明确标注 source）
    if gfxinfo_report_path and os.path.exists(gfxinfo_report_path):
        with open(gfxinfo_report_path, encoding='utf-8') as f:
            g = json.load(f)
        # 帧 p95 作为 work_time 的**代理**（S6 已声明：gfxinfo 百分位是帧渲染代理）
        metrics.setdefault('work_time_p95_ms', g.get('frame_p95_ms'))
        metrics['jank_rate'] = g.get('janky_pct')
        metrics['high_input_latency_count'] = g.get('high_input_latency')
        note.append('帧侧读数为 gfxinfo 代理（work_time 真值需 Perfetto，见 15 §6.3）')

    return {
        'end': end,
        'source': 'dactyl-measure-latency.py',
        'generated_at': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),
        'metrics': metrics,
        'notes': note,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--end', choices=['android', 'ios', 'harmony', 'skyline', 'web', 'native', 'flutter', 'rn'])
    ap.add_argument('--samples')
    ap.add_argument('--gfxinfo-report')
    ap.add_argument('--out')
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()

    if a.selftest:
        # 合成采样：10 条 4..13ms ⇒ 验证最近秩百分位
        s = [{'t0_touch_ms': 0, 't1_commit_ms': v} for v in [4, 5, 6, 7, 8, 9, 10, 11, 12, 13]]
        r = aggregate(s)
        exp = {'p50': 8, 'p95': 13, 'p99': 13}  # 最近秩：k=ceil(0.5*10)=5→第5=8（不是中位平均 8.5）; k=ceil(0.95*10)=10→13
        got = {'p50': r['input_latency_p50_ms'], 'p95': r['input_latency_p95_ms'], 'p99': r['input_latency_p99_ms']}
        ok = got == exp
        print(f"自测：{got} 期望 {exp} ⇒ {'✅' if ok else '❌'}")
        return 0 if ok else 1

    if not a.end:
        print('✗ 需 --end 或 --selftest'); return 2
    out = a.out or os.path.join(ROOT, f'hosts/{a.end}/results/dactyl-metrics.json')
    try:
        rep = build(a.end, a.samples, a.gfxinfo_report)
    except Exception as e:  # noqa: BLE001
        print(f'✗ 量具失败：{e}'); return 1
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(rep, f, ensure_ascii=False, indent=2)
        f.write('\n')
    m = rep['metrics']
    print(f"[measure-latency] ✅ {os.path.relpath(out, ROOT)}")
    print(f"   {a.end} · input_latency p50/p95/p99 = {m['input_latency_p50_ms']}/{m['input_latency_p95_ms']}/{m['input_latency_p99_ms']}ms"
          f"（用 {m['samples_used']} / 跳 {m['samples_skipped']}）" + (f" · jank {m.get('jank_rate')}" if m.get('jank_rate') is not None else ""))
    for n in rep['notes']:
        print(f"   ℹ {n}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
