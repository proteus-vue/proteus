# Proteus Studio 宿主壳（G-56）

> 决策 #1173 起（阶段 1 骨架）· **2026-10-22 出门**（决策 #1187：从 `docs/proteus-studio-poc/05-studio-shell` 迁入 `packages/studio`，判据升为门禁 `check:studio-panel` 并接 CI）
>
> 前四个 PoC 证明的是**性能**；本目录把它做成**产品形态**：三栏布局 + 原生设备画布 + 状态栏读数。

## 出门后的位置与入口

| 事项 | 位置 |
|---|---|
| 源码（唯一真源） | `packages/studio/` —— 原生层 `native/`、Rust 壳 `src/main.rs`、Vue 壳 `ui/` |
| 构建 UI | `./build-ui.sh`（或仓库根 `pnpm run build:studio-ui`）→ `web-dist/` |
| 构建应用 | `cargo build --release`；双击版 `./package-app.sh` → `build-app/Proteus Studio.app` |
| **门禁** | 仓库根 `pnpm run check:studio-panel`（Vite 构建 + Playwright 渲染 + **10 判据**；已接 CI 与 `pnpm verify`） |
| 判据输入 | `fixtures/panel-source.json`（真实跑机读数 + 采集机型；`results/panel-source.json` 是原始采集输出） |
| 为什么**没有** `package.json` | 它不是可发布的 npm 包：Cargo + Vite 项目。放进 workspace 会让 `build-packages`/`check:deps`/`check:pkg`/`docs-stats` 的包数口径一起漂 —— 详见 `.gitignore` 顶部注释 |

★**历史 PoC 仍在 `docs/proteus-studio-poc/`**（A/B1/B2/C 的 harness 与读数），它们现在反过来引用本目录的
`native/embed_view.m` —— 一份源码，两处引用，**不复制**。

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

- 原生侧：`native/embed_view.m`（**唯一真源**，PoC B2 反向引用它），`poc_set_frame` / `poc_frames` / `poc_late` / `poc_cpu_pct` / `poc_dump`；
- Rust：`set_canvas_rect` / `stats` / `dump_frame` 三个命令；60Hz 调度（原生按 PTS 决定这一拍出不出帧）；
- 前端：**Vue 3 + Vite**（`ui/` 源码 → `web-dist/` 产物），见下节。

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
cd packages/studio
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

## 打包成可双击的 .app（决策 #1184）

```bash
./build-ui.sh        # 前端 → web-dist/
./package-app.sh     # → build-app/Proteus Studio.app（70MB，自包含）
./package-app.sh --open
```

### 三件必须做的事（少一件"能双击"就是假的）

| # | 问题 | 做法 |
|---|---|---|
| 1 | 二进制硬链接 `/opt/homebrew/opt/ffmpeg/lib/libav*.dylib` ⇒ 只有装了 Homebrew ffmpeg 的机器能跑 | `bundle-dylibs.py` 递归收集 **65 个 dylib（59MB）** 打进了 `Contents/Frameworks`，`install_name_tool` 改 182 处引用为 `@rpath/…`，加 `LC_RPATH=@executable_path/../Frameworks` |
| 2 | 双击启动时 LaunchServices 只给 `/usr/bin:/bin:/usr/sbin:/sbin`，**`adb` 找不到** | `ensure_tool_path()` 把 `/opt/homebrew/bin`、`/usr/local/bin` 补进 PATH（面板能开但连不上设备 = 假可用） |
| 3 | 双击启动带不了环境变量 ⇒ 没输入源，画布永远空白 | `default_live_source()` 检测 `adb devices`，有设备就默认接真机，没有就明确打印"未检测到设备"而不是静默空白 |

### 自检判据（`bundle-dylibs.py` 收尾那两条，缺一不可）

1. 可执行文件里**不能有绝对** Homebrew 路径（否则换台机器就找不到）；
2. 每条 `@rpath/x` 都必须在 `Frameworks/x` 真的存在（否则启动即 `Library not loaded`）。

