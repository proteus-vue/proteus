# Proteus 自适应容器（Adaptive Container）

> **执行位**：G-22 补充 · 柔性布局体系第五个原语 `p-adaptive`
> **一句话**：把 iOS `UISheetPresentationController` / Android `BottomSheet` / 鸿蒙 `SideBarContainer` 的**系统级自适应能力**搬进框架——开发者写一次 `<p-modal p-adaptive="sheet|dialog|popover">`，手机 Sheet、平板 Dialog、桌面 Popover 自动切换。

## 与 rpx / 媒体查询 / 竞品的本质差异

| | rpx | 媒体查询 | uni-app/Flutter/RN | **Proteus `p-adaptive`** |
|---|---|---|---|---|
| 数值缩放 | ✅ | ✅ | ✅ | ✅（用 `p-fluid`） |
| 结构重排 | ❌ | ✅（样式级） | ⚠️ 手动 | ✅（用 `p-grid`） |
| **容器形态切换** | ❌ | ❌（只改样式） | ❌（手动 if width） | ✅ **系统原生容器级** |
| 系统原生转场 | ❌ | ❌ | ❌ | ✅ iOS/Android/鸿蒙 |
| 容器宽度感知 | ❌ | ⚠️ 视口 | ❌（屏幕宽度） | ✅ 容器查询 |

**关键**：`p-adaptive` 切换的是**各端原生容器组件**（UISheet / AlertDialog / Popup），不是 CSS class——转场动画由系统驱动。

## 文档清单

| 文件 | 内容 |
|------|------|
| `01-adaptive-container.md` | ★ 主文档：问题 / 原语 API / 弹窗实战 / 与 iOS 同构 / 对标 |
| `02-compiler-runtime.md` | Compiler IR / 区间校验 / `AdaptiveController` 运行时 / 五端 nodeOps |
| `03-five-end-mapping.md` | 五端原生映射详解 + 降级策略 + iOS 系统能力对照 |
| `04-component-api.md` | `<p-modal>` / `<p-nav>` / `<p-detail>` / `<p-drawer>` 组件规范 |
| `05-integration-synergy.md` | 与 G-07/G-09/G-16/G-19/G-21/G-22/G-23 协同 |
| `06-benchmark-batches.md` | 性能预算 / 五端真机矩阵 / B1-B5 / 单测 |
| `architecture-update.md` | 规约更新（G-22.5 + 原则#10 证据链 + FLD007-011） |

## 核心 API

```vue
<p-modal
  v-model:visible="visible"
  p-adaptive="sheet(0,600) | dialog(600,840) | popover(840,∞)"
  :anchor="triggerRef"
>
  <p-stack :wrap="true" :gap="12">
    <p-button variant="primary" @click="confirm">确定</p-button>
  </p-stack>
</p-modal>
```

| 容器宽度 | 形态 | 系统能力 |
|----------|------|----------|
| < 600pt | Sheet | `UISheetPresentationController` / `BottomSheetDialog` |
| 600-840pt | Dialog | `UIAlertController` / `AlertDialog` |
| > 840pt | Popover | `UIPopoverPresentationController` / `Popup` |

## 方法论定位

**原则 #10（统一语义 + 原生实现）证据链**：

```
Glass        → UIGlassEffect
Safe Area    → safeAreaInsets
Fluid Layout → UICollectionView
Adaptive     → UISheet / UISplitViewController ★
```

这是 Proteus 区别于竞品的核心——**不是用 Web 模拟，而是把操作系统能力语义化后跨端映射**。

## 打包

```bash
bash pack.sh
# 产物：proteus-adaptive-container.zip + CHECKSUM.md (SHA256)
```

## 严格规则（FLD 系列新增）

- **FLD007**：`p-adaptive` 区间必须连续不重叠
- **FLD008**：禁止手动 `if (width < 600) showSheet()` → 用 `p-adaptive`
- **FLD009**：区间端点须来自 `app.config.layout.breakpoints`
- **FLD010**：自适应组件内部禁止硬编码固定宽度
- **FLD011**：组件应暴露 `adaptive-config` 允许断点覆盖

## 状态

规划完成，待并入 `proteus-architecture` 规约。**B1（compute/validate 纯逻辑）可立即动手，零依赖、可单测。**
