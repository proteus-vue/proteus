# Proteus 全局挂载点任务卡清单

> 配套文档：《Proteus_全局挂载点与App根组件方案.md》
> 用法：LLM 逐张领取，完成后勾选验收项
> 硬约束：
> 1. **GP0 未完成前不得开始任何 GP3 子卡**（各端实测决定实现方式）
> 2. **C1/C2/C3 三条静态检查必须全部落地**，否则全局层会变成新逃生口
> 3. 例外通道（GP6）默认关闭，未登记不得启用

---

## 进度总表

### 第一批：各端实测（可并行，⭐ 一票否决）

- [~] **GP0-a** 小程序 `root-portal` 实测（点击穿透）⭐ —— **部分完成（2026-10-03）**：当前基础库（3.17.x）+ Skyline 下**不穿透**（三形态已验）；3.8.4 版本矩阵**未覆盖**（工具链无切换入口）⇒ 见报告 `docs/gp0a-root-portal-report.md`
- [ ] **GP0-b** 鸿蒙子窗口实测
- [ ] **GP0-c** iOS 独立 `UIWindow` 实测（含 iOS 26）
- [ ] **GP0-d** Android 权限流实测
- [ ] **GP0-e** ~~Web Teleport 实测~~ ⇒ **降级为决策卡**（Web 端跑标准 Vue+DOM，Teleport 是原生行为；真问题是「要不要为可校验性弃用」）

### 第二批：模型与编译期约束

- [x] **GP1-a** 三层挂载的指令流表达规格 ⇒ **已完成（2026-10-03）**：★核心结论是 **零新指令**（层间顺序用**树序**表达——内核 z-order 真源 = 声明顺序）；规格见 `docs/Proteus_三层挂载指令表达规格.md` + 契约 `packages/contracts/src/mount-layers.ts`
- [x] **GP1-b** 三层层级编码 ⇒ **已完成（2026-10-03）**：**域偏移**方案（`mountLayerDomainOffset` = 层序 × 1_000_000）——与层内四层**正交不混用**；单测实证误用场景被数值拦住
- [x] **GP2-a** App.vue template 编译支持 ⭐ ⇒ **已完成（2026-10-03）**：层标签解壳 + 声明收集（可枚举）+ App 壳免滚动容器；规则 `template/mount-layer` 已登记
- [x] **GP2-b** C1 静态检查 ⇒ **已完成（2026-10-03）**：`validateMountLayerUsage` + 接进 `compileVueSfc`（**error 级**）；修法点明"禁用运行时 insertGlobal"
- [x] **GP2-c** C2 静态检查 ⇒ **已完成（2026-10-03）**：`GLOBAL_LAYER_NODE_LIMIT` + 超限 error（提示含 MP 的 N 倍驻留口径）；★**数值待 GP0/实测校准**（当前 32 为契约常量）
- [x] **GP2-d** C3 静态检查 ⇒ **已完成（2026-10-03）**：Global 层内路由动作（navigator / router-link→proteusNavigateTo / a[href]）⇒ error；★事件回调**不**触发（不越界）

### 第三批：各端实现 🔴 依赖 GP0

- [x] **GP3-a** Web 端挂载实现 —— 见卡（实现完成 2026-10-03）
- [~] **GP3-b0** 小程序端 **Overlay 收口** —— **进行中（2026-10-03）**：✅ S42/S47 陷阱机器化（编译期检查 + 回归锁）· ✅ LY004×teleport 层叠逃逸修复 · ⏳ virtualHost 固定（依赖 GP0-a 矩阵）· ⏳ 导航栏影响（需实测）
- [x] **GP3-b1** 小程序端 **Global 层新建**（每页注入机制 + 状态共享通道）—— 见卡（实现完成 2026-10-03，已推 f6058728）
- [◐] **GP3-c** App 端挂载实现 —— **层结构完成+真机验证；「跨路由存活」暴露树模型缺口 gp3c-1（如实登记，非假绿）**（Android / iOS）
- [ ] **GP3-d** 鸿蒙端挂载实现 🔴 依赖 GP0-b

### 第四批：全局浮层能力

- [x] **GP4-a** Toast 队列（替代 `uni.showToast` 语义）⭐ —— 见卡（实现完成 2026-10-03）
- [x] **GP4-b** Loading 多实例与遮罩范围 —— 见卡（实现完成 2026-10-03）
- [x] **GP4-c** 登录失效拦截弹窗（与路由守卫协同）—— 见卡（实现完成 2026-10-03）

### 第五批：验收与例外通道

- [~] **GP5** 八条超级应用场景验收 ⭐ 最终判据 —— **实现完成（2026-10-03）**：八条全部就位（Overlay 三条 = GP4-a/b/c · Global 五条 = 状态条/悬浮球/音乐条/主题/IM 角标）；★**Global 层四条为本次新增**（App.mp.vue 声明一次 → 零声明演示页可用 → 跨页共享状态）；判据 = 单测 13 组 + MP 真机 e2e + Web e2e（跑验中）
- [ ] **GP6-a** 例外通道：Android 悬浮窗 + 授权流
- [ ] **GP6-b** 例外通道：iOS 独立窗口 + 键盘层级
- [ ] **GP6-c** 例外通道：鸿蒙全局悬浮窗
- [ ] **GP6-d** 例外通道登记机制（与 XComponent / TSX 同一套）

### 第六批：长期监控（可独立开始）

- [ ] **GP7** Global 层内存常驻监控
- [ ] **GP8** 与 uni-app 现状的对外对照表

---

# 第一批 · 各端实测

## 卡 GP0-a · 小程序 root-portal 实测

**优先级**：⭐ 最高（决定小程序端 Overlay 实现方式）
**预估**：1.5 人日（★已完成约 0.5 人日：当前环境实测 + 判据固化；剩 1 人日 = 版本矩阵）
**进度（2026-10-03）**：◐ 部分完成——见 `docs/gp0a-root-portal-report.md`
**依赖**：无
**阻塞**：GP3-b

### 现状

微信服务市场已确认：基础库 **3.8.4 + Skyline** 下 `root-portal` 内组件**点击穿透**（3.5.8 正常）。规避方式是 `virtualHost=false`。
但 `virtualHost` 设 false 与"设 true 规避其他场景问题"存在冲突。

### 必做项（★状态为 2026-10-03 实测结果）

- [x] **当前基础库（3.17.2/3.17.3）+ Skyline 实测**：`root-portal` 内点击**不穿透**
      （三形态：主树对照 / portal 内原生 button / portal 内自定义组件 p-button——都到 JS）
- [x] **判据固化**：`tests/e2e-mp-gp0-root-portal.test.ts`（16 秒可重跑，含零 error 门禁）
- [ ] 复现点击穿透：**3.8.4 + Skyline**（🔴 本机工具链**无基础库切换入口**——需 IDE 手动切版本或真机）
- [ ] 验证 `virtualHost=false` 是否确实修复（依赖上一条：问题先要能复现）
- [ ] 验证 `virtualHost=false` 是否会引入其他问题（记录具体现象）
- [ ] 覆盖基础库版本矩阵：3.5.8 / 3.8.4 / 最新（**当前只覆盖了最新档**）
- [ ] 记录 Skyline 与 WebView 两渲染引擎下的差异（产物 26/27 页为 skyline；本批只测了 skyline）
- [x] `root-portal` 内**自定义组件**已验（`p-button` 可达 ⇒ 组件边界不吞事件）

### 验收

- [x] 输出《小程序 root-portal 实测报告》（`docs/gp0a-root-portal-report.md`，含装置/读数/缺口）
- [x] 明确给出 `virtualHost` 建议：**暂不设**（无证据支持全局开启——详见报告 §5.2）
- [ ] **版本 × 引擎 × 现象三维度表格**（三维中只填了"最新 × skyline"一格 ⇒ **矩阵未完成**）
- [ ] 3.8.4 若确认穿透 ⇒ 记录修复版本号并在真机矩阵登记

### 风险备注

这是**版本相关的静默失效**——不报错，就是点不动。若不在本卡暴露，会在 GP3-b 后期才被发现，届时排查成本远高于现在。

---

## 卡 GP0-b · 鸿蒙子窗口实测

**优先级**：⭐ 高
**预估**：1.5 人日
**依赖**：无
**阻塞**：GP3-d

### 现状