★第 2 条是被打脸换来的：第一版只收集**绝对路径**依赖，漏了以 `@rpath/libsharpyuv.0.dylib` 形式写在
`libwebp` 依赖里的库，打出来的包启动直接 `dyld: Library not loaded`。

### 实测（干净环境 = `env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin`，模拟双击）

```
[studio] PATH 补充：/opt/homebrew/bin:/usr/local/bin
[studio] 未指定输入，默认接真机
实时：参数集 108 字节（等 1550ms）· 硬解=1 · open rc=0
```

`otool -L` 外部引用 **0 条**；`@rpath` 依赖 4 条全部在包内；`plutil -lint` 通过；ad-hoc 签名。

### 诚实边界

1. **ad-hoc 签名（`-`）不是公证**：拷到别人机器上仍会被 Gatekeeper 拦（右键 → 打开可绕过）。
   要做"双击就开"必须 Apple Developer ID + 公证，本轮没有；
2. **仍然依赖 adb**：设备调试工具依赖 platform-tools 是合理的，但"装上就能用"要求对方有 adb；
3. **只测了 Apple Silicon**（dylib 是 arm64）；Intel 机器需要重编；
4. 打包脚本是**手写组装** `.app`（不是 `cargo tauri build`）——因为本目录没装 tauri-cli。
   `tauri.conf.json` 的 `bundle` 段已配好（`active: true`, `targets: ["app","dmg"]`），
   装了 CLI 后 `cargo tauri build` 也能直接用；
5. **单次运行读数波动大**：设备画面静止时 `screenrecord` 几乎不出帧（实测 3 秒只有 2 帧），
   所以性能数字必须在"屏幕持续运动"下测，别拿静止画面下的 fps 当结论。

## UI 技术栈：Vue 3 + Vite（决策 #1183）

原来是一个 247 行的**单文件手写 HTML**。占位原型这样写没问题，产品不行——20 个字段散在 5 个区域，
**状态同步全靠人记**（已经出过"漏改一处就显示假数据"的事故）。

### 定稿

| 层 | 用什么 | 红线 |
|---|---|---|
| **壳**（Studio 自身 UI） | **Vue 3 + Vite**，`@vitejs/plugin-vue` | **不接 Proteus** |
| 被调试视图 | 原生 GL 画布（已有） | 像素层**绝不走虚拟 DOM** |
| 自举试点（未做） | Proteus 编译的非关键子面板 | 坏了不影响打开 Studio |

**为什么壳不能依赖 Proteus —— 自举死锁**：Studio 是排查 Proteus 的工具。如果它的 UI 由 Proteus
运行时渲染，Proteus 一旦有 bug，可能**连打开调试器都做不到**。调试器不能依赖被调试对象的运行时。

**为什么是 Vue 而不是别的**：全仓 368 个 `.vue`、包前缀 `@proteus-vue/*`、`packages/devtools` 的
peer 是 `@vue/devtools-api` —— Studio 要展示的「被调试对象」就是 `.vue`，用同一套心智模型冲突最少。

### 结构

```
ui/
  index.html            构建入口（只有 #app 一个空壳）
  src/main.ts           createApp + 全局样式
  src/App.vue           三栏布局 + 状态栏（画布矩形在此同步给原生）
  src/bridge.ts         Tauri IPC 唯一入口（缺桥时**明确报错**，不返回 undefined）
  src/useStats.ts       500ms 轮询 + 统一格式化（负值 → "—"）
  src/panels/PanelShell.vue     面板外壳（标题/内容/脚注）
  src/panels/DevicePanel.vue    设备与流
  src/panels/PipelinePanel.vue  管线四段
  src/panels/RuntimePanel.vue   出帧/迟到/AU/空转/CPU
  src/panels/InspectorPanel.vue 检查器（**显式说明无数据源**）
```

```bash
./build-ui.sh      # ⇒ web-dist/（约 70KB JS / 29KB gzip）
```

