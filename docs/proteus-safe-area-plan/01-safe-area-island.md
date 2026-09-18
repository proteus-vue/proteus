# 安全区与灵动岛（Dynamic Island）解决方案

> 所属：Proteus 横切层 / App Renderer + Glass + CSS Compat  
> 执行位：G-23（Safe Area 主体，依赖 G-22 App Renderer）+ Glass L3（随 G-22）+ G-21（CSS 兼容）  
> 优先级：P0（iOS 端是 App 首屏必踩的坑，不做则导航栏/玻璃直接错位）  
> 设计原则：#10「统一语义 + 原生实现」—— `p-safe` 语义收敛，五端各自用系统 API 实现

---

## 1. 问题定义：为什么这是独立一环

Proteus 的 App 端用 JSI 直调原生 View，意味着 **Vue 层拿不到浏览器那套 `env(safe-area-inset-*)` 自动生效能力**——iOS 的 safe area 是 `UIViewController.additionalSafeAreaInsets` + `UIView.safeAreaInsets` 这套机制，Android 是 `WindowInsets`，鸿蒙是 `getWindowRect()` + 挖孔避让，Web 才是 CSS `env()`。

**五种端的安全区来源完全不同：**

| 端 | 安全区来源 | 获取方式 |
|---|---|---|
| iOS | 刘海 / 灵动岛 / Home Indicator / 圆角 | `safeAreaInsets`（系统实时更新） |
| Android | 挖孔、状态栏、导航手势条 | `WindowInsets` / `DisplayCutout` |
| 鸿蒙 | 挖孔、状态栏、三键导航 | `WindowInsets` / `Rect` |
| Web | 无硬件安全区，仅视口 | CSS `env()` + `viewport-fit` |
| Skyline（小程序） | 胶囊按钮、状态栏 | 系统信息 API + CSS `env()`（部分） |

**灵动岛（Dynamic Island / 灵动半岛）是 iOS 16.1+ 刘海升级形态**：它是一个**可变宽度的实时区域**，系统会随状态变化（计时器、通话、AirPods、导航）动态伸缩，甚至**从胶囊变药丸再展开成大块**。这带来两个硬问题：

1. **布局避让**：导航栏内容不能叠到岛下，岛宽度实时变化（收起 ~ 59pt，展开可达 375pt 满宽）
2. **玻璃联动**：`<pg-glass>` 导航栏若盖住灵动岛区域，需与系统背景模糊融合，否则边缘锯齿/色差

> **结论：安全区不是"加个 padding"那么简单，是「实时变化的系统区域 + 玻璃视觉融合」的组合问题。** 这一环不做，Glass L3 导航栏方案就不成立。

---

## 2. 设计原则：统一语义 `p-safe`，原生实现

遵循原则 #10，框架**定义安全区语义**，各端**用系统 API 实现**：

```
<p-safe> 语义层（Proteus 统一）
    ├── p-safe-top     → 顶部安全区（状态栏 + 灵动岛 + 刘海）
    ├── p-safe-bottom  → 底部安全区（Home Indicator / 导航手势条）
    ├── p-safe-left    ┐
    ├── p-safe-right   ┘  → 横屏左右（刘海侧 / 挖孔侧）
    ├── p-safe-island  → 灵动岛专属避让（iOS only，其他端 = top）
    └── p-safe-island-glass → 玻璃与灵动岛融合语义（Glass L3 联动）
        ↓ Compiler 按 target 编译
各端原生实现：
    iOS     → safeAreaInsets + safeAreaLayoutGuide + UIKit 玻璃
    Android → WindowInsets + Window.setDecorFitsSystemWindows
    鸿蒙    → WindowInsets + 避让计算
    Web     → CSS env() + viewport-fit=cover
    Skyline → systemInfo + env(safe-area-inset-*)
```

**核心：开发者只写 `p-safe-*`，不写 `safeAreaInsets.top` 这种平台代码。**

---

## 3. 统一语义 API 设计

### 3.1 组件语义

```vue
<!-- 导航栏：自动避让灵动岛 + 状态栏，且与 Glass L3 融合 -->
<p-safe area="top" mode="extend">
  <pg-glass preset="navigationBar">
    <p-text class="title">{{ title }}</p-text>
  </pg-glass>
</p-safe>

<!-- 底部操作栏：避让 Home Indicator -->
<p-safe area="bottom">
  <p-view class="action-bar">
    <p-button>确认</p-button>
  </p-view>
</p-safe>

<!-- 横屏：左右避让刘海/挖孔 -->
<p-safe area="horizontal">
  <p-view class="landscape-content">...</p-view>
</p-safe>

<!-- 灵动岛玻璃融合（iOS 专属，其他端降级为普通 top） -->
<p-safe-island mode="glass-blend">
  <pg-glass preset="navigationBar" />
</p-safe-island>
```