鸿蒙 Stage 模型：每个 UIAbility 对应一个 WindowStage。`createSubWindowWithOptions` 创建子窗口（弹窗、悬浮球），`setWindowZLevel` 设相对层级。
**子窗口生命周期跟随主窗口**——主体窗口销毁则子窗口一并销毁。

### 必做项

- [ ] 验证子窗口能否承载 **Proteus 指令流**（而非必须塞 ArkUI 组件）
- [ ] 若不能直接承载，验证是否需走 `ContentSlot` + `NodeContent` 桥接
- [ ] 实测 `setWindowZLevel` 的层级语义，与《页面层级规范》四层语义能否对齐
- [ ] 验证子窗口随主窗口销毁是否确实发生（有无泄漏窗口）
- [ ] 实测子窗口内的触摸事件路由是否正常
- [ ] 验证子窗口是否受《单位系统与舍入规范》的 vp/fp 公式影响

### 验收

- [ ] 明确给出：鸿蒙端 Overlay 走"同窗口内分层"还是"子窗口"
- [ ] 若走子窗口，给出指令流桥接方案与代价（跨边界次数）
- [ ] 输出鸿蒙端挂载决策记录

---

## 卡 GP0-c · iOS 独立 UIWindow 实测

**优先级**：中高
**预估**：1 人日
**依赖**：无
**阻塞**：GP3-c（部分）

### 现状

iOS 独立 `UIWindow` + `windowLevel`：`normal < statusBar < alert`。
已知三个附加成本：需透明背景、需重写 `pointInside` 只响应目标区域、需监听键盘通知重置层级（键盘本身是高 windowLevel 的独立窗口）。

### 必做项

- [ ] 验证 iOS 26 下创建独立 UIWindow 是否仍可行（**与 EN0 联动**）
- [ ] 实测 iOS 13+ 场景管理对自定义 window 的影响
- [ ] 验证键盘弹出时是否需要重置 windowLevel（复现并记录）
- [ ] 验证 `pointInside` 不重写时的点击拦截范围（是否全屏拦截）
- [ ] 实测独立 window 内的动画是否走 CoreAnimation（与 Morpheus §5-bis 是否一致）

### 验收

- [ ] 明确给出：iOS 端 Overlay 默认走"同窗口内分层"还是"独立 window"
- [ ] 若 iOS 26 下受限，记录具体限制现象（EN0 已结案，本卡是补充验证）
- [ ] 输出 iOS 端挂载决策记录

---

## 卡 GP0-d · Android 权限流实测

**优先级**：中
**预估**：0.5 人日
**依赖**：无
**阻塞**：GP6-a

### 现状

`TYPE_APPLICATION_OVERLAY` 是敏感权限（Android 8.0 起）。窗口 type 决定 Z-order：application 1–99、sub 1000–1999、system 2000–2999。

### 必做项

- [ ] 验证普通应用申请 `SYSTEM_ALERT_WINDOW` 的实际流程与通过率
- [ ] 验证拒绝授权后的降级路径是否可控（不能静默失败）
- [ ] 实测国产 ROM（小米 / 华为 / OPPO / vivo）对此权限的差异处理
- [ ] 验证同窗口内分层（不用悬浮窗）能否满足绝大多数场景

### 验收

- [ ] 明确给出：Android 端是否默认走"同窗口内分层"
- [ ] 输出权限拒绝时的降级行为规格

---

## 卡 GP0-e · Web Teleport 实测

**优先级**：中（最简单，但仍需确认）
**预估**：0.5 人日
**依赖**：无
**阻塞**：GP3-a

### 现状

Vue 3 `Teleport to="body"` 原生支持。Teleport **只移动 DOM，不移动逻辑与作用域样式**——scoped 样式仍生效。

### 必做项

- [ ] 验证 Teleport 到 body 后，scoped 样式是否确仍生效
- [ ] 验证 Teleport 内容与 Proteus 指令流的兼容（是否绕过指令流直接操作 DOM）
- [ ] 若绕过指令流，给出替代方案（渲染树内挂载节点）
- [ ] 验证 Teleport 内组件的动画是否仍走 Morpheus

### 验收

- [ ] 明确给出：Web 端走原生 Teleport 还是自有渲染树节点
- [ ] **倾向自有渲染树节点**——Teleport 会绕过指令流，破坏可校验性

---

# 第二批 · 模型与编译期约束

## 卡 GP1-a · 三层挂载的指令流表达规格

**优先级**：⭐ 高（架构基础）
**预估**：1 人日
**依赖**：无
**阻塞**：GP1-b、GP2 系列、GP3 系列

### 必做项

- [ ] 定义 Global / Page / Overlay 三层的指令表达（新增指令还是层标记）
- [ ] 明确三层的生命周期语义：Global 随 App、Page 随路由栈、Overlay 显式控制
- [ ] 定义三层与 Host ABI 的接口边界
- [ ] 明确三层是否参与批处理（与"跨边界次数 = 帧数"红线的一致性检查）

### 硬约束

- [ ] **三层必须在编译期确定**，不得运行时动态新增层
- [ ] 层的顺序固定：`Overlay > Page > Global`，不可配置

### 验收

- [ ] 输出指令流扩展规格文档
- [ ] 与《Host ABI 设计方案》交叉确认接口一致

---

## 卡 GP1-b · 三层层级编码

**优先级**：高
**预估**：0.5 人日
**依赖**：GP1-a
**阻塞**：GP3 系列

### 必做项

- [ ] 定义三层的层级数值编码（留出层内四层语义的空间）
- [ ] 与《页面层级规范》的四层语义（Content/Navigation/Mask/Popout）对齐
- [ ] 定义 Global 层**不得使用 `layer="popout"`** 的编译期检查点

### 验收

- [ ] 层级编码表可直接被各端映射使用
- [ ] 明确写出：层间顺序与层内顺序是两个独立维度，不得混用同一套数值

---

## 卡 GP2-a · App.vue template 编译支持

**优先级**：⭐ 最高（本方案的核心能力）
**预估**：2 人日
**依赖**：GP1-a
**阻塞**：GP2-b/c/d、GP3 系列

### 必做项

- [ ] 编译器支持 App.vue 中的 `<template>`
- [ ] 支持 `<app-root>` / `<global-layer>` 等根级标签的解析
- [ ] 全局层内容的编译产物与页面编译产物的关系（共享还是复制）
- [ ] 热更新（HMR）下全局层的行为（不应重复挂载或丢失状态）
- [ ] 明确全局层编译产物的**可枚举性**（这是 C1 的实现基础）

### 验收

- [ ] 一个最小 demo：App.vue 声明全局状态条，任意页面自动显示
- [ ] HMR 修改全局层不产生重复挂载

---

## 卡 GP2-b · C1 静态检查：必须声明在 App.vue

**优先级**：⭐ 最高
**预估**：1 人日
**依赖**：GP2-a
**阻塞**：GP5

### 现状与理由

若开放运行时 `insertGlobal(vnode)`，全局层会成为**新的逃生口**——conformance 与 AI 可校验同时失效，且失效是**静默的**。
这与"不开放任意原生调用""TSX 是逃生口"是同一条原则。

### 必做项

- [ ] 实现编译期检查：全局挂载点只能出现在 App.vue 的 template 中
- [ ] 明确报错信息（可定位到文件与行号）
- [ ] **禁止提供运行时 `insertGlobal` API**（或提供但编译期拦截）
- [ ] 若必须支持动态挂载，设计显式逃生口通道并纳入埋点统计

### 验收

- [ ] 在页面组件中声明全局挂载 → 编译期报错，错误可读
- [ ] 无任何途径在运行时插入未声明的全局节点

---

## 卡 GP2-c · C2 静态检查：挂载节点上限

**优先级**：中高
**预估**：0.5 人日
**依赖**：GP2-a
**阻塞**：GP5

### 必做项

- [ ] 实现编译期节点计数，上限 **32**（数值待 GP0/实测校准）
- [ ] 超限时报错并给出提示（提示应引导拆分或改用 Overlay 层）
- [ ] 上限值需可配置但**默认值必须存在**

### 待校准

上限 32 是建议值。**GP0 完成后若发现单节点内存开销较大，应下调**；若发现典型超级应用场景需要更多，应上调并说明理由。

### 验收

- [ ] 第 33 个节点触发编译期错误
- [ ] 错误信息说明为何有限制（防止开发者认为是任意限制）

---

## 卡 GP2-d · C3 静态检查：禁止业务污染