★**依赖不在这里装**：本目录不是 npm 包（刻意没有 `package.json`，决策 #1187），`build-ui.sh` 直接借用仓库根的
`vite` / `vue` / `@vitejs/plugin-vue`，避免第二套 `node_modules` 和版本漂移。

★**输出目录为什么叫 `web-dist` 而不是 `dist`**：仓库根 `.gitignore:5` 有 `dist/` 规则，
我们已经在这条规则上栽过一次（手写 HTML 从没进过库）。构建产物该被忽略，换个不会被误伤的名字。

### 迁移的证据：判据一行没改

面板判据的 9 条**原样通过**——因为所有 `id`（`kdev` / `klat` / `kqw` …）在组件里保持不变。
**这就是"迁移没丢验证能力"的证据**，而不是"看起来还行"。

出门时判据从 `verify-panel.mjs` 升级为 `scripts/check-studio-panel.mjs`（`pnpm run check:studio-panel`）：
**9 条一条没放松**，另加第 ⑩ 条 —— fixture 与原始采集输出的数值必须一致（防"改 fixture 让判据变绿"）。

### 诚实边界

1. 只迁移了**右栏与布局**，左栏图标仍是占位、画布区仍是原生 GL（本就不该由 Vue 管）；
2. **没装 TypeScript 类型检查**（Vite 只做 transpile，`vue-tsc` 没接）；类型错误目前只能靠 IDE；
3. 没做组件测试（`vitest` + `@vue/test-utils` 未接），只有端到端的 9 条渲染判据；
4. 单文件 70KB 里有 60KB 是 Vue 运行时——**没做按需/预编译优化**，也没必要（桌面应用，本地加载）。

## 右栏检查器：接真数据（决策 #1181）

上一版右栏是**占位**，而且几行是**硬编码的假值**（"Android · 1200×2608"、"6.2 Mbps"）。这一版全部换成真读数。

### 数据从哪来

| 面板行 | 来源 | 备注 |
|---|---|---|
| 机型 | `adb shell getprop ro.product.model` + `wm size` | **探测不到就显示"未知"，不编一个** |
| 画面 | 解码器实际 `width×height` + 码率 | 码率按入队 AU 字节数估（含起始码，略高于 `--bit-rate` 目标值） |
| 解码 | `hwdec` 位 | VideoToolbox 硬解 / 软件 |
| 帧率 / 到达间隔 | 原生侧按墙钟 + 240 帧滑动窗口 | **不用前端差分**（丢帧时会跳） |
| 管线四段 | 首字节到达 → 上屏，逐段记账 | 队列 / 解码 / 合成 / 上屏 |
| 出帧 / 迟到 / 入队 AU / 空转拍 / CPU | 原生计数器 | 空转拍 = 没有新 AU 的渲染拍（能一眼看出取样是否跟得上） |

★**负值一律显示 `—`**：原生侧用 `-1` 表示"样本不足"，直接 `toFixed` 会显示成 `0.0`——0ms 会被读成"很快"。

### 怎么验证的（这是本轮的关键）

macOS 的屏幕录制权限（TCC）不给本进程，`screencapture` 直接失败，**WKWebView 内容截不到**。
但面板是**纯 HTML** ⇒ 用 Playwright 渲染一遍就有真截图：

```bash
pnpm run check:studio-panel     # ⇒ results/inspector-panel.png（10 判据）
```

桩只替换**"值怎么送到页面"**这一步：

- 读数来自 `fixtures/panel-source.json`（同一次真实跑机采的 JSON，**不是编的**；原始输出留在 `results/panel-source.json`）；
- 机型仍走**真实 adb**（与应用内同一条命令）；**无 adb 时回落 fixture 记录的采集机型**（CI 上不假红）；
- 10 条判据：IPC 调到 stats / 画布矩形被同步 / 三行有值 / 解码方式与读数一致 / 延迟是真实值 /
  管线四段都渲染 / 状态灯切运行中 / 无 JS 错误 / **正文无裸 `**`** / **fixture 与原始采集输出一致**。

