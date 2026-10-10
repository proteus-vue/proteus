# S3 · 编译期交互下沉（Compiled Interaction）落地方案（v1）

> 类型：plan（§14 六腿之 S3 · 输入延迟专项 #767 的"差异化护城河"）
> 触发：用户「先专项攻破输入延迟」（#767）→ S1.5/S1.1/S2/S6 已交付 → **S3 是 L2/L3 的公共前置**（Dactyl §1.3）
> 关联：`14-input-bridge-latency.md`（S3 设计意图 §4）· `15-dactyl-demo.md`（L2/L3 验收）· `packages/animation`（声明式语法）· `packages/layout-core-rust/src/anim.rs`（`AnimDrive::Progress` 手势跟随）· `packages/worklet`（Skyline worklet，本项吸收为三端统一）
> 状态：**立项（待实现；S3-T1 最小切片设计就绪）**

---

## 0. 结论先行

**S3 的目标**：让"跟手"这类高频交互**不进入 JS**（`js_involved_gestures_ratio → 0`）——把交互**折叠成内核可执行指令**，而非运行时跑 JS handler。这是 §14 与 Flutter/RN 拉开差距的**唯一同时拿到「原生延迟 + JS 生态 + 三端一致」的位置**。

**★关键：底座已存在，缺的是"接线"**（本项**不是从头造**）：
- **跟随机制面**：`anim.rs` 的 `AnimDrive::Progress`（`seek(u)` 外部设进度，`tick` 不推进）——注释原文「**手势跟随**的机制面：手指移动 → `seek`，动画值**精确跟随**（≤1 帧延迟的判据由此可测）」。
- **批量指针**：Android `proteus_dispatch_pointers`（一帧 N 点一次 FFI）已在 `host.rs`；iOS vtable 已声明待接。
- **声明式语法**：`packages/animation`（choreography/timeline/presets/compile）——S3 折叠产物**复用**它。
- **每帧重施**：内核 `anim` tick + 宿主帧回调（`Choreographer`/`CADisplayLink`）已就绪。

**⇒ S3 = 把"声明一个跟手元素"接到上述三件既有件上**（编译期产规格 + 宿主喂指针 → `seek` → 变换）。

---

## 1. 三级下沉模型（§14 §4 S3，本文落成可执行形态）

| Tier | 交互 | 执行位置 | 是否进 JS | 底座 |
|---|---|---|---|---|
| **Tier 1** | 按压态 / 滚动联动 / CSS transition·animation / 共享元素 | **内核 IR**（`anim.rs` 曲线求值 + Timeline） | **0** | ✅ 已有（S1.1 是按压态的一半） |
| **Tier 2** | **拖拽跟手 / swipe-to-delete / 下拉刷新 / 滚动吸附** | **内核 IR**（`AnimDrive::Progress`）+ 宿主喂指针 | **0** | ◐ 机制面已有，**缺"声明 + 接线"** |
| **Tier 3** | 请求 / 路由 / 校验 / 跨节点副作用 | JS（照常），**不得阻塞输入**（异步、可打断） | 1（异步） | ✅ 现状 |

**本文主攻 Tier 2**（跟手）——它是 `js_involved_gestures_ratio == 0` 的核心，也是 L2 的判据。

---

## 2. 设计：声明式"跟手"原语（`v-follow` / `:follow`）

### 2.1 作者写法（一份源码多端）

```vue
<view v-follow="{ axis: 'x', source: 'dragX', clamp: [0, 200] }" class="knob" />
```

- `axis`：`x`/`y`/`both`（跟手位移轴）；
- `clamp`：位移夹取区间（越界回弹/吸附，Tier 2 的 swipe-to-delete 场景）；
- 可选 `spring`：松手回弹（复用 `SpringParams`）——**松手后才回一条 JS**（记一次业务结果）或纯内核弹回。

### 2.2 编译期（新增 pass `interaction-folding`）

**可折叠判据（全部满足才折，否则保持回 JS handler——对齐"宁可少合并不错合并"）**：
1. 交互是**手势驱动**（pan/drag 类），非点击副作用；
2. 影响面**限于本节点的合成/变换属性**（`translation/scale/alpha/rotation`——§15 §7.3 同集）；
3. 不读非确定值（时间戳/随机/外部状态）；
4. handler 体是**纯"位置 → 属性"映射**（可静态化为内核 anim 曲线 + 轴向映射）。

**折叠产物**（进订阅表 / IR，纯 JSON 可序列化）：
```jsonc
{ "nodeId": 7, "follow": { "axis": "x", "clamp": [0,200],
  "field": "translateX", "seek": "pointer", "spring": null } }
```

### 2.3 运行期（零 JS 跨界）

