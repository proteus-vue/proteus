# Proteus Studio 阶段 1 骨架（PoC）

> 决策 #1173 · 承接 A / B1 / B2 / C
>
> 前四个 PoC 证明的是**性能**；本单把它装进**产品形态**：三栏布局 + 原生设备画布 + 状态栏读数。

## 这一版证明了什么（以及没证明什么）

| 证明了 | 证据 |
|---|---|
| 原生 GL 画布能挂进 Tauri 窗口，且**位置由 HTML 布局决定**（不是写死全屏） | 日志 `canvas rect = 80.0,68.0 996.0x748.0` 与 CSS 网格算出来的完全一致（左栏 56 + 内边距 24 = 80；顶栏 44 + 24 = 68；宽 1440−56−340−48 = 996） |
| 真机画面能通过我们的管线渲染进画布 | `results/canvas-device.png`（从 FBO 读回，1280×720，内容是**手机设置页**） |
| HTML 叠加层与原生画布共存（B2 的结论在产品布局里成立） | 十字线/边框/标签都画在 WebView 层 |

| 没做 | 原因 |
|---|---|
| 编辑器内核 | **G-56.1 红线：绝不自研**（xi-editor 已死 / Lapce 至今 pre-alpha / Floem 两年未发版） |
| 终端 / pty | 不在这一版范围 |
| 真实设备连线 | 画布用的是**录制流**（`device-720p.mp4`），不是实时投屏（C 的边界已写明） |
| 元素拾取 / 检查器数据 | 依赖 G-54 的 `locateAssertion` / `affectedDevices`，那两个方法仍是 0 行 |

## 结构

```
Tauri 2 窗口（1440×900）
├─ top    品牌 · 设备 chip · 帧率上限 · 阶段说明
├─ rail   56px 图标栏（设备/样式/断言/录制）
├─ main   ← 原生 GL 画布垫在这层的透明区域后面
│         #canvas 的 rect 由 JS 量出来 → invoke('set_canvas_rect') → 原生 setFrame
├─ side   340px 检查器（占位）+ 设备读数
└─ status canvas rect · frames · fps · late · cpu
```

- 原生侧：`native/embed_view.m`（与 PoC B2 **共用同一份**），新增 `poc_set_frame` / `poc_frames` / `poc_late` / `poc_cpu_pct` / `poc_dump`；
- Rust：`set_canvas_rect` / `stats` / `dump_frame` 三个命令；60Hz 调度（原生按 PTS 决定这一拍出不出帧）；
- 前端：单文件 `dist/index.html`，无打包器。

## ★这一版抓到的真 bug（画布上下颠倒）

用 `poc_dump` 把 FBO 读回来看，第一次是**倒的**（手机状态栏跑到画布底部）。
根因：顶点着色器里 `vUV = p`，而 GL 的 (0,0) 在**左下**、纹理首行是画面**顶部** ⇒ 上下颠倒。
修法：`vUV = vec2(p.x, 1.0 - p.y)`。

**这个 bug 在 B2 就一直存在**（当时没有视觉验证，只测了性能数字）——
说明"性能达标"不等于"画面对"。**能 dump 出来的东西才叫验证过**。

## 自证方式（截图被 TCC 拦时）

macOS 的屏幕录制权限不给本进程（`screencapture` 报 `could not create image from display`），
所以改用两条机器可查的证据：

1. **HTML→原生接线**：`set_canvas_rect` 里把收到的矩形打日志，与 CSS 网格手算值比对；
2. **画布内容**：`poc_dump(path)` 把 FBO `glReadPixels` 成 PPM（`POC_DUMP=` 触发，5s 后自动退出）。

```bash
POC_VIDEO=/tmp/poc/device-720p.mp4 POC_DUMP=/tmp/poc/canvas.ppm \
DYLD_LIBRARY_PATH=/opt/homebrew/opt/ffmpeg/lib ./target/release/proteus-studio-shell
ffmpeg -y -i /tmp/poc/canvas.ppm /tmp/poc/canvas.png
```

## 复跑

```bash
cd docs/proteus-studio-poc/05-studio-shell
cargo build --release
POC_VIDEO=/tmp/poc/device-720p.mp4 \
DYLD_LIBRARY_PATH=/opt/homebrew/opt/ffmpeg/lib ./target/release/proteus-studio-shell
```


## 实时投屏（决策 #1174 · 收口于 #1175）

把画布输入从"录制流"换成**实时管道**：

