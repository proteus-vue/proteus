# 02 · 焦点原语设计（Hestia）

> 目标：把 `navigateFocus`（已有）从 `@proteus-vue/fluid` 的**组件配套**抬成**渲染无关原语**，
> 并在其上加三样它现在没有的东西：**焦点状态机 / 滚动跟随 / 视觉出口**。

---

## 1. 分层与归属

```
@proteus-vue/fluid/focus-nav      ← 现有：纯几何算法（保留，转导出）
        │
@proteus-vue/focus（Hestia）      ← 新增：状态机 + 滚动跟随 + 三端无关的编排
        │
   ┌────┴────┐
组件层 p-focus-scope           渲染器 focus ring
（DOM/Vue 接线）               （App 按 focusId 描边）
```

**为什么不直接改 `fluid`**：`fluid` 是「形态画像 + 布局原语」包，焦点状态机带**可变状态**
（当前焦点、上次焦点、滚动目标），与 `fluid` 目前"纯函数"的定位冲突。⇒ 新包，`fluid` 只做转导出（零行为变化）。

---

## 2. 核心 API

### 2.1 纯函数（无状态，可 CI 跨端比对）

```ts
export type FocusDirection = 'up' | 'down' | 'left' | 'right'
export interface FocusRect { id: string; x: number; y: number; width: number; height: number }

/** 单步导航（= 现有 navigateFocus，签名不变） */
export function nextFocus(
  current: FocusRect | null,
  candidates: FocusRect[],
  direction: FocusDirection,
  opts?: { preferredFirst?: string; crossWeight?: number },
): string | null

/** 滚动跟随：焦点要在容器内可见 ⇒ 需要的目标偏移（纯函数，新增） */
export function ensureVisible(
  focus: FocusRect,
  container: { x: number; y: number; width: number; height: number; scrollY: number },
  opts?: { margin?: number },      // 默认 24（TV overscan 内边距）
): number                          // 返回新的 scrollY（已钳制，不自增）
```

**`ensureVisible` 契约（三条，缺一不可）**

| # | 规则 | 理由 |
|---|---|---|
| E1 | **最小位移**：焦点已完全可见 ⇒ 返回当前 `scrollY`（不居中、不跳动） | 否则每按一次都"跳一下"，TV 体感极差 |
| E2 | **就近对齐**：焦点在下方 ⇒ 滚到「焦点底 + margin」贴容器底；在上方 ⇒ 滚到「焦点顶 − margin」贴容器顶 | 与 Web `scrollIntoView({block:'nearest'})` 同语义 |
| E3 | **钳制**：结果夹到 `[0, max(0, contentH - containerH)]` | 复用内核 `setScroll` 已有的范围钳制（与 `applyContentOffset` 同源） |

### 2.2 状态机（有状态，宿主/组件持有）

```ts
export interface FocusSnapshot {
  currentId: string | null
  lastId: string | null        // remember：容器重进时恢复
  scopeId: string              // 焦点作用域（一个 scope 一套状态）
}

export function createFocusEngine(opts: {
  getRects: () => FocusRect[]        // ★ 几何来源由调用方注入（Web=DOM 测量，App=内核 element.rect）
  onFocusChange: (id: string | null, prev: string | null) => void
  getScroll?: () => number
  setScroll?: (y: number) => void
  remember?: boolean                 // 默认 true
}): {
  handleKey(key: RemoteKey): { handled: boolean; nextId: string | null }
  focus(id: string): boolean         // 程序化设焦点（对齐语义：不在候选里 ⇒ false）
  blur(): void
  snapshot(): FocusSnapshot
}
```

**关键设计点**

| # | 决定 | 理由 |
|---|---|---|
| D1 | **几何由 `getRects` 注入**，引擎不碰 DOM/内核 | 这是跨端一致的**唯一**前提：Web 量 DOM、App 读 `element.rect`，喂进同一个纯函数 |
| D2 | `handleKey` 返回 `handled` | 让业务可以"吃掉"某个键（如 `back` 弹层）而不触发焦点移动 |
| D3 | **不做自动首焦点**（`currentId=null` 时按 `preferredFirst` 或几何最左上） | 与 A2 算法一致；TV003 要求"有且仅有一个初始焦点"由校验器保证 |
| D4 | `remember` 只记 `lastId`，**不自动恢复** | 恢复时机属页面语义（返回栈 vs 新进入），由业务显式调 `focus(lastId)` |

