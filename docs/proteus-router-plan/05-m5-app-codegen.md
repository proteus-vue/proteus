# M5 — App 端 codegen（StackNavigator 抽象）

> **里程碑**：M5（B5）
> **输入依赖**：`02-m2-route-tree.md`（RouteNode[]）
> **产出**：`packages/router/src/codegen/app.ts`、`packages/router/src/app-stack.ts`（虚拟栈）、转场 native 映射
> **LLM 批次**：B5
>
> **★★2026-09-30 路线修正（用户决策）**：「路由的话吸取小程序和 uni-app 的路由栈数量限制的经验教训，
> 路由实现的话也必须是高性能的，可以参考 Flutter」
> ⇒ 本文档下方 §2/§3 原有的「**用系统导航栈**（`UINavigationController.pushViewController` /
> `FragmentTransaction` / 每屏一个 ViewController/Activity）」路线**已废弃**——那正是小程序
> 「10 层限制」路线的翻版（每屏一个原生容器 ⇒ 内存随层数线性增长 ⇒ 平台只能设层数上限）。
> **新路线 = Flutter 式虚拟栈**（已实现）：屏 = 当前树的子树；栈是纯逻辑对象；可见性切换 =
> `display:none`（内核已支持，零渲染成本）；内存由**预算冻结**治理而非层数上限。
> 实现与判据：`packages/router/src/app-stack.ts` + `tests/app-stack.test.ts`（32 条，含 100 层深栈）。
> 下方 §2-§6 保留为**历史设计记录**（原生桥形态仍有参考价值：屏注册表/转场映射/参数传递均沿用），
> 但「栈的物理实现」以本文档 §0 与 app-stack.ts 为准。

---

## 0. ★虚拟栈（最终路线，2026-09-30 实现）

### 0.1 两条路线的对照（为什么必须走虚拟栈）

| 维度 | 系统导航栈（初稿路线） | **虚拟栈（已实现）** |
|---|---|---|
| 屏的物理形态 | 每屏一个原生容器（VC / Activity/Fragment） | **当前树的一棵子树**（同一棵树里 `display:none` 切换） |
| 层数上限 | 有（原生容器内存线性增长；小程序 10 层、uni-app 同类） | **无**（100 层 push 实测全过——`tests/app-stack.test.ts` ①） |
| 超限行为 | `navigateTo` 失败 ⇒ 业务被迫 `redirectTo` 降级（**返回栈断裂**） | **无失败点**；内存超预算时冻结最旧屏（栈位保留，返回=重建） |
| 退场屏状态 | 系统销毁（热重载/内存压力下随时丢） | **树保留**（返程保状态；冻结是显式策略而非被动淘汰） |
| 转场 | 系统转场 API（能力受平台限制） | **Morpheus 自驱动**（内核曲线/FLIP；平台零参与路径） |
| 换宿主成本 | 每端重写栈桥 | 命令流消费（`ScreenCommand`）——换宿主只改执行器 |

### 0.2 核心设计

```
屏 = 树内子树（load_tree 语义：屏的根子树；切屏 = display 切换）
栈 = 纯逻辑对象（无平台调用；命令流交给执行器）
```

- **push**：新屏子树 mount → `enter`（Morpheus 转场）；旧顶 `exit`（转场完 → `display:none`，**树保留**）。
- **pop**：栈顶子树 `unmount`（真销毁）；新顶 `enter`（若为 frozen 则先 mount(rebuild=true)）。
- **内存有界**：`AppStackPolicy.nodeBudget`（缺省 `null` = 不冻结，全栈保状态）。
  超预算 → 从栈底起冻结最旧 `hidden` 屏（`keepWindow` 默认 3 层保护栈顶——**冻结永不触及可见屏**）。
  冻结 = 树销毁 + 栈位保留 + `needsRebuild` 标记；返回 = `mount(rebuild=true)`（重建，毫秒级）。

### 0.3 与既有设施的关系

- **转场**：命令流只携带 `RouteTransition`（声明），执行器经 `packages/animation` 的
  `appTransition()`（`APP_TRANSITION_MAP`）换成 Morpheus 规格——router 包**零动画依赖**（方向纪律）。