★最后一条是**被自己坑出来的**：我把 Markdown 粗体写进了 HTML，页面上直接露出 `**`，
第一次看截图就看到了。现在既有自检也有判据挡复发。

### 诚实边界

1. **只验证了渲染与字段映射**，没验证 Tauri IPC 真实往返（那是桩）、也没验证 WKWebView 与 Chromium 的渲染差异；
2. **元素拾取仍无数据源**——设备侧视图树 + 拾取通道未接，所以面板明说"这里不显示盒模型 / 计算样式"；
3. 源码定位（G-54 `locateAssertion`）**确认没有**「断言 id → 代码位置」注册表，不硬造；
4. 能查的只有能力影响面（G-54 `affectedDevices`），且要走 CLI：`proteus knowledge devices <id>`。

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
2. **只证明了"画布 + 布局 + 叠加 + 读数"这一层**：没有真实交互（不能点、不能选、不能改）；
   `screenrecord --size 1280x720` 会把竖屏**加黑边**塞进 16:9（实测有效像素只有约 330×720），
   带宽与 FBO 面积浪费约 74% —— 产品上应按设备宽高比取分辨率；
3. **没有编辑器/终端**——那是阶段 1 的另外两块，且编辑器按 G-56.1 只用现成的（CodeMirror 6）；
4. `stats` 的 fps 是原生侧按 240 帧滑动窗口算的（不是前端差分），但仍不是逐帧时序；
5. 状态栏读数取自**原生侧累计值**，页面刷新不清零。

## iOS 通道（G3 · 决策 #1190）

Android 那条腿是 `adb exec-out screenrecord`（整机录屏）。iOS 没有等价物，但有两条路：

| 方案 | 能录什么 | 代价 |
|---|---|---|
| **App 内 ReplayKit**（本仓采用） | **只录本 App 窗口** | 零额外 target / 零 entitlement；App 进后台即停 |
| Broadcast Upload Extension | 整机 | 额外 target + 每次从控制中心手动启动 + 独立签名档 |

Studio 要看的**就是 Proteus 宿主自己**（编译出的页面跑在 ProteusHost 里）⇒ 前者足够。

**链路**：`RPScreenRecorder.startCapture` → `VTCompressionSession`（H.264 High · 8Mbps · 实时模式）
→ **AVCC 转 Annex-B**（每 NAL 前补 `00 00 00 01`，IDR 前重发 SPS/PPS）→ TCP 发 Mac。

**为什么 Studio 侧几乎不用改**：`live_stream.h` 只认「管道里的 Annex-B」，所以 Mac 端只要
`/usr/bin/nc -l 9001` 就能收——`default_live_source()` 在没有 Android 设备时自动走这条路
（`PROTEUS_IOS_STREAM=0` 可关掉，`PROTEUS_IOS_STREAM_PORT` 可改端口）。

```bash
# 一条命令：起接收器 → 装 App → 收 10s → ffprobe 判合法
bash hosts/ios/run-screen-stream.sh
# 之后开 Studio 接画布。★`PROTEUS_IOS_STREAM_PORT` 是**显式意图**，
#   优先于 adb 探测——本机同时连着 Android 时不会被静默劫持到 Android 画面
PROTEUS_IOS_STREAM_PORT=9001 ./target/release/proteus-studio-shell
```

**已验 / 未验（别混）**：
- ✅ Swift 类型检查（`check:ios-selfdraw-compile`）、Rust 编译、接收端（假源 `ffprobe` 认 640×360/120 帧）、
  `nc -l` 与接收器两条接收路径；
- ✅ **真机链路（2026-10-23 · iPhone 12 / `F02622D7…`）**：
  `192.168.1.128 → 192.168.1.124:9001`，10 秒收 **1,209,837 字节 / 295 帧 / 合法 H.264 / 888×1920**；
  App 侧日志 `frames=264 encoded=264 bytes=1206675 kbps=9653.4 nals=1 size=888x1920`（约 **60fps**、**9.6 Mbps**）。