### 3.2 样式语义（CSS 子集扩展）

```css
/* 新增 p- 语义单位（编译期映射到各端） */
.nav-bar {
  padding-top: p-safe-top;      /* → iOS safeAreaInsets.top
                                   → Android WindowInsets.top
                                   → Web env(safe-area-inset-top) */
  padding-bottom: p-safe-bottom;
  padding-left: p-safe-left;
  padding-right: p-safe-right;
}

.island-zone {
  height: p-safe-island;        /* iOS: 灵动岛高度(因状态而异)
                                   other: 0 或安全区顶部 */
}
```

### 3.3 JS 运行时 API（响应式）

```typescript
import { useSafeArea } from '@proteus-vue/platform'

// 返回响应式对象，系统区域变化时自动更新（iOS 转场/展开灵动岛时）
const safe = useSafeArea()
// safe.value = { top: 59, bottom: 34, left: 0, right: 0, island: 37 }
// island: 灵动岛专属高度，无灵动岛的设备 = 0

// 监听变化（iOS 灵动岛展开/收起触发）
safe.onChange((next) => { ... })
```

---

## 4. 五端原生实现映射

### 4.1 iOS（最关键，灵动岛主场）

**安全区获取：**
- `UIViewController.view.safeAreaInsets` —— 系统实时维护，含刘海/灵动岛/Home Indicator
- `safeAreaLayoutGuide` —— AutoLayout 锚点，推荐用约束而非写死数值
- `additionalSafeAreaInsets` —— 手动扩展（如自定义浮层）

**灵动岛特殊处理：**
- 灵动岛**包含在 `safeAreaInsets.top` 内**（iOS 16.1+），所以 `p-safe-top` 已天然避让
- 但**灵动岛高度可变**：收起 59pt（含状态栏 44pt + 岛 15pt 余量），展开时系统会**自动调整 safeAreaInsets**，无需手动监听宽度
- **玻璃融合**：`p-safe-island-glass` → 将 `<pg-glass>` 的 `UIGlassEffect` 的 `containerRelativeAnchor` 设为包含灵动岛的 rect，让系统把岛区域纳入模糊，实现视觉融合

**JSI 映射（App Renderer nodeOps）：**
```objc
// nodeOps.applySafeArea()
UIView *view = node.nativeView;
// 用 safeAreaLayoutGuide 约束，而非硬编码
[view.topAnchor constraintEqualToAnchor:view.superview.safeAreaLayoutGuide.topAnchor]
// 灵动岛玻璃融合
if (preset == navigationBar) {
  effect.containerRelativeAnchor = [self _anchorIncludingIsland];
}
```

### 4.2 Android

- `WindowInsets.getInsets(type)` —— `systemBars()` / `displayCutout()` / `navigationBars()`
- **挖孔避让**：`WindowManager.LayoutParams.layoutInDisplayCutoutMode`
  - `LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT`：全屏时内容避让挖孔
  - 配合 `setDecorFitsSystemWindows(false)` 让内容可延伸到状态栏下（Glass 场景）
- `p-safe-island` → Android **无灵动岛**，`island = 0`，`p-safe-top` 仅含状态栏
- **横屏挖孔侧**：`displayCutout.boundingRects` 返回挖孔 rect，映射到 `p-safe-left/right`

### 4.3 鸿蒙（ArkUI）

- `window.getWindowRect()` + `getAvoidArea()` 获取避让区域
- `p-safe-top` → `AvoidAreaType.TYPE_SYSTEM` / `TYPE_CUTOUT`
- **灵动岛对应物**：鸿蒙无动态岛，但有**挖孔屏避让**，`island = 0`
- 布局用 `Row/Column` + `padding` 实现，ArkUI 无 AutoLayout 约束概念，用百分比 + padding

### 4.4 Web

- `env(safe-area-inset-top)` + `<meta viewport content="viewport-fit=cover">`
- `p-safe-island` → Web **无硬件岛**，编译为 `env(safe-area-inset-top)`（值通常为 0，iPhone Safari 有值）
- **无需 JS 运行时**，纯 CSS 即可；`useSafeArea()` 在 Web 端返回固定值或 `ResizeObserver` 监听

### 4.5 Skyline（微信小程序）

- `wx.getWindowInfo()` / `getSystemInfoSync()` → `statusBarHeight`、`safeArea`
- CSS `env(safe-area-inset-*)` **Skyline 部分支持**（需基础库版本）
- 胶囊按钮避让：`menuButtonBoundingClientRect`
- `p-safe-island` → 编译为 `safeArea.top`（小程序无灵动岛概念）

---

## 5. 灵动岛（Dynamic Island）专项