- **生命周期**：执行器建/销毁屏子树时对接 `render-backend` 的容器 SPI（五原子销毁 / ResourcePool），
  与 `docs/proteus-host-container-plan/` 的页面模型对齐（`page-lifecycle.md` 的 keep-alive 配额
  正是「预算冻结」的同族思路，本层把它的「深度限制 LRU」替换为「无深度限制 + 预算冻结」）。
- **Host ABI**：屏子树的加载/卸载最终经 `proteus_load_tree` / ops 流落地（HA0-HA5 已落地）。

### 0.4 执行器契约（`ScreenCommand`）

| op | 载荷 | 执行器动作 |
|---|---|---|
| `mount` | `screenId/name/path/params/rebuild` | 建屏子树（`rebuild=true` 时是冻结后重建）；完成后调 `markRebuilt` |
| `enter` | `screenId/transition?` | `display:flex` + 进场转场（Morpheus 规格来自 `appTransition(transition)`） |
| `exit` | `screenId/transition?` | 退场转场（播放完由执行器置 `display:none`；树保留） |
| `unmount` | `screenId/reason: 'pop'\|'reset'\|'freeze'` | 销毁子树（对接五原子销毁） |

惯序：`push` = exit(旧顶) → mount(新) → enter(新)；`pop` = exit(旧顶) → unmount(旧顶) → enter(新顶)。
★退场方向（pop 的反向转场）由执行器/Morpheus 推导——**动画知识不在 router**。

### 0.5 ★执行器已落地（2026-09-30）—— 命令流有了消费者

| 层 | 落点 | 判据 |
|---|---|---|
| **方向语义**（§0.4 的"由执行器/Morpheus 推导"） | `packages/animation/src/route-transition.ts`：`reverseDecls`（from/to 互换）+ `routeTransitionBatches`（forward/back 两向 + 两侧各自判空） | `tests/animation-presets.test.ts` 新增 9 条（含**镜像对**：forward.in `800→0` ↔ back.out `0→800`） |
| **执行器本体**（编排：顺序/可见性/方向/事务） | `packages/render-backend/src/screen-executor.ts`：`createScreenExecutor`（端口注入——树操作 + 动画播放 + 转场规划器；**零平台依赖、零 animation 依赖**） | `tests/screen-executor.test.ts` 11 条（真栈 + 真规划器 + 记录桩） |
| **真机证据** | `hosts/android/bridge/entry-app-stack.ts` 场景 E（两相：kick → 泵 job → read）+ Java 侧两相调用 | `check-app-stack.py` ⑦ 组 5 条 —— **真机全绿**（见下） |

**★两个编排决策（M5 契约没写死、由执行器定的部分）**
1. **退场销毁延迟到转场播完**：pop 的惯序是 `exit → unmount → enter`，若 unmount 即刻销毁，
   旧页会在滑出动画**中途消失**（闪断）⇒ 执行器把被 exit 标记的屏的销毁挂起到转场完成后。
2. **方向推导**（三值表）：本事务 `mount` 且 **非 rebuild** ⇒ `forward`（新内容到来）；
   其余（含 rebuild 重建、子树早已在树上的返回）⇒ `back`。★`rebuild=true` 只有 activateTop
   会产生（返回路径）⇒ 判 `back` 的观感正确（回程复位）。

**★真机读数（QuickJS · Android）**
- push 命令序 `mount(detail) → visible(detail,true) → visible(home,false)`（3 步 · 树保留零销毁）
- 方向 `forward`/`back` 分档正确；**镜像对**：`forward.in 800→0` ↔ `back.out 0→800`
- pop 销毁时机：`visible(home,true) → destroy(detail,pop)`（转场后销毁）
- 计数自洽：8 命令 → 3 转场（forward 2 / back 1）· 零错误
- ★**判据侧独立复算**（不信 JS 自报的 `e_mirror_ok`——那是自我认证；`e_mirror_ok` 仅作交叉核对，
  两侧结论不一致 ⇒ 当场红）；**6 个破坏变体全红**（镜像对打坏/自报不符/方向写反/push 出销毁/计数不自洽/时机倒置）

