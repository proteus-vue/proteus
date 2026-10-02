# Proteus Vapor 三端能力对照表

> 生成：2026-10-03 ｜ 回答「Vapor（编译产物驱动）在三端各自能跑到哪一步」——**差距可查、可勾销**。
> ★纪律：只列有**真机产物 / 判据**证据的项；「缺」= 该端无对应实现（不是"没找到"）。

## 一、Vapor 是什么（一句话）

`examples/pages/consistency-stress.vue` 等 SFC → **构建期编译**（`LayoutTemplate` + 订阅表）
→ **设备端实例化**（`instantiateTemplate`）→ 宿主建树（Rust 算几何）→ **订阅驱动增量**
（数据变 → 槽位求值 → **二进制指令** → 内核重排）——**JS 只产语义，几何一律内核算**。

## 二、能力矩阵（7 项）

| # | 能力 | Android | iOS | 鸿蒙 | 判据/产物 |
|---|---|---|---|---|---|
| 1 | **设备端实例化**（编译产物 → 节点树） | ✅ `runShort` | ✅ `V3_vapor_slot_pipeline` | ✅ `vaporProbe` | 三端均：模板 12 节点 → 实例化 26 节点（含运行时分配 id） |
| 2 | **订阅驱动增量**（二进制指令 → 内核几何变） | ✅ | ✅ | ✅ | Android/iOS：V3 单节点更新分位；鸿蒙：3 轮 / 183B / 探针宽 52→80 |
| 3 | **六端 SFC 压力夹具**（同一份 .vue） | ✅ `runStress` | ✅ `--stress` | ✅ `PROTEUS_SFCSTRESS` | 六端像素报告（44 节点） |
| 4 | **A/B 等价对照**（Vapor vs Vue 运行时） | ✅ `check-vapor-ab.py`（7 组） | ❌ **缺** | ✅ **已补** | Android：mount 几何逐节点 ≤0.01px + 更新/事件/绘制四路等价；**鸿蒙（2026-10-03）**：同一份判据——**mount 几何 9 样本 max_delta 0px** · **更新后 27 样本 max_delta 0px** · 两路 moved 一致 `[20,28,36]` · 文本双消费 `3/3` · 宿主补丁 3 次；④绘制通道/⑦事件路径按能力面**如实分档** |
| 5 | **虚拟化列表**（vapor 路 · 大列表） | ✅ `runVirtualList`（1000 行） | ◐ V4/V5（滚动补刷 + 像素） | ❌ **缺** | Android：物化行数有界 + 回顶签名恒等 |
| 6 | **事件路径**（tap → handler → 几何变） | ✅ 判据 ⑦（含冒泡链逐跳） | ❌ **缺**（V16/V17 是 Vue 路） | ❌ **缺** | Android：两路链 [11>10>0] / 逐跳位移 [30,5] 一致 |
| 7 | **绘制通道**（圆角/渐变/发光/裁剪/描边） | ✅ `probeChannels` 5 通道 | ✅（层上验证） | ◐ `probeChannels`（radius 真值；其余待渲染层） | — |

**统计**：Android **6.5/7** · iOS **4.5/7** · 鸿蒙 **5/7**（▲A/B 本轮补齐——最高价值缺口）。

## 三、缺口归因

- **A/B（#4）是最高价值的缺口**：它回答的不是"Vapor 能跑"，而是"**Vapor 跑出来的东西与
  Vue 运行时是否逐位等价**"——这是"Vapor 能替换 Vue 运行时"的**唯一量化证据**。
  · Android 已有完整 7 组判据（`hosts/android/check-vapor-ab.py`）。
  · iOS / 鸿蒙**各自都有 Vue 运行时能力**（iOS：`createAppRenderer` + selfdraw 适配器；
    鸿蒙：JSVM 可跑同一份 `bundle-vapor.js` 含 `abRender`）⇒ **材料齐备，缺的是接线与判据**。
