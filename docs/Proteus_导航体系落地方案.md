# Proteus 导航体系落地方案（NB 系列任务卡）

> 版本：v1 · 日期：2026-10-02
> 上游方案：《Proteus_导航体系与多端一致性方案》（tabBar / navBar，三层模型 L1 分支 / L2 栈 / L3 栏）
> 本文定位：**把上游方案转成可执行的任务卡清单**（编码前置：先对齐卡片与判据，再动代码）
> 关键决策（本轮确定）：**分支（branch）= `meta.isTab` 页面**——零新增配置项，与已统一的配置面一致。

---

## 0. 先读：现状核对（上游方案 × 仓库实况）

> 依据：2026-10-02 对 `packages/router/src`、`packages/components`、`examples/router/auto-routes.ts`
> 的代码核实。**"已有"的部分不重复造；只有标 🔴 的是真缺口。**

| 上游方案要点 | 仓库现状 | 结论 |
|---|---|---|
| **L1 多分支独立栈**（方案 §0.3 称"承载超级应用的唯一关键"） | `createAppStack` 是**工厂函数**（可创建多实例），但**没有任何"分支管理器"把它们组织起来**；`auto-routes.ts` 只产出 `tabNames` 名单 | 🔴 **真缺口（本批核心）** |
| L2 栈（分支内页面栈） | ✅ `AppStack`：无层数上限 + 预算冻结 + `removeByName`/`moveToTop` | 已具备 |
| **保活策略三档**（方案 §2.4，IndexedStack 陷阱对策） | ❌ 全仓无 `keepAlive`（穷尽检索 `packages/router` + `packages/types`） | 🔴 **真缺口** |
| tabBar 数据驱动 | ◐ `p-tabbar` 组件已存在（`tabs[] + active 受控 + select`），但**未与"分支栈"接线** | 部分具备 |
| `navigateTo` 不能跳 tab 页（小程序硬限） | ✅ 统一 API 无此限制（`routeMap` 全量可达） | 已具备 |
| 声明式路由 | ✅ `router.pages`（pages.json 等价物）+ 统一产物三投影 + `RouteParamsByName` | 已具备 |
| 深链 | ◐ `deep-link.ts` 有 `parse/match/resolve/buildColdStartStack`；**未与分支栈打通** | 部分具备 |
| **系统返回归属**（方案 §8，鸿蒙跨 Tab 静默差异） | ❌ `back()` = `adapter.navigateBack(delta)`，**无"分支"概念** | 🔴 **真缺口** |
| 层内不裸 z-index | ✅ `check:layers`（LY1）已接 CI/verify | 已具备 |
| navBar（L3） | ◐ `p-nav-bar` 存在（`title/back/fixed + 插槽`，back **仅 emit**，注释写明"C3：组件不直接调路由"） | 部分具备 |
| 安全区与凸起定位（方案 §5.3） | ❌ 未统一处理 | 🔴 缺口（NB4） |

**结论**：L1 多分支栈、保活三档、返回归属是**三个真缺口**且互相咬合（同属"分支"概念）；
其余多为已有或部分。⇒ 本批（NB1+NB3 核心）聚焦这三件。

---

## 1. 核心决策：分支 = `isTab` 页面（零新增配置）

### 1.1 决策内容

**每个 `meta.isTab === true` 的页面自动成为一个分支（branch）根**。
**不新增 `router.branches` 配置段**。理由：

| # | 理由 |
|---|---|
| 1 | `isTab` 已是**单一事实**：`auto-routes.ts` 统一产物里已有 `tabNames`（本轮刚统一），MP 端 `app.json.tabBar` 也由它推导 ⇒ 再引一个 `branches` 段就是**第二个事实源**（与上一轮"统一路由页面管理"的方向相悖） |
| 2 | 分支根 = tab 根屏是**语义等价**的（Android `saveBackStack` / Flutter `StatefulShellRoute` / 鸿蒙 `NavPathStack` 的"每 tab 一栈"都是这个形态） |
| 3 | 分支级配置（保活等）**挂在页面配置里**（`router.pages['pages/index'].branch = {...}`）——与"一个入口管全端页面"一致 |

### 1.2 配置形态（增量极小）

```ts
// proteus.config.ts —— 页面配置里新增**可选**的分支级字段（挂在 tab 根页上）
router: {
  pages: {
    'index': {
      title: '首页', isTab: true,
      // ★新增（NB1）：分支级配置（可选；缺省走框架默认）
      branch: { keepAlive: 'active' },   // none | active | all
    },
    'mine': { title: '我的', isTab: true },  // 不写 branch ⇒ 默认 active
  },
}
```

