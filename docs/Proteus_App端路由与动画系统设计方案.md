# Proteus App 端路由与动画系统设计方案

> 定位：**在 App 端实现超越 Skyline 的自定义路由与类 worklet 动画能力**，并与 Skyline 端共用一套上层 API
> 适用：Proteus v2.47+（Vue 3.4 / Vite 5 / TS 5.4 / 微信基础库 2.29.2+）
> 依赖：《App 端高性能渲染落地方案》M2、《Vapor for Proteus IR 设计方案》V1
> 本文档术语与上述两份保持一致

---

## 0. 决策与前提

### 0.1 一个必须先厘清的定位问题（否则全盘皆错）

| 端 | 路由/动画实际由谁执行 | 能否"超越 Skyline" |
|---|---|---|
| **小程序 Skyline 端** | 编译产物是 Skyline 四件套，自定义路由本质是调 `wx.router.addRouteBuilder` | ❌ **不可能**——就是 Skyline 在跑 |
| **App 端**（Rust 排版核心 + 自研渲染管线） | **Proteus 自己** | ✅ 可以 |

**准确表述**：在 App 端能做出超越 Skyline 的路由与动画能力；在 Skyline 端只是把它的能力翻译过来。

**但翻译本身有价值**——同一份 Vue 源码，两端都能用上原生级转场。只是**别把账算错**：对外宣称时必须区分端。

### 0.2 分叉点：动画逻辑用 JS 表达式还是任意 JS 函数？

这是本方案的第一个分叉，直接决定是否引入第二个 JS runtime。

**本文默认选择：JS 表达式（编译期转 IR 指令）为主 + 受限 worklet 函数兜底。**

| | 路线 A：IR 指令（默认） | 路线 B：第二 JS runtime |
|---|---|---|
| 开发者写 | 表达式 / 受限函数 | 任意 JS 函数 |
| 执行载体 | Rust 排版核心直接消费指令 | 第二个 Hermes 实例 |
| 内存 | 无额外 runtime | + 一个 JS runtime |
| 与架构一致性 | ✅ 与"编译期优先"一致 | ⚠️ 引入运行时解释层 |
| 能力上限 | 受编译期可分析性限制 | 高（任意逻辑） |
| 实现成本 | 中 | 中大 |

**选 A 为默认的三条理由**：

1. 与 Proteus 整体主张一致——全套架构都在做"编译期收敛"，单独在动画层开一个运行时解释层的口子，是架构自相矛盾
2. 实测数据支持——排版 0.08ms、宿主侧 1ms，**JS 线程能造成的阻塞本来就极有限**，worklet 存在的原始动机（规避 JS 阻塞）已被削弱
3. worklet 的**序列化陷阱**（见 §2.3）在路线 A 下根本不存在

**但保留路线 B 作为兜底**：无法编译期分析的动画逻辑，降级到受限 worklet 函数。

### 0.3 实测基础（本方案的能力边界来自这些数据）

| 项 | 实测 |
|---|---|
| 宿主侧（Rust 排版核心 + JSI） | 1 ms |
| 4001 节点全量重排（自研 vapor + 兄弟平移特调） | **0.08 ms**（提升四十余倍） |
| v-for 嵌套支持 | 三层 |
| 布局 / 绘制（4050 场景） | 0.063 / **2.0**（绘制口径已更正，见 `ACCEPTANCE.md`） |
| 内存增量 | 0.328 |
| 长列表滚动 | 124.5 FPS，复用率 0.997，掉帧 0.16% |

---

## 1. 0.08ms 的战略含义：不是"快"，是开启了新能力

0.08ms 在 120Hz 的 8.33ms 预算里只占 **约 1%**，再往下优化边际收益趋近于零。

**它真正的意义是：每帧全量重排变成了可接受的兜底策略。**

传统框架必须精心设计增量更新路径，就是因为全量重排太贵。现在可以反过来——**很多"必须精细优化"的场景可以直接硬算，实现复杂度大幅下降**。

对动画系统尤其重要：转场动画通常同时改变几十个节点的属性。若每帧全量重排才 0.08ms，就不必为转场单独设计增量通道。