```bash
# 硬解（默认）
POC_LIVE='adb exec-out screenrecord --output-format=h264 --size 1280x720 --bit-rate 8000000 --time-limit 180 -' \
DYLD_LIBRARY_PATH=/opt/homebrew/opt/ffmpeg/lib ./target/release/proteus-studio-shell

# 软解（逃生口：VT 在某些设备/参数下面会拒绝，用这个排除硬解因素）
POC_LIVE_SW=1 …

# 取数（真机流没有容器，ffmpeg 侧统计不了，只能自己上报）
POC_SECONDS=18 POC_JSON=results/x.json …
```

### 为什么要自己写传输层

`screenrecord --output-format=h264` 出的是**裸 Annex-B，没有时间戳**（PoC C 的发现③）。
ffmpeg 的 raw h264 demuxer 只能按默认 25fps 猜 ⇒ 慢动作。所以 `native/live_stream.h` 自己做了五件事：
popen 拉流（进程退出自动重连）→ Annex-B 拆 NAL → **按 `first_mb_in_slice==0` 判新帧** →
**到帧时刻 = PTS**（`CLOCK_MONOTONIC`）→ 环形队列交给主线程；另加 `live_peek_params` 供硬解取参数集。

### 五个实测踩坑（全修了，每条都被画面或用例打回过）

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| 1 | 画布全黑，`send_packet` 返 `INVALIDDATA(-1094995529)` | 组 AU 时只拼 NAL 负载，**丢了起始码** | 每个 NAL 前补 `00 00 00 01` |
| 2 | 花屏（块状拖影） | 用"一个 VCL = 一帧"，**一帧多 slice 时被切成半帧** | 按 `first_mb_in_slice==0` 判新帧；SPS/PPS/SEI 归下一帧 |
| 3 | 仍花屏，`aus 649 / send_ok 295` | tick 60Hz 追不上 120fps，队列积压**丢参考帧** | 每拍**排空队列**，只把最后一帧拿去渲染 |
| 4 | **画面残留块状失真**（零丢包仍在） | ★**找不到下一个起始码时，尾部不完整数据既被当完整 NAL 处理、又留在 carry 带进下一轮** ⇒ 同一段字节被拼进 AU 两次 ⇒ 码流损坏 | 没有下一个起始码就 `break`，尾部一律留给下一轮；只在缓冲塞满时硬切 |
| 5 | `ticks=309 / empty=228`（74% 空转），且投屏延迟平白多最多 64ms | `fread` 会**把请求字节读满才返回**（管道也如此），64KB 缓冲在 8Mbps 下要攒 ~64ms ⇒ AU 成批到达 | 改 `read(fileno(p), …)`，取"当前有多少给多少"⇒ `empty` 228→28 |

另修两处：**VT 硬解需要 extradata**（原"先开解码器后读流"⇒ VT 拿不到 SPS/PPS 直接拒绝）
⇒ 改为先起读取线程、`live_peek_params` 窥探首个 IDR 里的 SPS/PPS（**不取走**，首个 IDR 仍会正常解码）
→ 设 `cc->extradata` → 再 `avcodec_open2`；以及**上传按 `linesize` 走**（解码器 stride 可能 > width，
直接按 width 上传会把每行读偏）。

### 实测（同一台真机 120fps 流，各 3 轮 18s，取中位）

| 解码 | fps | 间隔 p50 / p99 | compose p50 | present p50 | 回拷 | 迟到 | CPU 单核 |
|---|---|---|---|---|---|---|---|
| **VT 硬解** | **59.5** | 16.1 / 37.7ms | 1.30ms | 0.44ms | **0.05ms** | 0 | **20.5%** |
| 软解 | 59.8 | 16.2 / 37.0ms | 1.19ms | 0.42ms | — | 0 | **32.7%** |

⇒ **硬解省 37% CPU，帧率与抖动无实质差别**。默认走硬解，`POC_LIVE_SW=1` 留作逃生口。

### 两处被自己推翻的猜测（记下来免得下轮重犯）

1. 上一轮写"软解仍有残留失真、怀疑 AU/slice 边界"——真因是踩坑 4 的**尾字节重复拼接**，
   与解码方式无关；修完后**硬解与软解画面都干净**（`results/canvas-live-hw.png` / `canvas-live-sw.png`）。
2. 本轮中途猜"硬解 p99 更差是 GPU→CPU 回拷造成的"——量出来 `hw_transfer_ms.p50 = 0.05ms`
   （Apple Silicon 统一内存），**假设不成立**；首批看到的 p99 差异是机器负载噪声，不是机制。

## 延迟（决策 #1177）

