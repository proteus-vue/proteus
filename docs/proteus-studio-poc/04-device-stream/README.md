# Proteus Studio PoC C —— 真机投屏流（不是合成源）

> 决策 #1172 · 承接 A（离屏）/ B1（原生窗口）/ B2（Tauri 承载）
>
> A/B 用的都是 `testsrc2` 合成源（30fps、恒定码率、理想关键帧）。真实设备投屏流完全不同——
> 本 PoC 用**手机自己硬编的流**复测，看结论是否还成立。

## 流是怎么来的（可复跑）

```bash
# 真机（Android，adb 已连）：设备侧 screenrecord 硬编 H.264，带容器时间戳
adb shell screenrecord --size 1280x720 --bit-rate 8000000 --time-limit 30 /sdcard/poc-720p.mp4
adb pull /sdcard/poc-720p.mp4 /tmp/poc/device-720p.mp4
# 抓流时用连续滑动制造运动（静止画面 screenrecord 只出极少数帧，实测 40s 才 15 帧）
```

**流参数（`results/stream-probe.json`，ffprobe 实测）**：

| 项 | 值 |
|---|---|
| 编码 / profile | h264 / **High** |
| 分辨率 / 码率 | 1280×720 / **6.17 Mbps** |
| 标称帧率 | **120 fps**（`r_frame_rate=120/1`） |
| 实测平均 | **107.3 fps**（3215 帧 / 29.97s） |
| 变帧率 | 是（avg ≠ r_frame_rate） |

## 判据（沿用 A/B 的阈值，不新造）

| # | 判据 | 阈值 |
|---|---|---|
| S1 | 真实流可解码（High profile + VFR） | 退出码 0 |
| S2 | 迟到帧 ≤ 1%（同 A/B 的 P3） | ≤ 1% |
| S3 | 单帧合成成本 ≤ 8ms（同 B1 的 Q2） | ≤ 8ms |
| S4 | 单核 CPU ≤ 40% | ≤ 40% |

## 结论（2026-10-22 实测，同一段真机流）

| 路径 | fps | 间隔 p50 / p99 | 单帧成本 p50 | 迟到 | CPU | 判定 |
|---|---|---|---|---|---|---|
| **离屏**（A 的 harness） | 107.32 | 9.27 / 14.10ms | render 1.32ms | **73/2147 = 3.40%** | 20.1% | S1 ✅ · **S2 ❌** · S3 ✅ · S4 ✅ |
| **窗口**（B1 的 harness） | 107.33 | 9.30 / 16.34ms | compose+present **1.23ms** | **14/2147 = 0.65%** | 21.3% | **四条全过** |

**再测 60fps 上限**（同一段真机流重编码到 60fps，`results/window-device-60fps.json`）：

| 路径 | fps | 间隔 p50 / p99 | 单帧成本 p50 | 迟到 | CPU |
|---|---|---|---|---|---|
| 窗口 · 60fps | 60.04 | 16.64 / 24.98ms | 2.77ms | **0%** | **11.0%** |

⇒ **60fps 完全宽裕**（预算 16.67ms，迟到 0，CPU 11%）；107fps 才是紧的那一档（0.65%、21%）。

读数入库：`results/offscreen-device-107fps.json` · `results/window-device-107fps.json` · `results/window-device-60fps.json` · `results/stream-probe.json`

## 三条会改变决策的发现

**① 真机投屏流不是 30fps，是 100–120fps。**
3215 帧 / 29.97s = 107.3fps，标称 120。而 A/B 的全部预算都按 30fps 的 **33.3ms** 算——
真机上帧预算是 **9.3ms**，差 3.6 倍。**Studio 不能默认"投屏就是 30fps"**。

**② 同一段流，离屏掉出判据（3.40%），窗口通过（0.65%）。**
与 B1 的结论一致：`glFinish` 的墙钟同步在快节奏流上代价被放大。**窗口路径才是产品路径**，
离屏路径只适合批处理/取证。

**③ `screenrecord --output-format=h264` 出来的 raw 流没有容器时间戳。**
实测：同一段内容，raw 形态下 ffprobe 只能报 `avg_frame_rate=25`（默认猜的），而 mp4 形态是 120。
⇒ **真实投屏链路必须带 PTS**（mp4 / RTP 时间戳）。没有时间戳就没法做节奏控制，
只能"解码多快放多快"——那正是 A 早期版本跑出 224fps 的原因。

## 对 Studio 的含义

- 镜像帧率**必须设上限并可配**：实测三档 —— 30fps CPU 5.2% / **60fps CPU 11.0% · 迟到 0** /
  107fps CPU 21% · 迟到 0.65%。⇒ **建议默认 60**（余量足、观感够），120fps 只在"必须看动画细节"时开。
- 必须定义**迟到策略**：丢帧保实时（画面跳过但延迟稳定）还是全显示（延迟累积）。
  本 PoC 的 `late` 只统计"晚于预算产出"，没有丢帧——真实产品必须二选一并写死。
- 传输层要保证 PTS 不丢；只发裸 H.264 等于把节奏控制权丢掉。

## 诚实边界

1. **只测了 Android 一台机（1200×2608 / 120Hz）**；iOS 的 ReplayKit 流未测，帧率/码率分布可能不同；
2. **60fps 上限已补测**（重编码，非设备直出）：60.04fps / 迟到 0% / CPU 11% ⇒ 宽裕；但重编码改变了编码器分布，设备直出 60fps 未测；
3. 走的是 `screenrecord`（设备本地录屏），**不是** 实时投屏链路（无网络抖动、无丢包、无 RTP 重组）；
4. 抓流时的滑动是脚本输入，画面内容比真实操作单调（码率偏低）。

## 复跑

```bash
# 1) 抓流（见上）
# 2) 离屏
POC_CLIP=/tmp/poc/device-720p.mp4 FFMPEG_PREFIX=/opt/homebrew/opt/ffmpeg \
  bash ../01-offscreen-fbo/run.sh 20
# 3) 窗口
DYLD_LIBRARY_PATH=/opt/homebrew/opt/ffmpeg/lib /tmp/poc/win_harness \
  --file /tmp/poc/device-720p.mp4 --seconds 20 --json results/window.json
```