**优先级**：中高
**预估**：1 人日
**依赖**：GP2-a
**阻塞**：GP5

### 必做项

- [ ] 检查全局层组件是否引用 `useRoute` / 页面参数 → 报错
- [ ] 检查全局层组件是否调用 `navigateTo` 等路由 API → 报错
- [ ] 检查全局层是否持有业务数据集合（大数组、Map 等）→ 告警
- [ ] 与 GP7 的内存监控联动（编译期告警 + 运行时监控双层）

### 验收

- [ ] 全局层引用 `useRoute` → 编译期报错
- [ ] 全局层声明大数组 → 编译期告警

---

# 第三批 · 各端实现 🔴 依赖 GP0

## 卡 GP3-a · Web 端挂载实现　✅ **实现完成（2026-10-03）**

**优先级**：高
**预估**：0.5 人周
**依赖**：GP0-e、GP1-a
**阻塞**：GP5

### 必做项

- [x] 按 GP0-e 结论实现（倾向自有渲染树节点，不用原生 Teleport）
      —— `packages/web/src/mount-layers.ts`：三层是**普通 Vue 组件**（`defineComponent`），
      内容**原地渲染**（零 Teleport；单测的机器判据 = 内容在层容器**内部** + 容器挂在挂载点之下）
- [x] 三层与 DOM 结构的映射
      —— `<app-root>` **解壳**（不产元素，与 MP 编译器同款 ⇒ 两端 DOM 同构）；
      三个层容器各产一个 `<div data-mount-layer="global|page|overlay">`
      （**可枚举**——测试/DevTools/conformance 的机器可查面）
- [x] 与《页面层级规范》的 z-index 语义打通
      —— 层容器 = **独立层叠上下文**（`position: relative` + `z-index: 域偏移`），
      偏移**取自契约** `mountLayerDomainOffset()`（不硬编码数值）；层内元素照常写 1/10/100/1000
      ⇒ 被限制在本层域内（两个正交维度各管一段）

### 验收

- [x] 三层顺序正确：Overlay > Page > Global
      —— 真浏览器 E2E 双判据：**DOM 序**（global→page→overlay）+ **z-index 值**
      （0 / 1_000_000 / 2_000_000，即契约域偏移，且严格递增）
- [x] 全局层内容在路由切换时保持存活且不重复挂载
      —— E2E 三条判据：切换后 Global 层**仍在** + **同一 DOM 节点**（打标验证，非重建）+
      层容器**数量不变**（不随路由累积）

### ★与 MP 端的"同形不同机制"（本卡的架构要点）

| | Web（本卡） | MP（GP2-a / GP3-b1） |
|---|---|---|
| 层标签本质 | **运行时组件**（App.vue 是真根组件） | **编译期**概念（编译器解壳） |
| Global 如何跨路由 | RouterView 之外 ⇒ **天然存活**（同一实例） | **每页注入**（N 份实例 + 共享状态） |
| 层间顺序表达 | 容器 z-index（域偏移） | **树序**（注入时前缀）——零新指令 |
| 声明形态 | `<app-root>` / `<*-layer>`（**相同**） | 同左（**相同**） |

⇒ **声明形态统一、落地机制分端**——这是"一套源码跨端"在本议题上的兑现方式。

### ★C1 的 Web 侧：运行时软校验（与 MP 的编译期 error 分工）

契约 C1 = "层只能声明在 App.vue"。MP 端是**编译期 error**（GP2-b）；Web 端跑标准 Vue、
无编译期检查 ⇒ 本卡用 `provide/inject` 做**开发模式软校验**：层不在 `<app-root>` 之下时给警告
（含修法指引），**不阻断渲染**。生产由 `__PROTEUS_DEBUG__` 常量折叠 ⇒ 零开销。

### ★诚实的实现边界（本卡侦察发现的**既有缺口**，如实登记）

`layer="layer-navigation"` 等**层内四层原语**当前**不产 z-index**——实测：
MP 端属性**原样透传**进 wxml、WXSS 里**没有** z-index；Web 端插件也不处理；全仓
`layerValueFor()` **零消费者**。即：**层间**（本卡做的）今天生效，**层内**层级今天不生效
（只做校验不产出）。
★这不是本卡引入的缺口——《页面层级规范》§13.3 已把"LY2 各端映射驱动到内核/宿主"登记为
**未做**；但该节措辞是"web/mp **由 CSS 生效**"，与实测**不符** ⇒ 本卡在此如实更正：
**web/mp 也尚未生效**。⇒ 后续若要层内层级，需做 LY2（产出 z-index）；在那之前
**不得假设 `layer="..."` 会带来任何遮挡效果**（既有弹层组件如 p-drawer/p-modal 用的是
**自带裸 z-index**，与本原语无关——这也是它们至今正常的原因）。

### 交付物

- 实现：`packages/web/src/mount-layers.ts`（`installMountLayers` / `createMountLayerComponent` /
  `AppRoot` / `GlobalLayer` / `PageLayer` / `OverlayLayer`）+ `global-components.ts`（模板类型）
- 接线：`installWebPlatform` 聚合安装（未使用的应用零开销）+ `examples/App.vue`（三层示例）
- 测试：`tests/web-mount-layers.test.ts`（16 组，happy-dom，含破坏性验证 3 条）
  + `tests/e2e-web-mount-layers.test.ts`（5 组，真 Chromium + 真产物）

---

## 卡 GP3-b0 · 小程序端 **Overlay 收口**（★既有实现复用，不是新建）

**优先级**：高　**预估**：0.2 人周　**依赖**：GP1-a　**阻塞**：GP3-b1、GP5

### 现状（★本批盘点：此层**已基本存在**）

- `<teleport>` → `<root-portal>` 编译（`packages/compiler/src/template.ts` 的 `template/teleport-root-portal`）
- 三件套已在用：`p-drawer` / `p-popover` / `p-page-container`
- `docs/skyline-pitfalls.md` **S42**（Skyline 无 fixed ⇒ 用 teleport）/ **S47**（portal 用 `v-if` 会卡死 ⇒ **常驻 + class 驱动**）已固化

### 必做项（★状态为 2026-10-03）

- [x] **S42/S47 经验固化** ⇒ 已升级为**编译期检查**（不只是文档）：
      `<teleport>` 自身带 v-if（静默丢弃）与**直接子元素**带 v-if（S47 锁死形态）**各拦一条警告**，
      修法指向正解（常驻 + class 驱动）；回归锁 `tests/mp-portal-pitfalls.test.ts`（6 组）
      规则登记 `template/teleport-root-v-if` / `template/teleport-v-if-dropped`
- [x] **与 `contracts/src/layers.ts` 打通** ⇒ 修出**真缺陷**：LY004（popout/mask 必须在根容器）
      只看源码 depth，把 `<teleport>` 内（**运行时被提升到根**）的合法正解判成违规
      ⇒ 判据改为「**portal 内相对深度 ≤1**」；验证：169 个 .vue 扫描无违规、单测 +4 组
- [x] 处理 Skyline **不支持 `position: fixed`** ⇒ 已有 teleport→root-portal 链路（既有实现）+ 本批补检查
- [ ] 按 GP0-a 结论固定 `virtualHost`（⏳ **依赖 GP0-a 版本矩阵**——当前结论"暂不设"，见报告 §5.2）
- [ ] 处理 Skyline **不支持原生导航栏** 的影响（⏳ 需实测：导航栏在 skyline 下由谁渲染）
- [ ] 与方案 §3 三层模型的**完整对齐**（overlay 层语义收口为"root-portal + 常驻"的**文档化约定**
      + 新增弹层组件的模板（脚手架））

### 验收（★状态为 2026-10-03）

- [x] 坑经验**有机器判据**（编译期拦得住，不只写在 markdown）
- [x] `layer-*` 语义在 portal 路径上**被消费**（LY004 已按逃逸点修正）
- [ ] Skyline + WebView 双引擎下 overlay 行为一致（⏳ WebView 档未测）
- [ ] 点击穿透不存在（真机回归）—— ★GP0-a 已在**模拟器**证明三形态可达；**真机**未跑

---

## 卡 GP3-b1 · 小程序端 **Global 层新建**（★本方案在小程序端的真正增量）　◐ **实现完成（2026-10-03），待真机 e2e**

**优先级**：⭐ 最高　**预估**：0.8 人周　**依赖**：GP0-a、GP1-a、GP3-b0　**阻塞**：GP5