分两层量：**我们自己这侧**（可统计、可改）与**全链路**（含设备编码与 adb 传输，跨时钟域）。

### 一、我们这侧：到达 → 上屏

起点 = 该帧**第一个字节到达**（不是"凑齐一整帧"，那会虚高 ~8ms@120fps），终点 = `flushBuffer` 返回。
三段分开记，同一时钟域（`CLOCK_MONOTONIC`）：

| 段 | p50 | p95 | 说明 |
|---|---|---|---|
| 队列等待（到达 → 被取出解码） | **6.1–6.3ms** | 13.7–14.0ms | 60Hz 取样节拍的固有边界 |
| 解码（`send_packet` → `receive_frame`） | 2.0–2.1ms | — | VT 硬解 |
| 合成（上传 + BT.601 着色） | 1.3ms | — | |
| 上屏（`flushBuffer`） | 0.4–0.5ms | — | |
| **合计（到达 → 上屏）** | **7.7–8.0ms** | 13.5–15.1ms | p99 22.0–22.6ms，max 26–32ms |

### 二、把节拍调快能不能降延迟？**不能**

`POC_TICK_HZ` 可配（15–240）。60 → 120Hz 实测：

| 节拍 | 队列等待 p50 | 端到端 p50 | fps | CPU |
|---|---|---|---|---|
| 60Hz | 6.57ms | **8.78ms** | 52.6 | 25.4% |
| 120Hz | **3.41ms** | 9.15ms | 86.7 | **34.7%** |

队列等待确实减半，但**端到端一点没降**，CPU 反而 +9pt——因为呈现被 60Hz vsync 锁住，
加倍节拍只是把同一帧算了两遍。⇒ **默认保持 60Hz**，`POC_TICK_HZ` 只留作排查用。

### 三、全链路：设备出帧 → 我们上屏

方法：`screenrecord --bugreport` 会把**设备时间戳烧进画面**（实测左上角形如 `13:17:34.190 f=607 (0)`）；
`poc_dump` 时同时打出该帧的 `arrive_epoch` / `present_epoch`；再用设备↔Mac 时钟偏差换算
（长连接 + 多次采样取最小 RTT：offset **-685.6ms**，三次采样相差 <3ms，保守记 ±23ms）。

| 轮 | 编码+传输 | 我们这侧 | **全链路** |
|---|---|---|---|
| 1 | 57.4ms | 7.0ms | **64.4ms** |
| 2 | 60.4ms | 9.0ms | **69.4ms** |
| 3 | 54.4ms | 9.0ms | **63.4ms** |

⇒ **全链路中位 64.4ms，我们只占 11%**；剩下 87–89% 是设备硬编 + adb 管道，不在这层能优化的范围。
证据：`results/e2e-latency.json` + `results/e2e-{1,2,3}-corner.png`（烧了时间戳的画布角）。

### 四、这条数字该怎么用

- 60ms 量级对"看手机"够了（人眼对镜像延迟的容忍约 100–150ms），但**对触摸回传不够**——
  真做双向控制时，60ms 会明显"拖"。届时要走**设备侧低延迟通道**（RTP/WebRTC 或厂商投屏协议），
  而不是继续在 adb 管道上抠。
- 我们这侧 8ms 里 **6ms 是 60Hz 取样边界**，已经接近该架构下限（16.7/2 ≈ 8.3ms）；
  真要再降得提高呈现频率或做预测呈现，不是"优化代码"能解决的。

## 诚实边界


1. **实时链路仍未覆盖的**：只测了 Android 一台（1200×2608 / 120Hz）；iOS ReplayKit 未接；
   走 `adb` 管道**不是**网络投屏（无 RTP 重组 / 丢包 / 抖动），真实无线链路未测；
   端到端延迟（设备出帧 → 画布上屏）**还没量**——PTS 已经打好了，接统计即可；
2. **只证明了"画布 + 布局 + 叠加"这一层**，面板内容是占位，没有真实交互；
   `screenrecord --size 1280x720` 会把竖屏**加黑边**塞进 16:9（实测有效像素只有约 330×720），
   带宽与 FBO 面积浪费约 74% —— 产品上应按设备宽高比取分辨率；
3. **没有编辑器/终端**——那是阶段 1 的另外两块，且编辑器按 G-56.1 只用现成的（CodeMirror 6）；
4. `stats` 的 fps 是前端按帧数差算的（500ms 窗口），不是精确到帧的时序；
5. 状态栏读数取自**原生侧累计值**，页面刷新不清零。