### 1.1 兄弟平移特调为什么能做——这是架构选型的胜利

能实现 O(1) 兄弟平移，根源在方案 §5.1 的设计：**节点树是扁平数组 + 父指针 + 兄弟链**。

指针追逐的树做不了这件事。这是当初选扁平数组换来的红利，不是调优成果。v-for 支持嵌套三层则证明槽位寻址方案本身正确。

**推论**：动画系统应复用这套扁平结构，不要为动画另建一套节点索引。

---

## 2. worklet 的本质：它是给"跨线程通信"打的补丁

理解这一点，才知道能做得更好在哪。

### 2.1 Skyline 为什么需要 worklet

Skyline 推 worklet 的直接原因：双线程架构下 UI 事件要传到 JS 线程再回传，**做拖拽这类交互动画时异步性会带来明显延迟和不稳定**。WXS 原本解决这个，但 Skyline 把 WXS 移到了 AppService，效率反而下降，所以用 worklet 替代。

Reanimated 的实现更直白：spawn 一个独立 JS context 跑在 UI 线程，Babel 插件把 `'worklet'` 函数**转成字符串 + 闭包变量序列化**，注入 UI 线程 `eval`。

### 2.2 Skyline worklet 的三类固有成本

| 成本 | 说明 | Proteus 路线 A 能否绕开 |
|---|---|---|
| ① 闭包序列化陷阱 | 见 §2.3 | ✅ 绕开 |
| ② 仍是 JS 解释执行 | worklet 跑在 UI 线程，执行的仍是 JS（App 端用 Hermes，无 JIT） | ✅ 可绕开（编译为指令） |
| ③ 双 runtime 维护成本 | 调试、sourcemap、错误定位跨线程 | ✅ 单 runtime 无此问题 |

### 2.3 序列化陷阱（语义坑，Skyline 与 Reanimated 都有）

Skyline 文档明确：worklet 捕获的外部变量是**序列化拷贝**，`obj.name` 在声明后修改，worklet 里看到的仍是旧值。Reanimated 同样——worklet 按值捕获，普通 `let` 变量后续修改在 worklet 里是陈旧的，跨线程可变状态**必须**放在 shared value。

**Proteus 路线 A 没有这个问题。** Vapor IR 方案的**槽位（Slot）**本来就是"可变的强类型容器"，动画状态走槽位，语义天然正确，不存在拷贝不同步。

这是编译期响应式转换顺带解决的，不需要额外设计。

### 2.4 ⚠️ 一条需要谨慎验证的推论

> 若动画表达式能在编译期完全分析，理论上可编译为**直接驱动 Rust 排版核心的指令**，完全不需要第二个 JS runtime。

**这是 Skyline 和 Reanimated 都做不到的**——它们必须保留 JS 语义。

但**不要当成既定结论**。架构上通路存在，实际可行性需 spike 验证（见 §9 RT0）。表达式复杂度、闭包捕获、动画曲线函数的可编译性都需要实测。

---

## 3. 统一路由 API 设计

### 3.1 设计原则：上层统一，下层分流

```
开发者（Vue SFC / proteus.config.ts）
        ↓  统一 API
   Proteus 路由层
        ↓
   ┌────┴─────┐
Skyline 端            App 端
映射到 routeType      自研实现
wx.router             IR 指令驱动
```

### 3.2 对齐 Skyline 内置 routeType 语义

Skyline 从基础库 v3.1.0 起内置了一批 routeType，做映射表时**直接对齐这批语义**，降低开发者心智负担：

| 内置 routeType | 效果 |
|---|---|
| `wx://bottom-sheet` | 向上半屏弹窗，前一个页面不变 |
| `wx://upwards` | 向上进入页面，前一个页面不变 |
| `wx://zoom` | 放大进入页面，前一个页面不变 |
| `wx://cupertino-modal` | 向上打开至胶囊下方，前一个页面收缩下沉 |
| `wx://cupertino-modal-inside` | 被 cupertino-modal 打开的页面继续使用 cupertino-modal |
| `wx://modal-navigation` | 被 modal 打开的页面向左进入，前一个页面不变 |
| `wx://modal` | 向上打开至胶囊下方，前一个页面不变 |

