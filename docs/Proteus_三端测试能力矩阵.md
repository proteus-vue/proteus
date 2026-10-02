# Proteus 三端测试能力矩阵（覆盖对照基线）

> 生成日期：2026-10-02 ｜ 用途：回答「三端测试范围是否对齐」——**缺口可查、可勾销**。
> ★纪律：本表**只列有产物证据或代码证据**的项；「缺」= 全仓无对应实现（不是"没找到"）。

## 1. 矩阵（按能力域）

| # | 能力域 | Android | iOS | 鸿蒙 | 备注 |
|---|---|---|---|---|---|
| 1 | **布局核心（Rust）** | ✅ JNI | ✅ staticlib | ✅ C ABI | 同一份源码；三端产物均真机跑通 |
| 2 | **4050 元素应用级基准** | ✅ A/B 5 轮 | ✅ L1/L2 | ✅ L1 | 统一口径见 `hosts/results/cross-end-4050.json` |
| 3 | **L2 光栅级对照** | ✅ `soft_raster_ms` | ✅ `drawHierarchy` | ⛔ 架构性不适用 | 鸿蒙渲染由 RS 进程负责（无宿主 CPU 光栅路径） |
| 4 | **长列表复用池** | ✅ `recycle` | ✅ `V12_scroll_recycle` | ✅ **已补** | 鸿蒙 `recycleProbe`：**reuse_ratio 0.9962**（4000 行/400 帧，created=30/reused=7936/max_live=30） |
| 5 | **滚动（平台侧）** | ✅ `scroll`/`scroll-core`/`scroll-native` | ✅ V12 滚动帧 | ◐ **帧率已采** | 鸿蒙 `scrollProbe`（`postFrameCallback` 逐帧）：61 帧 · **p50 16.64ms（60fps）** · p95 66.62ms · avg fps 31.9；★滚动驱动的是 ArkUI Scroll 容器（非 Proteus 渲染路径），深度接线待做 |
| 6 | **命中测试（三层）** | ✅ `hit` | ✅ `hit_probes`（与 Android 同探针） | ✅ **已补** | 鸿蒙 `hitProbe`：**6/6 与两端逐位一致**（同场景同探针点） |
| 7 | **手势** | ✅ `gesture`（GestureDetector；tap/longpress/fling + 负向计数） | ◐ **tap+longpress 全链已通（真机 PASS）** | ⛔ **缺** | iOS：`V9_event_dispatch`（tap 3 探针，PASS）+ `V16_gesture_split`（2 tap + 2 longpress，**零串扰负向判据**，6/6 PASS）——注入 → 核心命中 → 冒泡派发；★真实触摸层已实现 500ms 时长分流（tap/longpress/拖动三分支）。**swipe/fling 待补**；鸿蒙待补（`packages/gesture` 已三端中立） |
| 8 | **文本通道** | ✅ drawText/StaticLayout 分流 + 归因 | ✅ CoreText（`measureText`） | ✅ **上屏已通（含单位模型）** | 鸿蒙：`textProbe`（typography 200 项/8.0ms）+ 上屏（content modifier 回调绘制）；**单位模型已修**：RenderNode/canvas 是**物理 px**、host 属性是 **vp**——ArkTS 侧 ×`vp2px(1)` 换算（一处），host 尺寸 ÷密度；真机截图色块+文字双重可见 |
| 9 | **字体族映射** | ✅ `font-family`（与 iOS V13 同契约） | ✅ V13 | ⛔ **缺** | 鸿蒙待补 |
| 10 | **原生组件混用（L3）** | ✅ `native`/`native-host`/`shot-scroll-native` | ❌ **缺** | ⛔ **缺** | iOS/鸿蒙待补（方案坑位 #4 的核心） |
| 11 | **结构变更（splice）** | ✅ `splice` | ✅ **已补**（`splice_probe`） | ✅ **已补**（`spliceProbe`） | **三端同树同 payload 4/4 判据全过**（rects 4→5 · 0/1 · 新节点高 50.0 · 重排 5 有界）；`apply-ops` 仍待 iOS/鸿蒙 |
| 12 | **整树虚拟化（mount-virtual）** | ✅ `mount-virtual` | ✅（V12 同族） | ⛔ **缺** | 鸿蒙待补 |
| 13 | **JS 引擎闭环** | ✅ `js-engine`/`js-batch`/`js-render` | ✅ JSC 现场编码 | ⛔ **缺** | 鸿蒙待补（ArkTS 已含 JIT 运行时，接法待定） |
| 14 | **Vapor 指令流** | ✅ `vapor`/`vaporAb`/`vaporList` | ✅（vapor 场景） | ⛔ **缺** | 鸿蒙待补 |
| 15 | **平台零参与动画（MA0-RT）** | ✅ `platform-anim`/`platform-anim-node` | ✅（CA 动画） | ⛔ **缺** | 鸿蒙待补 |
| 16 | **内核驱动动画（kernel-anim）** | ✅ `kernel-anim` | ✅ | ✅ **已补** | 鸿蒙 `kernelAnimProbe`（anim_seek+updates 读数）：曲线终态**精确 120** · easeOut 半程 **105**（前快后慢，>线性 60）· 滚动联动 0/-80/-160 **精确映射**；★scroll=0 读到 -1 系内核「无变化不重发」语义（已文档化，非缺陷） |
| 17 | **App 路由栈（M5）** | ✅ `app-stack` | ✅ `app-stack` | ✅ **已补（真机判据绿）** | 鸿蒙：`app-stack.ts` **移植副本**（零运行时依赖；逐字节同步校验 `sync-core.sh`，验收自动跑）+ 场景探针（与两端同口径 depth=20000）；`check-app-stack.py` 三端共用——①–⑥ 组全绿（**真机 ArkTS 证据**），⑦ 组如实跳过（未接 ScreenExecutor） |
| 18 | **宿主运行时（G-39）** | ✅ `host-runtime` | ✅ `host-runtime` | ⛔ **缺** | 鸿蒙待补 |
| 19 | **内存读数** | ✅ `proteus-mem` | ✅ `delta_mb` | ⛔ **缺** | 鸿蒙待补 |
| 20 | **截图回归** | ✅ `shot`/`shot-native` | ✅（L4/sim-selfdraw） | ◐ 截图（人工取回） | 鸿蒙：**渲染树架构修正后**色块+文字双可见（`results/render-root-arch.jpeg`）；自动化像素判据待接 |
| 21 | **一致性快照（L2-L4）** | ✅ | ✅ | ⛔ **缺** | 鸿蒙待补 |
| 22 | **Perfetto / 帧率** | ✅（Perfetto 接入） | ◐（帧统计） | ⛔ **缺** | |

