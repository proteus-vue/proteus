# Proteus Studio PoC（G-56）

> 主线：`docs/proteus-studio-plan/`（G-56 自有宿主壳）。
> 本目录只放**会改变决策的验证**，不放推演。

## 为什么要 PoC

plan 的诚实边界里有一条是**决定生死**的：

> **libmpv 离屏 FBO 真嵌入未验证** —— 需 PoC

因为 Studio 在四宿主矩阵里唯一 ✅ 的两项是 `device.native` 与 `form.mobile`；
`form.mobile` 先例最少（推后），而 `device.native` 的技术前提就是「mpv 只解码、
画面画进**我们自己的** FBO/合成层」。这条不成立，Studio 就退化成"又一个 mpv 播放器窗口"，
存在理由塌掉一半。

## PoC 清单

| 编号 | 验证 | 状态 | 结论 |
|---|---|---|---|
| **A** | 720p30 解码 → 我们的 FBO（ffmpeg+VideoToolbox，无窗口 CGL） | ✅ 已测 | **管线成立**：30.01fps / 0 丢帧 / 单核 5.2%；P2 渲染段不可判定（2.7–9.2ms 漂移） |
| **B1** | 同一条管线放进**真实窗口**：compose / present 分开量 | ✅ 已测 | **窗口内 1.4ms/帧**（合计 p50 1.15–2.00），0 迟到，CPU 7–8%；并更正 A 的 P2 高估 |
| **B2** | 把这层 NSView 挂进 **Tauri 2 的 WKWebView 窗口** | ✅ 已测 | **成立**：`attach rc=0`、WebView 透明叠加成功、单帧 **1.4ms**；代价是间隔 p99 **+8ms**（余量 13→4ms） |
| **C** | 真机投屏流（不是合成源）复测 | ✅ 已测 | **真机是 100–120fps**（预算 33.3→9.3ms）；窗口路径迟到 0.65% 通过、离屏 3.40% 不通过 |
| **阶段 1** | 三栏 Studio 骨架：画布位置由 HTML 布局驱动 | ✅ 已落地 | 画布矩形与 CSS 网格手算一致；并抓到「画布上下颠倒」这个从 B2 就存在、只因没做视觉验证而漏掉的 bug |
| **实时投屏** | `adb exec-out screenrecord` 裸 H.264 → 自建传输层 → 硬解 → 画布 | ✅ 已收口 | **VT 硬解 59.5fps / CPU 20.5%（比软解省 37%）**；拆包修完画面干净；`empty` 空转 74%→2.5% |

## 环境（本机实测，别照抄网上的）

| 事实 | 影响 |
|---|---|
| `github.com` 的 **HTTPS 不通**（`curl` 8s 超时，返回 000），SSH 通 | `brew` 默认从 GitHub 拉仓库/瓶装包会**静默卡死**（实测 4 分钟只涨 80KB） |
| `mirrors.tuna.tsinghua.edu.cn` 通（瓶装包 200 / 1.8s） | 用清华镜像装 |
| 主 `/opt/homebrew` 有 34 个公式会被 mpv 依赖连带升级 | **不碰主 brew**：装到独立前缀 |

独立前缀安装（一次性，已在本机做完）：

```bash
export HOMEBREW_PREFIX=/Volumes/data1/brew
export HOMEBREW_CELLAR=$HOMEBREW_PREFIX/Cellar
export HOMEBREW_REPOSITORY=$HOMEBREW_PREFIX/Homebrew
export HOMEBREW_BOTTLE_DOMAIN=https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles
export HOMEBREW_API_DOMAIN=https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles/api
export HOMEBREW_NO_ANALYTICS=1 HOMEBREW_NO_AUTO_UPDATE=1 CI=1

git clone --depth=1 "https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/brew.git" "$HOMEBREW_REPOSITORY"
"$HOMEBREW_REPOSITORY/bin/brew" install mpv
```

## 判据纪律

每个 PoC 的判据**先注册再测量**（写在各自 README 顶部），跑完只填实测值，
**不允许**看完数字再回头放宽阈值。任一条不过 ⇒ 记录读数、给结论、走降级链（INV-ST-05），不硬做。

## 目录

```
native/              共用原生层（B2 与骨架共用同一份，别复制）
  embed_view.m        解码 → FBO → blit → swap；poc_attach/set_frame/dump/report
  live_stream.h       实时流传输层：拆 NAL / 判帧 / 打 PTS / 环形队列 / 取参数集
01-offscreen-fbo/     PoC A：无窗口 CGL，离屏基线
02-window-present/    PoC B1：真实 NSWindow，compose/present 分开量
03-tauri-embed/       PoC B2：Tauri 2 + 透明 WKWebView 叠加
04-device-stream/     PoC C：真机 screenrecord 流（读参数 + 帧率档位）
05-studio-shell/      阶段 1 骨架 + 实时投屏（默认硬解）
  dist/index.html     三栏布局（左栏/画布/检查器/状态栏）
  src/main.rs         Tauri 侧：set_canvas_rect / stats / dump / POC_SECONDS 取数
  results/            画布自证 PNG + 硬解/软解各 3 轮读数
```