### 5.1 灵动岛的本质

灵动岛是 **iOS 系统独占的动态区域**，Proteus **不提供"自定义灵动岛内容"的能力**（那是 `ActivityKit` 的 `LiveActivity`，需原生项目配置 + 证书，超出跨端框架职责）。

**Proteus 只解决两件事：**
1. **避让**：内容不叠到岛下（`p-safe-top` 已覆盖）
2. **视觉融合**：导航栏玻璃与岛区域平滑过渡（`p-safe-island-glass`）

### 5.2 灵动岛高度/宽度变化的处理

| 状态 | 岛形态 | safeAreaInsets.top | 应对 |
|---|---|---|---|
| 收起 | 胶囊 ~ 59pt 宽 | 59pt | 静态布局，按 top 约束即可 |
| 展开（计时/导航） | 药丸/大块，宽可达 375pt | **系统自动增大** | 用 `safeAreaLayoutGuide` 约束，自动跟随 |
| 展开（来电/通话） | 满宽横条 | 自动 | 同上，无需手动监听 |

**关键：iOS 系统会随灵动岛形态变化自动更新 `safeAreaInsets` 并发出 `viewSafeAreaInsetsDidChange()`**。所以方案是——
> **永远用 `safeAreaLayoutGuide` 约束，永不硬编码 59/44 等数值。**

### 5.3 玻璃与灵动岛融合（Glass L3 联动）

这是安全区与 Glass plan 的交叉点，需联动设计：

```vue
<!-- 导航栏：玻璃盖住状态栏+灵动岛区域，与系统模糊融合 -->
<p-safe-island mode="glass-blend">
  <pg-glass preset="navigationBar" :island-follow="true">
    <p-text class="title">{{ title }}</p-text>
  </pg-glass>
</p-safe-island>
```

编译到 iOS：
- `UIGlassEffect` 的 `containerRelativeAnchor` 设为包含灵动岛的 rect
- `contentView` 用 `safeAreaLayoutGuide` 定位，玻璃层延伸到岛区域
- 系统自动处理岛与玻璃的边缘融合（iOS 26 玻璃材质会随岛形态动态调整）

**降级**：无 `UIGlassEffect` 的平台（Android < 12、鸿蒙、Web、Skyline），`glass-blend` 降级为**普通 `p-safe-top` 避让 + 普通半透明背景**，不报错。

### 5.4 横屏灵动岛（易被忽略）

iOS 横屏时灵动岛跑到**左侧短边**，此时：
- `safeAreaInsets.left` 变大（含岛），`top` 变小
- `p-safe-island` 在横屏自动映射为 `safeAreaInsets.left`（iOS）
- **其他端横屏无岛**，`island = 0`

---

## 6. 响应式更新机制（跨端统一）

**问题：灵动岛展开/收起、状态栏高度变化（如通话条）时，布局需实时调整。**

### 6.1 各端监听源

| 端 | 监听方式 | 触发时机 |
|---|---|---|
| iOS | `viewSafeAreaInsetsDidChange` | 灵动岛展开/收起、转场 |
| Android | `WindowInsetsListener` | 软键盘、导航栏显隐 |
| 鸿蒙 | `window.on('avoidAreaChange')` | 挖孔避让变化 |
| Web | `ResizeObserver` + `env()` | 视口变化（罕见） |
| Skyline | `onResize` + `safeArea` | 屏幕旋转 |

### 6.2 统一为 Vue 响应式

```typescript
// Runtime 内部：各端实现 SafeAreaProvider
interface SafeAreaProvider {
  getInsets(): SafeAreaInsets
  onChange(cb: (next: SafeAreaInsets) => void): Disposer
}

// useSafeArea() 返回 reactive，变更触发 patch
const safe = reactive(provider.getInsets())
provider.onChange((next) => { Object.assign(safe, next) })
```

**开发者用 `safe.top` 绑定样式，系统区域一变，Vue 自动 patch**——与灵动岛展开/收起同步，无闪烁。

---

## 7. 编译期处理（遵循 CSS Compat 原则）

归入 CSS Compat plan 的「🔶 语义组件封装」+「⚠️ 编译期重写」：

| 写法 | 级别 | 编译产物 |
|---|---|---|
| `padding-top: p-safe-top` | 🔶 语义 | iOS→`safeAreaLayoutGuide.top`；Web→`env()`；其他→对应 API |
| `<p-safe area="top">` | 🔶 语义 | 各端原生约束/布局 |
| `<p-safe-island>` | 🔶 语义 | iOS→灵动岛避让；其他→`p-safe-top` |
| `p-safe-island-glass` | 🔶 语义 | iOS→`UIGlassEffect` 融合；其他→降级 |
| `env(safe-area-inset-top)` | ⚠️ 重写 | Web 保留；其他端→映射到 `p-safe-top` |
| `viewport-fit=cover` | ⚠️ 重写 | Web 注入 meta；App 端忽略（原生默认全屏） |