- **虚拟化列表（#5）**：Android 有 vapor 路（`mountVirtual` + `scrollRows`）；iOS 的 V4/V5 是
  滚动补刷（等价能力但形态不同）；鸿蒙两份宿主方法都没实现。
- **事件路径（#6）**：Android 判据 ⑦ 最强（含**冒泡链逐跳**）；iOS 的 V16/V17 走 Vue 路
  （验的是适配器 + 手势分流，不是 Vapor 的动作表路径）；鸿蒙 `tapAt`/`onGesture` 未实现
  （`runShort` 的 tap 段按 `typeof` 自动跳过——不造假）。

## 四、补齐优先级（按「价值 × 成本」）

| 优先级 | 缺口 | 端 | 理由 | 成本 |
|---|---|---|---|---|
| ~~P0~~ | ~~A/B 对照~~ | ~~鸿蒙~~ | ✅ **已完成（2026-10-03）**：宿主桥补 `updatePatches`（含**文本先度量再注入**的闭环）+ 判据分档——mount/更新两路几何**逐位一致（0px）** | ✔ |
| **P1** | A/B 对照 | iOS | **成本重估（2026-10-03 实测）**：iOS 宿主缺 **`readRects`** / **`probeChannels`** 两个方法（A/B 判据的几何/通道读数依赖它们）——虽 `rects()` 功能等同但**命名与返回形状不同**（`proteus_layout_rects` 原样透传 vs Android 的 `{rects:{...}}` 包装）；且 iOS 的 `vapor-artifacts.json` 是**简化版**（5 节点模板 / 单 list 源，与 Android 的 12 节点/3 源/events/handlers **不同源**）⇒ 需先统一产物再接线。**估 1.5–2 天**（非 0.5） | 1.5–2 天 |
| **P2** | 事件路径 | 鸿蒙 | `tapAt`/`onGesture` 两方法 + 判据 ⑦ 分档（冒泡链已由 hitProbe 佐证） | 0.5 天 |
| **P3** | 虚拟化列表 | 鸿蒙 | `mountVirtual`/`scrollRows` 两方法（内核 C ABI 已有：`proteus_recycle_*`） | 1 天 |

## 四·补 · 鸿蒙 A/B 的实测细节（2026-10-03）

**链路**：`bundle-vapor.js`（与 Android 同一份，含 `mode:'ab'`）→ JSVM eval →
A 路（Vapor 编译产物）+ B 路（Vue 运行时 `abRender`）各自 mount → 逐节点比几何 → 三轮更新对照。

**读数**：A 26 节点 / B 39 节点（树形天然不同：Vapor 折文本进元素，Vue 是标准 vnode 树）·
**按语义文本节点对齐后 9 样本 max_delta=0px** · 更新后 **27 样本 max_delta=0px** ·
两路 moved `[20,28,36]` 完全一致 · 文本双消费 3/3 · 宿主补丁 3 次（`host_update_patch_calls`）。

**★本轮抓出的两个"分档写了但没生效"缺陷**（都在判据侧）：
`ok = False` 写在分档 `if/else` **之外** ⇒ 鸿蒙"如实跳过"仍判红，且**汇总行只报"有失败项"
而无具体 fail 消息**（极难定位）。⇒ 纪律：**分档的分支里必须连 `ok` 一起分支**
（判据的"跳过"路径与"失败"路径要一起设计，否则跳过等于没跳）。

## 五、诚实边界

- 本表「缺」= **该端未实现**（与矩阵 #14 的"Vapor 指令流"不同层级——那是"链能不能跑"，
  本表是"链上各项能力跑到哪一步"）。
- iOS 的 V4/V5（滚动补刷 + 像素验证）与 Android 判据 ④（绘制通道逐项等价）**形态不同**：
  前者验"滚动后屏幕与几何一致"，后者验"两条路通道签名相等"——**不可互相替代**。
- 鸿蒙 `probeChannels` 当前只返回 `radius`（渲染层其余通道待补，判据如实分档）。