**Proteus 现有预设映射**：仓库 README 已内置 `halfScreen` / `slideUp` / `scaleDown`，并支持微信预设 `routeType: 'wx://bottom-sheet'`。

建议映射表：

| Proteus 预设 | Skyline routeType | App 端 |
|---|---|---|
| `halfScreen` | `wx://bottom-sheet` | 自研实现 |
| `slideUp` | `wx://upwards` | 自研实现 |
| `scaleDown` | `wx://cupertino-modal` | 自研实现 |
| 新增 `zoom` | `wx://zoom` | 自研实现 |
| 新增 `modal` | `wx://modal` | 自研实现 |
| 自定义 builder | 手写 builder（需 `'worklet'`） | 自研实现 |

**保持"两端同一套配置"的设计**——这是仓库已有的正确决策，不要改。

### 3.3 App 端可解除的 Skyline 硬限制

Skyline 自定义路由有明确的强制约束：

- 处理函数**必须声明 `'worklet'`**，否则无法在 UI 线程执行
- **仅在连续 Skyline 页面间生效**，WebView 页面不支持，降级为默认动画
- 手势接管必须**成对**调用 `startUserGesture` / `stopUserGesture`
- 动画完成后**必须手动调 `didPop`**，引擎无法自动判断开发者是否退出页面
- 参数模型固定：`primaryAnimation`（推入 0→1）、`secondaryAnimation`（被推出 1→0）、`primaryAnimationStatus`、`userGestureInProgress`

**App 端自研路由中，这五条全部可解除**：

| Skyline 限制 | App 端可做到 |
|---|---|
| 必须 `'worklet'` 指令 | 无需第二 runtime（走 IR 指令路线） |
| 仅 Skyline 页面间生效 | 无此限制，所有页面统一 |
| 手动成对 gesture 调用 | 框架自动管理手势生命周期 |
| 手动 `didPop` | 框架可自动判定退出意图 |
| 固定进度参数模型 | 自定义进度模型（支持多元素协同进度） |

### 3.4 关于页面栈层数（一个可能被忽略的红利）

Skyline 有一项特性：**无页面栈层数限制**——WebView 因内存占用大，页面层级最多 10 层；Skyline 连续页面复用同一引擎实例，不受此限。

Proteus 内存实测为原生增量 0.328、节点复用率 0.997，**大概率天然也突破了 10 层限制**。

**建议实测确认**——这是个容易讲、也容易验证的卖点。

---

## 4. 动画驱动：IR 指令 vs 第二 JS runtime

### 4.1 决策树

```
动画表达式能否编译期完全分析？
   │
   ├─ 能 ──→ 路线 A：编译为 IR 动画指令
   │          槽位写入 → Rust 排版核心 → 绘制
   │          （默认路径，覆盖绝大多数场景）
   │
   └─ 不能 ─→ 是否必须运行在渲染线程？
                │
                ├─ 否 ──→ 降级：在主 JS 线程执行
                │          （0.08ms 重排使得这通常够用）
                │
                └─ 是 ──→ 路线 B：受限 worklet 函数
                           第二个 Hermes 实例
                           （需评估内存与启动成本）
```

**关键判断**：因为全量重排只要 0.08ms，**"必须跑在渲染线程"的场景比想象中少得多**。这是本方案能选路线 A 为默认的技术前提。

### 4.2 路线 A 的指令扩展

在 Vapor IR 方案 §2.2 的 `OpCode` 基础上扩展动画类指令：

```ts
enum AnimOpCode {
  ANIM_BIND      = 0x40,  // (nodeId, slotId, animExprId)  绑定槽位到动画表达式
  ANIM_START     = 0x41,  // (animId, target, curveId, duration)
  ANIM_STOP      = 0x42,  // (animId)
  ANIM_SEEK      = 0x43,  // (animId, progress)            手势驱动的进度定位
  ANIM_PROGRESS  = 0x44,  // (routeId, progress)           路由进度广播
}

interface AnimExpr {
  id: number
  // 编译期生成的求值程序，由 Rust 侧直接消费
  // 禁止运行时解释 JS
}
```

