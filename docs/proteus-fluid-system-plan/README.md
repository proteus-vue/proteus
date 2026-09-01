# Proteus 柔性框架系统（Fluid System）

> 定位：**多形态设备的完整语义布局体系**——折叠屏 / 平板 / 车机 / 多窗口场景下，开发者写**响应式意图**，
> 框架负责求解。区别于 fluid-layout-plan（G-22，4 原语 + 编译期推导）：本体系是**完整的响应式布局语言**，
> 核心抽象从「组件」升级为「响应式上下文（FluidContext）」，独立拆包 `@proteus-vue/fluid`。

## 0. 本质定位：柔性 = 系统能力收敛，不是升级版 rpx（★essence 文档）

**柔性框架的本质是把各终端厂商/操作系统的柔性布局能力收敛进框架**（原则 #10 统一语义 + 原生实现），
**不是升级版 rpx**——rpx 是「单位换算」（值 × 屏幕宽/750，布局结构不变），Proteus 是「布局引擎能力」
（不同屏幕尺寸/密度/形态/折叠状态下，布局结构自适应）。三层对照：

| 层 | rpx | Proteus |
|----|-----|---------|
| 数值缩放 | ✅ 值×屏幕宽/750（无下限/上限） | ✅ `p-fluid` clamp 区间（min/max 兜住） |
| 结构自适应 | ❌ 列数/换行/方向不变 | ✅ `p-grid` 自适应列数 / `p-stack` 换行 / `p-split` 分栏 |
| 形态自适应 | ❌ 折叠屏/分屏/多窗口无感知 | ✅ 容器查询 + 断点切换 + display-mode（折叠形态） |

**Proteus 不模拟网格**——让各平台用各自原生容器实现同一语义（iOS UIStackView/UICollectionView、
Android ConstraintLayout/GridLayoutManager、鸿蒙 Flex/Grid、Web CSS Grid/clamp/container query）。
与 Glass（G-07 系统级玻璃）、SafeArea（G-09 系统级安全区）是**同一套哲学**：把操作系统的能力搬进框架。

- 本质差异详细论述：`docs/proteus-fluid-layout-essence-plan/01-fluid-vs-rpx.md`
- 五端原生 API 映射明细 + 降级策略表：`docs/proteus-fluid-layout-essence-plan/02-system-capability-mapping.md`
- 降级铁律 G-22.2「朴素但正确」落地：`detectFluidCapabilities`（Web CSS.supports 探测）+ p-grid flex-wrap 模拟

## 1. 为什么是独立体系

| 维度 | fluid-layout（G-22，已落地） | Fluid System（本方案） |
|------|------------------------------|------------------------|
| 抽象 | 4 原语（fluid/grid/stack/fit） | **FluidContext 响应式上下文** + 原语全家桶 |
| 响应式基准 | 视口（clamp/vw） | **容器**（container query——车机/多窗口按容器而非视口） |
| 设备形态 | 通用 Web | 折叠屏（display-mode/hinge）、车机（焦点/drive-mode）、平板（split/密度） |
| 包 | compiler + src/components | **独立包 @proteus-vue/fluid** |
| 治理 | FLD001-006 | FLD 扩展 + fluid:check |

## 2. 核心抽象：FluidContext

统一求解上下文（Web 用 CSS 原生 + ResizeObserver/container query，不依赖全局媒体查询）：

```ts
interface FluidContextState {
  width: number                 // 容器宽度（px）
  height: number
  orientation: 'portrait' | 'landscape'
  breakpoint: 'sm' | 'md' | 'lg' | 'xl'   // 容器级断点（非视口！）
  density: 'compact' | 'regular' | 'comfortable'
  fontSizeScale: number         // 动态字号缩放（无障碍）
  safeAreas: { top: number; bottom: number; left: number; right: number }  // 刘海/铰链/圆角
  displayMode: 'standard' | 'fold' | 'span' | 'expand'   // 折叠屏形态
  isDriveMode: boolean          // 车机驾驶中（动效/颜色限制）
}
```

运行时：`createContainerQuery(el)`（ResizeObserver 可注入，纯逻辑可单测）+ `createDeviceEnv()`（matchMedia 折叠形态/方向/驾驶模式）。

统一断点入口：**`createSizeAwareObserver(el)`**（essence 02 §2——容器级 + 视口级 + 方向双断点订阅，
呼应「useBreakpoint() + onLayoutChange 内部桥接各端 API」；组件层组合式入口在此基础上桥接，本包保持纯逻辑）。

