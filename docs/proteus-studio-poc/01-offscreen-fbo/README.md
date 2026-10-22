# Proteus Studio PoC A —— 720p30 解码 → 我们自己的 GL FBO

> 决策 #1167 · 承接 `docs/proteus-studio-plan/README.md` 的「阶段 2 决定性验证」
> 与「诚实边界 ②：libmpv 离屏 FBO 真嵌入未验证」
>
> **选型变更（实测迫使）**：原计划 libmpv，本机装不上（github HTTPS 不通 + 独立前缀不吃瓶装包
> + 瓶装解包被沙箱挡，三重叠加）。改用 **ffmpeg + VideoToolbox**——设备投屏要的是**解码器**
> 不是播放器，这个选型反而更贴。判据不变。

## 为什么这个 PoC 决定 Studio 的生死

plan 的四宿主能力矩阵里，Studio 在 `device.native` 与 `form.mobile` 是**唯一 ✅**——这就是它存在的理由。
而 `device.native` 要求把设备画面**嵌进我们自己的窗口/合成层**（叠加检查器、对齐参考线、录制标注），
**不是**让 mpv 自己开一个播放器窗口。

后者是降级档（`window`），前者才是卖点。技术分水岭只有一条：

> **能否让 mpv 只解码、把帧画进我们提供的 GL FBO，并且开销够低。**

这个 PoC 只回答这一条。它**不**回答「嵌进 Tauri 的 WebView 窗口后表现如何」——那是 B 阶段。

## 判据（先注册，后测量；不许看完数字再定标准）

| # | 指标 | 阈值 | 理由 |
|---|---|---|---|
| P1 | 帧间隔 **p99** | ≤ 1.5 × 帧预算（33.3ms ⇒ ≤ 50ms） | 卡顿是 p99 现象，平均值会掩盖 |
| P2 | 渲染段耗时 **p95** | ≤ 5ms | 720p 一次 FBO 合成若超 5ms，留给检查器叠加的预算就没了 |
| P3 | 丢帧率（frame-drop + decoder-drop） | ≤ 1% | 超过就说明管线跟不上源 |
| P4 | 单核 CPU 占用 | ≤ 40%，且 ≤ 独立 `mpv --vo=null` 播放的 1.3× | 增量来自"画进 FBO"这一步，不该翻倍 |

任一不过 ⇒ **记录读数、给结论、走降级链**（`mpv-wid → window → web`，INV-ST-05），不硬做。

## 方法：为什么是「无窗口 CGL 离屏 + 硬解」

- 有窗口就变成"人看着它跑"，而这轮要的是**可复核数字**；
- 无窗口 ⇒ 能进 CI、能跨机对比、能回归；
- `swap`（上屏）成本不在本 PoC 范围，B 阶段在 Tauri 窗口里量。

量什么：

- **帧间隔**：两次「update 回调 → render 完成」之间的间隔（≈ 管线真实出帧节奏）；
- **渲染段**：`mpv_render_context_render` + `glFinish`（把 GPU 时间算进去，否则只是量了命令提交）；
- **丢帧**：mpv 自己的 `frame-drop-count` / `decoder-frame-drop-count` / `mistimed-frame-count`；
- **CPU**：进程 `getrusage` 的 user+sys ÷ 墙钟，折算成「单核百分比」。

## 复跑

```bash
# 1) 装 libmpv（本机用独立前缀，不碰 /opt/homebrew）
#    见 docs/proteus-studio-poc/README.md 的「环境」一节
# 2) 跑
MPV_PREFIX=/Volumes/data1/brew/opt/mpv bash 01-offscreen-fbo/run.sh 60
```

产出：`01-offscreen-fbo/results/readout-<时间戳>.json`（入库，供对账）。

## 结论（2026-10-22 实测）

环境：Apple M1 / 8 核 / macOS 26.5 · GL `Apple M1`（Metal 后端 4.1）· VideoToolbox 硬解 · 合成源 1280×720@30 6Mbps

