---
title: Rust 排版核心与绘制指令流
order: 28
group: 渲染层
---

# Rust 排版核心与绘制指令流

前一篇[渲染后端](/docs/framework/23-render-backend)讲的是「谁来画」；本篇讲**高频路径上的两个 Rust 组件**：算几何的排版核心，和承载「画什么」的绘制指令流。它们服务于同一条路线——**业务声明语义，几何与绘制由端上高效执行**。

## 为什么把布局放到 Rust

布局是**每次尺寸变化都要走一遍**的热路径。放在 JS 侧（或走 View 体系递归 measure）会有两个代价：跨语言次数多、且每次都要重新遍历整棵树。

`@proteus-vue/layout-core`（Rust）的做法是：**布局树持久驻留内核，按变更范围增量求解**——调用方给变更，内核只重算受影响的部分。

| 机制 | 作用 |
|---|---|
| **持久 taffy 树** | 引擎按句柄存活，不每次新建（新建会丢 taffy 内部缓存） |
| **平移传播** | 兄弟整体位移时免于重解 flexbox（6 条前提守卫，不满足则回退全量） |
| **跨节点度量复用** | 度量键含字号/字重/字族 ⇒ 同文本只真实度量一次 |
| **脏点压实** | 结构增删后回收孤点，内存有界 |

**实测**（真机报告 `bench-filtered-*.json`）：整树重排 **17.16 ms → 1.52 ms**（度量调用 6003 → 0）· 跨节点度量复用使 CoreText 调用**降 4 倍** · 4000 行列表 10 轮增删后**末轮孤点 0**。

### 手势 / 命中也在同一棵树

命中测试走**核心的全量树**，与「层是否物化」解耦——虚拟化下未物化的行照样能被命中（`V12` 实测：命中第 63 号节点）。这样滚动复用池与交互正确性不互相牵制。

## 绘制指令流（RenderCmd）

布局之后要把结果变成"画什么"。指令流是**平台无关的线性序列**，平台只需顺序消费，不做布局计算、不做样式解析。

```ts
import { layoutTreeFromPNode, solveLayout, attachParents, emitRenderCmds } from '@proteus-vue/layout-core'

const tree = layoutTreeFromPNode([pnode], { lengthContext })   // PNode → 布局树
solveLayout(tree[0]!, loose(width, height))                     // 求解几何
attachParents(tree[0]!)                                         // 建立父链（裁剪/裁剪判定用）
const { cmds, stats } = emitRenderCmds(tree, opts)              // → 绘制指令流
```

**三种指令**（`RenderCmdKind`）：`background`（纯色/渐变）· `text` · `image`；另有 `border` 与成对的 `pushClip` / `popClip`。

### 三条架构不变量

1. **绝对坐标**：每条指令自带绝对位置（父链偏移已累加）⇒ 平台层零换算；
   也让**视口裁剪**成为一次坐标比较（无需维护变换栈）。
2. **拍平不产生独立指令**：被拍平节点的绘制**并入父级指令**（`mergedFrom` 记录可验证），
   **不新建合成位图**——一旦破坏，iOS 上曾出现的 +78% 内存会以更难查的形式复发。
3. **paint-hint 编译期推导**：`isMonochrome` / `isPureBackground` / `shareableContent`
   随指令携带，平台据此决定 backing store 策略（**禁止运行时猜**）。

### 视口裁剪（overdraw culling）

`EmitOptions.cullToViewport` 让视口外的元素**不产出绘制指令**（几何仍参与布局）。
**默认关闭**——既有全量路径的读数不因它改变语义。

| 场景 | 指令条数 | 生成耗时 |
|---|---|---|
| 长列表 400×40（16401 节点） | **16001 → 1592（↓90.1%）** | 14 → 2 ms |
| 4050 元素（50×40） | 2001 → 1592（↓20.4%） | 3 → 2 ms |

⇒ 长列表的指令数从「**随内容增长**」变为「**随视口恒定**」。
★边界：贴视口边界的元素**保守保留**（可能是 1px 描边/阴影，裁掉即内容消失）；
「完全被遮挡」的剔除与「同色相邻合并」**尚未实现**。

## 当前状态（诚实分级）

| 能力 | 状态 |
|---|---|
| 排版核心（`@proteus-vue/layout-core`，npm 已发布） | ✅ 代码已落地 · 有单测 · **浏览器真值基准 21 用例**（golden）· 真机 conformance **17 用例 / 67 节点**，最大偏差 **0.375 dp**（合格线 0.5） |
| 绘制指令流（`emitRenderCmds` 等公开导出） | ✅ 代码已落地 · 有测试（含裁剪三条硬判据） |
| 端上消费（iOS CALayer / Android Canvas 宿主） | 🟡 **实验宿主**（`hosts/ios`、`hosts/android`），不是产品形态 |
| 与原生组件混用 | 🟡 仅 IR 声明 + 实验验证（地图 / WebView 原生嵌入） |

★**与「原生控件映射」路线的关系**：两条路线**按页面选**——
系统特性优先的页面走原生控件映射（[原生能力](/docs/20-native-backend)）；
高频列表 / 动画走本篇的高性能路径。选择依据是[渲染后端](/docs/framework/23-render-backend)的能力声明。

★**引擎选择与兼容性**：Rust 侧用 **taffy**（Flexbox；开启 `grid` / `taffy_tree`）。
**版本锁定 0.14**——0.13 存在 measure 指数退化（本仓实测）。

## 可复现验证

| 门禁 | 锁什么 |
|---|---|
| `pnpm check:vapor-perf` | 性能棘轮（上限 + 优化路径生效证明） |
| `cargo test --manifest-path packages/layout-core-rust/Cargo.toml` | Rust 侧全量单测（含跨语言 golden） |
| `npx tsx scripts/bench-culling.mjs 400 40` | 视口裁剪收益（零设备） |

```bash
cargo test --manifest-path packages/layout-core-rust/Cargo.toml   # Rust 单测
npx tsx scripts/bench-culling.mjs 50 40                           # 4050 场景裁剪收益
pnpm check:vapor-perf                                             # 性能棘轮
```

## 本组导航

- [渲染后端](/docs/framework/23-render-backend)：五后端与可插拔渲染
- [Vapor 更新路径](/docs/framework/43-vapor-update-path)：编译期更新与槽位直写
- [Flutter 后端](/docs/framework/24-flutter-backend)：widget 映射路线
- [一致性验证](/docs/framework/29-conformance)：浏览器真值基准
