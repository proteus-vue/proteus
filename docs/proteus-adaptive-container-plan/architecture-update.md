# Architecture 规约更新：自适应容器（G-22 补充）

> **合并方式**：将本章内容并入 `proteus-architecture`（Architecture 规约），G-22 条目新增 §5
> **影响**：执行位表 + 原则 #10 + 铁律 + 严格规则

---

## 1. 执行位更新（G-22 新增 §5）

```
G-22  布局  柔性布局（Fluid Layout）
       ├── ① p-grid     网格密度自适应    ✅ 已规划
       ├── ② p-fluid    流式数值缩放      ✅ 已规划
       ├── ③ p-stack    弹性栈（方向+换行）✅ 已规划
       ├── ④ p-fit      内在尺寸          ✅ 已规划
       └── ⑤ p-adaptive 容器形态自适应    ★ 本次新增
```

**`p-adaptive`**：把操作系统"同一语义随尺寸切换形态"的能力（iOS `UISheetPresentationController` / `UISplitViewController`、Android `BottomSheet` / `NavigationRail`、鸿蒙 `SideBarContainer`）语义化 + 声明式化 + 跨端统一。

## 2. 原则 #10 补充

> **#10 统一语义 + 原生实现**
>
> 新增证据：`p-adaptive` 与 Glass（`UIGlassEffect`）、SafeArea（`safeAreaInsets`）、柔性布局四原语（`UICollectionView`）同构——**都是把操作系统能力语义化 + 跨端映射**。

### 原则 #10 方法论证据链（更新）

```
Glass        → 系统级视觉材质        (iOS UIGlassEffect / 鸿蒙 fractal)
Safe Area    → 系统级安全区          (safeAreaInsets)
Memorial     → 系统级纪念日灰度      (iOS reduceTransparency)
Fluid Layout → 系统级柔性布局引擎    (UICollectionView / GridLayoutManager)
Adaptive     → 系统级自适应容器      (UISheet / UISplit / SideBarContainer) ★
```

**统一方法论**：操作系统提供能力 → 语义收敛（`p-*` 原语）→ 编译期 IR → 各端 nodeOps 映射。**这是 Proteus 区别于 uni-app/RN/Flutter 的核心**（它们的布局/弹窗是 Web 能力模拟 + 开发者手动适配）。

## 3. 铁律新增

### 铁律 G-22.5（容器形态）

> **禁止手动判断屏幕宽度切换弹窗/导航/详情形态（`if (width < 600) showSheet()`）。一律使用 `p-adaptive` 声明式断点区间。**

- 校验：`--strict-fluid`（FLD008）
- 自动修复：G-23 Agent `suggestAdaptiveProp`

### 铁律 G-22.6（容器宽度语义）

> **`p-adaptive` 的区间端点指"容器宽度"，不是"屏幕宽度"。监听容器尺寸变化，不监听屏幕旋转/orientationchange。**

- 实现：`ResizeObserver`（Web）/ `onSizeChanged`（Android）/ `onConfigurationChanged`（鸿蒙）/ `viewDidLayoutSubviews`（iOS）
- 理由：嵌套容器各自独立判断（父级侧栏收起时子级弹窗重新计算）

## 4. 严格规则新增（FLD 系列扩展）

| 规则 | 级别 | 说明 |
|------|------|------|
| FLD007 | error | `p-adaptive` 区间必须连续不重叠 |
| FLD008 | error | 禁止手动判断宽度切换形态 → 用 `p-adaptive`（G-22.5） |
| FLD009 | warning | 区间端点须来自 `app.config.layout.breakpoints` |
| FLD010 | error | 自适应组件内部禁止硬编码固定宽度（须用 `p-fluid`/`p-grid`） |
| FLD011 | warning | 组件应暴露 `adaptive-config` 允许断点覆盖 |

合并进 `--strict-fluid` 校验（`--strict-css` / `--strict-style` / `--strict-fluid` 三件套）。

## 5. 全景图更新

```
基础设施  G-01~G-06, G-21       Compiler / Plugin / Memory / IFR
渲染平台  G-07~G-10, G-20        App Renderer / Glass / i18n / Safe / AppConfig
应用能力  G-11~G-16              Memorial / Skeleton / Theme / Font / Cache / StyleSafety
工程化    G-17~G-19              Router / CLI / DevTools
布局      G-22 ★ (含 p-adaptive)  柔性布局 + 自适应容器
AI        G-23                   AI Agent 柔性接入
```

## 6. 跨 Plan 依赖

```
p-adaptive → G-22 四原语（内容层 + 容器层）
           → G-07 Glass（glass="auto" 随形态选档）
           → G-09 Safe Area（形态切换重算 inset）
           → G-16 Style Safety（STS007 禁止手动 position 模拟）
           → G-19 DevTools（Inspector 形态可视化）
           → G-21 Compiler Plugin（解析实现为 Plugin）
           → G-23 Agent（FLD008 自动修复）
           → G-20 App Config（breakpoints 单一事实源）
```

## 7. 对齐 Architecture 既有原则

| 既有原则 | `p-adaptive` 对齐点 |
|----------|---------------------|
| #1 五端统一 | 同一声明，五端系统原生容器 |
| #3 编译透明 | 映射逻辑可追踪（DevTools 可视化） |
| #5 类型安全 | 区间端点 TS 校验 + FLD007 |
| #8 渐进式 | `glass="auto"` / 降级链 |
| #9 不崩溃 | 降级策略（能力检测 → 逐级降级） |
| #10 统一语义 + 原生实现 | **核心体现**（见 §2 证据链） |
| #11 插件化 | 解析实现为 Compiler Plugin |
| #12 AI 友好 | Agent 可自动重构为 `p-adaptive`（FLD008） |