- ✅ **Studio 画布上屏（2026-10-23）**：用 888×1920 的 H.264 灌 `tcp://…:9001`，
  Studio 以 `POC_LIVE="/usr/bin/nc -l 9001"` 接收 → 解码 → 上屏 → `POC_DUMP` 读回画布，
  得到 **888×1920 完整画面**（`results/studio-ios-frame.png`，86 帧上屏、`dump rc=0`）。
  ★这一环是靠**假源**验的（不需要真机）：iOS 与 Android 到 live_stream 都是同一形态的 Annex-B。

**★两个已修的真问题（都只有真机/真流才暴露）**：
1. **SIGPIPE 打死 App**：Mac 侧接收器退出后，App 下一次 `send` 吃 SIGPIPE（`App terminated due to signal 13`）。
   修：`setsockopt(SO_NOSIGPIPE)` ⇒ send 只返 `-1(EPIPE)`，走"关连接 + 下帧重连"。
2. **尺寸预设不生效**：VT 硬解下 `avcodec_open2` 后 `g_cc->width` 仍是 0（SPS 要等首帧），
   于是 `g_W/g_H` 停在默认 **1280×720**；Android 恰好也是 720p 所以一直没暴露，
   **iOS 的 888×1920 会被按 720p 分配纹理** ⇒ 画面错位。
   修：**首帧尺寸不符就就地重建三张纹理**（`embed_view.m`，只在尺寸不等时执行 ⇒ Android 路径零影响）。

⚠ **分辨率边界**：ReplayKit 给的是 **888×1920**（与屏幕 native 1170×2532 等比，比例 0.4625 一致）
⇒ 看画面够用，**但做不了像素级 1:1 比对**（那要 Broadcast Upload Extension 才给 native）。

## 代码视图（G4 · 决策 #1190 续）

左栏第二个按钮 ◈ 把中间区域从**原生画布**切到**代码面板**。这一版刻意只做**只读**：

| 件 | 实现 | 为什么不一步到位 |
|---|---|---|
| 文件列表 | Rust 命令 `list_files`（仓库内 · 扩展名白名单 · 跳过 `node_modules/target/dist/…` · ≤300 条） | 前端没有文件系统访问权；这是只读有界查询，边界与 `read_text` 共用一套 |
| 读文件 | Rust 命令 `read_text`（`canonicalize` + 仓库根前缀比对 ⇒ 拒绝 `../`；≤512KB；只读） | 引 `@tauri-apps/plugin-fs` 会把前端依赖树和 capabilities 配置一起拉进来，而"只读仓库文本"20 行就够 |
| 展示 | 左侧文件列表（208px）+ 右侧 `<pre>` + 行号（等宽、可选中、深色） | CodeMirror 6 是独立一单（新依赖 + binding），不跟"文件通路"混 |
| 切换 | `view` 状态；**切到 code 时 `set_canvas_rect(0,0,0,0)`** | ★GL 视图是独立 NSView，只隐藏 HTML 里的 `#canvas` **盖不住它** ⇒ 判据 ⑪b 专门盯这条 |

**★诚实边界**：仓库根取自编译期 `CARGO_MANIFEST_DIR` ⇒ **只在开发机直接跑二进制时有效**；
打包成 `.app` 后那个路径不存在，面板会显示「仓库根不可达（打包形态？）」——是如实报错，不是空白。
真要让 `.app` 读工程源码，需要"让用户选工程目录"（G4 的后续）。

**判据**（`check:studio-panel` 已扩到 **14 条**）：
- ⑪ `read_text` 被调用 + 面板渲染出内容 + 无错误；
- ⑪b 切到代码视图后 `set_canvas_rect` 收到 **w=0/h=0**（原生画布真的让开了）；
- ⑪c 文件列表渲染出条目且默认打开 `App.vue`（自证）；
- ⑪d **点第二个文件能切换**（`open` 通路，不只是默认那个能看）。

## UI 生产验收标准（2026-10-23）

出门后按大厂 IDE 的口径收敛，四件事落地（都写在 `ui/src/styles.css` 头部）：