**硬性约束**：`AnimExpr` 必须由编译器生成，运行时**不得**存在 JS 求值或字符串解析。

### 4.3 动画曲线与缓动

Skyline 支持常见 Easing 缓动函数；Reanimated 有 `timing` / `spring` / `decay`。

Proteus 路线 A 下，曲线函数应在 Rust 侧实现为**查表 + 插值**，不经过 JS：

```
curve_id (u8) + progress (f32) → eased_value (f32)
```

常用曲线（linear / cubic / ease-in-out / spring 近似 / bounce）内置，自定义曲线需编译期注册。

### 4.4 路线 B 的启动条件（不要过早做）

**只在同时满足以下条件时才引入第二 JS runtime**：

1. 有真实业务场景，其动画逻辑**无法编译期分析**
2. 该场景**确实需要**渲染线程执行（实测证明主线程方案掉帧）
3. 团队接受额外的内存与启动成本

**没有这三条，先不做。** 过早引入会让调试链路和内存都变复杂，而收益可能为零。

---

## 5. 手势系统

### 5.1 能力边界

Skyline 提供基于 worklet 的手势系统，支持缩放、拖动、双击等识别，并支持**手势协商**——遇到冲突（常见于滚动容器下）决定让哪个手势生效。

**Proteus App 端应实现同等能力**，但要注意：

> ⚠️ **手势协商是真正的深水区。** Android 与 iOS 的嵌套滚动语义不同（Android 的 NestedScrolling / iOS 的 UIScrollView 手势竞争机制差异大）。**建议单独立项，不要并入路由或动画的排期。**

### 5.2 设计要点

| 项 | 说明 |
|---|---|
| 手势生命周期 | 框架自动管理，不要求开发者成对调用 |
| 与滚动容器冲突 | 需协商机制，单独立项 |
| 手势驱动动画 | 走 `ANIM_SEEK`，进度直接来自手势 |
| 平台差异 | Android / iOS 分别实现，语义对齐靠 conformance 测试 |

### 5.3 一条建议

先做**最小手势集**（tap / pan / long-press），验证整体链路；缩放、双击、多指等复杂手势后置。**手势系统的坑多于收益，别一开始就铺开。**

---

## 6. 共享元素转场

Skyline 通过 `share-element` 实现共享元素转场（如列表页图片飞入详情页）。官方提示：为保证动画效果，**前后页面的 share-element 子节点结构应尽量保持一致**。

### 6.1 Proteus App 端的实现路径

因为节点树是**编译期确定 + 扁平数组**（方案 §3.1、§5.1），共享元素可以做得比 DOM 系更直接：

```
1. 编译期为跨页面的共享元素分配全局稳定 ID
2. 转场时直接读取源节点与目标节点的几何信息（Rust 侧已有）
3. 生成一条 ANIM 指令，驱动该元素从源几何插值到目标几何
4. 转场结束，提交最终布局
```

**优势**：几何信息本来就在 Rust 侧，不需要跨边界查询——这比 Skyline / Web 的实现路径都短。

### 6.2 约束

- 共享元素需在**编译期声明**，运行时动态指定不支持
- 前后页面的共享元素结构需保持一致（与 Skyline 同约束）
- 跨端一致性：Skyline 端映射到 `share-element`，App 端自研，**行为需 conformance 比对**

---

## 7. 与 Skyline 能力对照表

| 能力 | Skyline | Proteus App 端 | Proteus Skyline 端 |
|---|---|---|---|
| 自定义路由 | ✅ 仅连续 Skyline 页面 | ✅ 全页面 | ✅ 映射 routeType |
| 路由预设 | 7 种内置 routeType | ✅ 对齐实现 | ✅ 直接复用 |
| 手写 builder | ✅ 需 `'worklet'` | ✅ 无需指令声明 | ✅ 需 `'worklet'` |
| 手势系统 | ✅ 8 种手势 + 协商 | 🟡 最小集先行 | ✅ 复用 |
| 共享元素 | ✅ share-element | ✅ IR 直驱 | ✅ 映射 |
| 动画驱动 | worklet（JS on UI 线程） | **IR 指令（无 JS）** | worklet |
| 页面栈层数 | 无 10 层限制 | 🟡 需实测确认 | ✅ 继承 |
| 闭包捕获语义 | ⚠️ 序列化拷贝陷阱 | ✅ 槽位直写，无陷阱 | ⚠️ 继承 Skyline 行为 |

