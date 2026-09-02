# Proteus 全终端柔性架构（G-25）主文档

> 状态：Draft v2 · 依赖：G-09（Safe Area）/ G-22（Fluid Layout）/ G-22.5（p-adaptive）/ G-24（语义原语）
> 目标：**把柔性框架从「手机+PC」扩展到车机 / TV / 手表，实现一套语义覆盖六类终端**

---

## 1. 问题：设备类型爆炸，但布局本质是同一个

Proteus 目前已覆盖手机、平板、PC（Web / Skyline / iOS / Android / 鸿蒙）。
但客户端开发的真实版图远大于此：

| 终端 | 核心约束 | 主流框架支持度 |
|------|----------|----------------|
| 手机 | 触摸、竖屏 | ✅ 都有 |
| 平板 | 分屏、多窗口 | ⚠️ 部分 |
| PC | 鼠标键盘、窗口拖拽 | ⚠️ 部分 |
| **车机** | **驾驶安全、远距、横屏、语音** | ❌ 几乎无 |
| **TV** | **遥控器 5 向导航、焦点引擎、远距大字** | ❌ 无 |
| **手表** | **小屏单列、表冠、并发症** | ❌ 无 |

uni-app / Flutter / RN 的共同做法：
- 每个平台写一套 `if (isTV)` 条件分支
- 没有统一的"设备能力语义层"
- **车机/TV/手表基本靠原生开发，跨端框架进不去**

Proteus 的机会：**柔性框架的本质是"容器无关"，容器可以是任意尺寸的屏幕**——
只要把"设备类型"降维成"容器特征"，车机/TV/手表自然被打通。

---

## 2. 核心洞察：三维断点模型（W × H × F）

G-22 的 `p-fluid` / `p-grid` 只用**宽度（W）**做断点。
车机/TV/手表要求我们引入三个独立维度：

```
┌─────────────────────────────────────────────────┐
│                  容器特征空间                     │
│                                                   │
│   宽度 (W)  ×  高度 (H)  ×  形态 (F)             │
│     ↓              ↓              ↓              │
│   sm/md/lg/xl    sm/md/lg/xl   touch/cursor/    │
│                  (横竖屏)       remote/dial/voice│
│                                                   │
└─────────────────────────────────────────────────┘
```

| 维度 | 含义 | 示例 |
|------|------|------|
| **W（宽度）** | 容器宽度档位 | xs(0-320) / sm(320-600) / md(600-900) / lg(900-1280) / xl(1280+) |
| **H（高度）** | 容器高度档位 | 处理横竖屏、车机矮屏 |
| **F（形态/输入）** | 主要交互范式 | touch / cursor / **remote** / **dial** / voice |

**G-22.5 的 `p-adaptive` 从二维升级为三维**：

```vue
<p-modal
  p-adaptive="
    sheet(0,600,touch) |
    dialog(600,840,touch) |
    popover(840,∞,cursor) |
    confirmation(∞,∞,driving)
  "
/>
```

含义：宽度 0-600 且触摸 → Sheet；840+ 且鼠标 → Popover；任意宽度且驾驶模式 → 仅确认弹窗。

---

## 3. 五端支持矩阵

| 设备 | W 档位 | H 档位 | F（输入形态） | 关键能力 |
|------|--------|--------|---------------|----------|
| 手机 | sm/md | md/lg | touch | 基础 |
| 平板 | md/lg | md/lg | touch | 分屏、多窗口 |
| **车机** | lg/xl | sm/md | **touch + cursor + voice** | **驾驶模式、分组懒聚焦** |
| **TV** | xl | md/lg | **remote** | **焦点引擎、5 向导航、远距大字** |
| **手表** | xs | xs | **dial + touch** | **单列一屏、表冠、并发症** |
| PC | md→xl | — | cursor | 窗口拖拽 |

> 注意：**车机的"大屏"不等于 PC**——它矮（H=sm）、远距观看、有驾驶安全约束。
> 手表则是最极端的 xs×xs×dial。**宽度断点不足以区分它们，必须靠 F 维度。**

---

## 4. 车机（Vehicle）

### 4.1 核心约束

- **驾驶安全**：行驶中禁止复杂交互（GDPR/车规强制）
- **远距观看**：最小点击目标 88pt（Apple CarPlay 规范）
- **横屏矮屏**：H 通常 < 480pt
- **多输入**：触摸 + 鼠标 + 语音（"嘿 Siri"/"小艺导航"）

### 4.2 语义原语

```vue
<p-modal
  v-model:visible="show"
  :driving-safe="true"
  p-adaptive="confirmation(∞,∞,driving) | sheet(0,600,touch)"
>
  <p-button @click="confirm">确认</p-button>
</p-modal>
```

**Compiler 强制约束（铁律 G-25.1）**：
- `driving-safe=false` 的组件 → 车速 > 0 时**自动禁用 + 提示"请在停车后操作"**
- 映射 Apple CarPlay `CPTemplate` / Android Auto `CarAppService`

### 4.3 分组懒聚焦（车机专属）

车机屏幕大但注意力稀缺，内容应**分组建模**，一次只展示一组：

```vue
<p-vehicle-group :lazy="true">
  <p-vehicle-panel title="导航">
    <p-button>回家</p-button>
  </p-vehicle-panel>
  <p-vehicle-panel title="音乐">
    <p-button>下一首</p-button>
  </p-vehicle-panel>
</p-vehicle-group>
```