★**诚实边界**：执行器只做**编排**；端口的生产实现在**同日第二轮**已接上（见下）。

### 0.6 ★★端口接到生产实现（2026-09-30 续）——真内核树 + 真帧循环动画

| 层 | 落点 | 说明 |
|---|---|---|
| **端口适配层**（跨边界协议） | `packages/render-backend/src/screen-executor-host.ts`（新）：`createHostScreenPorts` | 把执行器的树操作/动画翻译成宿主 `invoke` 请求（`screen.mount/visible/destroy/anim`）；**完成回调**：宿主帧循环播完后回推 `__proteusHostScreenAnimDone(token)`，本层把 promise 接回（两种完成形态：宿主声明 `immediate` / 回推 token） |
| **宿主实现**（真动作） | `hosts/android/.../ScreenHost.java`（新） | `screen.mount` = 每屏一棵**真实内核树**（`RustLayout.create`，屏=树同构）；`screen.visible` = 内核 `display:flex/none` 补丁（布局与命中测试随之生效）；`screen.destroy` = 真句柄销毁；`screen.anim` = `anim_start` + **Choreographer 帧循环** `anim_tick_bin` 推进到播完 |

**★真机读数（Android QuickJS · 宿主记账——不是 JS 自述）**：`mount=2 · visible=4 · destroy=1 ·
anim=3/完成 3 · 在册句柄 1 · 零钩子缺失`；判据 ⑦ 组 **10 条全绿**（含"宿主真动作"与"屏保留语义"两条新断言）。

**★★三个真机抓出的真缺陷（都修了，记账）**
1. **`appStackRun` 用裸 `eval(bundle)` 没注入宿主桥** ⇒ JS 侧 `proteusHost` 不存在 ⇒ 生产端口抛
   "通道缺失" ⇒ 执行器 10s 超时（记录桩阶段不暴露——**换真端口的价值之一**）；
2. **轮询器把"无 pending 字段"当 pending**（`optBoolean("pending", true)`）⇒ 结果已就绪也永不收工
   ⇒ 必修成"只认显式 `pending:true`"；
3. **动画按树分发的必需性**：把整批 anims 灌给每棵树时，混批（含别棵树的节点）会让内核**整批拒绝**
   （实测 3 次转场只成功 1 次）⇒ 按 `nodeId → 屏` 映射分发（`ScreenHost.nodeToScreen`）。

**★方法学（第三处同源）**：**主线程不得被堵死**——动画推进依赖 Choreographer 帧回调，
若在 `runAll()` 里 `sleep`/同步轮询等待动画完成会死锁 ⇒ 执行器结果走**异步报告**
（`app-stack-executor.json`，`postDelayed` 链让出主线程推进，有界 10s）。

---

## 1. 目标

App 端走 **Vue Custom Renderer + 自绘树**（架构决策），页面栈语义（**虚拟栈，见 §0**）：
- Web：SPA 单根，`<router-view>` 切换组件
- mp：MPA，每页独立 `Page()`
- **App：虚拟栈式导航**——`push` 压栈、`pop` 出栈；**每个屏是当前树的一棵子树**（不是原生容器）

把 `RouteNode[]` 编译为 **屏注册表**（`screens`）+ 嵌套栈结构，转场映射到 Morpheus 声明。

## 2. 导航模型抽象

```
Proteus Router（端无关）        App 端具体
─────────────────              ──────────────────
push(path, params)    ──→      nativeBridge.pushScreen(url, anim)
pop()                 ──→      nativeBridge.popScreen(anim)
replace(path)         ──→      nativeBridge.replaceScreen(url)
goBack(n)             ──→      pop n 次
```

`Router` API **三端一致**（Web 用 vue-router 实现、mp 用 `wx.navigateTo` 实现、App 用原生栈实现），业务代码不写平台分支。

## 3. 映射规则

### 3.1 路由表 → 屏（Screen）注册表