### ★★诚实前提（方案 §1.2-bis——不读这段会做错）

小程序**每页是独立渲染树**，`root-portal` 只脱离**页面内层叠**、不脱离**页面本身** ⇒
Global 层**必然是「每页一份实例」**（N = 页面栈深度）——与微信官方 `custom-tab-bar` 同一模式
（每页注入 + **共享状态**）；**源码层面**仍只声明一次（编译期自动注入）= 本卡的核心价值。

### 必做项

- [x] **每页注入机制**：编译期把 App.vue 声明的 Global 内容注入每页产物（对齐 `custom-tab-bar`）
      —— 实现：`App.vue`/`App.mp.vue` 含 `*-layer` 标签时按 `appShell` 模式编译（不产页面机制）
      → `GlobalLayerSnippet`（wxml/wxss/data/methods/initLines，**与外壳自身产物同源**，不从产物文本反解）
      → plugin 按页回填 `requirePath` 并注入（wxml **前缀** = 树序表达层间顺序 / data 合并 / 方法合并 / wxss 并入）
- [x] **状态共享通道**：多份实例共享一份状态（参照 `custom-tab-bar` 的「实例多份、状态一份」）
      —— 实现：产物 `_proteus/global-layer.js`（**require 缓存 = 同实例**，与 vendor 单例化同机制）。
      ★**不用 `getApp().globalData`**：它是否存在取决于用户入口写法（骨架极简模式下没有）——
      依赖它 = 依赖"用户手写形态"（脆弱）。
      两个方向：**写** = 拦截页面 `setData` 镜像全局键（全覆盖：计算属性/路径键都覆盖）；
      **读** = Page data 字面量直读（首次进入）+ `onShow` 拉取（回退到本页时同步别的页写过的值）
- [x] 与 `layers.ts` 的 `layer-content` 对齐（Global 在 Content 之下）
      —— 判据 = **树序**（GP1-a 零新指令结论）：注入时 Global 内容置于页面 wxml **之前** ⇒ 内核 z-order 天然在下；
      `mountLayerDomainOffset` 域偏移仅 CSS 场景（layers.ts）；`.wxss` 里不写死层级（不依赖 `position: fixed`——S42 红线）
- [x] 内存口径：**O(N)**（回补 GP0 待核实项 4）；C2 上限区分「每页 32」vs「总驻留 32×N」（联动 GP2-c）
      —— 契约注释已写明（`GLOBAL_LAYER_NODE_LIMIT` 的**每页**口径）；实测开销待 GP7

### ★实现要点（怎么做的——给维护者）

| 关注点 | 做法 | 为什么 |
|---|---|---|
| 外壳识别 | `findAppShellFile`（`app-shell.ts`，**两处消费者同源**：plugin 注入 + gen-routes 注册） | 同一件事两份实现 = 修一份等于没修（F-30 教训） |
| 外壳编译 | `compileVueSfc(..., { appShell: true })`：**保留** data/methods/computed/provide·inject，**跳过** onLoad/onReady/onUnload/派发桥/滚动桥/探测复位/决策钩子 | 外壳不是页面（与 GP2-a 同一条纪律）——那些机制属于页面运行期 |
| 生命周期冲突 | 壳方法名为 `onShow` 等页面钩子名 ⇒ **壳侧剔除 + 警告**（页面侧合并再兜一道） | 注入会与页面钩子**抢同一个 Page 键** ⇒ 页面自身钩子被覆盖（**静默失效**） |
| 同名冲突 | **页面优先**（数据字段/方法都是）+ 可见 warning | 页面更局部；不静默丢弃 |
| 组件引用 | 壳并入 `usedComponents` 闭包起点 + 每页 `usingComponents` 注册壳标签 | 否则"只被 Global 层用到的组件"不产出 ⇒ 真机 `usingComponents 未找到`（F-30 同族） |
| 平台变体 | `isMountLayerDeclarableFile` 放行 `App.<平台>.vue`；`App.mp.vue` 是 MP 的声明面 | 变体是同一逻辑文件的按端形态（本仓机制）——拦掉变体 = C1 误报 |
| 样式去重 | 壳 wxss **剥离** `BASE_SEMANTIC_WXSS`（每文件都注入的常量）——分段剥（global/scoped 各一段） | 不剥 = 每页多 ~1.8KB 死重量且永不命中 |

### 硬约束

- [x] **不得对外宣称「MP 端单实例跨页面存活」**（不实表述——实例数就是 N）
      —— 规格与任务卡、代码注释、单测头注、e2e 头注**四处**都写了这条边界
- [x] 不得包含页面级业务组件（C3，编译期检查）
      —— GP2-d 已接线（error 级）；本轮 C3 判据改用**产物形态**（`router-link` → `bindtap="proteusNavigateTo"`）

### 验收

- [x] App.vue 声明一次，**任意页面自动显示**（源码零改动）
      —— 示例：`examples/App.mp.vue` 的 `<global-layer>` 注入全部页面产物（构建日志 + 产物取证）
- [x] 页面栈 3 层时 Global 状态跨页一致
      —— 单测 19 组锁"写镜像 + onShow 拉取"两条通道；真机链路 = `tests/e2e-mp-global-layer.test.ts`
      （本页注入 → 跨页可见 → 第二页写回 → 回第一页仍生效）
- [x] 内存如实报告 N 份实例的实测开销（不得只报单份）
      —— 口径如实写入（O(N) 每页一份）；**实测数值待 GP7**（当前只报口径，不报未测的数）

### 交付物

- 契约：`GlobalLayerSnippet`（types）+ `GLOBAL_LAYER_STATE_MODULE`（contracts）
- 编译：`appShell` 模式（template/script 双侧）+ `mountLayerWxml` 逐层留存 + 页面侧合并
- 插件：`app-shell.ts`（壳定位，两消费者同源）+ 每页注入 + 状态模块产出 + 闭包起点
- 路由：`gen-routes` 壳组件并入每页 `usingComponents`（含闭包起点）
- 示例：`examples/App.mp.vue`（全局网络状态条）+ `examples/pages/gp3-global-layer-demo.vue`（验证页）
- 测试：`tests/mp-global-layer-inject.test.ts`（19 组）+ `tests/e2e-mp-global-layer.test.ts`（真机四段证据）


## 卡 GP3-c · App 端挂载实现　◐ **部分完成（2026-10-03）：层结构已落地并真机验证；"跨路由存活"暴露树模型缺口（如实登记）**

**优先级**：高
**预估**：0.5 人周
**依赖**：GP0-c、GP0-d、GP1-a
**阻塞**：GP5

### 必做项

- [x] 默认走**同窗口内分层**（不用独立窗口）
      —— 层 = **同屏内核树里的三个容器**（零独立窗口、零敏感权限）
- [x] Android 与 iOS 各端实现
      —— **两端共用同一份契约**（`contracts/mount-layers.ts` 的 `mountLayerContainerPlans`：
      偏移/树序/几何口径单一来源）+ 各自宿主"照此建树"：
      · Android：`ScreenHost.mount` 按计划建三层容器（真机读数见下）
      · iOS：`ScreenHost.mount` 同法（真机 app-stack 全绿，且 ⑦.7 共享元素链的
        `源 home#1(节点 102)` 正是 **page 层容器 id**（rootId 100 + 偏移 2）⇒ 层容器真建且内容挂其下）
- [x] 与《单位系统与舍入规范》的物理像素整数对齐
      —— 几何全部由**内核**算（宿主零几何数学，既有纪律）；层容器取屏全尺寸（无舍入介入）

### 验收

- [x] 不申请任何敏感权限即可使用默认能力
      —— **实证**：`AndroidManifest.xml` **零 `uses-permission`**（真机判据读数 `permissions=0`）
- [ ] 🔴 **全局层跨页面存活，路由切换不重建** —— **本树模型下不成立**（见下方缺口）

### ★★真机验证（Android，2026-10-03）

```bash
bash hosts/android/run-mount-layers.sh     # 判据：hosts/android/check-mount-layers.py
```

| 判据 | 读数 | 结论 |
|---|---|---|
| 层容器真建 | `layer_count=3` · `layer_ids={global:101, page:102, overlay:103}` | ✅ |
| **树序 = 层序**（内核 z-order 真源） | 根的直接子序：`global@0 → page@1 → overlay@2` | ✅ |
| **层容器 = 全屏 @ 原点**（契约 `frame:'fullscreen'`） | 三层各 `1080×2400 @ (0,0)`（判据逐层断言） | ✅ |
| 纯容器不挤压内容 | 内容节点 `1080×200 @ y=0`（挂 page 层） | ✅ |
| 零敏感权限 | `permissions_declared_in_manifest=0` | ✅ |
| 跨路由存活 | `global_layer_destroyed_with_screen=true` | 🔴 **缺口**（见下） |