## 3. 原语全家桶

```
尺寸    p-fluid（流式 clamp ✅）· p-fit（内在尺寸 ✅）· p-scale（动态字号/密度 ⬜ S4）
布局    p-grid（自适应网格 ✅）· p-stack（弹性栈 ✅）· p-split（自适应分栏 ⬜ S1）· p-aspect（纵横比 ⬜ S2）
导航    p-sidebar（窄屏 bottom-bar → 宽屏 side-rail ⬜ S3）· p-toolbar（溢出折叠 ⬜ S3）
形态    p-safe（安全区：刘海/铰链/圆角 ⬜ S2）
响应式  p-zone（容器断点渲染不同子布局 ⬜ S1）
```

## 4. 场景矩阵

| 场景 | 关键能力 | Web 支撑 |
|------|---------|---------|
| 折叠屏 | display-mode（fold/span/expand）+ hinge 安全区 + 跨屏 span | ✅ Chrome 折叠屏 media query + env() |
| 平板 | 分栏（split view）、方向、密度、多窗口容器查询 | ✅ container queries |
| 车机 | 容器查询（卡片/分屏）、焦点导航（d-pad）、drive-mode 动效限制 | ✅ Web 焦点 + prefers-reduced-motion |
| 无障碍 | 动态字号（font scaling）、密度 | ✅ clamp + 语义 token |
| 多窗口/嵌入 | 容器断点（非视口） | ✅ ResizeObserver/container query |

## 5. 包结构

```
packages/fluid/                    # @proteus-vue/fluid（独立体系核心）
  src/
    context.ts                     # FluidContext 状态模型 + 容器查询运行时（ResizeObserver 可注入）
    env.ts                         # 设备环境：折叠形态/方向/安全区/drive-mode（matchMedia 可注入）
    breakpoint.ts                  # 容器级断点推导（复用 compiler deriveBreakpoints 语义）
    capabilities.ts                # ★essence 02 §4 能力检测（CSS.supports 探测 clamp/grid/containerQuery/flexGap）
    layout.ts                      # ★essence 02 §2 统一断点入口（容器 + 视口 + 方向双断点）
    index.ts                       # 导出（纯逻辑——esbuild 可构建）
  package.json                     # exports: "."（逻辑）/ "./components"（.vue 源码，Web alias + MP 组件目录消费）
```

组件（p-split/p-zone 等 .vue）S1 放 `src/components/` 薄壳引用 @proteus-vue/fluid（复用现有扩展组件管线：
Web alias + MP usingComponents 自动编译）；S2 迁入包内组件目录 + mpTransform 多组件目录支持。

## 6. 分批

| 批 | 内容 | 验收 | 状态 |
|----|------|------|------|
| S1 | 拆包 + FluidContext（容器查询/断点/方向）+ p-split + p-zone 简化版 + ★essence 定位（能力检测 + 统一断点入口 + p-grid 降级） | 容器宽度变化 → 断点/分栏实时切换；无 grid 环境 flex-wrap 降级（单测 + demo） | ✅ 已落地（@proteus-vue/fluid：context/env/breakpoint/**capabilities/layout** + src/components/p-split·p-zone·p-grid 降级 + examples/pages/fluid-system-demo） |
| S2 | p-safe（安全区 env()）+ p-aspect + 折叠形态（display-mode） | 折叠屏/刘海 demo | ⬜ |
| S3 | p-sidebar/p-toolbar + 车机焦点导航 + drive-mode | 窄屏 bottom-bar → 宽屏 side-rail | ⬜ |
| S4 | p-scale 动态字号/密度 + FLD 规则扩展（fluid:check） | 无障碍 + 治理闭环 | ⬜ |
| S5 | 组件目录入包 + mpTransform 多组件目录 + App 端求解器接口（B4/B5 后接） | 全端消费 | ⬜（★MP 共享模块已自动识别 @proteus-vue/fluid——组件内 import 已可编译，仅模板 ref 降级） |

## 7. 与既有体系关系

- **继承**：G-22 的 clamp/断点算法、FLD 规则、p-grid/p-stack/p-fit
- **升级**：响应式基准 视口 → 容器（p-split/p-zone 是原语层新增，不动既有原语）
- **App 端**：设计上预留原生求解器接口（FluidContext 状态模型即跨端契约），B4/B5 渲染层就绪后实现