### 1.3 契约扩展（`RouteMeta`）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `branch.keepAlive` | `'none' \| 'active' \| 'all'` | `'active'` | 分支视图保活：`none`=切走即销毁视图（栈状态序列化保留）；`active`=当前+相邻保活；`all`=全保活（对齐 IndexedStack，慎用） |

★`branch` 仅对 `isTab: true` 的页面有意义；写在非 tab 页上 ⇒ **编译期警告**（不阻断，但登记）。

---

## 2. 任务卡（NB 系列）

> 编号沿用方案 §10，但**重排依赖与切片**（本批只做 NB1+NB3 的核心，其余待办）。

### 卡 NB1 · 分支导航核心（L1）：`createBranchNavigator`

**现状**：`createAppStack` 可多实例，但无组织者；`tabNames` 只是名字数组。

**目标**：新增 `packages/router/src/branch-navigator.ts`

```ts
export interface BranchSpec {
  name: string            // = tab 根页的路由名
  root: string            // = 该页 path
  transition?: RouteTransition
  keepAlive?: 'none' | 'active' | 'all'
}
export interface BranchNavigator {
  /** 分支清单（顺序 = auto-routes 里 tabNames 的顺序） */
  readonly branches: readonly BranchSpec[]
  /** 当前活跃分支名 */
  active(): string
  /** 切分支（**保留各自栈**——与小程序"强制清栈"的本质差别） */
  switchTo(name: string): void
  /** 取某分支的栈（诊断/深链/返回归属用） */
  stackOf(name: string): AppStack
  /** 当前活跃分支的栈 */
  activeStack(): AppStack
  /** 保活决策（供执行器消费：哪些分支的视图要保留） */
  keepAlivePolicy(): Array<{ branch: string; keep: boolean }>
  /** 统一命令流（含"切分支"的 mount/enter/exit/unmount 事务） */
  drainCommands(): BranchCommand[]
}
```

**判据（机器可验证）**：
- [ ] `createBranchNavigator({ screens, tabNames, branches })` 从**统一产物**装配（`tabNames` + `screens`，不新增配置源）
- [ ] `switchTo` **保留各分支栈**：A 分支 push 3 层 → 切到 B → 切回 A ⇒ **A 栈深仍 3**（对照小程序：切 tab 清栈）
- [ ] 深链直达分支内子页：`branch.navigate(frames)` 能在指定分支内重建栈
- [ ] 命令流按分支隔离（`branch` 字段标记，执行器据此决定 mount/unmount）

**估时**：1 人周 ｜ **依赖**：无（复用 `AppStack`）

---

### 卡 NB3 · 保活三档（`keepAlive`）

**现状**：无 `keepAlive`（全仓穷尽检索为空）。

**目标**：把方案 §2.4 的 IndexedStack 陷阱对策落成可声明 + 可机器验证的策略。

| 档 | 语义 | 对齐 |
|---|---|---|
| `none` | 切走 ⇒ **销毁视图**，但**栈状态序列化保留**；切回重建 | Android `saveBackStack`（"instances no longer exist in memory"） |
| `active`（默认） | 当前 + 相邻分支保活 | 社区实践（保手感 + 控内存） |
| `all` | 全保活（对齐 Flutter `IndexedStack`） | ⚠ 方案 §2.4 明确警告：几十个模块会爆内存 |

**判据**：
- [ ] `keepAlivePolicy()` 输出可被执行器直接消费（每个分支一个 `keep: boolean`）
- [ ] `none` 档：切走的分支产生 `unmount(视图)` 但**栈状态仍可读**（`stackOf(name)` 返回完整栈；切回产生 `mount(rebuild=true)`）
- [ ] `active` 档：**相邻分支不卸载**（与 IndexedStack 的差别在设计上可声明）
- [ ] 内存读数：`none` vs `all` 在深栈场景下的**活跃节点数差异**（复用 `AppStack.stats().activeNodes`）可测且有界
- [ ] 编译期：`branch.keepAlive` 写在非 tab 页 ⇒ 警告（登记，不静默）

**估时**：0.5 人周 ｜ **依赖**：NB1

---

### 卡 NB6 · 系统返回归属统一（方案 §8）

**现状**：`back()` = `navigateBack(delta)`——无分支概念；鸿蒙"返回键绑定根 Navigation"是**静默差异**（方案 §3.3 社区实证）。

**目标**：返回规则**显式化**（方案 §8.2 四条）：