**统计**：Android 22/22 · iOS **16/22** · 鸿蒙 **11/22**（持续推进：鸿蒙 4→11 · iOS 15→16）。

## 2. 缺口归因（为什么鸿蒙最少）

鸿蒙宿主是**本轮（2026-10-02）从零建成**的：昨天只有"接入包装"，今天才有
"装机 + RenderNode 直绘 + 4050 基准"三件事。其余能力域需要**逐个把既有 C ABI 接上**
（`proteus_layout_*` 已在，缺的是宿主侧调用与测量装置）——属**工作量**，非**架构障碍**。

iOS 的缺口（手势 / 原生组件混用 / 整树虚拟化 / JS 引擎闭环）是**历史遗留**：iOS 宿主先做了
"布局基准 + CALayer 渲染"主线，周边能力域未铺开（「结构变更」本轮已补，见上表 #11）。

## 3. 补齐优先级（建议，按「方案价值 × 成本」）

| 优先级 | 缺口 | 端 | 理由 | 估时 |
|---|---|---|---|---|
| **P0** | 命中测试 | 鸿蒙 | C ABI 已存在；`hit_probes` 是"三端共享核心"的直接证据（与 Android/iOS 同探针逐位对比） | 0.5 天 |
| **P0** | 长列表复用池 | 鸿蒙 | `proteus_recycle_*` 已存在；与 iOS V12 同一条路 | 1 天 |
| **P1** | 文本通道（绘制） | 鸿蒙 | `styled_string.h` + ArkGraphics2D 齐备；4060 场景的算力大头 | 1.5 天 |
| **P1** | 手势 | iOS/鸿蒙 | `packages/gesture` 已三端中立 | 各 0.5 天 |
| **P1** | 结构变更（splice/apply-ops） | iOS/鸿蒙 | `proteus_layout_splice`/`apply_ops` 已存在 | 各 0.5 天 |
| **P2** | 原生组件混用 | iOS/鸿蒙 | 方案坑位 #4；但鸿蒙需 XComponent 或 NodeContent 方案 | 各 2 天 |
| **P2** | JS 引擎闭环 | 鸿蒙 | ArkTS 自带 JIT，接法需设计（与 iOS JSC 不同路径） | 2 天 |
| **P2** | Vapor / 动画 / 虚拟化 / 内存 / 快照 | 鸿蒙 | 逐个把既有 C ABI 接上 | 各 0.5–1 天 |

## 4. 本轮（2026-10-02）已完成的补齐

**口径层**：
- ✅ **L2 光栅级对照**：iOS 补 `drawHierarchy` 真对照（原 `layout_ms` 误标为绘制）；
  Android 补双方 `soft_raster_ms`；统一口径生成器 `scripts/gen-cross-end-4050-report.mjs`。
- ✅ **L1 口径统一**：三端共用"建树+排版+指令送达"定义（iOS 补入 `rust_layout_ms`）。
- ✅ **Android L2 缺口修复**：1.673× → **0.349×**（显示列表复用；见代码注释的真因归因链）。

**鸿蒙能力域（4 项，全部真机读数）**：
- ✅ **命中测试**（P0）：`hitProbe` 6/6 逐位一致；
- ✅ **长列表复用池**（P0）：`recycleProbe` reuse_ratio **0.9962**（对齐 Android 0.9947 / iOS 95.5%）；
- ✅ **结构变更**（P1）：`spliceProbe` 4/4 判据（与 Android 同 payload）；
- ✅ **文本通道**（P1，探针 + **上屏**）：`textProbe` 200 项/8.0ms；**上屏已通**——
  `proteus_render.cpp` 的 `DrawTextCallback`（content modifier 回调 → typography 绘制），
  真机截图四段文字可见（`results/render-text-demo.jpeg`）。
  ★所有权实测（两轮定位，已写进代码注释）：`FontCollection` 跨 `CreateTypographyHandler`
  **复用会 CppCrash**（Run B）⇒ 采用"每次迭代完整创建/销毁"形态（Run A，可复现）。
  ★指令切分修正：首版用第一个 `}` 截断 JSON——含 `}` 的文本会断；改**大括号计数 + 字符串感知**。

## 5. 诚实边界

- 本矩阵的「✅」= **有真机产物或代码证据**；「⛔ 缺」= 全仓无实现（可用 `grep` 复核）；
- **不是**"测试范围不重要"——它是方案 §9 的验收面，缺口即**未验收面**；
  本文把缺口显式化，避免"以为三端都测过了"的误判。
- 鸿蒙 4/22 不代表"鸿蒙做得差"——它是**本轮新建成**的宿主（昨天为零），
  其余能力域均有**现成 C ABI**，属可预期的工作量。