---

## 5. TV（智慧屏 / 机顶盒）

### 5.1 核心约束

- **遥控器 5 向导航**：上下左右 + 确认，没有触摸
- **焦点引擎**：必须知道"当前焦点在哪、按右移到哪"
- **远距大字**：文字 ≥ 24pt，按钮间距大

**这是竞品完全缺失的能力**——Flutter/RN/uni-app 的 TV 适配停留在
"放大字体 + 监听遥控器 keyCode"。Proteus 把它做成语义原语。

### 5.2 焦点引擎原语

```vue
<p-grid
  :focusable="true"
  focus-mode="grid"        ← 上下左右 + 记忆上次焦点
  :focus-wrap="true"       ← 边缘环绕
>
  <p-card v-for="item in items" />
</p-grid>
```

| 端 | TV 焦点原生能力 |
|----|---------------|
| Android TV | `RecyclerView` + `FocusFinder` + Leanback |
| Apple TV | `UIFocusSystem` + `UIFocusEnvironment` + 视差特效 |
| 鸿蒙智慧屏 | `TVComponent` + 焦点框 |

### 5.3 远距大字档位

TV 自动进入 `xl` 断点 → `p-fluid` 取上限值、`p-grid` 列数收敛，确保沙发距离可读。

---

## 6. 手表（Wearable）

### 6.1 核心约束

- **极小屏**：通常 < 200pt 宽
- **单列一屏**：禁止横滑多页（Apple Watch 规范）
- **表冠（Digital Crown）**：旋转输入
- **并发症（Complication）**：表盘小组件

### 6.2 语义原语

```vue
<p-page p-watch="complication | corner | full">
  <p-stack direction="column" :gap="2">
    <p-complication :data="heartRate" />
  </p-stack>
</p-page>
```

| 端 | 手表原生能力 |
|----|-----------|
| Apple Watch | `WKInterfaceController` + Digital Crown + 并发症 |
| Wear OS | `ComplicationData` + Rotary input + Tiles |
| 鸿蒙穿戴 | 表盘服务 + 旋转表冠 |

### 6.3 单列约束（铁律 G-25.3）

手表页面**必须单列一屏**，`p-grid` 在 `xs` 档位强制 1 列。

---

## 7. 统一导航模式（跨设备不变）

```
p-nav 家族（G-24 扩展）：
  p-nav-stack        → 手机 Push/Pop
  p-nav-master-detail → 平板 SplitView
  p-nav-tab          → 手机/车机 TabBar
  p-nav-rail         → 折叠态侧栏（TV/车机竖屏）
  p-nav-drawer       → 平板/车机 Drawer
  p-nav-cursor       → ★ TV/PC 焦点导航（G-25 新增）
  p-nav-voice        → ★ 车机语音导航（G-25 新增）
```

**同一套语义，不同端映射到不同原生导航容器**——这就是原则 #10。

---

## 8. 与竞品的本质差距

| 框架 | 车机 | TV | 手表 |
|------|------|-----|------|
| uni-app | ❌ | ❌ | ❌ |
| Flutter | ⚠️ 手动（go_router + 条件分支） | ⚠️ 需 leanback 插件 | ⚠️ watchOS 支持差 |
| RN | ❌ | ⚠️ 监听 keyCode | ❌ |
| **Proteus** | **✅ 语义原语 + CarPlay 映射** | **✅ 焦点引擎 + UIFocusSystem** | **✅ 表冠 + 并发症** |

竞品缺的不是某个 API，而是**"显式设备能力语义 + 可编程 IR + 系统原生映射"这套方法论**。
Proteus 从 G-01 到 G-25 一路搭建，**车机/TV/手表是这套方法论的自然延伸**。

---

## 9. 对外定位（建议写入 positioning.md）

> Proteus 不是"移动端跨端框架"，而是**操作系统能力语义层**：
> 一套 `p-*` 语义覆盖手机 / 平板 / PC / **车机** / **TV** / **手表**六类终端，
> 布局、导航、交互形态随容器三维特征（W×H×F）自动适配——
> 车机的驾驶安全约束、TV 的焦点引擎、手表的表冠与并发症，
> 全部映射为各端系统原生能力。**竞品还在"支持某个平台"，Proteus 已"统一所有平台"。**

---

## 10. 严格规则（新增）

| 规则 | 级别 | 说明 |
|------|------|------|
| **VEH001** | error | 车机交互须声明 `driving-safe`（铁律 G-25.1） |
| **TV001** | error | 可获焦组件必须声明 `focus-mode`（铁律 G-25.2） |
| **WATCH001** | error | 手表页面必须单列一屏（铁律 G-25.3） |
| TV002 | warning | TV 端文字不得小于 24pt |
| VEH002 | error | 车速 > 0 时禁止非安全交互 |

---

## 11. 下一步

详见 `08-integration-batches.md`：B1（三维断点模型 + 焦点引擎纯逻辑，零依赖可单测）→
B2（车机 driving-safe）→ B3（TV 焦点映射）→ B4（手表表冠）。

配套：`architecture-update.md`（G-25 + 原则#10.9 + 铁律）需合并进规约。
