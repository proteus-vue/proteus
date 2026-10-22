# Proteus Studio PoC B1 —— 同一管线放进真实窗口：拆开量「合成」与「上屏」

> 决策 #1168 · 承接 PoC A（决策 #1167）
>
> A 证明了「解码 → 我们自己的 FBO」，但**全程无窗口** ⇒ swap 与 vsync 等待一点没量到。
> Studio 的 `device.native` 最终要被用户看见，这一段不能靠推测。

## 判据（先注册）

| # | 指标 | 阈值 | 理由 |
|---|---|---|---|
| Q1 | 帧间隔 p99 | ≤ 1.5 × 帧预算（50ms） | vsync 锁定时应在 33.3ms 附近 |
| Q2 | 单帧「合成+上屏」合计 p50 | ≤ 8ms（预算的 25%） | 留 25ms 给检查器/叠加/交互 |
| Q3 | 迟到帧（超一帧预算） | ≤ 1% | |
| Q4 | 单核 CPU | ≤ 40% | |

## 方法：三段分开记账

```
解码帧 ──① compose──▶ 画布 FBO ──② blit──▶ 窗口 backbuffer ──③ present(swap+vsync)──▶ 屏幕
```

- **compose**：NV12 两平面上传 + BT.601 着色器画进 FBO（与 A 同一条路径）；
- **blit**：FBO → backbuffer 全屏贴图（模拟"把设备画布贴进 Studio 画布"）；
- **present**：`[NSOpenGLContext flushBuffer]`，`swapInterval=1` ⇒ **含 vsync 等待**。

★把 present 混进"渲染耗时"是最常见的测量谎言：视频工具报"渲染 16ms"往往 15ms 在等 vsync。

## 结论（2026-10-22 实测）

环境：Apple M1 / macOS 26.5 / GL `Apple M1`（Metal 后端 4.1）/ VideoToolbox / 合成源 1280×720@30

三轮 30s（`results/readout-run{1,2,3}-30s.json`）：

| 轮 | fps | 间隔 p99 | compose p50 | present p50 | **合计 p50** | 合计 p95 | 迟到 | CPU |
|---|---|---|---|---|---|---|---|---|
| 1 | 30.03 | 34.80 | 0.986 | 0.404 | **1.39** | 2.16 | 0% | 7.5% |
| 2 | 30.03 | 40.77 | 0.803 | 0.349 | **1.15** | 7.26 | 0% | 7.0% |
| 3 | 30.03 | 37.87 | 1.576 | 0.427 | **2.00** | 5.95 | 0% | 8.2% |

| 判据 | 实测 | 判定 |
|---|---|---|
| Q1 间隔 p99 ≤ 50ms | 34.8 – 40.8ms | ✅ |
| Q2 合计 p50 ≤ 8ms | **1.15 – 2.00ms**（中位 1.39） | ✅（= 预算的 4%） |
| Q3 迟到 ≤ 1% | **0 / 903 帧** | ✅ |
| Q4 CPU ≤ 40% | 7.0 – 8.2% | ✅ |

⇒ **窗口内合成 + 上屏约 1.4ms/帧，给检查器叠加留出 ~32ms 余量**：`device.native` 在性能上完全可行。

### ★这条数据同时修正了 PoC A 的一个结论

A 报「渲染段 p95 3–9ms、判不了」。本轮在**有真实 vsync 的窗口里**测到 compose 只有 **0.8–1.6ms**。
差别就在 A 用了 `glFinish`（**墙钟同步等待**），而窗口路径靠双缓冲自然节流、不需要显式同步。
⇒ **A 的 P2 高估了渲染成本**，那 3–9ms 主要是同步等待与并发负载，不是 GPU 工作量。
（旧结论不删，按纪律在原处标注更正——见 `01-offscreen-fbo/README.md` 的「更正」段。）

### ★另一个必须写明的测量事实

**compose 与 present 的分界会漂移**：run1 `present 0.40`、run2 `present 5.55`——vsync 等待到底落在
compose 还是 present，取决于"这一帧是否早于 vsync 就绪"。
⇒ **只有"合计"是稳定可比的量**，分段数字不能跨轮直接比。

## 复跑

```bash
cc -O2 -fobjc-arc -DGL_SILENCE_DEPRECATION -o results/window_harness window_harness.m \
   -I/opt/homebrew/opt/ffmpeg/include -L/opt/homebrew/opt/ffmpeg/lib \
   -lavformat -lavcodec -lavutil -lswscale \
   -framework Cocoa -framework OpenGL -framework VideoToolbox -framework CoreVideo
DYLD_LIBRARY_PATH=/opt/homebrew/opt/ffmpeg/lib results/window_harness \
   --file /tmp/proteus-poc/720p30.mp4 --seconds 30 --json results/readout.json
```

## 诚实边界

1. **不是 Tauri**：这是原生 `NSWindow + NSOpenGLView`。Tauri 2 的窗口内容是 WKWebView，
   把这一层 NSView 挂进它的 `contentView` 是**独立风险**（B2，未做）——性能面与这里同源，**挂载可行性不同源**；
2. **无 UI 叠加**：只测"画布贴满窗口"，没测检查器/参考线/录制的叠加开销；
3. **本机有并发负载**（同仓另一会话在跑测试），p95 的 2.2–7.3ms 波动主要来自它；
4. **合成源**：`testsrc2`，真实设备投屏流的码率/关键帧分布不同（C 阶段）。
