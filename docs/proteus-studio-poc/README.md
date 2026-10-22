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
| B | 同一条管线嵌进 Tauri 2 窗口（swap + 合成） | 未开始 | A 已给出基线 |
| C | 真机投屏流（不是合成源）复测 | 未开始 | 依赖 A/B |

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
01-offscreen-fbo/     PoC A：无窗口 CGL + libmpv render API + 采样
  fbo_harness.c       采样器（帧间隔 / 渲染段 / 丢帧 / CPU）
  run.sh              生成确定性测片 → 编译 → 跑 → 落 JSON
  results/            读数（入库，供跨机对账）
  README.md           判据 + 方法与边界
```