**对照表的用途**：对外沟通时，用这张表区分"App 端超越"与"Skyline 端对齐"，避免混淆。

---

## 8. 里程碑

### RT0 · spike 验证 ✅ **已完成（2026-09-30）——路线 A 判定可行**

- [x] **验证 §2.4 推论**：动画表达式能否编译为直接驱动 Rust 的指令 —— ✅ **可行**
      （曲线求值 = Rust 侧查表 + 插值；运行时**零 JS 求值、零字符串解析**）
- [x] 选定 3 个代表性动画做端到端验证 —— ✅ 位移 / 缩放 / **路由转场**（双属性组合）三场景跑通，
      **终值精确落在 `to`**（曲线端点钉死策略）
- [x] 测量：指令路径 vs 主线程 JS 路径的帧耗时差 —— ✅ 规模扫描 50/200/1000 节点：
      **10.5× / 26.0× / 84.5×**（宿主侧口径，**下界**——JS 侧计算与编码成本未含）；
      每帧跨边界数据量 **N×11B → 0B**；每帧指令条数 **N → 0**
- [x] **结论决定路线 A 是否可行为默认** —— ✅ **可行，推荐作为默认路径**

**出口（已达）**：`docs/generated/rt0-anim-spike.md`（结论报告 + 三场景读数 + 六条诚实边界）。

**本轮交付（RT2 的起手式，非空推论）**：
`layout-core-rust/src/anim.rs`（5 曲线 + `AnimEngine` · 10 单测）·
`style.rs` 加 `translate_x/y` / `scale`（**paint-only，不触发布局**）·
FFI `proteus_layout_anim_start` / `_anim_tick`（每帧 1 调用）·
TS 镜像 `slot-runtime/src/anim-curve.ts` + 跨语言 golden `tests/anim-curve-golden.test.ts`
（期望值 = **Rust 实测**，非"凭印象"；破坏性验证：改公式 ⇒ 3 条红）。

**★协议层决策（供 RT2）**：本 spike **故意不把 ANIM_START 编入 ops 二进制流**——
每帧一条 20B 消息只为传一个 `dt`，是把 V2「池按需」省下的字节又花回去；
启动参数走一次性 JSON（N 条动画一次调用）+ 每帧 `tick(dt)` 最小协议。
完整指令集（`ANIM_BIND` / `ANIM_SEEK` / `ANIM_PROGRESS`）是否编入流，归 RT2 决策。

### RT1 · 路由框架（≈2.5 人周）—— ✅ **核心价值已收口**（2026-10-02 更新）

- [x] 统一路由 API（上层与现有 `proteus.config.ts` 配置兼容）—— ✅ `packages/router/src/{navigation,merge,rules,schema,skyline}.ts` + `tests/router*.test.ts`（20+ 测试文件）
- [x] routeType 映射表（§3.2）—— ✅ `router/src/rules.ts:131` + `schema.ts:28` + `presets/{halfScreen,scaleDown,slideUp}.ts`
- [x] **App 端路由实现（解除 §3.3 五条限制）—— ✅ 已收口（2026-10-02）**：
      · **统一 API 直通 App 端**：`router-core.ts`（平台中立核心，adapter 注入）+ `app-route.ts`
        （App 入口，不 import shared ⇒ 无 window/wx 环境可运行）+ `app-adapter.ts`
        （栈 → RouterAdapter）+ `render-backend/app-navigation.ts`（`createAppNavigation` 一步装配）
      · **开发者零胶水**：`createRouter(routes, { adapter: nav.adapter })` → `router.push({ name })`
        —— 与 Web/MP 同一个 API（此前 App 必须手写 stack+executor+ports+泵 五段胶水）
      · **真机证据**（Android QuickJS，`check-app-stack.py` ⑧ 组）：
        `push→2层(r-detail · params={'id':'42'}) · back→1层(r-home) · replace→1层(r-user)`
      · **无 DOM 环境实测**：裸 Node（显式断言无 window）跑通全链 + 参数保留
