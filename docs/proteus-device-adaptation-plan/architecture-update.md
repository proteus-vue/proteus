# Architecture 规约更新（G-25）

> 将 G-25（全终端柔性架构）合并进 `proteus-architecture` 规约
> 新增：G-25 执行位 + 原则#10.9 + 铁律 G-25.1/2/3 + 严格规则

---

## 1. 执行位表新增（G-25）

| 编号 | 名称 | 层级 | 状态 |
|------|------|------|------|
| **G-25** | 全终端柔性架构（车机/TV/手表） | 渲染平台 / 语义原语扩展 | Draft |

**依赖关系**：
```
G-25 → G-22 (Fluid Layout)
     → G-22.5 (p-adaptive)
     → G-24 (语义原语)
     → G-09 (Safe Area)
     → G-21 (Compiler Plugin)
```

---

## 2. 原则 #10 扩展（新增 #10.9）

> **#10（统一语义 + 原生实现）**：框架定义跨端语义（`p-*`），Compiler + 各端用各自最优方式实现。

**新增子项 #10.9**：
> 语义原语须覆盖**全部客户端设备类型**（手机/平板/PC/车机/TV/手表），
> 设备差异通过**容器三维特征（W×H×F）**表达，而非 `if (isXXX)` 分支。
> 每个 `p-*` 必须对应至少一个主流 OS 的系统原生能力（对齐原则 #10 本义）。

---

## 3. 铁律（G-25.1 / G-25.2 / G-25.3）

| 铁律 | 内容 |
|------|------|
| **G-25.1** | 车机交互必须声明 `driving-safe`；车速 > 0 时禁止 `driving-safe=false` 的交互 |
| **G-25.2** | TV 可获焦组件必须声明 `focus-mode`；页面必须有初始焦点 |
| **G-25.3** | 手表页面必须单列一屏；禁止 TabBar / Drawer / Rail |

---

## 4. 严格规则汇总（新增）

### 4.1 通用（DEV 系列）

| 规则 | 级别 | 说明 |
|------|------|------|
| DEV001 | error | 禁止手动 `if (isTV/isCar/isWatch)` → `useContainerProfile().f` |
| DEV002 | error | 设备能力须通过 `p-*` 语义声明 |
| DEV003 | warning | 新增设备须登记到 DeviceProfile |
| DEV004 | error | Compiler 须为每端生成对应原生声明 |

### 4.2 车机（VEH 系列）

| 规则 | 级别 |
|------|------|
| **VEH001** | error（= G-25.1） |
| VEH002 | error |
| VEH003 | warning |
| VEH004 | error |

### 4.3 TV（TV 系列）

| 规则 | 级别 |
|------|------|
| **TV001** | error（= G-25.2） |
| TV002 | warning |
| TV003 | error |
| TV004 | warning |

### 4.4 手表（WATCH 系列）

| 规则 | 级别 |
|------|------|
| **WATCH001** | error（= G-25.3） |
| WATCH002 | warning |
| WATCH003 | error |
| WATCH004 | warning |

### 4.5 断点（BP 系列，见 02-3d-breakpoints.md）

| 规则 | 级别 |
|------|------|
| BP001 | error |
| BP002 | warning |
| BP003 | error |

---

## 5. 全景图更新

```
Proteus 语义地图（G-24 + G-25）：
┌────────────────────────────────────────────────┐
│  布局 (G-22)                                   │
│   p-grid / p-fluid / p-stack / p-fit          │
│   + p-adaptive (G-22.5, 三维 W×H×F)           │
│                                                │
│  输入 (G-24)                                   │
│   p-hover / p-shortcut / p-focus-trap         │
│   + F 维度: touch/cursor/remote/dial/voice    │
│                                                │
│  系统 (G-24)                                   │
│   p-notify / p-permission / p-share           │
│   + 车机: p-vehicle-* (G-25)                  │
│                                                │
│  导航 (G-17 + G-25)                            │
│   Router + p-nav 家族                          │
│   + cursor(F=remote) / voice(F=voice)         │
│                                                │
│  设备专属 (G-25)                               │
│   TV:  p-focus-scope + focus-mode             │
│   车机: p-vehicle-group + driving-safe        │
│   手表: p-watch + p-crown + p-complication   │
└────────────────────────────────────────────────┘
```

---

## 6. 对齐既有原则校验

- ✅ **原则 #1**（单一事实源）：设备能力收敛到 `p-*`，单一语义源
- ✅ **原则 #5**（编译透明）：三维断点编译期推导，开发者无感知
- ✅ **原则 #10**（统一语义+原生实现）：G-25 核心方法论
- ✅ **原则 #11**（插件化）：设备能力映射实现为 Compiler Plugin
- ✅ **G-16 Style Safety**：设备样式校验（DEV001/DEV002）
- ✅ **G-20 App Config**：DeviceProfile 可远端下发的预留位

---

## 7. 合并动作清单

1. 将 G-25 加入**执行位表**（本文件 §1）
2. 新增**原则 #10.9**（本文件 §2）
3. 新增**铁律 G-25.1/2/3**（本文件 §3）
4. 新增**严格规则 DEV/VEH/TV/WATCH/BP**（本文件 §4）
5. 更新**全景图**（本文件 §5）
6. 在 `proteus-positioning-v3.md` 第 5 章补充杀手特性：
   > 「全终端柔性架构：一套 `p-*` 语义适配手机/平板/PC/车机/TV/手表，
   > 车机驾驶安全、TV 焦点引擎、手表表冠与并发症全部映射系统原生能力」

---

## 8. 风险与治理

| 风险 | 治理 |
|------|------|
| 语义原语膨胀 | 原则 #10.9：无原生对应 → 组件层/插件层 |
| 五端差异过大 | Compiler Plugin 逐端映射 + 降级策略 |
| 新增设备类型 | DEV003 强制登记到 DeviceProfile |

---

## 9. 小结

G-25 让 Proteus 从"跨端 UI 框架"升级为**操作系统能力语义层**——
**一套 `p-*` 语义覆盖六类终端，车机/TV/手表是这套方法论的自然延伸。**
这是竞品无法短期复制的：它们缺的不是 AI 模型，而是"显式语义 + 可编程 IR + 系统原生映射"这套基础。
