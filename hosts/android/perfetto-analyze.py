#!/usr/bin/env python3
# hosts/android/perfetto-analyze.py
# ★★§9.2 要求的 **Perfetto 严格核确认**：从 trace 里用 SQL 直接读出「主线程跑在哪个核」。
#
# 【为什么需要它（替代进程内采样）】
#   此前用 app 内「每 3ms 读 /proc/self/task/<tid>/stat 的 processor 字段」判定核归属。
#   判定能力等价，但**不是 Perfetto trace 证据** —— §9.2 原文明确要求「用 Perfetto 确认
#   数据跑在普大核（被调度到超大核则数据作废）」。
#   本脚本从 `sched/sched_switch` 事件里按**时间区间**统计每个 CPU 上运行指定进程的
#   时长占比，是**可复核的原始证据**（trace 文件 + SQL 都可存档重跑）。
#
# 【为什么 sched_switch 是权威】
#   `sched_switch` 是内核调度器的原始事件，每个事件带 `next_comm`（下一个运行的线程名）
#   与 `next_pid` + `cpu`。按 (cpu, next_comm) 聚合时长，就是「该线程在各核上实际运行的时间」。
#   这比读取瞬时 processor 字段强：它是**统计量**，不受采样时机影响。
#
# 用法：python3 hosts/android/perfetto-analyze.py <trace文件> [进程名]
import sys
import os
import json

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '.tools', 'py'))

from perfetto.trace_processor import TraceProcessor  # noqa: E402


def main() -> int:
    if len(sys.argv) < 2:
        print('用法：perfetto-analyze.py <trace文件> [进程名]')
        return 2
    trace_path = sys.argv[1]
    proc_name = sys.argv[2] if len(sys.argv) > 2 else 'dev.proteus.layoutcore'

    tp = TraceProcessor(trace=trace_path)

    print(f'═══ Perfetto 核归属分析（§9.2）═══')
    print(f'trace: {trace_path}')
    print(f'进程: {proc_name}')
    print()

    # ── ① trace 基本信息 ──
    try:
        df_info = tp.query('SELECT COUNT(*) AS n FROM thread_state').as_pandas_dataframe()
        print(f'  thread_state 事件数: {int(df_info.iloc[0]["n"])}')
    except Exception:
        pass
    print()

    # ── ② ★核心：按 CPU 统计该进程**主线程**的运行时长 ──
    #   用 `thread_state`（Perfetto 的标准视图，由 sched_switch 派生）：
    #     state = 'Running' 的行即「该线程在 cpu 上运行」的时间片，`dur` 为其时长。
    #   ★为什么比「进程内采样 processor 字段」强：它是**内核调度事件的统计量**，
    #     不受采样时机/瞬时波动影响，且 trace 文件可存档复核。
    # ★★关键：Android 的 comm 字段有 **15 字符硬上限**，超出部分被**从头部截断**——
    #   实测：进程 `dev.proteus.layoutcore` 在 trace 里是 `teus.layoutcore`（前 4 字符没了）。
    #   故匹配名取**进程名的尾部 15 字符**，而不是头部（头部在长包名下必然丢）。
    short = proc_name[-15:]
    sql = """
    SELECT
      ts.cpu AS cpu,
      COUNT(*) AS slices,
      SUM(ts.dur) / 1e6 AS total_ms,
      ROUND(100.0 * SUM(ts.dur) / (
        SELECT SUM(ts2.dur) FROM thread_state ts2
        JOIN thread th2 ON ts2.utid = th2.utid
        JOIN process p2 ON th2.upid = p2.upid
        WHERE p2.name LIKE ? AND ts2.state = 'Running'
      ), 2) AS pct_of_app
    FROM thread_state ts
    JOIN thread th ON ts.utid = th.utid
    JOIN process p ON th.upid = p.upid
    WHERE p.name LIKE ?
      AND ts.state = 'Running'
      AND th.name LIKE ?
    GROUP BY ts.cpu
    ORDER BY total_ms DESC
    """
    # ★只统计**主线程**（Android 上主线程名 = 进程名，截断到 15 字符）
    sql = sql.replace('?', "'%__P__%'", 1).replace('?', "'%__P__%'", 1).replace('?', "'%__S__%'", 1)
    sql = sql.replace('__P__', proc_name).replace('__S__', short)
    try:
        df = tp.query(sql).as_pandas_dataframe()
    except Exception as e:
        print(f'  ✗ SQL 执行失败：{e}')
        tp.close()
        return 1

    if df.empty:
        print(f'  ⚠ trace 里没有 {proc_name}（匹配名 "{short}"）的运行记录')
        # 诊断：列出 trace 里名字相近的线程（帮助定位「进程名被截断」这类问题）
        try:
            like = tp.query(
                "SELECT t.name, t.tid, COUNT(*) AS n FROM thread_state ts JOIN thread t ON ts.utid=t.utid "
                f"WHERE ts.state='Running' AND t.name LIKE '%{short[-8:]}%' GROUP BY t.name, t.tid ORDER BY n DESC LIMIT 5"
            ).as_pandas_dataframe()
            if not like.empty:
                print('    相近线程（可能是 comm 截断后的名字）：')
                for _, r in like.iterrows():
                    print(f'      {r["name"]} (tid={r["tid"]}, {int(r["n"])} 时间片)')
        except Exception:
            pass
        tp.close()
        return 1

    print('  CPU   时间片数   运行时长(ms)   占该应用比')
    print('  ' + '-' * 72)
    total_ms = 0.0
    prime_ms = 0.0
    normal_ms = 0.0
    # 本机实测：cpu0-5 = 3.6GHz 普大核；cpu6-7 = 4.6GHz 超大核
    PRIME_CORES = {6, 7}
    for _, r in df.iterrows():
        cpu = int(r['cpu'])
        cls = 'prime' if cpu in PRIME_CORES else 'normal'
        mark = '★超大核' if cpu in PRIME_CORES else '普大核'
        print(f'  cpu{cpu:<2} {int(r["slices"]):>8}   {r["total_ms"]:>10.1f}   {r["pct_of_app"]:>6.2f}%  {mark}')
        total_ms += float(r['total_ms'])
        if cls == 'prime':
            prime_ms += float(r['total_ms'])
        else:
            normal_ms += float(r['total_ms'])

    print()
    print(f'  合计运行 {total_ms:.1f} ms')
    verdict = '✓ 全部在普大核（数据有效）' if prime_ms == 0 else (
        f'⚠ 有 {prime_ms:.1f} ms（{100*prime_ms/total_ms:.1f}%）在超大核上'
    )
    print(f'  ★§9.2 核判定：{verdict}')

    # ── ③ 导出 JSON（供 acceptance.sh 汇总）──
    out = {
        'trace': os.path.basename(trace_path),
        'process': proc_name,
        'total_ms': round(total_ms, 2),
        'normal_core_ms': round(normal_ms, 2),
        'prime_core_ms': round(prime_ms, 2),
        'prime_ratio': round(prime_ms / total_ms, 4) if total_ms > 0 else 0,
        'per_cpu': [
            {'cpu': int(r['cpu']), 'slices': int(r['slices']), 'ms': round(float(r['total_ms']), 2),
             'prime': int(r['cpu']) in PRIME_CORES}
            for _, r in df.iterrows()
        ],
    }
    with open(trace_path + '.analysis.json', 'w') as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print(f'  分析结果已写入 {trace_path}.analysis.json')

    tp.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