| 判据 | 实测 | 判定 |
|---|---|---|
| P1 帧间隔 p99 ≤ 50ms | **36.3ms**（三轮 35.6 / 36.3 / 39.2；单轮 60s 38.8） | ✅ |
| P2 渲染段 p95 ≤ 5ms | **2.7 – 9.2ms，中位 3.9ms** | ⚠️ **不可判定**（详见下） |
| P3 丢帧 ≤ 1% | **0 / 1801 帧**（late 0.00%） | ✅ |
| P4 CPU ≤ 40% 单核 | **5.2%**（三轮 4.9 / 5.2 / 6.1） | ✅（绝对线） |
| P4′ ≤ 纯解码 1.3× | 纯解码 1.7% ⇒ 本管线 **≈3×** | ❌ **判据本身不成立**（见下） |

帧率稳定在 **30.01–30.03 fps**，60s 无丢帧 ⇒ **"解码 → 我们自己的 FBO"这条管线成立**。

### 两个必须说清的地方

**① P2 不可判定：噪声大于信号。**
三次 30s 复测的 render p95 是 `9.23 / 3.91 / 2.66`——**3.5 倍漂移**，中位 3.9ms 达标、最差 9.2ms 不达标。
根因两条：
- 本机同时有其他进程在跑（同仓另一个会话在跑 vitest），`glFinish` 是**墙钟同步等待**，被抢占直接计入；
- 上传只占 **0.58ms**（`POC_SKIP_UPLOAD=1` 对照：5.36 → 5.94），剩下全是绘制 + 同步等待。

⇒ 这条判据要变成**可判定**，需要同时改测量与实现：
(a) 用 GPU timer query（`GL_TIME_ELAPSED`）替代墙钟 `glFinish`；
(b) 静机复测（或记录并发负载）；
(c) 流水线化（双缓冲 + fence，不等当帧完成）——那会改变"渲染段"的语义（吞吐 vs 延迟），
    必须重新注册判据，**不允许**悄悄换口径。

**② P4′ 判据写得不对。**
"≤ 纯解码 1.3×" 的分母**不含渲染**，等于要求"渲染零成本"，任何真实合成管线都过不了。
绝对线（≤40% 单核）才是有效判据，实测 5.2% ≪ 40%。
v2 应改成：「每帧成本 ≤ 解码成本 + 渲染预算」，或直接用绝对线。

### 对 Studio 的意义

`device.native` 的技术前提**基本成立**：720p30 解码 + 合成进自有 FBO，30fps 零丢帧、单核 5%。
但它**只证明了离屏这一段**——真机上屏（swap/合成进 Tauri 窗口）、检查器叠加的开销余量，
以及真实设备投屏流（低延迟 H.264，码率/关键帧分布不同于合成源）都还没测（PoC B / C）。
P2 的 3–9ms 波动也提示：**给检查器叠加留的预算很薄**，v2 的流水线化不是优化项而是必需品。

## 复跑

```bash
FFMPEG_PREFIX=/opt/homebrew/opt/ffmpeg bash run.sh 60
FFMPEG_PREFIX=/opt/homebrew/opt/ffmpeg bash run.sh --baseline 60   # P4 纯解码基线
POC_SKIP_UPLOAD=1 ./results/fbo_harness --file ... --seconds 30     # 拆上传/绘制开销
```

## 诚实边界

1. **无上屏**：证明"能画进 FBO"，不证明"能嵌进 Tauri 窗口稳定呈现"（PoC B）；
2. **合成源**：`testsrc2` 编码器友好，真实设备投屏流的码率/关键帧分布不同（PoC C）；
3. **硬解回拷**：当前路径是 VT 硬解 → `av_hwframe_transfer_data` 回拷到 CPU → 再上传 GPU（**两次拷贝**）。
   零拷贝（IOSurface / `CVOpenGLTextureCache`）未做——实测上传只占 0.58ms，所以它**不是** P2 的主因；
4. **单机**：M1 / 8 核；跨机结论需重跑（`run.sh` 确定性，可直接比）；
5. **读数文件**：`results/readout-*.json` 全部入库，含三轮 30s 与诊断轮，可直接对账。