iOS 侧：`bash hosts/ios/run-selfdraw.sh --app-stack <设备>` 全绿（⑦.7 新增"层容器 = 全屏 @
原点"断言，源节点即 page 层容器）；两端均过**零设备编译检查**（`check:android-host-compile` /
`check-selfdraw-compile.sh`）。

### ★★收尾时抓出的层实现缺陷（已修 + 判据已升级，2026-10-03）

**缺陷**：层容器被写成 `relative` 而不是契约承诺的 `absolute-fullscreen`——两端宿主的
`node()` 辅助函数有一条启发式「x/y≠0 才给 `absolute`」，而层容器**恰在原点 (0,0)**
⇒ 被写成 `relative` 进 flex 流 ⇒ **三个全屏容器互相挤压**：
真机读数（修复前）page 层 `1080×800 @ y=800`、内容随之偏移 800——契约
`frame:'fullscreen'` 名存实亡。

**为什么首版判据没抓住**：判据只断言"内容几何**非零**"——被挤压的形态照样非零 ⇒ 假绿。
**判据缺陷与实现缺陷各一条**：
· 实现：`node()` 启发式对"原点处的 absolute"不适用（绝对值语义与坐标是否为零无关）；
· 判据：**要对着契约的关键承诺断言**（`fullscreen`/`absolute-fullscreen` 是真承诺），
  不是对着"没崩/非零"这类弱信号。

**修复**（两端同源）：新增 `layerNode()`（显式 `position:absolute` + `left/top:0` + 全屏尺寸）；
判据升级：逐层断言 **全屏 @ 原点**（容差 ≤0.5px）+ 内容 `y≈0`；app-stack 的 ⑦.7 同步加
"层容器 = 全屏 @ 原点"回归锁（源节点 102 正是 page 层容器——iOS 腿的端上读数）。
**破坏性验证**（用升级后的判据跑旧产物）：旧形态读数当场红（`y=800` + 缺 `layer_rects`），rc=1。
**修复后真机**：三层各 `1080×2400 @ (0,0)`、内容 `y=0`，全绿（读数见上表）。
**门禁接线**：`check:mount-layers`（同 `check:app-stack` 族：读真机产物；本机侧等价 =
`tests/mount-layers.test.ts` 16 组）已进 `pnpm verify` 链 + gates-sync 声明。

### 🔴 已知缺口（gp3c-1）：**当前树模型下"全局层跨路由存活"不成立**

**现象**：`screen.destroy` 销毁屏树时，建在该树里的 global 层容器**一并被释放**
（真机读数 `globalLayerDestroyed: true`）。

**根因（取证）**：本仓宿主当前实现的是 **每屏一棵独立内核树**（`ScreenHost` 类头注释：
"每屏一棵真实内核树（屏 = 树，M5 §0.2）"），而 M5 设计原文是「**屏 = 树内子树**，
切屏 = display 切换」——**两者是两种树模型**。层容器建在屏树里 ⇒ 屏销毁必然带走 global 层。

**为什么不在本卡"顺手修"**：改成"所有屏共享一棵内核树"是 `ScreenHost` 的**整体重构**
（id 分配 / 节点映射 / 动画按树分发全要跟进），不是 destroy 里能补的一行；
**在此处硬补（如"销毁时把 global 层摘出来重建"）会制造"看着通过、实则重建了新实例"的假绿**——
比不通过更坏（本仓"不制造假绿"纪律）。

**处置（已落地）**：判据 `check-mount-layers.py` 把它**如实标为【已知缺口】而不算通过**，
并要求读到该读数（防"缺口被静默吞掉"）。

**修复归属**：`gp3c-1` ⇒ **M5「屏 = 树内子树」重构**（归 `proteus-router-plan` M5 / 宿主层）。
完成该重构后，本卡的验收第 2 条可再跑 `run-mount-layers.sh` 复验（判据已就位）。

### ★本卡的装置教训（四次对账，全在场景代码里）

GP3-c 场景首版判据**全红**，排查出**四处测量装置缺陷**（都是"对着看起来合理写"而非对着契约核）：
① 宿主回执包在 `ok()` 的 **`data`** 下（读顶层 ⇒ 空）；② 内核 snapshot 的根在 **`root`** 键下；
③ 节点字段名是 **`nodeId`**（不是 `id`）；④ snapshot 是**嵌套树**（`children`）不是扁平数组。
⇒ **与 GP4-a/b 同族教训的第三次出现**：**装置代码必须对着真实契约核**（先 dump 一次真实
JSON 再写读取代码）。已写进本卡与归档。

---

## 卡 GP3-d · 鸿蒙端挂载实现

**优先级**：高（**排在鸿蒙宿主主线 HM0–HM2 之后，不得并行**）
**预估**：0.5 人周
**依赖**：GP0-b、GP1-a、HM2
**阻塞**：GP5

### 必做项

- [ ] 按 GP0-b 结论实现（同窗口内分层 or 子窗口）
- [ ] 若走子窗口，实现指令流桥接并统计跨边界次数
- [ ] 处理子窗口随主窗口销毁的生命周期

### 验收

- [ ] 无窗口泄漏（主窗口销毁后子窗口一并回收）
- [ ] 与鸿蒙 C-API 渲染路径不冲突

---

# 第四批 · 全局浮层能力

## 卡 GP4-a · Toast 队列 ⭐　✅ **实现完成（2026-10-03）**

**优先级**：⭐ 高（最直观的对外证据）
**预估**：0.5 人周
**依赖**：GP2-a
**阻塞**：GP5

### 现状

`uni.showToast` 是全局单例：样式固定、类型仅 loading/success/none/error、**无法管理顺序**。多个 Toast 连续触发时行为未定义。

### 必做项

- [x] 实现 Toast 队列（FIFO），支持并发触发排队
      —— `packages/runtime/src/toast.ts`（**模块级单例**：队列/计时器/统计；纯 TS，跨端可单测）
- [x] 支持自定义样式与位置（不再是固定居中）
      —— `position: top|center|bottom`（Overlay 内三锚点）+ `type: info|success|warn|error`
      （色彩经 CSS 变量 `--p-toast-<type>` 可换色）+ `--p-toast-color` 等宿主级定制
- [x] 支持指定持续时长与手动关闭
      —— `duration`（0 = 常驻）+ `hideToast(id?)` / `clearToasts()` + `dismissible`（点本体即关）
- [x] 队列上限与丢弃策略（防止刷屏）
      —— `configureToast({ maxSize, policy })`；三种策略 `drop-oldest`（默认）/`drop-newest`/`replace`
      + `dropped` 计数与 `drop` 事件（**丢弃可观测**——不静默丢）

### 硬约束

- [x] Toast 必须在 Overlay 层，**不得混入 Global 层**
      —— 宿主 `p-toast-host` 用 `<teleport to="body">`（编译期 → `root-portal`）；**不是** `<global-layer>`
- [x] 语义必须与《页面层级规范》的 Popout 层一致
      —— 宿主根全屏 fixed 于 portal 内（与 p-drawer/p-modal 同款层级手法）；Toast 属"临时出现、最上层"

### 验收

- [x] 连续触发 10 个 Toast，按序显示且不互相覆盖
      —— 真机 e2e 实测 **1→2→3→4→5→6→7→8→9→10**（严格递增，`tests/e2e-mp-toast-queue.test.ts`）
- [x] 自定义样式生效（对照 `uni.showToast` 的固定样式）
      —— 位置三态 / 色彩四态 / 常驻 / 手动关均经真机 e2e 断言

### ★实现要点（怎么做的——给维护者）

