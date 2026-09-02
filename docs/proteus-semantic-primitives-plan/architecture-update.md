# Architecture 规约更新（G-24）

## 新增执行位

| ID | 名称 | 层 | 状态 |
|----|------|----|------|
| G-24 | 语义原语全景（六大家族） | 框架核心 / 组件层 / 插件层 | planned |

## 原则 #10 补充

> **#10（原有）**：框架定义统一语义，各端用原生方式实现。
>
> **#10.8（新增）**：每个 `p-*` 语义原语必须对应至少一个主流 OS 的系统原生能力；
> 无系统原生对应的能力，归入**组件层**（Proteus Components）或**插件层**，不进框架核心。

### 判定流程

```
拟新增能力
  ↓
有明确系统原生对应？（iOS/Android/鸿蒙/Web/Skyline 至少一端）
  ├─ 是 → 是否多端通用语义？
  │       ├─ 是 → 框架核心（p-*）
  │       └─ 否 → 组件层（单端适配）
  └─ 否 → 组件层 / 插件层
```

## 分层铁律（G-24.1 / G-24.2）

- **G-24.1**：系统集成能力（通知/权限/分享/窗口/深链）必须通过 `p-*` 语义访问，
  禁止业务代码直调原生 SDK。
- **G-24.2**：框架核心只承载"系统原生能力语义"；复杂 UI（富文本/日历/图表）归组件层，
  业务长尾归插件层。**框架不膨胀。**

## 全景图更新

```
基础设施  G-01~G-06, G-21
渲染平台  G-07~G-10, G-20
应用能力  G-11~G-16
工程化    G-17~G-19
布局      G-22（p-grid/fluid/stack/fit/adaptive）
语义原语  G-24 ★（六大家族：Input/Navigation/Data/System/Lifecycle/Device）
AI        G-23
```

## 严格规则

| 规则 | 级别 |
|------|------|
| PRIM001 | error | 禁止手动 `if (isDesktop)` → 用 p-adaptive / 输入原语 |
| PRIM002 | error | 系统集成必须走 p-* 语义，禁止直调原生 SDK |
| PRIM003 | warning | 无系统原生对应的能力应放组件层 |
| PRIM004 | error | 输入原语须声明设备适配（触摸/鼠标/键盘/遥控器） |
| PRIM005 | warning | 快捷键遵循平台惯例（⌘ vs Ctrl） |

## 与 Glass / Fluid / Style Safety 的同构性

```
G-07 Glass        → pg-glass        → UIGlassEffect          （视觉系统能力）
G-22 Fluid        → p-grid/fluid    → UICollectionView       （布局系统能力）
G-24 System       → p-notify/perm   → UNUserNotificationCenter（集成系统能力）
                      ↓
        全部 = 原则 #10 方法论的全域应用
        "把操作系统能力语义化 + 跨端映射"
```
