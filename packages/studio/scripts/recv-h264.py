#!/usr/bin/env python3
"""packages/studio/scripts/recv-h264.py —— ★Studio 的 iOS 输入源（决策 #1190 · G3）

【它是什么】一个极小的 TCP 接收器：把 iOS 宿主推来的**裸 Annex-B H.264** 写出去。
  iOS 侧见 `hosts/ios/ProteusHost/runtime/screen-stream.swift`（ReplayKit 捕获 + VideoToolbox 硬编）。

【为什么不用 `nc -l`】
  `nc` 能用，但三个需求它给不了：
    ① 客户端断开后要**继续等下一次连接**（iOS 侧会重连 —— 切后台/授权失败后重试）；
    ② 统计要能看见（收到多少字节 / 多少 MB/s / 连了几次）——排障时没有读数只能靠猜；
    ③ 超时与退出要可控（判据脚本不能挂死）。
  ⇒ 30 行 Python 就够，且零依赖（不引 ffmpeg 的进程管理）。

【两种用法】
  ① 直接看：`python3 packages/studio/scripts/recv-h264.py --port 9001 --seconds 10 --out /tmp/ios.h264`
     → 之后 `ffprobe /tmp/ios.h264` 验证是不是合法 H.264；
  ② 喂给 Studio：`POC_LIVE="python3 packages/studio/scripts/recv-h264.py --port 9001 --stdout"`
     → 字节直接进管道，`native/live_stream.h` 照旧拆 NAL（它只认管道里的 Annex-B，不关心来源）。

【诚实边界】只做"搬运 + 计数"，**不校验码流合法性**（那是 ffprobe / 解码器的事）。
  收到 0 字节 = 对端没连上或没授权（不是本脚本的问题，读 stderr 的统计）。
"""

import argparse
import socket
import sys
import time


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9001)
    ap.add_argument("--bind", default="0.0.0.0")
    ap.add_argument("--seconds", type=float, default=0.0, help="0 = 一直等（判据脚本请给值）")
    ap.add_argument("--out", default="", help="写文件；空则不落盘")
    ap.add_argument("--stdout", action="store_true", help="字节写 stdout（供 Studio 的 POC_LIVE 管道）")
    ap.add_argument("--oneshot", action="store_true", help="客户端断开即退出（默认继续等下一次连接）")
    args = ap.parse_args()

    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((args.bind, args.port))
    srv.listen(1)
    srv.settimeout(1.0)

    out = None
    if args.stdout:
        out = sys.stdout.buffer
    elif args.out:
        out = open(args.out, "wb")

    print(f"[recv] 监听 {args.bind}:{args.port}（等 iOS 连入）", file=sys.stderr, flush=True)
    t0 = time.time()
    total = 0
    conns = 0
    deadline = (t0 + args.seconds) if args.seconds > 0 else None

    while True:
        if deadline is not None and time.time() >= deadline:
            print(f"[recv] 到时限 {args.seconds}s", file=sys.stderr, flush=True)
            break
        try:
            conn, peer = srv.accept()
        except socket.timeout:
            continue
        conns += 1
        conn.settimeout(1.0)
        print(f"[recv] 连接 #{conns} 来自 {peer[0]}:{peer[1]}", file=sys.stderr, flush=True)
        while True:
            if deadline is not None and time.time() >= deadline:
                break
            try:
                chunk = conn.recv(65536)
            except socket.timeout:
                continue
            except OSError:
                break
            if not chunk:
                break
            total += len(chunk)
            if out is not None:
                out.write(chunk)
                out.flush()
        conn.close()
        el = max(1e-6, time.time() - t0)
        print(
            f"[recv] 断开（累计 {total} 字节 · {total / 1e6:.2f} MB · {total * 8 / el / 1e6:.2f} Mbps · 连接 {conns} 次）",
            file=sys.stderr,
            flush=True,
        )
        if args.oneshot:
            break

    srv.close()
    if out is not None and out is not sys.stdout.buffer:
        out.close()
    el = max(1e-6, time.time() - t0)
    print(
        f"[recv] 结束：{total} 字节（{total / 1e6:.2f} MB）· 平均 {total * 8 / el / 1e6:.2f} Mbps · 连接 {conns} 次",
        file=sys.stderr,
        flush=True,
    )
    return 0 if total > 0 else 3


if __name__ == "__main__":
    sys.exit(main())