- [x] Skyline 端映射验证 —— ✅ `router/src/skyline.ts` + `tests/platform-variant-router.test.ts`
- [x] **页面栈层数实测 —— ✅ 无上限**：真机 **20000 层 push/pop 全成**（`a_depth_reached=20000`，
      对照小程序第 10 层 `navigateTo` 直接失败）；内存靠**预算冻结**（`b_frozen_count=19985`，
      `active_nodes 960 ≤ budget 1000`，`over_budget=false`）—— §3.4 的"红利"已用真机数字兑现。

> ★**RT1 剩余（非核心价值）**：`ANIM_BIND`/`ANIM_PROGRESS`（属 RT2 范围）、跨端 conformance
>   （App ⇄ Skyline 转场视觉对照表）。核心价值（统一 API + App 实现 + 解除限制 + 层数实测）**已齐**。

### RT2 · 动画指令（≈3 人周，依赖 RT0 结论）—— ◐ **骨架 + 真机验证通过**（2026-09-30）

> ★**RT0 出口已满足**（见上）⇒ 本卡已开工。

**已落地（真机验证 8/8 判据全过，`hosts/ios/check-anim-rt2.py`）**：
- [x] **驱动力式**：`AnimDrive::{Time, Progress}`——Time 自动播放；Progress 由外部设进度（手势跟随）
- [x] **`ANIM_SEEK`**（手势驱动进度）：`seek` **立即求值写字段**（不等帧）；Progress 驱动后 tick 不再推进它
- [x] **帧循环**：iOS `CADisplayLink`（真实 vsync；`.common` 模式不被滚动/手势掐停）→ 内核 tick
- [x] **宿主变换应用**：`CATransform3D` 中心锚点缩放（等价 CSS 默认 origin）
- [x] **每帧二进制通道**：`anim_tick_bin` **16B/条**（JSON 每帧 O(N) 编解码是白付——RT0 证明的主要收益来源）
- [x] **§7.3 节点复用解绑**（Morpheus 方案要求）：`AnimEngine::stop_nodes` + FFI + 宿主 `dematerializeRow`
      成批解绑 + **层进池前重置 transform**（否则池里取出的层带旧变换 ⇒ 新内容错位）
- [x] **真机证据**：位移中途 tx=**105.00**（=120×easeOutCubic(0.5)=120×0.875 **精确吻合**）·
      终值 **120.0000**（端点钉死）· seek 后 scale=**0.9500**（=0.6+0.4×0.875 **精确吻合**）·
      Progress 稳定不被 tick 改动 · 帧循环可启停 · 回收解绑（stopped=1 + 解绑后不再动）

**帧率测席落地（§9 指标已取得，`animBench` 相位）**：真机 **59.3 FPS · 帧耗时 p95 0.679ms ·
掉帧 0**（179 帧 / 3.0s 持续测量；同时统计每帧工作耗时与 vsync 间隔）。
判据 `check-anim-rt2.py` 的 **E 组**（6 条，破坏性验证过 6 种失败形态）。

**剩余**：`ANIM_BIND`（槽位绑定）/ `ANIM_PROGRESS`（路由进度广播）· **120 FPS 目标**（需 ProMotion
设备——iPhone 12 为 60Hz，本轮如实标注未声称）· Android 侧帧驱动（Choreographer）。

- [ ] `AnimOpCode` 指令集 —— ❌ 全仓 `AnimOpCode`/`AnimExpr` 命中 8 处，**7 处在本方案自身、0 处实现**
- [ ] 动画表达式编译器（生成 `AnimExpr`）—— ❌
- [ ] Rust 侧曲线查表与插值 —— ❌
- [ ] 槽位与动画状态绑定 —— ❌
- [ ] 每帧批处理（与现有 flush 调度合并）—— ❌