```ts
// dist/.proteus/navigation.generated.ts
export const screens = {
  home: { component: () => import('/abs/Home.vue'), transition: 'slideUp' },
  user: { component: () => import('/abs/User.vue'), transition: 'slide' },
  // ...
}
```

Custom Renderer 启动时把 `screens` 注册进原生桥：**key → 原生组件类 + Vue 组件工厂**。

### 3.2 转场 native 映射

| `<route>.meta.transition` | iOS (UIViewController) | Android (Activity) |
|---------------------------|------------------------|--------------------|
| `slide` | `.push` (默认) | `overridePendingTransition` 右滑 |
| `slideUp` | `.modal` 从底部 | 底部上滑 |
| `halfScreen` | `.pageSheet` (UISheetPresentationController) | BottomSheet |
| `scaleDown` | 自定义 `UIViewControllerTransitioning` | 自定义 ActivityOptions |
| `slideDown` | dismiss 下滑 | 下滑 finish() |

映射写在 `transforms/transform-transition.ts`（**与 M3/M4 共用同一份枚举**，三端一致）：
```ts
export const APP_TRANSITION_MAP = {
  slideUp: { ios: 'presentModal', android: 'slideUp' },
  halfScreen: { ios: 'pageSheet', android: 'bottomSheet' },
  // ...
}
```

> **★2026-09-30 状态更新：Morpheus 侧的第三腿已接上**（本表的映射**语义**已实现，落点在
>   `packages/animation/src/route-transition.ts`）：
>   · `APP_TRANSITION_MAP: Record<RouteTransition, RouteTransitionSpec>`——**穷尽映射**（枚举增员即编译报错）；
>   · 五个成员的落点：`slideUp`→`presets.route.slideUp()`、`slideDown`→新补的 `presets.route.slideDown()`、
>     `halfScreen`→`bottomSheet()`、`scaleDown`→`zoom()`、`none`→**空规格**（不产生动画）；
>   · **三端枚举已交叉核对**（测试里同时加载 router 的 Web/MP 两张表比对键集，`tests/animation-presets.test.ts`）；
>   · ★**与上表的差别**：上表映射到"平台原生转场标识"（presentModal / pageSheet），
>     适用于"用系统导航栈 + 系统转场"；Morpheus 是**自己驱动动画**（内核曲线/FLIP 那套）⇒
>     返回的是**声明规格**而非标识串。★且虚拟栈路线（§0）**不用系统导航栈** ⇒ 采用 Morpheus 规格路线。
>
> **★2026-09-30 更新（第二处）**：路由栈本身已落地（§0 虚拟栈 + 下方 §4/§5 的实现注记）——
> `generateAppScreens`（codegen/app.ts）+ `createAppStack`（app-stack.ts）已实现并有 32 条单测；
> `appTransition` 从"就绪的第三腿"变为**已被命令流消费**（`ScreenCommand.enter/exit` 携带枚举）。

### 3.3 嵌套 → 嵌套栈

App 支持嵌套导航器（stack-in-stack，如 tab 里的每个 tab 各有一个栈）：
```ts
// RouteNode.children → tabStacks 聚合产物（codegen/app.ts）
{
  home: ['home', 'home-profile'],
  user: ['user', 'user-settings'],
}
```
`children` 在 App 端**有意义**（不同于小程序平铺），由 `tabStacks()` 编译为嵌套栈结构
（★实测边界：虚拟栈下"嵌套栈"是**逻辑分组**——各 tab 的栈深/历史独立，但共享同一棵树的可见性机制，
不产生额外的原生容器）。

## 4. codegen 实现 `app.ts`（★已实现）

```ts
// packages/router/src/codegen/app.ts（实际产物形态）
export function generateAppScreens(nodes: RouteNode[]): string
// 产物 navigation.generated.ts：
//   export const screens = { home: { name, path, component: () => import(...), transition, children, isTab } }
//   export const tabStacks = { home: ['home', 'homeProfile'], ... }
```

