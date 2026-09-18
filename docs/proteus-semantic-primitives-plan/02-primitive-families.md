# 六大语义原语家族（G-24 语义地图）

> 本文定义 Proteus 的完整语义地图，确保覆盖**全部客户端开发域**。

## 家族总览

| # | 家族 | 职责 | 代表原语 |
|---|------|------|---------|
| ① | Input（输入与交互） | 鼠标/键盘/触摸/遥控器/手柄 | p-hover / p-shortcut / p-drag |
| ② | Navigation（导航结构） | 大屏多栏/路由/命令面板 | p-nav / p-master-detail / p-command |
| ③ | Data（数据展示） | 列表/表格/画布/虚拟滚动 | p-virtual-list / p-data-grid |
| ④ | System（系统集成） | 通知/权限/分享/窗口/深链 | p-notify / p-permission / p-window |
| ⑤ | Lifecycle（生命周期） | 前后台/状态恢复/网络 | p-lifecycle / p-state-restoration |
| ⑥ | Device（设备能力） | 相机/蓝牙/NFC/传感器 | p-camera / p-bluetooth |

## 原则 #10.8：分层判定

> 每个 `p-*` 必须对应至少一个主流 OS 的系统原生能力；
> 无系统原生对应 → 归**组件层**（Proteus Components）。

**判定示例：**
- ✅ `p-notify` → iOS UNUserNotificationCenter / Android NotificationManager → **进框架**
- ✅ `p-shortcut` → 各端 keydown + 菜单栏 → **进框架**
- ❌ 富文本编辑器 → 无统一系统原生对应 → **组件层**
- ❌ 日历 → 系统差异大 → **组件层**

## 输入设备矩阵

| 原语 | 触摸 | 鼠标 | 键盘 | 遥控器(TV) | 手柄 |
|------|------|------|------|------------|------|
| p-tap / p-click | ✅ | ✅ | ✅(Enter) | ✅ | ✅ |
| p-hover | ❌ | ✅ | ❌ | ⚠️ | ❌ |
| p-context-menu | 长按 | 右键 | Shift+F10 | 菜单键 | ⚠️ |
| p-drag | ✅ | ✅ | ⚠️ | ❌ | ⚠️ |
| p-focus-trap | ❌ | ✅ | ✅ | ✅ | ✅ |

**无系统原生能力的输入（如手柄）走组件层适配，框架只保证焦点/导航语义。**

## 与竞品覆盖面对照

| 域 | uni-app | Flutter | RN | **Proteus** |
|----|---------|---------|-----|-------------|
| 布局自适应 | ⚠️ rpx | ✅ | ✅ | ✅✅ 系统级 |
| 系统集成 | ❌ 插件 | ⚠️ 插件 | ⚠️ 插件 | ✅ **统一语义** |
| 桌面交互 | ❌ | ⚠️ | ❌ | ✅ 原生映射 |
| 车机/TV | ❌ | ⚠️ | ❌ | ✅ 输入家族 |

**Proteus 是首个把"系统集成 + 桌面交互 + 多输入"纳入统一语义层的框架。**