| 规则 | 实现落点 |
|---|---|
| 1 | 返回**只作用于当前活跃分支的栈** | `BranchNavigator` + `back()` 分层 |
| 2 | 当前分支栈空 ⇒ 交外层 RootStack | 未到根即可 pop；到根 ⇒ 交外层 |
| 3 | RootStack 空 ⇒ 交系统 | 宿主侧（Android `onBackPressed`） |
| 4 | **各端显式实现，禁止依赖默认行为** | 两端宿主接线 + 判据 |

**★与既有 capability-app 的衔接**：`packages/api/src/capability-app.ts:1114` 已登记
「实体/手势返回同样经栈 pop 派发——壳负责把 onBackPressed 转成虚拟栈 pop」+ roadmap
「壳接线 onBackPressed → 栈 pop 后生效」⇒ **本卡就是兑现该 roadmap**。

**判据**：
- [ ] `back()` 在分支 A 上 pop **不影响分支 B 的栈**（机器可验证）
- [ ] 分支 A 栈空后 `back()` ⇒ 产生"交外层"信号（可观测），**不静默吞掉**
- [ ] 两端宿主（Android `onBackPressed` / iOS 手势或按钮）接线后，真机读数：**返回落点 = 当前分支**（判据组进 `check-app-stack.py` 或新判据脚本）
- [ ] 鸿蒙侧：显式实现（**待端可用后再做**，本批只留接口与判据定义）

**估时**：0.5 人周 ｜ **依赖**：NB1

---

### 卡 NB2 · 深链与分支栈打通（◐ 部分已有）

**现状**：`deep-link.ts` 已有 `parseDeepLinkUrl` / `matchPattern` / `isDeepLinkAllowed` /
`resolveDeepLink` / `buildColdStartStack`；**缺**"与分支栈合并"这一步。

**目标**：方案 §7.3 四种场景落地——

| 场景 | 要求 | 落点 |
|---|---|---|
| 冷启动深链 | 重建**完整分支 + 栈**（直达 `pages/mine/settings` ⇒ 生成 `mine` 分支 + 其栈） | `buildColdStartStack` × `BranchNavigator.navigate(branch, frames)` |
| 温启动深链 | **合并**到现有栈（不重复压入已有公共前缀） | 复用 `AppStack.navigate` 的公共前缀 diff |
| 栈状态序列化 | 分支栈可序列化（`ScreenFrame[]`） | 已有 `ScreenFrame` 形态；补 `serializeBranchStacks()` / `restoreBranchStacks()` |
| 鉴权重定向 | 声明式 guard | ✅ 已有（`requiresAuth` / `permissions` 自动守卫） |

**判据**：
- [ ] 冷启动：`deepLink('app://mine/settings')` ⇒ `mine` 分支被创建且栈 = `[mine, settings]`（或 `[mine]` 若 settings 不在栈模型内）
- [ ] 温启动：当前在 `home` 分支栈 `[home, a, b]`，深链到 `[home, a]` ⇒ **零 mount**（最小操作集）
- [ ] 序列化往返：`serialize → restore` 后各分支栈**逐帧相同**（含 params）
- [ ] 未授权深链 ⇒ 走 `requiresAuth` 重定向（不静默落地）

**估时**：1 人周 ｜ **依赖**：NB1

---

### 卡 NB4 · tabBar 组件数据驱动化（◐ 部分已有）

**现状**：`p-tabbar` 已有（`tabs({key,label,badge?,icon?})[] + active 受控 + select`），
**缺**：与分支栈接线、安全区、凸起、动态增删的验证。

**目标**：方案 §5 落地——

| 项 | 做法 |
|---|---|
| 数据驱动 | `tabs` 来自 `BranchNavigator.branches`（不写死） |
| 动态增删 | 分支增删时 `tabs` 跟随（**运行期可变**——打破小程序"编译期固化"） |
| 图标 | **矢量优先**（组件库既有图标集；不使用 40kb/81px 位图约束） |
| 角标/红点 | 声明式（`badge` 字段已有雏形） |
| 安全区 | 框架统一处理（`env(safe-area-inset-bottom)` / Android 手势条），**开发者不写定位代码** |
| 凸起按钮 | 统一实现（方案 §5.3 的坑：外层 fixed + 凸起 absolute——**不许用 transform/margin 定位**） |
| 数量 | **不设硬上限**；`branches.length > 5` ⇒ **编译期分层建议**（Drawer/Rail，方案 §2.5） |