### 2.3 `RemoteKey` → `FocusDirection` 映射

```ts
const DIR: Partial<Record<RemoteKey, FocusDirection>> =
  { up:'up', down:'down', left:'left', right:'right' }
// confirm / back / menu 不产生方向；由业务或默认行为处理
```

---

## 3. 三端映射

| 端 | `getRects` 实现 | 焦点视觉 | 滚动 |
|---|---|---|---|
| **Web** | DOM 测量（`getBoundingClientRect`，与 `p-formfactor:396` 现有做法一致） | CSS `:focus-visible`（**现状不动**） | `scrollIntoView` 或容器 `scrollTop` |
| **Android TV** | `element.rect`（`HostCapabilities:267`）批量取 | **渲染器描边**（新增，见 §4） | 内核 `setScroll` + `ensureVisible` |
| **tvOS** | 同契约（`element-rect.swift`） | `CALayer` 描边 | 同上 |
| **鸿蒙** | `measureElementRect`（`Superapp.ets:819`） | 自绘描边 | 同上 |

> **一致性判据**：同一 SFC + 同一组 rects，四端 `focusSequence` **指纹完全相同**（P2）。
> Web 端是"金标准"，因为 `:focus-visible` + 原生焦点顺序可作对照——**但顺序必须由我们的算法决定**，
> 不能被浏览器默认 Tab 序污染（B3 需要 `tabindex=-1` + 全程 `preventDefault`）。

---

## 4. 焦点视觉（App 无 `:focus` 的正解）

App 的能力表里 `selector-pseudo-state` 是 `absent`（`features[40]`），⇒ **不能靠 CSS**。

**方案：渲染器按 `focusId` 画环**（三选一，B3 先做①）

| 方案 | 做法 | 代价 | 结论 |
|---|---|---|---|
| ① **绘制期描边** | 渲染器在出指令时，对 `id == focusId` 的节点追加一条描边指令 | 零额外节点；焦点变化只需重发该节点 | ✅ **推荐**（与"坐标舍入只在核内"同源：画在已有几何上） |
| ② 内核 focus overlay 节点 | 内核加一个虚拟节点跟随焦点 | 要动内核几何；"焦点不是几何"语义污染 | ❌ |
| ③ 独立 CALayer/Canvas 层 | 宿主叠一层画 | 两套坐标要同步（`#832` 教训） | ❌ 风险最高 |

**参数来源**：`formfactor.tv.visual.focus = 'ring'` + `baseFont 18`（描边宽度按 baseFont 比例），
以及 `safe{96,54}` 决定焦点环不被 overscan 裁掉。

---

## 5. 与 `p-focus-scope`（G-25 `04-tv.md` 已声明）的关系

`04-tv.md` 声明了组件形态 `<p-focus-scope mode="grid|linear|manual">`。本方案**不改它的 API**，
只把它的内核换成 Hestia：

| `p-focus-scope` 属性 | 映射到 Hestia |
|---|---|
| `mode="grid"` | `DIR` 全向 + `nextFocus`（默认算法） |
| `mode="linear"` | 只允许 `up/down` 或 `left/right`（按 `topology` 推导） |
| `mode="manual"` | 不调 `nextFocus`，改用 `:next-focus-*` 显式映射（业务给表） |
| `:wrap="true"` | 边缘无候选时用 `clampOrWrap` 取对端 |
| `:remember="true"` | `FocusSnapshot.lastId` |

> ⇒ **G-25 的声明保持不变，本方案提供它的实现**。这符合"同一语义一处实现"。

---

## 6. 规则落地（TV001–TV004）

| 规则 | 规约定义（`proteus-architecture.md:370`） | 本方案实现位置 |
|---|---|---|
| **TV001** error | 可获焦组件必须声明 `focus-mode` | 编译器校验：`focusable=true` 且无 `focus-mode` ⇒ 报错（B2） |
| TV002 warning | TV 端文字不得小于 24pt | 编译器校验 `fontSize`（TV 画像下）；**降级为 warning**，因为 10ft 度量已由 `baseFont 18` + `p-fluid` 承担 |
| **TV003** error | TV 页面必须有且仅有一个初始焦点 | 运行时校验：挂载后 `focusId` 必须非空且唯一（B2） |
| TV004 warning | 避免焦点陷阱 | 静态检测：`p-focus-scope` 内所有方向键均可离开（B2，先做提示） |

**诚实边界**：TV002 与 TV004 本轮只做到 warning/提示，**不做自动修复**。