```
宿主 MOVE 事件（官方触摸时间戳）
  → 一组指针点（多指）→ proteus_dispatch_pointers（一帧一次 FFI，S1.4）
  → 内核：按 follow 规格把 指针位移 → 目标值（夹取/映射）→ anim.seek（Progress）→ 写字段
  → 宿主帧回调采样 → 绘制变换（translation/scale/alpha）
```
**全程不过 JS**；只有"松手判定/业务结果"（如 swipe-to-delete 触发删除）才回一条 JS handler。

### 2.4 与既有 `:style` / 动态 `:class` 的关系
- `v-follow` 产出的是**内核 anim 规格**（transform 通道），不是 `:style` 的静态字段——互补；
- `packages/worklet` 从"仅 Skyline"提升为"三端统一的内核指令"（§14 §4 S3 第 4 条）：Skyline 走 `wx.worklet`，App 三端走本方案内核指令——**同一份 `v-follow` 声明多端同形**。

---

## 3. 最小切片 S3-T1（Android · 单指单节点 · 先证"零 JS 跟手"）

| 项 | 内容 |
|---|---|
| 范围 | **Android** 一端；**单指**；**一个节点**；**X 轴**翻译跟手（无夹取/回弹） |
| 编译期 | `v-follow="{axis:'x'}"` ⇒ 订阅表加 `follow` 规格；产诊断（Tier 3 交互不折叠） |
| 内核 | `anim.rs` 复用 `AnimDrive::Progress`：一个"pointer→progress→translateX"的轻量跟随规格（或直接"指针位移→字段"） |
| 宿主 | `ProteusHostView.onTouchEvent` 的 MOVE ⇒ 经 `dispatch_pointers`（已有）喂指针 ⇒ 内核 seek ⇒ 重绘 |
| 判据 | 新烟囱 `s3`（Dactyl L2 迷你版）：拖拽节点 ⇒ 其内核变换跟手 + **`js_involved_gestures_ratio == 0`**（宿主计数：MOVE 期间 0 次 JS 回调） |
| DoD | 真机：拖拽时 **MOVE 不触发任何 JS**（宿主计数）+ 节点 transform 跟踪手指（几何可核） |

**估时**：S3-T1 ≈ 3–4 人日（编译期折叠 + 内核跟随规格 + Android 宿主接线 + 判据）；全 Tier 2 三端 ≈ 8–12 人日。

---

## 4. 风险（对齐 §14 §7 / §15 §11）

| # | 风险 | 处置 |
|---|---|---|
| R1 | **折叠误判**（把有副作用的 handler 当纯函数折） | 判据保守（全部满足才折）+ 编译期如实报告折叠率 + 反例测试 |
| R2 | **合成属性边界**（用了需重排/重绘的属性做装饰 ⇒ demo 自己是压力源） | §15 §7.3 红线 + `check:dactyl-visual-nonblocking` 门禁（AST 扫描） |
| R3 | **多端语义漂移**（三端各自实现跟随） | 跟随语义**只在内核**（`anim.rs`），三端宿主只喂指针（同 `hit.rs`/`anim.rs` 的"同一份内核"纪律） |
| R4 | **与 JS 权威冲突**（跟手期间 JS 也写同一字段） | 优先级：**跟手期间内核优先，松手后 JS 权威恢复**（同 S1.1 的按压态优先级契约） |
| R5 | **worklet 三端同形收口**成本 | 先只做 App 三端内核指令；Skyline 走 `wx.worklet`（既有）；统一 IR 为后续 |

---

## 5. 诚实边界

- **现状**：交互**几乎 100% 进 JS**（§14 §1.4 B3）——本项之前，拖拽/滚动联动都过 JS。
- **本方案不包含**：任意 JS 动画函数（封闭集外 ⇒ 诊断回 JS）；`async`/网络/存储驱动的交互（Tier 3）。
- 目标 `js_involved_gestures_ratio < 10%`（长列表）为**目标值**，实测前不对外宣称（§14 §8）。

---

## 6. 交付批次

| 批次 | 内容 | DoD |
|---|---|---|
| **S3-T1 ✅** | Android 单指单节点 X 跟手（本方案 §3）——**已交付（决策 #776，判据 ㉞ 真机过）** | `js_involved_gestures_ratio == 0`（拖拽期）+ 节点 transform 跟手 |
| **S3-T2 ✅** | 夹取（`clamp`）+ 松手回弹（`spring`）+ swipe-to-delete（`snap`）——**已交付（决策 #777，判据 ㉟ 真机过）** | 跟手仍零 JS；松手后**内核弹簧**接管（过阈值滑出吸附 / 未过回弹归零）|
| **S3-T3 ✅** | 多指（接 S1.4 批量指针 ABI）——**已交付（决策 #778，判据 ㊱ 真机过）** | `ffi_calls_per_frame ≤ 1`（M 指） |
| **S3-T4** | 三端同形 + worklet 收口 + 门禁 `check:interaction-folding`（折叠率棘轮） | 三端同一份 `v-follow` 同结果 |
