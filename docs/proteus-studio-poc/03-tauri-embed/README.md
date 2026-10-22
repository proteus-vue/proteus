# Proteus Studio PoC B2 —— Tauri 2 窗口里承载原生 GL 画面 + HTML 叠加

> 决策 #1169 · 承接 PoC B1（决策 #1168）
>
> B1 证明了「原生窗口里 decode→compose→present 只要约 1.4ms/帧」，但那是**自己开的 NSWindow**。
> Studio 的真实形态是：**Tauri 2 的窗口里，WKWebView 做 UI、原生 GL 画面垫在下面**。
> 这是 plan 里**唯一还没有数据支撑**的假设——本 PoC 只回答它。

## 判据（先注册）

| # | 判据 | 阈值 | 为什么 |
|---|---|---|---|
| R1 | 原生 NSView 能挂进 Tauri 的 contentView | `attach rc == 0` | 挂不上 ⇒ 这条路根本不通，性能再好也没用 |
| R2 | 找到 WKWebView 且背景透明化成功 | `webview_found && webview_transparent` | 不透明 ⇒ 原生画面被白底盖住，等于不能叠加 |
| R3 | 帧节奏不劣化 | fps ≥ 29.5 · 迟到 ≤ 1% · 间隔 p99 ≤ 50ms | 多一层 WebView 不该拖慢出帧 |
| R4 | 单帧成本不劣化 | compose+present 合计 p50 ≤ 8ms（与 B1 同阈值） | 直接与 B1 对账 |

## 方法

```
Tauri 2 窗口(NSWindow)
 └ contentView
    ├ PocGLView        ← 我们加的：解码 → 画布 FBO → blit → swap（与 B1 同一条管线）
    └ WKWebView        ← Tauri 自带：透明背景 + HTML 叠加层（十字线/面板/角标）
```

- 挂载：`poc_attach(tauri_window.ns_window())`，`addSubview:positioned:NSWindowBelow`；
- 透明：遍历 contentView 子视图找 `*WebView*`，KVC `drawsBackground = NO`（Studio 实现里同样要这么干）；
- 驱动：Rust 后台线程按 30fps 绝对时基 sleep → `run_on_main_thread(poc_tick)`，
  **GL 上下文永远在创建它的线程（主线程）上 makeCurrent**；
- 计量：与 B1 完全同口径（compose / present 分开记账），可直接对账。

## 结论（2026-10-22 实测）

环境：Apple M1 / macOS 26.5 / Tauri **2.12.5** / GL `Apple M1`（Metal 后端 4.1）/ VideoToolbox / 720p30 合成源

三轮各 22s：

| 轮 | fps | 间隔 p99 | compose p50 | present p50 | **合计 p50** | 迟到 | CPU |
|---|---|---|---|---|---|---|---|
| 1 | 30.34 | 44.5ms | 0.839 | 0.519 | **1.36** | 0% | 8.1% |
| 2 | 30.34 | 49.6ms | 0.866 | 0.572 | **1.44** | 0% | 8.5% |
| 3 | 30.35 | 45.2ms | 0.867 | 0.558 | **1.43** | 0% | 8.8% |

| 判据 | 实测 | 判定 |
|---|---|---|
| R1 挂进 Tauri contentView | `attach rc=0` | ✅ |
| R2 WKWebView 找到且背景透明 | `found=1 · transparent=1` | ✅ **HTML 能叠在原生画面上** |
| R3 帧节奏 | 30.34 fps · 迟到 0% · 间隔 p99 44.5–49.6ms | ✅（但余量薄，见下） |
| R4 单帧成本 ≤ 8ms | **1.36–1.44ms** | ✅ |

⇒ **Studio 的核心形态成立**：一个 Tauri 窗口里，原生 GL 画面垫底、WKWebView 透明叠加做 UI，
单帧成本 **1.4ms**（与 B1 的原生窗口**同样量级**），CPU 8–9%。

### 与 B1 对账：代价在哪

| 项 | B1（原生窗口） | B2（Tauri + WebView） | 差 |
|---|---|---|---|
| 合计 p50 | 1.15–2.00ms | **1.36–1.44ms** | 持平 |
| 间隔 p99 | 34.8–40.8ms | **44.5–49.6ms** | **+8ms** |
| CPU | 7.0–8.2% | 8.1–8.8% | +1pt |

代价不在单帧渲染，而在**调度抖动**：多一层 WebView 合成后，vsync 的对齐变松，
p99 从 ~37ms 涨到 ~46ms——**仍在 50ms 判据内，但余量从 13ms 缩到 4ms**。
交互/叠加越重，这条线越要盯。

## 复跑

```bash
cd docs/proteus-studio-poc/03-tauri-embed
POC_VIDEO=/tmp/proteus-poc/720p30.mp4 POC_SECONDS=15 \
POC_JSON=results/readout-tauri.json cargo run --release
```

## ★踩坑记录（每条都实测过，省下次两小时）

1. **`setup()` 里拿不到配置窗口**：`get_webview_window("main")` 返回 `None`；此时去遍历 labels
   会直接在 tao 的 ObjC 回调 `did_finish_launching` 里 panic ⇒ `panic in a function that cannot unwind` ⇒ abort
   （连 `catch_unwind` 都抓不到）。⇒ `setup` 里只起线程，等 loop 起来后再轮询。
2. **不要在 `setup` 里直接 `run_on_main_thread`**：事件循环还没起，同样 abort。
3. **不要从后台线程碰窗口对象**：`get_webview_window` 会触发 WKWebView 跨线程 ObjC 异常 ⇒
   `fatal runtime error: Rust cannot catch foreign exceptions`。
4. **`ns_window()` 给的是 `NSWindow`（TaoWindow），不是 NSView**：直接当 NSView 用会
   `-[TaoWindow bounds]: unrecognized selector` ⇒ ObjC 异常穿进 Rust ⇒ abort。
   正确做法：`isKindOfClass:[NSWindow class]` 后取 `contentView`。
5. **ObjC 异常必须在 ObjC 侧兜住**（`@try/@catch`）：穿到 Rust 就是 abort，没有栈、没有消息。
6. **`generate_context!` 要求图标存在且是 RGBA PNG**，否则编译期就失败。

## 诚实边界

1. **只看能否共存 + 成本**：不评判 HTML 叠加层的交互/无障碍/命中测试（那是 Studio 真正的工作量）；
2. **KVC 设透明是 PoC 手法**：生产要走 Tauri 的透明窗口配置或自绘 layer，路径不同、风险不同；
3. **不是最终壳**：没有菜单栏/多窗口/面板拖拽，只验证「原生画面 + Web UI」这一层；
4. 本机有并发负载（同仓另一会话在跑测试），p95 波动主要来自它。