**判据**：
- [ ] `tabs` 与 `BranchNavigator.branches` 同源（改名/增删一处生效）
- [ ] 安全区：三端（iOS/Android/MP）真机读数——底栏与安全区**不重叠、不被顶**（复用既有 L4 截图装置）
- [ ] 凸起按钮：真机上不随滚动偏移（方案 §5.3 的坑专项）
- [ ] `>5` 分支 ⇒ 构建期输出分层建议（**不阻断**）

**估时**：1 人周 ｜ **依赖**：NB1 ｜ **需要真机**

---

### 卡 NB5 · navBar 组件（L3）

**现状**：`p-nav-bar` 已有（`title / back / fixed + left/right 插槽`）；`back` **仅 emit**
（注释：「C3：组件不直接调路由」）。

**目标**：方案 §6 语义拆分落地——重点是**返回按钮语义**：

| 语义 | 要求 |
|---|---|
| 返回（back） | **内容由来源页决定**（iOS 语义）——方案 §6.2 明确"必须在 API 上体现"，否则开发者困惑"为什么我设置的返回文案不生效" |
| 标题 | 大标题 / 副标题 / 自定义视图 |
| 操作区 | 左/右按钮组（插槽已有） |
| 背景 | 纯色/渐变/透明/模糊（与 `p-glass` 交叉） |
| 滚动联动 | **调用**滚动编排能力（SC 方案），navBar 不自己实现动画（方案 §6.3 依赖方向） |

**判据**：
- [ ] 返回文案由**来源页**决定（API 体现：目标页设置无效、来源页有效——与 iOS 一致）
- [ ] `back` 点击 ⇒ 走 `BranchNavigator.back()`（**不直接调平台 API**——与 C3 一致：组件 emit，页面/框架决策）
- [ ] 各端形态差异（iOS large title / Android TopAppBar / MP 自绘+胶囊避让）**如实登记**（允许差异清单）

**估时**：1 人周 ｜ **依赖**：NB1/NB6

---

### 卡 NB7 · 一致性回归（进 L2 + 允许差异清单）

**目标**：方案 §9 的对接——分支/保活/返回归属进 L2 几何校验，端差异进 `allow-differences.json`。

**判据**：
- [ ] 「切分支保栈」在 **App 两端真机**读数一致（判据组进 `check-app-stack.py`）
- [ ] 「返回归属」三端（App 两端 + MP）行为一致；鸿蒙待端可用后补
- [ ] 新增允许差异条目（若有）：安全区高度差异、系统返回手势差异——**每条必须有理由**

**估时**：1 人周 ｜ **依赖**：NB2–NB6

---

## 3. 执行顺序与切片（依赖修正）

```
本批（可立即做，零真机依赖）
  NB1 分支导航核心 ──┬── NB3 保活三档 ──┐
                     ├── NB6 返回归属 ───┼── NB7 一致性回归（真机）
                     └── NB2 深链打通 ───┘
后批（需端/UI）
  NB4 tabBar 组件（真机验收）  NB5 navBar 组件（真机验收）
  NB0 实测核实（Android saveBackStack / 鸿蒙 NavPathStack / Skyline —— 上游方案 §13 待核实项）
```

**与上游方案 §10 的差异（如实标注）**：
- 上游把 NB0（实测）列为关键路径首项；本轮判定**先做 NB1/NB3/NB6**——因为它们**纯逻辑、零端依赖**（`AppStack` 已有真机证据），实测可并行补
- NB2 上游列在 NB1 之后，本方案**提前**（深链解析已有，缺的只是"与分支合并"，成本低于预期）
- NB4/NB5（组件层）**后置**：需真机验收，且 `p-tabbar`/`p-nav-bar` 已有基础

---

## 4. 判据汇总（本批要交付的机器可验证项）

| # | 判据 | 类型 | 落点 |
|---|---|---|---|
| 1 | 分支清单来自统一产物（`tabNames` + `screens`），**无第二配置源** | 静态 | 单测 |
| 2 | 切分支**保留各栈**（切回栈深不变） | 逻辑 | 单测 |
| 3 | `keepAlive` 三档的卸载/保活行为 | 逻辑 | 单测 |
| 4 | `none` 档：销毁视图 + **栈状态可恢复** | 逻辑 | 单测 |
| 5 | 返回只作用于当前分支；栈空交外层（可观测） | 逻辑 | 单测 |
| 6 | 深链冷启动/温启动的栈重建与合并 | 逻辑 | 单测 |
| 7 | 序列化往返（各分支栈逐帧相同） | 逻辑 | 单测 |
| 8 | 切分支保栈 + 返回归属 | **真机** | `check-app-stack.py` 新组 |
| 9 | 安全区/凸起（NB4） | **真机视觉** | L4 截图装置 |