App 入口用法（★实际形态）：
```ts
// main.app.ts
import { createAppStack } from '@proteus-vue/router'
import { screens } from '../.proteus/navigation.generated'

const stack = createAppStack({ screens, policy: { nodeBudget: 3000 } }) // 预算可选
stack.push('home')
stack.push('user', { id: 1 }, { transition: 'slideUp' })
// 执行器（宿主侧）：每帧 drainCommands() → 建/销毁子树 + Morpheus 转场
```

★与初稿的差别：`createAppRouter()` 更名为 **`createAppStack()`**（它是**栈核心**，不是"另一个
三端 Router 实例"——三端 Router API 由 `createRouter`（index.ts）统一，App 端执行器把它的
导航调用转发到 `createAppStack`）。这样避免出现"两套 Router API"。

## 5. 执行器（宿主侧）约定（★替代原 NativeBridge）

```ts
interface ScreenExecutor {
  mount(cmd: { screenId, name, path, params, rebuild }): Promise<void>  // 建屏子树；完成后 stack.markRebuilt(screenId)
  enter(cmd: { screenId, transition? }): void   // display:flex + Morpheus 转场（appTransition(transition)）
  exit(cmd: { screenId, transition? }): void    // Morpheus 退场；播放完置 display:none（树保留）
  unmount(cmd: { screenId, reason }): void      // 销毁子树（五原子销毁）
}
```

- 执行器**不写平台分支**：子树操作最终经 Host ABI（`proteus_load_tree` / ops 流），
  转场经内核动画（平台零参与路径）——换宿主只换执行器的树操作实现。
- 参数传递：`push('user', { id: 1 })` → 命令流 `mount.params` → 新屏读（栈帧即数据源，
  不依赖全局单例；响应式对齐 Pinia store 注入由 runtime 层提供）。

## 6. 与 Custom Renderer 的关系

- Router 只管**栈操作 + 屏注册**，不管组件渲染（Renderer 职责）
- 屏内的 Vue 组件由 Renderer 渲染为**当前树的一棵子树**；Router 只负责"哪棵子树在栈顶可见"
- ★**屏与树的关系**：挂载新屏 = 把该屏子树加到树上（`display` 由栈状态控制）；
  退场屏保留在树上（`display:none`）⇒ 返程零重建、状态保留。

## 7. 测试（★已实现，`tests/app-stack.test.ts` 32 条）

- ① **无层数上限**：100 层 push/pop 全成功；popToRoot 一条命令（对照小程序第 11 层失败）
- ② **内存有界**：超预算冻结最旧 hidden 屏 + keepWindow 保护栈顶 + 冻结永不触及可见屏 +
  返回冻结屏 = `mount(rebuild=true)` + `overBudget` 可观测
- ③ **退场屏树保留**：push 不产生 unmount；exit 携带新屏声明的转场
- ④ **栈语义**：push/pop/replace/popTo（找不到抛错）/popToRoot/reset(tab)/pop 保底不弹空
- ⑤ **声明式 navigate**：公共前缀 diff（含 params 匹配）+ 同栈不重放 + 未注册屏抛错且不部分执行 +
  与 `computeRoutePatch/applyRoutePatch` 结果一致（跨端同源模型）
- ⑥ **命令流**：mount/enter/exit/unmount 配对与顺序 + drain 清空 + params 传递 + 事件流可观测
- ⑦ **codegen**：字段提取/path 推导/budgetNodes/flatten/tabStacks/产物可执行（eval）且可直接喂栈
- 转场映射：三端枚举交叉核对在 `tests/animation-presets.test.ts`（含 `APP_TRANSITION_MAP` 穷尽性）

---

## LLM 执行提示（B5）★已更新

> 读 `00-overview.md` + `02-m2-route-tree.md` + 本文件 §0。栈核心（app-stack.ts）与 codegen（app.ts）
> **已实现**；**宿主执行器（编排层）亦已落地**（§0.5：`createScreenExecutor` + 方向语义 + 真机 ⑦ 组全绿）。
> ⇒ 后续工作只剩**端口的生产实现**（真机树操作接 Host ABI 的树接口 + 平台转场提交接内核动画/零参与路径）。