| # | 标准 | 落地 |
|---|---|---|
| ① | **语义化 token** | 背景三级 `--bg-canvas/surface/elevated/overlay`、文字三级 `--fg/-muted/-subtle`、边框三级；组件里**不再出现十六进制色值**。旧名 `--panel/--panel2/--line/--dim` 保留为别名，存量组件零改动。 |
| ② | **4px 网格** | 间距只用 `--sp1..--sp8`；尺寸 22/36/40/48/320 全部落在网格上。 |
| ③ | **交互态齐备** | `hover` / `active` / `focus-visible`（2px accent 环）/ `disabled`；过渡 140ms `cubic-bezier(.4,0,.2,1)`。缺 focus-visible 的 IDE 键盘没法用。 |
| ④ | **尺寸对齐行业基线** | 活动栏 **48**（VS Code 同值）· 顶栏 40 · 右栏 320 · 状态栏 24 · 画布内边距 20。 |

**图标**：`ui/src/icons/StudioIcon.vue` —— **内联 SVG**，`24×24` 网格 · 1.5 线宽 · `currentColor` · 半像素对齐。
★**为什么不自带 npm 图标库**（lucide/tabler）：本目录刻意没有 `package.json`（#1187），装库要改**根** lockfile
并触发全仓 relink——实测两次都失败（`ERR_PNPM_UNEXPECTED_STORE`；换 `--store-dir` 后 relink 超时被杀）。
而 IDE 需要的图标是**封闭的少量集合**（VS Code 的 Codicon、JetBrains 的图标集也都是自带资源）⇒
自带一份规范线框图标零依赖、完全可控。**新增图标必须遵守同一网格与线宽。**

**空状态**：没有输入源时画布中央给「等待首帧 / 没有输入源：接 Android（adb）或 iPhone（--stream）」——
生产 IDE 不允许"一片黑让人以为坏了"。同理面板里**没数据就显示 `—`**，不摆 `0×0` 这种像真值的假值。

**去重**：`.kv`（键值行）此前在 Device/Pipeline/Runtime **三处一字不差抄了三遍** ⇒ 提到全局，
三处面板各自的 `<style scoped>` 删除。生产标准里"同一视觉只有一处实现"是硬要求。

## 出门 ≠ 完成：还没做的（按顺序）

| # | 缺口 | 现状 | 前置 |
|---|---|---|---|
| **G3** | iOS 通道 | ✅ **全链路通（#1190 · 2026-10-23）**：iPhone 12 → Mac（888×1920 · ~60fps · 9.6 Mbps · 10s 295 帧合法 H.264）→ **Studio 画布上屏**（`results/studio-ios-frame.png`）；首帧尺寸自动适配，不再需要手工设 `POC_LIVE_W/H` | — |
| **G4** | 编辑器容器 | **浏览 + 只读已成（#1190 续）**：左栏 ◈ 切换 · `list_files` 列真实文件（白名单 + ≤300 条）· 点谁读谁 · 行号展示 · **切走时把原生画布收成 0×0**（否则 GL 画面浮在代码上）；判据 ⑪/⑪b/⑪c/⑪d 守着。**还没做**：CodeMirror 6 编辑与写回、元素拾取、触摸回传 | CodeMirror 6（G-56.1 红线：绝不自研编辑器内核）+ 设备侧视图树 |
| **G5** | 持久化 / 模块化 | `src/main.rs` 单文件 291 行 | 会话配置落盘、面板可插拔；先按命令分组拆 Rust，再谈模块化 |
| — | 元素拾取数据源 | **确认不存在** | G-54 的 `locateAssertion` 仍无「断言 id → 代码位置」注册表；面板明说"不显示盒模型/计算样式" |
| — | 类型检查 | 未接 `vue-tsc` | 本目录没有 tsconfig；接的话要单独一份 `tsconfig.studio.json` 进 CI |
| — | 组件测试 | 无 | 只有端到端 10 判据；加 `vitest` 需先有 package.json（与"不是 npm 包"冲突，要先决定） |
