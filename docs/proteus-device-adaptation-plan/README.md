# Proteus 全终端柔性架构（G-25）

> 把柔性框架从「手机+PC」扩展到 **车机 / TV / 手表**，实现一套语义覆盖六类终端。

---

## 核心洞察：三维断点模型（W × H × F）

```
宽度 (W)  ×  高度 (H)  ×  输入形态 (F)
              ↓
Proteus 把"设备类型"降维成"容器三维特征"
```

| F（输入形态） | 设备 |
|---------------|------|
| touch | 手机/平板/车机中控 |
| cursor | PC/车机副屏 |
| **remote** | **TV** |
| **dial** | **手表** |
| voice | 车机/智能屏 |

---

## 五端支持矩阵

| 设备 | W | H | F | 关键能力 |
|------|---|---|---|----------|
| 手机 | sm/md | md/lg | touch | 基础 |
| 平板 | md/lg | md/lg | touch | 分屏 |
| **车机** | lg/xl | sm/md | touch+cursor+voice | **驾驶安全/分组懒聚焦** |
| **TV** | xl | md/lg | **remote** | **焦点引擎/远距大字** |
| **手表** | xs | xs | **dial** | **单列一屏/表冠/并发症** |
| PC | md→xl | — | cursor | 窗口拖拽 |

---

## 文档清单

| 文件 | 内容 |
|------|------|
| **01-vehicle-tv-watch.md** | ★ 主文档 |
| **02-3d-breakpoints.md** | 三维断点模型 + 表达式语法 |
| **03-vehicle.md** | 车机：driving-safe / 分组懒聚焦 / CarPlay |
| **04-tv.md** | TV：焦点引擎 / p-focus-scope / Leanback |
| **05-watch.md** | 手表：单列一屏 / p-crown / 并发症 |
| **06-navigation-modes.md** | p-nav 家族（cursor/voice 导航） |
| **07-compiler-runtime.md** | DeviceProfile IR + 五端映射 + 降级 |
| **08-integration-batches.md** | 跨 plan 协同 + B1-B6 分批 |
| **architecture-update.md** | 规约更新（G-25 + #10.9 + 铁律） |

---

## 一句话定位

> **rpx 是单位换算；Proteus 是把操作系统柔性布局能力搬进框架。**
> **G-25 进一步：把这套能力扩展到车机/TV/手表——六类终端，一套 `p-*` 语义。**

---

## 铁律速览

- **G-25.1**：车机交互必须声明 `driving-safe`
- **G-25.2**：TV 可获焦组件必须声明 `focus-mode`
- **G-25.3**：手表页面必须单列一屏

---

## 打包

```bash
cd /data/workspace/proteus-device-adaptation
bash pack.sh
```

生成 `proteus-device-adaptation.zip` + `CHECKSUM.md`。

---

## 依赖

- G-09 Safe Area
- G-22 Fluid Layout + G-22.5 p-adaptive
- G-24 语义原语
- G-21 Compiler Plugin
- G-16 Style Safety
- G-23 AI Agent（设备适配工作流）
- G-19 DevTools（DeviceProfile Inspector）