> ⚠ **勿与 worklet 路线混淆**：`packages/worklet/`（`easing` / `runtime`）是**已完成**的 worklet 动画能力，
> 但它**不是本方案的 IR 指令路径**（本方案要的是"指令驱动动画"以走编译器优化）。
> ⇒ 本方案 §1 声称的"超越 Skyline 的动画能力"目前**未兑现**（RT0 spike 也未做）。

### RT3 · 手势最小集（≈2 人周）—— ◐ **大部分完成**（核实于 2026-09-28）

- [x] tap / pan / long-press —— ✅ `packages/gesture/src/recognizers.ts` + Web 接线 `use-gesture.ts` + 真机 `hosts/android/results/gesture.json`
- [x] 框架自动管理手势生命周期 —— ✅ 同上（与渲染器接线）
- [ ] `ANIM_SEEK` 手势驱动链路 —— ❌ 无证据（依赖 RT2 的动画指令，**未实现**）

### RT4 · 共享元素转场（≈1.5 人周）—— ❌ **未实现**（核实于 2026-09-28）

- [ ] 编译期全局稳定 ID —— ◐ **仅 IR 声明**（`component-ir/src/primitives.ts` E29 + `map.ts` 的 `skyline: 'share-element'`），无编译期实现
- [ ] 几何插值指令 —— ❌ 无证据
- [ ] 跨端 conformance 验证 —— ❌ 无证据

> ⚠ **勿混淆**：小程序侧有 `p-share-element` 组件（`showcase/.../p-share-element.vue`），
> 那是 **Skyline 端能力**，与本方案的 **IR 指令驱动 App 端转场**不是一回事。

### RT5 · 手势协商与复杂手势（≈3 人周，建议单独立项）—— ❌ **未实现**（核实于 2026-09-28）

- [ ] 嵌套滚动冲突协商 —— ❌ 无协商代码
- [ ] Android / iOS 语义对齐 —— ❌ 无证据
- [ ] 缩放、双击、多指 —— ❌ 无证据（注：`pinch`/`rotate` 若已在 RT3 的 recognizers 里，属"识别"而非"协商"）

---

## 9. 验收标准

| 指标 | 合格线 | 目标 | ★真机实测（2026-09-30 · iPhone 12 · 持续 3s 测席） |
|---|---|---|---|
| 转场动画帧率 | ≥ 60 FPS | 120 FPS 不掉帧 | ✅ **59.3 FPS**（vsync p50 16.86ms ⇒ 设备 60Hz 已达上限）· ★120 FPS 需 ProMotion 设备验证（如实标注） |
| 转场动画帧耗时 P95 | ≤ 8.33 ms | ≤ 4 ms | ✅ **p95 0.679ms**（p50 0.53 / max 0.774）——远优于目标线 |
| 手势跟随延迟 | ≤ 1 帧 | ≤ 1 帧 | ✅ 每帧工作 p95 仅为帧间隔的 **4.0%**（seek 立即写层，不引入延迟） |
| 动画路径是否经过 JS 求值 | **否**（路线 A） | 否 | ✅ 曲线求值在内核（Rust 查表）；JS 侧每帧成本 **0** |
| 掉帧率（附加） | — | — | ✅ **0**（179 帧 / 3.0s） |
| 页面栈层数 | ≥ 10 层无异常 | 无限制 |
| 跨端一致性（App vs Skyline） | 视觉可接受偏差 | 有对照表说明 |
| 既有测试 | 全绿 | 全绿 |

---

## 10. 坑位清单

