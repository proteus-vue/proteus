# Proteus 语义原语全景：打通全客户端开发（G-24）

> 配套：`02-primitive-families.md` / `03-desktop-primitives.md` /
> `04-system-integration.md` / `05-mapping-spec.md` /
> `06-integration-synergy.md` / `07-benchmark-batches.md`

## 1. 一句话定位

Proteus 不是"跨端 UI 框架"，而是 **"操作系统能力语义化层"**：
把 iOS / Android / 鸿蒙 / Web / Skyline 各自原生能力收敛为统一 `p-*` 语义，
编译期经 IR 映射到各端系统原生实现。

**传统跨端框架竞争的是"能不能渲染出来"；Proteus 竞争的是
"能不能把系统能力无损搬进框架"。** 这是代际差。

## 2. 代际差在哪（为什么是降维）

| 维度 | uni-app / RN / Flutter | **Proteus** |
|------|------------------------|-------------|
| 布局 | rpx / 单位换算（一层） | 系统级网格 + 容器感知（三层） |
| 导航 | API 封装（页面栈） | 原生导航容器映射（UINavigationController 等） |
| 自适应 | 媒体查询 / LayoutBuilder | p-adaptive：原生容器形态自动切换 |
| 系统集成 | 插件各自为战、无统一语义 | **统一语义原语 + 系统原生映射** |
| 扩展 | 组件库 / 第三方包 | Compiler Plugin + 可编程 IR |
| 调试 | 各端独立 | Vue DevTools 复用 + 自定义 Inspector |

竞品把"渲染"当终点；**Proteus 把"渲染"当起点，终点是"完整的客户端应用"**。

## 3. 现有原语体系（已落地，原则 #10）

| 域 | 原语 | 系统能力来源 |
|----|------|-------------|
| 布局 | p-grid / p-fluid / p-stack / p-fit | UICollectionView / GridLayoutManager / CSS Grid |
| 自适应容器 | p-adaptive | UISheet / BottomSheet / UISplitViewController |
| 视觉 | pg-glass / p-safe-* / Memorial gray | UIGlassEffect / safeAreaInsets |
| 样式 | style + :class（Style Safety） | 各端原生样式 API |
| 路由 | router | UINavigationController / NavPathStack |
| 配置 | app.config | 各端原生存储 |

## 4. 本次缺口：六大原语家族（语义地图）

缺口不再散列，收敛为 **6 个家族**——每个家族对应一类 OS 系统能力：

```
┌────────────────────────────────────────────────────┐
│ ① 输入与交互（Input）     ← 桌面/折叠屏/车机/TV     │
│ ② 导航结构（Navigation）  ← 大屏生产力             │
│ ③ 数据展示（Data）        ← 表格/列表/画布         │
│ ④ 系统集成（System）      ← 打通客户端的关键        │
│ ⑤ 生命周期（Lifecycle）   ← 多实例/状态恢复        │
│ ⑥ 设备能力（Device）      ← 相机/蓝牙/NFC/传感器   │
└────────────────────────────────────────────────────┘
```

**原则 #10 补丁（#10.8）：**
> 每个 `p-*` 语义原语必须对应至少一个主流 OS 的系统原生能力；
> 无系统原生对应的能力，归入**组件层**（Proteus Components），不进框架核心。

→ 区分"框架该内置"与"组件库该提供"，**防止原语膨胀**。

## 5. 第一批落地：桌面交互原语（Input 家族核心）

让 PC 端从"布局兼容"升级到"交互可用"：

| 原语 | 语义 | 五端映射 |
|------|------|---------|
| `p-hover` | 指针悬停态 | CSS `:hover` / iOS 无（编译期剔除）/ 鸿蒙 hover |
| `p-context-menu` | 右键上下文菜单 | `UIMenu` / `PopupMenu` / `ContextMenu` |
| `p-shortcut` | 键盘快捷键 | 各端 keydown + 菜单栏显示 |
| `p-focus-trap` | 焦点陷阱（弹窗无障碍） | `focusTrap` / iOS 自动 |
| `p-drag` / `p-drop` | 拖拽（含文件） | `UIDragInteraction` / HTML5 DnD |
| `p-resizable` | 可调整尺寸（分栏/列宽） | `UIPanGesture` / resize observer |

```vue
<!-- PC 端完整交互示例：一次声明，五端原生 -->
<p-card p-hover p-context-menu="cardMenu" p-drag="card"
        p-shortcut="mod+a:selectAll">
  {{ item.title }}
</p-card>

<p-modal p-adaptive p-focus-trap>
  <!-- 弹窗内 Tab 循环，系统级焦点管理 -->
</p-modal>
```

## 6. 打通客户端的关键：系统集成家族（System）

这是"全客户端开发"的最后一块拼图，定义**统一语义 → 系统原生**映射规范：

