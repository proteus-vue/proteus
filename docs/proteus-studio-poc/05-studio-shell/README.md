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


## 实时投屏（决策 #1174）

把画布输入从"录制流"换成**实时管道**：

```bash
POC_LIVE='adb exec-out screenrecord --output-format=h264 --size 1280x720 --bit-rate 8000000 --time-limit 180 -' \
POC_LIVE_SW=1 DYLD_LIBRARY_PATH=/opt/homebrew/opt/ffmpeg/lib ./target/release/proteus-studio-shell
```

### 为什么要自己写传输层

`screenrecord --output-format=h264` 出的是**裸 Annex-B，没有时间戳**（PoC C 的发现③）。
ffmpeg 的 raw h264 demuxer 只能按默认 25fps 猜 ⇒ 慢动作。所以 `native/live_stream.h` 自己做了四件事：
popen 拉流（进程退出自动重连）→ Annex-B 拆 NAL → **按 `first_mb_in_slice==0` 判新帧** →
**到帧时刻 = PTS**（`CLOCK_MONOTONIC`）→ 环形队列交给主线程。

### 三个实测踩坑（都修了）

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| 1 | 画布全黑，`send_packet` 返 `INVALIDDATA(-1094995529)` | 组 AU 时只拼 NAL 负载，**丢了起始码** | 每个 NAL 前补 `00 00 00 01` |
| 2 | 画面花屏（块状拖影） | 用"一个 VCL = 一帧"，**一帧多 slice 时被切成半帧** | 按 `first_mb_in_slice==0` 判新帧；SPS/PPS/SEI 归下一帧 |
| 3 | 仍然花屏，且 `aus 649 / send_ok 295` | tick 60Hz 追不上 120fps，队列积压**丢参考帧** | 每拍**排空队列**，只把最后一帧拿去渲染 ⇒ `649/649` 零丢包 |

### 还没解决的（如实写）

- **VT 硬解在裸流上直接拒绝**（`POC_LIVE_SW=1` 才出画面）：VideoToolbox 需要 SPS/PPS 作为 extradata，
  而我们是"先读流再开解码器"。修法明确（先收首个 AU 抽 SPS/PPS → 设 extradata → 再 `avcodec_open2`），本轮没做。
- 软解路径下画面**仍有残留块状失真**（`results/canvas-live-softdecode.png`），
  但收发已经 649/649 零丢包 ⇒ 不是丢包问题，怀疑 AU/切片边界仍有错判，**未定位完**。
- 软解 720p/120fps 的 CPU 明显高于硬解（未测准确值）。

⇒ **结论：实时链路"通了但没通干净"**——数据流、拆包、解码、上屏都成立，画面质量还差一个 extradata/AU 边界的修复。

## 诚实边界

1. **画面来自录制流**，不是实时投屏；循环播放靠 `avformat_seek_file` 回片头；
2. **只证明了"画布 + 布局 + 叠加"这一层**，面板内容是占位，没有真实交互；
3. **没有编辑器/终端**——那是阶段 1 的另外两块，且编辑器按 G-56.1 只用现成的（CodeMirror 6）；
4. `stats` 的 fps 是前端按帧数差算的（500ms 窗口），不是精确到帧的时序；
5. 状态栏读数取自**原生侧累计值**，页面刷新不清零。
