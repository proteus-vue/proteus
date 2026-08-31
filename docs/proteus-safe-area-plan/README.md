# Proteus 安全区与灵动岛（Dynamic Island）解决方案

## 定位

Proteus App 端用 JSI 直调原生 View，**没有浏览器那套 `env(safe-area-inset-*)` 自动生效能力**，需要框架层统一收敛。同时灵动岛（Dynamic Island）是 iOS 系统独占的动态区域，与安全区、Glass L3 玻璃融合强耦合——**这一环不做，导航栏玻璃方案就不成立**。

## 设计原则

遵循 Architecture 原则 #10「统一语义 + 原生实现」：

> 框架定义 `p-safe` 语义，各端用系统 API 实现。开发者只写 `p-safe-*`，不写 `safeAreaInsets.top`。

## 核心语义

| 语义 | 含义 |
|------|------|
| `p-safe-top` | 顶部安全区（状态栏 + 灵动岛 + 刘海） |
| `p-safe-bottom` | 底部（Home Indicator / 导航手势条） |
| `p-safe-left/right` | 横屏左右（刘海/挖孔侧） |
| `p-safe-island` | 灵动岛专属避让（iOS only，其他端 = top） |
| `p-safe-island-glass` | 玻璃与灵动岛融合（Glass L3 联动） |

## 五端实现映射

| 端 | 安全区来源 |
|---|---|
| iOS | `safeAreaInsets` + `safeAreaLayoutGuide` + UIKit 玻璃 |
| Android | `WindowInsets` + `DisplayCutout` |
| 鸿蒙 | `getAvoidArea()` + `getWindowRect()` |
| Web | CSS `env()` + `viewport-fit=cover` |
| Skyline | `getSystemInfo().safeArea` + `env()` |

## 关键洞察

> **灵动岛高度可变（收起 59pt → 展开满宽），但 iOS 系统会随形态变化自动更新 `safeAreaInsets` 并发出 `viewSafeAreaInsetsDidChange`。**
>
> **所以唯一正确姿势是：永远用 `safeAreaLayoutGuide` 约束，永不硬编码 44/59/88pt。**

## 文档清单

| 文件 | 内容 |
|------|------|
| `01-safe-area-island.md` | **主文档**：问题定义/语义设计/五端映射/灵动岛专项/玻璃联动/分批/对标 |
| `02-ios-dynamic-island.md` | iOS 专项：safeAreaInsets/LayoutGuide/灵动岛三态/玻璃融合 |
| `03-android-harmony-insets.md` | Android `WindowInsets` + 鸿蒙 `getAvoidArea` 映射 |
| `04-web-skyline-env.md` | Web `env()` + viewport-fit + Skyline 胶囊避让 |
| `05-compiler-integration.md` | Compiler 集成（`p-safe-*` 编译期映射 + `--strict-css`） |
| `06-glass-integration.md` | 与 Glass L3 联动（navigationBar/tabBar/sheet/floating） |
| `07-api-design.md` | `useSafeArea()` + `<p-safe>` + `p-safe-island-glass` API |
| `08-strict-css-rules.md` | CSS013/014/015 规则 + 自动修复 |
| `09-benchmark-budgets.md` | 真机验收矩阵 + 性能预算 |
| `10-batches.md` | 分批 M1-M5 + Prompt 模板 |

## 执行位

- **G-22**（App Renderer）起手：语义定义 + iOS `safeAreaLayoutGuide`（本 plan 主体为 **G-23**）
- **Glass L3**（随 G-22 App Renderer）联动：`p-safe-island-glass`
- **G-21**（CSS Compat）规则扩展：CSS013/014/015
- 优先级：**P0**（iOS 首屏必踩，导航栏前置依赖）

## 验收（一句话）

> iPhone 16 Pro 灵动岛收起/展开/满宽三态，导航栏内容不叠岛、玻璃融合无锯齿；Android/鸿蒙挖孔避让；Web/Skyline `env()` 正常。

## 校验

```bash
bash pack.sh
```