---

## 5. 验收标准（对齐上游方案 §8 的四条返回规则 + §2.4 保活）

- [ ] `createBranchNavigator` 从统一产物装配，**零新增配置源**（分支 = `isTab` 页面）
- [ ] **切分支保留各分支栈**（与小程序"强制清栈"的本质差别，机器可验证）
- [ ] `keepAlive` 三档可声明、可读、可测；`none` 档栈状态可恢复（对齐 `saveBackStack`）
- [ ] 返回**显式作用于当前分支**；三端行为一致（鸿蒙待端）
- [ ] 深链能直达分支内子页，返回回到该分支根（小程序做不到的能力）
- [ ] tabBar **动态增删**（运行期）；`>5` ⇒ 编译期分层建议（不阻断）
- [ ] 所有新增能力**进 L2 校验**；有意差异进 `allow-differences.json`

---

## 6. 与既有资产的关系（复用清单 —— 不重复造）

| 已有 | 复用方式 |
|---|---|
| `AppStack`（含预算冻结 / `removeByName` / `moveToTop`） | NB1 每个分支一个实例 |
| `createAppNavigationAdapter`（栈 → RouterAdapter + 泵串行化） | NB1 的 `activeStack()` 接它 |
| `createAppNavigation`（一步装配） | 扩展为"多分支"装配器（NB1） |
| `auto-routes.ts` 统一产物的 `tabNames` / `screens` | **分支清单唯一来源**（决策 §1） |
| `Router` 统一 API（`push`/`back`/`popTo`/`removeByName`/`moveToTop`） | NB6 在其上分层"分支归属" |
| `deep-link.ts`（解析/白名单/冷启动栈） | NB2 的解析侧直接用 |
| `check-app-stack.py`（判据脚本，两端共用） | NB7 加"分支栈"判据组 |
| `p-tabbar` / `p-nav-bar` | NB4/NB5 在其上扩展（不重写） |
| LY1 层级门禁（`check:layers`） | tabBar/navBar 走层级原语（方案 §5.4） |

---

## 7. 风险登记（承接上游 §12，补落地视角）

| # | 风险 | 等级 | 缓解（本方案落点） |
|---|---|---|---|
| 1 | 声明式路由复杂度失控（重蹈 Navigator 2.0） | 🔴 高 | §1 分支 = `isTab`（**不引入新 API 面**）；NB1 的 API 表面积只 8 个方法 |
| 2 | 多栈内存（IndexedStack 陷阱） | 🔴 高 | NB3 三档 + `none` 档栈状态序列化；用 `stats().activeNodes` 做**读数判据** |
| 3 | 鸿蒙返回跨 Tab 跳转 | 🟡 中 | NB6 显式实现 + 判据定义（**端不可用 ⇒ 如实标"待端"**） |
| 4 | 安全区各端不一致 | 🟡 中 | NB4 框架统一处理 + 真机矩阵 |
| 5 | tab 数量放开导致设计灾难 | 🟡 中 | `>5` 编译期分层建议（NB4） |
| 6 | 与滚动编排 / Morpheus / 层级边界不清 | 🟡 中 | 依赖方向写死（navBar→滚动编排；动画→Morpheus；层→LY1） |

---

## 8. 待确认（开工前需与产品/用户对齐）

| # | 事项 | 影响 |
|---|---|---|
| 1 | `keepAlive` 默认档 = `active`（当前，`active`） | 若默认 `all` 则与方案 §2.4 警告冲突；**建议保持 active** |
| 2 | 分支级配置字段名 | 现定 `branch: { keepAlive }`；若未来分支需更多配置（如 `rootTransition`），沿用该子对象 |
| 3 | 深链 scheme（`app://` 还是自定义） | 影响 NB2 的解析入口（`deep-link.ts` 已支持自定义 scheme） |

---

## 9. 诚实边界（本方案未覆盖 / 未验证的）

① **鸿蒙端整体未验证**（无设备）：NB6 的鸿蒙显式实现只有接口与规则，**实测待端可用**；
② **`p-tabbar`/`p-nav-bar` 是否满足方案 §5/§6 全部形态**未逐项核对（本批只列差距项，未审计现有实现）；
③ **上游 §13 的 5 条待核实项**（鸿蒙 NavPathStack 生命周期 / Skyline tabBar 增强 / Android saveBackStack ROM 一致性 / 微信 tabBar 上限当前值 / iOS 26 large title）**均未核实**——NB0 承接；
④ 本方案**只出文档**（用户本轮决策："先只出落地方案"），**未动任何代码**。