| 关注点 | 做法 | 为什么 |
|---|---|---|
| 队列归属 | **runtime 模块级单例**（不是组件内） | MP 端宿主**每页一份**；若计时器在组件里，多实例会各自推进 ⇒ 同一秒弹两个 |
| 渲染端 | `p-toast-host`（teleport → Overlay），只订阅队列、自己不知道显示什么 | 命令式 API 与声明式组件解耦：业务只调 `showToast` |
| **零每页引入** | plugin 检测到 toast API 用法 ⇒ **每页 wxml 注入 `<p-toast-host />`** + 每页 `usingComponents` 注册 + 组件本体按需产出 | GP5 判据（八条场景任一需每页引入 ⇒ 方案不成立）；**两处判定同源**（`detectToastUsage`） |
| 手动优先 | 项目里已手写宿主 ⇒ 整体不注入 | 双宿主会各渲染一份 ⇒ 同一条显示两次 |
| 无宿主提示 | 无订阅者时给**一次** console 提示（不是错误） | 防"静默不显示"；MP 端页面 `onLoad` 早于宿主 `ready` 属正常，宿主就绪会补显示 |
| 状态一致 | 队列单例 + 各页宿主订阅（"实例 N 份、状态一份"，同 custom-tab-bar） | MP 每页独立渲染树（§1.2-bis），与 GP3-b1 同一条诚实边界 |

### ★本轮真机排障三坑（已机器化/文档化，防重犯）

1. **面板塌成 0×0**：面板自身 `position: fixed` 而父容器无尺寸——Skyline 下 fixed 需 portal 内**四边撑满**
   才构成视口坐标系 ⇒ 改「全屏根 + 内层 absolute」（p-drawer 同款）。
2. **动态类名拼串失效**（S 系列 T12/A 同族）：`:class="'p-toast-host--' + position"` 编译成
   `'p-toast-host---' + scopeId + position` ⇒ 拼出 `...-data-v-xxxcenter`，**与任何 CSS 都不匹配** ⇒
   根无 top ⇒ 面板塌陷且**零报错** ⇒ 一律用 `{ 'literal-key': cond }`。
3. **测量装置反被判成产品缺陷**：组件在 `root-portal` 内 ⇒ 页面级 `selectComponent`/
   `createSelectorQuery` **一律查不到**（四种选择器全 null）。我据此一度得出"组件未创建"的**错误结论**
   并改错一版实现 ⇒ 教训：**排障结论必须用能看见该层的通道复核**（探针 / 运行时落痕）。

### 交付物

- 队列：`packages/runtime/src/toast.ts` + `index.ts` 导出（`showToast`/`hideToast`/`clearToasts`/
  `configureToast`/`subscribeToast`/`toastSnapshot`/`toastStats`/`toastConfig` + 类型）
- 宿主：`packages/components/p-toast-host/index.vue`（注册进 `index.ts` + `global-components.d.ts`）
- 注入：`packages/plugin-vite/src/page-overlay.ts`（`detectToastUsage`/`injectToastHost`）
  + `plugin.ts`（wxml 注入 + 闭包起点）+ `gen-routes.ts`（每页 `usingComponents`）