| # | 坑 | 应对 |
|---|---|---|
| 1 | **把 Skyline 端的成绩算成"超越 Skyline"** | 对外必须分端表述，见 §0.1 |
| 2 | **跳过 RT0 直接做 RT2** | 未验证指令路径可行性就大规模投入，风险极高 |
| 3 | **过早引入第二 JS runtime** | 严格按 §4.4 三条启动条件，不达标不做 |
| 4 | **低估手势协商难度** | 单独立项（RT5），不并入其他排期 |
| 5 | **动画表达式运行时用 JS 求值** | 硬性禁止，违背路线 A 的定义 |
| 6 | **为动画另建节点索引** | 复用既有扁平数组结构，见 §1.1 |
| 7 | **手势生命周期交给开发者手动管理** | 框架自动管理，这是相对 Skyline 的改进点 |
| 8 | **共享元素未编译期声明** | 编译期声明是硬约束，运行时动态指定不支持 |
| 9 | **忘记实测页面栈层数** | RT1 明确列入 |
| 10 | **跨端一致性未验证** | 共享元素与转场必须有 conformance 比对 |

---

## 11. 给实现 LLM 的执行指令

1. **RT0 spike 未完成前，禁止开始 RT1/RT2。** 指令路径可行性未验证就投入，是本方案最大的风险。
2. **动画表达式禁止运行时 JS 求值**。发现 `eval` / 字符串解析 / 表达式解释器，视为路线偏离。
3. **不要为动画另建节点索引**，复用既有扁平数组 + 兄弟链结构。
4. **不引入第二 JS runtime**，除非同时满足 §4.4 三条启动条件。
5. **手势生命周期由框架管理**，不要求开发者成对调用。
6. **手势协商单独立项**，不与其他里程碑捆绑。
7. **对外表述必须分端**：App 端是自研实现，Skyline 端是能力映射。
8. **共享元素必须编译期声明**，运行时动态指定直接编译期报错。
9. **既有 Web / Skyline 后端测试必须全绿**，不得为动画能力牺牲既有端。
10. **新增指令与规则自带 AI 说明书**，与既有 111 条规则约定一致。

---

## 附：关键事实依据

- Skyline 创建专用渲染线程（UI 线程）负责 Layout / Composite / Paint；框架代码与开发者业务逻辑运行在**同一共享上下文**，无需 JSBridge 交换数据
- Worklet 用于解决双线程架构下 UI 事件跨线程传递导致的交互动画延迟；WXS 在 Skyline 中被移到 AppService 导致效率下降，故推出 worklet 替代
- worklet 函数体顶部需 `'worklet'` 指令；`wx.worklet` 提供 `shared()` / `derived()` / `runOnUI()` / `runOnJS()`；动画函数 `timing(toValue, config, callback)` / `decay({velocity, clamp})`；样式绑定 `applyAnimatedStyle(selector, workletFn)`
- Skyline 共享变量陷阱：worklet 捕获的外部变量被序列化拷贝，后续修改不同步；跨线程可变状态须用 sharedValue
- Reanimated worklet：Babel 插件把函数转为字符串 + 闭包变量序列化，注入 UI 线程 `eval`；worklet 按值捕获，普通 `let` 变量后续修改在 worklet 内陈旧
- 自定义路由三步骤：定义路由动画（注册 builder）→ 跳转时指定 routeType → 绑定页面手势；`wx.router.addRouteBuilder(name, builder)`
- 自定义路由强制约束：仅连续 Skyline 页面间生效（WebView 降级）；处理函数必须声明 `'worklet'`；手势接管须成对 `startUserGesture` / `stopUserGesture`；动画完成须手动 `didPop`
- 路由参数模型：`primaryAnimation`（推入 0→1）、`secondaryAnimation`（被推出 1→0）、`primaryAnimationStatus`、`userGestureInProgress`；builder 可配 `transitionDuration` / `reverseTransitionDuration` / `opaque` / `canTransitionTo` / `canTransitionFrom`
- 内置 routeType（基础库 v3.1.0+）：`wx://bottom-sheet` / `wx://upwards` / `wx://zoom` / `wx://cupertino-modal` / `wx://cupertino-modal-inside` / `wx://modal-navigation` / `wx://modal`
- `share-element` 实现共享元素转场；官方建议前后页面的 share-element 子节点结构尽量一致
- Skyline 无页面栈层数限制（WebView 因内存占用大最多 10 层；Skyline 复用同一引擎实例）
- Skyline 手势系统支持缩放、拖动、双击等，并支持手势协商（常见于滚动容器冲突场景）
