# 跨 Plan 协同

> **执行位**：G-22 补充（自适应容器 `p-adaptive`）
> **关联**：G-07 / G-09 / G-16 / G-19 / G-21 / G-22 / G-23

---

## 1. 协同全景

```
                    ┌──────────────────────────┐
                    │   p-adaptive（本次 G-22 补充）│
                    └────────┬─────────────────┘
        ┌───────┬───────┬────┼────┬───────┬───────┐
        ↓       ↓       ↓    ↓    ↓       ↓       ↓
    G-22 四原语  G-07   G-09  G-16 G-19   G-21   G-23
    (grid/stack) (Glass) (Safe) (Style) (Dev) (Plugin)(Agent)
```

## 2. 与 G-22 柔性布局四原语（核心）

`p-adaptive` 是**第五个柔性原语**，但作用在**容器形态层**，与四原语（内容布局层）正交互补：

| 层级 | 原语 | 解决的问题 |
|------|------|-----------|
| 内容布局 | `p-grid` / `p-fluid` / `p-stack` / `p-fit` | 内容怎么排 |
| **容器形态** | **`p-adaptive`** | **装内容的容器长什么样** |

**协同**：`p-modal` 用 `p-adaptive` 选形态，内部用 `p-stack`/`p-grid` 排内容——**双层自适应**。

## 3. 与 G-07 Glass（视觉能力层）

弹窗/Sheet 天然需要玻璃质感：

```vue
<p-modal p-adaptive="sheet|dialog|popover" glass="auto" />
```

- `glass="auto"`：根据当前形态选玻璃档位（sheet → L1 blur，popover → L3 `UIGlassEffect`）
- **共享 `CapabilityRegistry` 能力检测**：iOS 15- 无 `UISheetPresentationController` 时，Glass 降级 + `p-adaptive` 降级**同步发生**

## 4. 与 G-09 Safe Area（安全区）

Sheet 底部、Drawer 侧边必须避让安全区：

```vue
<p-modal form="sheet">
  <div p-safe="bottom">内容</div>
</p-modal>
```

- `p-adaptive` 切换形态时，**自动重新计算安全区 inset**（sheet → 避让 Home Indicator，popover → 避让 anchor 方向）
- 与 iOS `additionalSafeAreaInsets` 联动

## 5. 与 G-16 Style Safety（样式运行时安全）

`p-adaptive` 生成的形态切换**不经过内联 style 直通**，而是走原生容器 API：

- 编译期：`p-adaptive` 表达式 → `AdaptiveConstraint` IR → 各端 nodeOps
- 运行时：`AdaptiveController` → `applyAdaptiveForm()` → 原生容器
- **完全在 Style Safety Validator 管辖之外（因为是原生 API 调用，非 CSS 属性）**——但需要新增规则：

| 规则 | 级别 | 说明 |
|------|------|------|
| STS007 | error | 禁止手动 `element.style.position` 模拟弹窗形态 → 用 `p-adaptive` |

## 6. 与 G-19 DevTools（调试）

- Inspector 显示**当前容器宽度** + **命中的形态区间** + **断点定义**
- 可手动覆盖形态（强制 sheet/dialog/popover）→ 调试响应式断点无需改代码
- Timeline 记录**形态切换事件** + 转场耗时
- **数据来源**：`AdaptiveController` 的 `update()` 上报 TraceBus

## 7. 与 G-21 Compiler Plugin（dogfooding）

`p-adaptive` 解析实现为 Compiler Plugin：

```typescript
definePlugin({
  name: 'proteus:adaptive',
  parse(ctx) { /* 识别 p-adaptive 指令 */ },
  buildIR(ctx) { /* 生成 AdaptiveConstraint */ },
  codegen(ctx) { /* 各端映射 */ },
})
```

**与 G-23 AI Agent 的协同**：Agent 的 `scanHardcodedWidth` 工具识别到手动 `if (width < 600) showSheet()` 时，建议重构为 `p-adaptive`——**正是 FLD008 的自动修复场景**。

## 8. 与 G-23 AI Agent（智能接入）

Agent 工作流：

```
开发者写：if (width < 600) showSheet() else showDialog()
    ↓ scanHardcodedWidth（识别 FLD008 违规）
    ↓ suggestAdaptiveProp（生成 p-adaptive 表达式）
    ↓ applyFluidRefactor（写入 SFC）
    ↓ verifyViaCompilerPlugin（跑 --strict-fluid + FLD007/008/009）
    ↓ 合法 → commit
```

**这正是"把系统能力搬进来"的自动化**：Agent 识别出开发者手动判断宽度的反模式，自动升级为声明式 `p-adaptive`。

## 9. 共享基础设施

| 基础设施 | 共享方 | 用途 |
|----------|--------|------|
| `app.config.layout.breakpoints` | G-20 + G-22 + `p-adaptive` | 断点单一事实源（FLD009） |
| `CapabilityRegistry` | G-07 + `p-adaptive` | 能力检测 + 降级 |
| `ResizeObserver` 抽象 | G-22 + `p-adaptive` | 容器宽度监听 |
| TraceBus | G-19 + `p-adaptive` | 切换事件上报 |
| Compiler Plugin API | G-21 + `p-adaptive` + G-23 | 解析/校验/代码生成 |

## 10. 原则 #10 的又一次验证

> **框架定义统一语义（`p-adaptive` + 形态区间），各端用原生方式实现（iOS `UISheet` / Android `BottomSheet` / 鸿蒙 `SideBarContainer`）。**

`p-adaptive` 与 Glass（`UIGlassEffect`）、SafeArea（`safeAreaInsets`）、柔性布局四原语（`UICollectionView`）**完全同构**——它们都是"把操作系统能力语义化 + 跨端映射"。这条证据链现在更完整了：

```
Glass        → 系统级视觉材质
Safe Area    → 系统级安全区
Memorial     → 系统级纪念日灰度
Fluid Layout → 系统级柔性布局引擎
Adaptive     → 系统级自适应容器 ★ 新增
```

**统一方法论 = 原则 #10 的最强背书。**