- 演示：`examples/pages/gp4-toast-queue-demo.vue`
- 测试：`tests/toast-queue.test.ts`（24 组·三种丢弃策略/常驻/幂等/事件）+ `tests/toast-host-inject.test.ts`
  （14 组·按需/手动优先/**扫描器不自污染**）+ `tests/e2e-mp-toast-queue.test.ts`（真机 8 段）

### ★附带修复（被本轮真机暴露的**编译器缺口**）

**裸方法引用传参不重写**：`subscribeToast(applySnapshot)` 里的 `applySnapshot` 是"方法作为值"传给回调——
编译器此前只改写 `name(` 与 `name.bind(`，裸值传参**不改写** ⇒ MP 产物里是模块作用域下不存在的裸标识符 ⇒
`ready()` 当场 `ReferenceError`，其后整段初始化（含订阅）**静默不执行**。
修：实参位（`(name)` / `, name,`）识别 + 补 `.bind(this)`（方法体在 MP 侧被改写成 `this.setData(...)`，
不 bind 则回调触发瞬间 TypeError）。回归锁在 `tests/toast-queue.test.ts` 的同源测试与 GP4-a e2e。

---

## 卡 GP4-b · Loading 多实例与遮罩范围　✅ **实现完成（2026-10-03）**

**优先级**：中高
**预估**：0.3 人周
**依赖**：GP2-a
**阻塞**：GP5

### 必做项

- [x] 支持多个 Loading 同时存在（不同遮罩范围）
      —— 服务 = **活跃集合**（`packages/runtime/src/loading.ts`；与 Toast 的**队列**语义分道扬镳：
      队列 = 一条条来；集合 = N 个同时存在，各自独立结束）
- [x] 支持指定遮罩范围：全局 / 当前页面 / 指定区域
      —— 三层分工：`global`（跨页可见 + **跨页存活**，页面卸载不清理）· `page`（**仅本页** +
      **卸载自动清理**——防"忘了 hide"，`swept` 计数可观测）· `region`（组件 `p-loading-region`
      **就地包裹**——贴合盒子尺寸、零测量、零滚动同步）
- [x] 遮罩范围内的交互拦截语义明确
      —— `mask: true`（默认）拦截；`dismissible: false`（默认）点遮罩**不关**（结束由业务显式 hide，
      对齐 `uni.showLoading`）。★拦截挂**根容器**（Skyline 下遮罩元素自身不参与命中测试——p-drawer 实证）

### 验收

- [x] 两个不同范围的 Loading 可共存
      —— 真机 e2e：page 级 `work-a`/`work-b` 同时活跃（宿主渲染 2 个实例），结束 A 后 B 仍在
- [x] 遮罩范围内的交互被正确拦截，范围外不受影响
      —— ★**部分机器验证 + 诚实边界**（见下）：渲染正确性已**截图取证**（全屏覆盖 + 多实例层叠）；
      **拦截语义无法用本机自动化端到端断言**（`automation_element_action` 的选择器 tap 走"直接派发"，
      会绕过渲染层层叠——实证：点被完全遮罩覆盖的按钮仍触发页面回调）；拦截的**字段与判定**在单测锁，
      真机拦截需**人眼/手工**验证。

### ★实现要点

| 关注点 | 做法 | 为什么 |
|---|---|---|
| 服务 vs 队列 | `active` 数组（seq 升序 = 层叠顺序） | Loading 是"进行中任务"（可多个），不是"临时提示"（排队）——**两种语义不能合并** |
| 同名替换 | 同 id 再调 = 替换文案，**保住原位置** | 对齐 `uni.showLoading` 覆盖语义；但反复刷新文案不该改变层叠顺序 |
| 缺省 scope | `page` | **更安全的默认**：忘了 hide 也不跨页泄漏 |
| 卸载清理 | `sweepPageLoadings(pageKey)`（宿主 `onUnmounted` 调） | page 范围的核心安全收益；`swept` 计数 = "业务忘了 hide"的指标 |
| region 为什么是组件 | 就地包裹 ⇒ 盒子即遮罩边界 | 放页面级宿主就得测量元素矩形 + 跟随滚动/尺寸变化（脆弱且三端有差异） |
| ★注入机制**表驱动** | `OVERLAY_HOSTS` 一行一个能力（Toast/Loading） | GP4-a 时为 Toast 写死扫描器，GP4-b 若再抄一份 = "同一件事两份实现 = 修一份等于没修" |

### ★真机排障（两处真实缺陷，已修 + 已文档化）

1. **根 0×0**（遮罩永不生效）：portal 内 `display: none → block` **不重排** ⇒ 根恒 0×0。
   修：根**常驻显示**（实测 390×844），拦截靠 `catchtap` 语义（无实例时不消费事件 ⇒ 页面照常可点）。
2. **观测面自毁**（本轮踩的元缺陷）：组件把几何诊断写在**订阅回调里**，而 runtime 的 notify
   **会吞掉订阅者异常**（设计如此）⇒ 诊断抛错时**它上面的落痕写入被一并跳过**（"状态对但 trace 空"），
   我据此又误判一轮。修：诊断自带 try/catch + **落痕写在诊断之后**（观测面不得自毁）。

### ★验证边界（诚实记录——这条比结论更重要）

`automation_element_action` 的**选择器 tap 是"直接派发"**：绕过渲染层层叠（点被遮罩完全覆盖的
按钮仍触发页面回调），且**无法定位 portal 内元素**（遮罩 id 直接报错）。
⇒ 本机自动化**无法**判定"遮罩是否真拦住点击"。故：
· 可机器验证的 → e2e 断言（宿主实例化 / 多实例 / 范围语义 / 跳页清理与跨页存活 / 遮罩几何全屏）
· 不可机器验证的 → 单测锁字段与判定 + 组件头注写明"真机拦截需人眼验证"
（**不用会给出假结果的手段硬凑一条绿**——那是本仓反复强调的"假绿"形态）

### 交付物

- 服务：`packages/runtime/src/loading.ts` + `index.ts` 导出
- 宿主/组件：`packages/components/p-loading-host/`（多实例渲染端）· `p-loading-region/`（区域遮罩）
- 注入：`packages/plugin-vite/src/page-overlay.ts`（**表驱动** `OVERLAY_HOSTS`）+
  `plugin.ts`（wxml 注入 + 闭包）· `gen-routes.ts`（每页 `usingComponents`）
- 演示：`examples/subpackages/svg-lab/pages/gp4-loading-demo.vue`（★放分包：主包页面数有 32 上限）
- 测试：`tests/loading-multi.test.ts`（24 组）+ `tests/overlay-host-inject.test.ts`（20 组）
  + `tests/e2e-mp-loading-multi.test.ts`（真机）

---

## 卡 GP4-c · 登录失效拦截弹窗　✅ **实现完成（2026-10-03）**

**优先级**：中高
**预估**：0.3 人周
**依赖**：GP2-a
**阻塞**：GP5

### 必做项

- [x] 不可取消的模态弹窗（无关闭按钮、不响应返回键）
      —— `p-auth-gate`：**不提供** `closable`/`maskClosable`/`closeOnClickOverlay`（不给误配置的机会，
      单测锁住这点）；点遮罩/点面板/点页面**都不关**（唯一出口是登录态恢复）
- [x] 与路由守卫协同，**但不新建机制**（复用《导航体系方案》的守卫）
      —— `auth-gate.ts` 不是平行机制，而是**既有守卫的信号源 + 收口**：
      · `createAuthChecker()` 直接喂给**既有** `createRouter({ auth })` ⇒ 守卫与弹窗读**同一份事实**
      · 守卫的 `onAuthFail` 与 401 上报（`notifyAuthExpired`）**汇入同一状态**（不各说各话）
      · 恢复走业务注入的 `onRestored`（内部走**既有** `router.replace`）——组件**不自己导航**
- [x] 全局触发：任意页面任何请求返回 401 均可弹出
      —— 业务在请求拦截器里调一行 `notifyAuthExpired()`；宿主由**表驱动注入**每页
      （`OVERLAY_HOSTS` 加一行，扫描/注入/注册/闭包自动跟上）

### 硬约束

- [x] 不得新建独立的"全局拦截机制"，必须复用路由守卫
      —— 见上；另：**动作按钮不自己导航**（转达 `props.onAction` 给业务）——单测机器判据：
      组件内不得出现 `navigateTo`/`reLaunch`/`switchTab`

### 验收

- [x] 在任意页面触发 401，弹窗出现且不可取消
      —— 真机 e2e：401 → `expired=true`（状态）+ 宿主侧投影为显示；**点页面别处后仍失效**
      （★判据刻意设计成**状态事实**而非交互事实——见下方"验证边界"）
- [x] 弹窗消失后回到登录态，不产生页面栈异常
      —— 真机 e2e：恢复前后**页面栈深度不变**（本模块不注入任何导航动作）

### ★实现要点

| 关注点 | 做法 | 为什么 |
|---|---|---|
| 为什么需要它（既有守卫不够吗） | 既有 `auth` 守卫**只在导航时**跑；用户停在页面上被 401 打中时**没有导航** | 本卡补的是"**非导航触发**的失效"这一路输入 |
| 唯一事实 | `expired`（模块级单例）——守卫读它、弹窗读它、计数也在它旁边 | 两套判断会各说各话（守卫放行但弹窗还在，或反之） |
| 幂等 | 重复 401 不重复翻转（只累加 `count`） | 并发请求会各报一次 401 ⇒ 不能弹 N 次 |
| 恢复由谁决定 | 业务（登录成功 ⇒ `markAuthRestored()`）；组件**无权**宣称已恢复 | 登录是否真的成功是"守卫的事实"，不是 UI 的 |
| 组件形态 | `p-auth-gate`（与 `p-modal` **同语义不同可取消性**——语义表登记为 `shell.modal` 别名） | 把"不可取消"做成 p-modal 的开关，会让"可关"配置有机会被误用到拦截场景 |
| **宿主需业务回调** | ★本页/本项目**手写**宿主（注入的是裸标签，绑不了 `onAction`） | 这正暴露了注入机制的真实边界：**纯状态驱动的宿主可注入，需业务动作的宿主须手写**（手写后自动注入会让位，防双宿主） |

### ★验证边界（诚实记录——与 GP4-b 的对照很说明问题）

GP4-b 的"遮罩拦截"依赖**渲染层命中测试**⇒ 自动化工具绕过层叠 ⇒ **不可机器断言**。
本卡的"不可取消"刻意表达成**状态事实**（`isAuthExpired()` 在任意点击后是否仍为 true）——
**不依赖命中测试** ⇒ **可机器断言**（真机 e2e 已锁）。
★这是判据设计上的取舍：**能表达成状态的就不要表达成交互**（可验证性优先）。
另：「重新登录」按钮在 portal 内 ⇒ 页面级自动化点不到它 ⇒ 其**接线**由单测锁
（转达 `onAction`、组件内不得出现导航 API），真机点击需人眼验证。

### 交付物

- 服务：`packages/runtime/src/auth-gate.ts` + `index.ts` 导出
- 组件：`packages/components/p-auth-gate/`（不可取消模态）+ 注册（index.ts / global-components / 语义表 / Rust）
- 注入：`OVERLAY_HOSTS` 加 `auth-gate` 行（表驱动——无新机制代码）
- 演示：`examples/subpackages/svg-lab/pages/gp4-auth-gate-demo.vue`
- 测试：`tests/auth-gate.test.ts`（18 组，含破坏性验证 3 条）+ `tests/e2e-mp-auth-gate.test.ts`（真机）

### ★本轮附带修正

用户新增文档 `docs/Proteus_原生资产复用与统一开发体验方案.md` 的**过期数字**（"183 原语"→ 187）—— <!-- stats-ok: 引述修正前的错误值，用于说明本次对账 -->
`check:docs-stats` 按设计抓出（防"数字过时静默上线"）；同轮更新官网组件数 80 → 81。

---

# 第五批 · 验收与例外通道

## 卡 GP5 · 八条超级应用场景验收 ⭐　**实现完成（2026-10-03）**

**优先级**：⭐ 最高（最终判据）
**预估**：0.5 人周
**依赖**：GP3 系列、GP4 系列
**阻塞**：对外表述

### 验收清单

| # | 场景 | 归属层 | 是否每页引入 | 实现落点 |
|---|---|---|---|---|
| 1 | 全局 Toast（可排队、可自定义样式、可指定位置） | Overlay | ❌ | `runtime/toast.ts` + `p-toast-host`（**构建期按需注入**每页——GP4-a） |
| 2 | 全局 Loading（可多实例、可指定遮罩范围） | Overlay | ❌ | `runtime/loading.ts` + `p-loading-host`（同上——GP4-b） |
| 3 | 全局登录失效拦截弹窗（不可取消） | Overlay | ❌ | `runtime/auth-gate.ts` + `p-auth-gate`（★**唯一手写宿主例外**——需绑业务动作 onAction；已注释写明理由） |
| 4 | 全局悬浮球（播放器 / 客服） | Global | ❌ | `App.mp.vue` Global 层（★本次新增） |
| 5 | 全局音乐播放条 | Global | ❌ | 同上（★本次新增） |
| 6 | 全局网络状态条 | Global | ❌ | 同上（GP3-b1 起既有） |
| 7 | 全局主题容器（暗黑切换，无需刷新页面） | Global | ❌ | 同上（★本次新增——全屏背景层，树序最底） |
| 8 | 全局 IM 未读角标（跨页面同步） | Global + 状态 | ❌ | 同上（★本次新增——任意页 +1 其它页读到同一份） |

### 判据

- [x] **8 条全部为"否"**（源码层：Toast/Loading/登录拦截 = 构建期注入或根组件声明一次；Global 五条 = App 壳声明一次）
- [x] 任何一条需要每页引入 → **方案不成立，回退排查**（无回退——8/8 零引入）
- [ ] 逐条截图 / 录屏留证（可进 Playground 演示库）—— ★待人工补（机器判据已就位：见下）

### ★验收装置（机器判据，2026-10-03）

| 层 | 装置 | 验什么 |
|---|---|---|
| 编译期 | `tests/gp5-scenarios.test.ts`（13 组） | 演示页**零全局声明**（源码 + 编译产物双向）· 四条场景字段/方法齐备 · **C2 上限回归锁**（≤32）· 注入面（data 直读/方法合并/写镜像）· 主题容器树序最前 · Overlay 三条的宿主零手写（登录拦截为唯一例外且有注释） |
| MP 端上 | `tests/e2e-mp-gp5.test.ts` | 零声明页 → 注入生效（悬浮球/音乐条/主题/角标）→ **跨页仍在** → 状态一份（回页仍为同值）→ 写回同步 → 零 error |
| Web 端上 | `tests/e2e-web-gp5.test.ts` | 场景在 Global 层容器内（不在 Page 层内）· 点桥后出现 · **SPA 导航后仍在且状态保留**（同一 DOM 节点） |

★**诚实边界（方案 §1.2-bis）**：MP 端 Global 层四条是**每页一份实例**（N = 页面栈）——
跨页一致靠**状态一份**（共享模块）；**不得说"单实例跨页面存活"**（Web/自绘端才是）。

### 对照

uni-app 现状：这 8 条中**至少 5 条**需要每页引入或依赖全局单例 hack。
**对照表建议做成对外素材（见 GP8）。**

---

## 卡 GP6-a · 例外通道：Android 悬浮窗

**优先级**：中（默认关闭）
**预估**：0.3 人周
**依赖**：GP0-d、GP3-c
**阻塞**：无

### 必做项

- [ ] 实现 `TYPE_APPLICATION_OVERLAY` 悬浮窗
- [ ] **完整授权流程**（申请、引导、跳转设置页）
- [ ] **拒绝降级**：不得静默失败，必须有明确降级行为
- [ ] 国产 ROM 差异处理（按 GP0-d 结论）

### 验收

- [ ] 拒绝授权后有可见降级，无静默失败
- [ ] 未登记时该通道默认不可用

---

## 卡 GP6-b · 例外通道：iOS 独立窗口

**优先级**：中（默认关闭）
**预估**：0.3 人周
**依赖**：GP0-c、GP3-c
**阻塞**：无

### 必做项

- [ ] 透明背景 + 重写 `pointInside`（只响应目标区域）
- [ ] 键盘通知监听与 windowLevel 重置
- [ ] iOS 13+ 场景管理适配

### 验收

- [ ] 独立 window 不拦截全屏点击
- [ ] 键盘弹出时层级正确

---

## 卡 GP6-c · 例外通道：鸿蒙全局悬浮窗

**优先级**：中（默认关闭）
**预估**：0.3 人周
**依赖**：GP0-b、GP3-d
**阻塞**：无

### 必做项

- [ ] 实现鸿蒙全局悬浮窗（应用退至后台仍可显示）
- [ ] 明确与子窗口的生命周期差异（独立窗口类型）

### 验收

- [ ] 退至后台仍显示（这是子窗口做不到的）
- [ ] 权限与用户授权流程完整

---

## 卡 GP6-d · 例外通道登记机制

**优先级**：中高
**预估**：0.3 人周
**依赖**：GP6-a/b/c
**阻塞**：无

### 必做项

- [ ] 与 XComponent 自绘、TSX 使用**同一套登记机制**
- [ ] 例外通道默认关闭，启用必须显式声明
- [ ] 纳入埋点统计（使用频次、各端分布）

### 验收

- [ ] 未声明使用例外通道时，产物中不含相关代码路径
- [ ] 埋点可统计例外通道的实际使用量

---

# 第六批 · 长期监控

## 卡 GP7 · Global 层内存常驻监控

**优先级**：中高（超级应用的隐形负担）
**预估**：0.5 人周
**依赖**：GP3 系列
**阻塞**：无

### 现状

Global 层**永不销毁**。若塞入全局 IM 会话列表、全局埋点缓冲、全局图片预加载缓存，会形成一块永不释放的内存。

★**小程序端更重**（方案 §1.2-bis）：MP 的 Global 层是**每页一份实例** ⇒ 内存开销是 **O(页面栈深度)**
而非 O(1)——页面栈 5 层就是 5 份。本卡口径**必须分端报告**（自绘端 1 份 / MP N 份，不得混算）。

### 必做项

- [ ] Global 层节点的内存占用可观测（接入已有内存诊断设施）
- [ ] 提供 `unmountGlobal(id)` 显式卸载，与挂载对称
- [ ] 运行时告警：Global 层内存超过阈值时告警（阈值待实测校准）
- [ ] 与 GP2-d 的编译期告警形成双层防护
- [ ] ★**分端口径**：自绘端（1 份）与 MP（N 份）分别报告

### 验收

- [ ] 可查询 Global 层当前内存占用
- [ ] `unmountGlobal` 后内存确实释放（有前后对比数据）

---

## 卡 GP8 · 与 uni-app 现状的对外对照表

**优先级**：中
**预估**：0.3 人周
**依赖**：GP5
**阻塞**：对外材料

### 必做项

- [ ] 制作八条场景的对照表（Proteus vs uni-app）
- [ ] 每条场景给出 uni-app 现状的具体描述（每页引入 / 全局单例 hack / 需第三方插件）
- [ ] 引用 `@uni-ku/root` 作为痛点硬证据（**官方不支持、需第三方 Vite 插件补上**）

### 对外表述约束

**✅ 可以讲**
- "App.vue 支持真正的 template，全局组件声明一次，全应用生效。"
- "三层挂载模型：Global / Page / Overlay，语义清晰，编译期可校验。"
- "Toast 支持排队、自定义样式与位置，不再是全局单例。"

**❌ 禁止讲**
| 错误表述 | 问题 |
|---|---|
| "我们首创了全局挂载机制" | Flutter Overlay、RN Portal、Compose SnackbarHost 都是等价物，会被拆穿 |
| "我们超越了所有跨端框架" | 必须限定为"**对小程序系框架**" |
| "支持任意组件挂到全局" | 与 C1/C2/C3 冲突，且是逃生口径 |

**推荐落点**
> "全局挂载不是新发明，Web 和原生开发一直有。我们做的，是把这个常识还给小程序开发者。"

### 验收

- [ ] 对照表八条完整，每条有出处
- [ ] 对外表述通过禁语检查

---

# 执行指令

1. **GP0 必须先做**——五个子卡可并行，但全部未完成前不得开始 GP3 系列。
2. **GP0-a（小程序 root-portal 点击穿透）是最高优先级**——它是版本相关的静默失效，不实测会在 GP3-b 后期才暴露。
3. **GP2-b（C1 静态检查）不可省略**——省略它，全局层就是新逃生口，且失效是静默的。
4. **GP6 例外通道默认关闭**，未登记不得启用；与 XComponent、TSX 共用同一套登记机制。
5. **GP3-d 鸿蒙卡排在鸿蒙宿主主线 HM0–HM2 之后**，不得并行。
6. GP2-c 的节点上限 32 是建议值，**GP0 实测后应校准**，不要直接当结论用；
   ★MP 端要区分「**每页 32**」与「**总驻留 32×N**」（方案 §1.2-bis 实例数列）。
7. **GP3-b0 与 GP3-b1 是两张卡**：Overlay 是**收口既有实现**（teleport→root-portal 2026-09-08 已落地），
   Global 层才是新建——不要合并估算，也不要把 Overlay 当新工作重复投入。
7. GP5 是最终判据：**八条中任意一条需要每页引入，方案不成立**。
8. GP8 对外材料必须通过禁语检查——"超越所有跨端框架"必须限定为"对小程序系框架"。

---

# 待核实项（跨卡）

| # | 事项 | 影响 | 归属卡 |
|---|---|---|---|
| 1 | Skyline `root-portal` + `virtualHost=false` 在**最新基础库**是否仍有效 | 决定小程序端 Overlay 实现方式 | GP0-a |
| 2 | 鸿蒙子窗口能否承载 Proteus 指令流（而非 ArkUI 组件） | 决定鸿蒙端是否需走 ContentSlot | GP0-b |
| 3 | iOS 26 下独立 UIWindow 的创建限制是否变化 | 与 EN0 联动 | GP0-c |
| 4 | 小程序端 Global 层是否受页面栈数量影响（多页面同时存活时的内存） | 决定 C2 上限取值 | GP0-a / GP2-c |