**`--strict-css` 规则新增：**
- `CSS013`：`position: fixed` 盖住 top 区域时未包 `<p-safe>` → 警告
- `CSS014`：硬编码 `padding-top: 44px/59px/88px` → 错误，要求改 `p-safe-top`
- `CSS015`：直接读 `safeAreaInsets`（JSI 旁路）→ 警告，要求走 `useSafeArea()`

---

## 8. 反例与禁止项

❌ **硬编码安全区数值**（44/59/88/34pt）→ 灵动岛展开后错位  
❌ **用 `window.innerHeight` 算安全区** → iOS 全屏时不含状态栏  
❌ **`position: fixed; top: 0` 导航栏不包 `<p-safe>`** → 内容叠到岛下  
❌ **自己实现灵动岛内容**（LiveActivity）→ 超出跨端框架职责，应走原生插件  
❌ **玻璃层不延伸到灵动岛区域** → 导航栏与岛之间出现色差/锯齿  

✅ **唯一正确姿势**：`<p-safe area="top">` + `safeAreaLayoutGuide` 约束 + Glass 融合

---

## 9. 与 Glass Plan 的联动（交叉点清单）

| Glass 场景 | 安全区联动 |
|---|---|
| `navigationBar` preset | 必包 `<p-safe-island mode="glass-blend">` |
| `tabBar` preset | 用 `p-safe-bottom` 避让 Home Indicator |
| `sheet` / `modal` | 顶部用 `p-safe-top`，避开状态栏 |
| `floating` preset | 横屏避让灵动岛侧（`p-safe-left/right`） |
| `fullscreen` | 明确 `ignore-safe-area`，但仍需玻璃融合岛区域 |

---

## 10. 验收标准

- [ ] iPhone 16 Pro（灵动岛）收起/展开/满宽三态，导航栏内容不叠岛、玻璃融合无锯齿
- [ ] 横屏时灵动岛在左侧，`p-safe-island` 正确映射为 `left`
- [ ] Android 挖孔屏（华为/小米），`p-safe-top` 避让挖孔
- [ ] 鸿蒙挖孔屏，`getAvoidArea` 映射正确
- [ ] Web `env()` 正常工作，`viewport-fit=cover` 注入
- [ ] Skyline 胶囊按钮避让，`safeArea` API 可用
- [ ] 灵动岛展开/收起时 `useSafeArea()` 响应式更新，无闪烁
- [ ] 无 `UIGlassEffect` 平台降级为普通避让，不崩溃
- [ ] `--strict-css` 能捕获硬编码数值（CSS014）

---

## 11. 分批策略

| 批次 | 内容 | 依赖 | 里程碑 |
|---|---|---|---|
| **M1** | 语义定义 + iOS `safeAreaLayoutGuide` 映射 + `useSafeArea()` | App Renderer M1 | 真机能弹出正确避让的导航栏 |
| **M2** | Android `WindowInsets` + 横屏/挖孔 | M1 | 双端真机验证 |
| **M3** | 鸿蒙 + Skyline + Web 映射 | M1 | 五端齐 |
| **M4** | 灵动岛玻璃融合（`p-safe-island-glass`）+ Glass L3 联动 | Glass M3 | 导航栏玻璃与岛融合 |
| **M5** | `--strict-css` 规则 CSS013-015 + 响应式更新 | Compiler B1 | CI 门禁 |

**建议优先级：M1 可与 App Renderer M1（JSI 骨架）同期启动**——因为安全区是导航栏的前置依赖，越早验证越好。

---

## 12. 参考实现对标

| 框架 | 安全区方案 | 灵动岛 |
|---|---|---|
| uni-app | `uni.getSystemInfo().safeArea` + CSS `env()` | 需手动处理，无专属 API |
| uni-app x (uvue) | `uni.getWindowInfo()` | 无灵动岛专属，靠 safeArea |
| React Native | `SafeAreaContext`（`useSafeAreaInsets`） | 用 `safeAreaInsets` 手动避让 |
| Flutter | `SafeArea` widget + `MediaQuery.padding` | 手动避让，无融合 |
| NativeScript | `iosSafeArea` CSS 属性 + `insets` 事件 | 无灵动岛专属 |
| **Proteus** | **`p-safe` 语义 + `useSafeArea()` 响应式 + Glass 融合** | **`p-safe-island-glass` 与 Glass L3 联动** |

**差异化点：Proteus 是唯一把「安全区 + 灵动岛 + 玻璃材质融合」三者统一收敛到声明式语义的框架。**
