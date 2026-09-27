# 自绘管线：标准 Vue 应用 → Rust 核心 → CALayer（真机验证）

> ★**这是「Vue 整套在 App 端跑通」的第一份端到端证据**（2026-09-29）

## 一句话

标准 Vue 组件 → Vue 自定义渲染器（`createRenderer`）→ 语义树 → **Rust 排版核心算几何**
→ 宿主按几何建 **CALayer 树**。**全链路无任何 UIKit 布局参与**。

## 与既有 iOS 竖切的本质差别

| | `entry.ts`（既有竖切） | `entry-selfdraw.ts`（本链路） |
|---|---|---|
| 输出 | UIView 树 | CALayer 树（自绘） |
| 布局 | **交给 UIKit**（注释明写「不实现 flex/grid 求解」） | **Rust 核心**（Taffy 0.14） |
| 几何来源 | UIKit | 核心（唯一来源，JS 与宿主都不算布局） |
| 文本度量 | UIKit | CoreText（平台注入核心） |

此前这两条链路**互不相连**：「Vue 渲染 → 自绘管线」一次都没接上过。本目录是那个接头。

## 运行

```bash
bash hosts/ios/run-selfdraw.sh          # 构建 + 装机 + 启动 + 取报告与截图
python3 hosts/ios/verify-selfdraw.py    # ★独立核验（四层对照）
```

## ★★四层核验（`verify-selfdraw.py`）

从 **Vue 源码里的规格**（行高 56 / margin 8 / padding 16 / 圆形 36 等）独立推导期望，再对照：

| 层 | 对照什么 | 抓得到什么 |
|---|---|---|
| ① 规格 → 核心 rects | 卡片高/步距/水平内缩/圆形尺寸/文本在卡片内 | 布局算错、样式没生效 |
| ② 核心 rects vs **实际 CALayer frame** | 按 `parentId` 逐级累加后比对 | ★**坐标系二次叠加**（核心 rects 本身是对的，只有这层能暴露） |
| ③ 屏幕像素 | 卡片底色 / 强调圆 / 页面底色采样 | 画错、没画出来 |
| ④ 管线健康度 | 未知样式键为空 / 相位异常为空 / 相位读数齐全 | ★**静默失败**（写了没生效、异常被吞） |

**破坏性验证**：把某个节点的层 frame 偏 30px → 核验 exit 1 并精确报出该节点；正版 exit 0。

## ★★三条实测发现（都是「宿主集成」而非「渲染」问题）

### 1. JSC 的 `evaluateScript` **不排空微任务** —— 而 Vue 的更新调度正是微任务

用最小程序实测确认：`Promise.resolve().then(f)` 的 `f` 要等该次 `evaluateScript`
**返回**后才执行。后果：把「mount + 改 ref + 量结果」写在**一个**脚本里时，
`ref` 变更触发的重渲染**永远不会发生**（实测 `patch=0`、节点数不变），
看起来像「响应式失效」，实际是宿主集成方式的问题。

⇒ **正解：由宿主逐相位调用**（每次 `evaluateScript` 之间返回主线程，微任务排空）。
这也更贴近真实 App：更新由事件驱动、分散在时间轴上。
★这也解释了 NativeScript-Vue 为何不必处理此问题：它跑在**完整集成的 runloop** 上，
VM 事件循环被持续泵动；而「evaluateScript 一个 bundle」是一次性执行模型。

### 2. JSExport 方法**不能当裸值传递**（会丢接收者）

`measureAsync(..., proteusSelfDraw.update)` → `self type check failed for Objective-C instance method`。
必须用闭包包一层：`(j) => proteusSelfDraw.update(j)`。
★症状是「该相位静默不记录」——因为异常被 `catch` 吞了。⇒ **异常必须可观测**（本脚本的 ④ 层管这个）。

### 3. 嵌套 `style` 必须**显式展开**

Vue 的 `h('p-view', { style: {...} })` 把整个 `style` 对象作为一个 prop key 传下来
（key === `'style'`），**不是**摊平成 height/backgroundColor。
不展开 → 所有样式落进「未知键」（实测 `unknown_keys: {style: 2646}`），
现象是**文字画出来了、卡片/圆角/强调色全没有**。
⇒ 既有 iOS 宿主（`main.swift:90`）也显式展开 style，本适配器与之保持一致。

## ★一处「核心正确」的意外验证

初版场景没写 `flexShrink` → 12 张卡片内容总高 **886** > 视口 **844**，
溢出 42px；而 CSS 的 `flex-shrink` **默认 1** ⇒ 均摊压缩 42/12 = 3.5 ⇒ 卡片实测高 **52.5**。
核验脚本报出 13 项失败；核查后确认**核心算得完全正确**（算术与观测逐位吻合），
是场景规格要求了放不下的内容。处置：加 `flexShrink: 0`（真实列表项语义），
**而不是**改阈值去迁就——判据只能因「规格变了」而改，不能因「实现没达标」而改。
⇒ 顺带证明：自绘管线的 flex-shrink **真的生效了**，不是「看起来像布局」。

## JS 逻辑层性能读数（iPhone 12 真机 · JSC）

| 相位 | vue | 适配器 | 序列化 | 宿主 | 合计 | 节点 | patch |
|---|---|---|---|---|---|---|---|
| mount（12 项） | 2ms | 0ms | 0ms | 10ms | **12ms** | 91 | 152 |
| update 结构路径（12→30 项） | 3ms | 0ms | 0ms | 8ms | **11ms** | 217 | 280 |
| update 纯样式路径 | 1ms | 1ms | 0ms | 8ms | **10ms** | 217 | 153 |
| **纯 JS 吞吐**（不调宿主） | — | — | — | — | **0.9ms/次** | — | — |

★读法要点：
- **Vue 自身只占 1–3ms** —— 逻辑层不是瓶颈
- **宿主侧（CoreText 度量 + Rust 布局 + 建层）占 8–10ms**，是当前大头
- **序列化 ≈ 0ms**（请求仅 3.4–5.6KB）——本仓既有「JSON 通道慢」的担心在小树上不成立
- ★**与 NativeScript-Vue 的对照口径**：NS-Vue 走 FFI 直调、无序列化项。
  本脚手架走 JSON 字符串，但实测该成本在小/中树上可忽略；**大树上需重测**（诚实边界）

## ★诚实边界（未做/未证）

1. **宿主每次 update 重建整棵树 + 全部 CALayer** —— 属脚手架现状，**不是架构结论**。
   增量更新（按 patch 只改变化节点）未实现。
2. **性能数字是 91–217 节点的小树**：不能外推到 4050 元素场景（那是另一个量级，
   见 `README-BENCH.md` 的真机数字）。
3. **未接事件**：命中测试（`hit.rs`）已在核心实现并跨端验证，但**本场景未接线** ——
   宿主还没有 `onTouchEvent` → `proteus_layout_hit_test` 的调用。
4. **Android 侧未做**：本链路只在 iOS 验证。Android 宿主目前**没有 JS 引擎**
   （无 JSC/V8/QuickJS 接入），这是「Vue 整套跑通」在 Android 上的**前置缺口**。
5. **不是编译器链路**：本场景的 Vue 应用是**手写 render 函数**（`entry-selfdraw.ts`），
   尚未走 `.vue` SFC → 编译器 → IR。故「编译期折叠」在本链路里是**运行时折叠**代劳的
   （见 `selfdraw.ts` 的 `foldLength` 注释）。