| 能力 | 语义 | iOS | Android | 鸿蒙 |
|------|------|-----|---------|------|
| 通知 | p-notify | UNUserNotificationCenter | NotificationManager | notificationManager |
| 权限 | p-permission | AuthorizationStatus | ActivityResult | abilityAccessCtrl |
| 分享 | p-share | UIActivityViewController | ShareCompat | share |
| 剪贴板 | p-clipboard | UIPasteboard | ClipboardManager | pasteboard |
| 生物识别 | p-biometric | LocalAuthentication | BiometricPrompt | userAuth |
| 窗口 | p-window | UIWindowScene | WindowManager | WindowStage |
| 深链 | p-deeplink | Universal Links | App Links | Want |
| 角标 | p-badge | UIApplication.badge | notification badge | badge |

**示例：**
```vue
<button @click="pNotify({ title: '新消息', body: '来自系统通知' })">
  发送通知
</button>
```
→ Compiler 映射到 `UNUserNotificationCenter` / `NotificationManager` / `notificationManager`。
**开发者写一次，系统原生呈现。**

## 7. 导航结构家族（Navigation，大屏核心）

```
p-nav:        drawer(0,768) | sidebar(768,∞)   ← 已有 p-adaptive
p-master-detail: 三栏（master + detail + inspector）  ← iPad/Mac 标配
p-tabs:       标签栏 / 分段控件（UISegmentedControl / TabLayout）
p-breadcrumb: 面包屑（路由栈推导）
p-command:    命令面板 ⌘K（PC 生产力标配）
```

`<p-master-detail>` 直接映射 `UISplitViewController` 的三列模式
（`primary` / `supplementary` / `secondary`），**鸿蒙 `SideBarContainer`、Android `SlidingPaneLayout` 同理**。

## 8. 生命周期家族（Lifecycle）

| 原语 | 语义 | 系统能力 |
|------|------|---------|
| `p-lifecycle` | 前后台/激活 | `UIApplicationDelegate` / `onPause` |
| `p-state-restoration` | 状态恢复 | `UIStateRestoration` / `SavedStateHandle` |
| `p-network-status` | 网络状态 | `NWPathMonitor` / `ConnectivityManager` |
| `p-low-power` | 低电量/低数据 | `NSProcessInfo` / `BatteryManager` |

**`p-state-restoration` 是 iOS 核心能力，竞品几乎无人映射——Proteus 把它语义化。**

## 9. 设备能力家族（Device）

`p-camera` / `p-bluetooth` / `p-nfc` / `p-sensor` / `p-file-system` ——
统一语义 + 权限前置（`p-permission`），映射到各端原生 API。
**遵循原则 #10.8：有明确系统原生对应的才进框架。**

## 10. 分层：框架核心 vs 组件层 vs 插件层

```
框架核心（p-* 原语）      ← G-24 定义，Compiler Plugin 编译期映射
   ↑ 只有"系统原生能力"才入此层
组件层（Proteus Components） ← 无系统原生对应的复杂 UI（富文本/日历/图表）
插件层（Community Plugins）   ← 业务特定 / 长尾能力
```

**这条分界线保证框架不膨胀，同时语义地图完整。**

## 11. 严格规则（PRIM 系列）

| 规则 | 级别 | 说明 |
|------|------|------|
| PRIM001 | error | 禁止手动 `if (isDesktop)` 分支 → 用 `p-adaptive` / 输入原语 |
| PRIM002 | error | 系统集成必须走 `p-*` 语义，禁止直调原生 SDK |
| PRIM003 | warning | 无系统原生对应的能力应放组件层，不新增 `p-*` |
| PRIM004 | error | 输入原语须声明输入设备适配（触摸/鼠标/键盘/遥控器） |
| PRIM005 | warning | 快捷键须遵循各平台惯例（⌘ vs Ctrl） |

## 12. 收益总结

落地 G-24 后，Proteus 覆盖：
```
手机 ✓ 平板 ✓ 折叠屏 ✓ 桌面(PC/Mac) ✓ 网页 ✓ 小程序(Skyline) ✓
车机(TV/遥控器) ◐ 手表 ◐（输入家族扩展即可）
```

**从"移动端跨端框架"进化为"全客户端操作系统能力语义层"**——
这正是 uni-app / RN / Flutter 在架构层面无法短期追赶的代际差：
它们缺的不是某个 API，而是**"显式语义 + 可编程 IR + 系统原生映射"这套方法论**。
Proteus 从 G-01 到 G-23 一路搭建，G-24 把方法论覆盖到全部客户端开发域。

## 13. 落地策略

不一次实现全部——**先画地图（本方案），再按价值分批**：
- **B1**：桌面交互原语（p-hover/p-context-menu/p-shortcut/p-focus-trap）——纯逻辑可单测
- **B2**：系统集成核心四件套（p-notify / p-permission / p-clipboard / p-deeplink）
- **B3**：导航结构（p-master-detail / p-command）
- **B4**：生命周期 + 设备能力
详见 `07-benchmark-batches.md`。
