# 跨 Plan 协同 & 分批策略

> 依赖：G-07 / G-09 / G-16 / G-19 / G-21 / G-22 / G-23 / G-24
> 目标：**把 G-25 嵌入现有 41 份 plan 体系，定义可执行的落地路径**

---

## 1. 协同全景

```
                    G-25 全终端柔性架构
                           │
   ┌───────────┬───────────┼───────────┬───────────┐
   ↓           ↓           ↓           ↓           ↓
 G-22        G-22.5      G-24        G-07       G-09
 Fluid       p-adaptive  语义原语    Glass       Safe Area
 Layout      (二维→三维)  (System)   (焦点视觉)  (车机异形)
   │           │           │           │           │
   └───────────┴─────┬─────┴───────────┴───────────┘
                     ↓
              G-21 Compiler Plugin
                     ↓
              G-16 Style Safety
                     ↓
              G-23 AI Agent（自动生成 p-adaptive）
                     ↓
              G-19 DevTools（Profile 可视化）
```

---

## 2. 与各 Plan 的协同点

| Plan | 协同内容 |
|------|----------|
| **G-07 Glass** | TV 焦点框 / 车机遮罩用 `<pg-glass>` 强度档位 |
| **G-09 Safe Area** | 车机异形屏安全区、手表圆角屏 `p-safe-inset` |
| **G-16 Style Safety** | 设备相关样式校验、禁止手动媒体查询（DEV001） |
| **G-19 DevTools** | 新增 DeviceProfile Inspector（实时切换 W/H/F 调试） |
| **G-21 Compiler** | 设备能力映射实现为官方 Plugin（dogfooding） |
| **G-22 / G-22.5** | 三维断点（W×H×F）、`p-adaptive` 扩展 |
| **G-23 AI Agent** | Agent 自动识别 TV/车机/手表代码并生成 `p-adaptive` |
| **G-24 语义原语** | G-25 是 G-24 的"设备域"扩展（Input/System 家族） |

---

## 3. DevTools 扩展（G-19，建议跟进）

新增 **DeviceProfile Inspector** 标签页：

```
┌─ DeviceProfile ────────────────────────┐
│  W: [xs] [sm] [md] [lg] [xl]  ← 可点切换
│  H: [xs] [sm] [md] [lg]                 │
│  F: [touch] [cursor] [remote] [dial] [voice] │
│  driving: [ ]                            │
│                                          │
│  预览 → 实时 reflow                      │
└──────────────────────────────────────────┘
```

开发者可**在 DevTools 里模拟任意终端**，无需真机。

---

## 4. AI Agent 扩展（G-23，建议跟进）

```
开发者：这个弹窗在 TV 上怎么用遥控器操作？
Agent：检测到 <p-modal> 未声明焦点行为
       → 建议加 <p-focus-scope mode="grid">
       → 生成 p-adaptive="*(0,∞,remote)"
       → 经 Compiler Plugin 校验（TV001）
       → 一键应用
```

Agent 调用 G-21 Plugin API，产物自动过 FLD + TV001 + VEH001。

---

## 5. 分批策略

### B1：三维断点模型（首发，推荐）
- **零依赖、纯逻辑、可单测**
- 实现 `resolveProfile(W, H, F)` + 断点匹配算法
- 单测：五端 profile 解析、p-adaptive 表达式匹配、二维兼容

### B2：车机（driving-safe + p-vehicle-*）
- VehicleProfile + 车速采集
- 编译期校验 VEH001/VEH002
- 真机：CarPlay Sim + Android Auto DHU

### B3：TV（焦点引擎）
- FocusScope 运行时（焦点状态机）
- 五端焦点 API 映射（Leanback / UIFocusSystem）
- 真机：Android TV Emulator + Apple TV Sim

### B4：手表（p-watch + p-crown + p-complication）
- 单列强制（WATCH001）+ 导航限制
- 表冠/并发症映射
- 真机：Watch Sim + Wear OS Emulator

### B5：统一导航 p-nav 家族
- p-nav-cursor / p-nav-voice
- 与 Router（G-17）集成

### B6：Compiler Plugin + DevTools + Agent 联动
- 官方 Plugin 打包
- DeviceProfile Inspector
- AI Agent 设备适配工作流

---

## 6. 依赖图

```
B1 (三维断点)  ──→  B2 (车机)
                ──→  B3 (TV)
                ──→  B4 (手表)
                          ↓
                    B5 (p-nav)
                          ↓
                    B6 (Plugin + DevTools + Agent)
```

**B1 是地基，必须首发**。B2/B3/B4 可并行（均依赖 B1）。

---

## 7. 验收矩阵

| 批次 | 真机/模拟器 | 关键验收 |
|------|------------|----------|
| B1 | jsdom + Node | profile 解析、断点匹配 100% 通过 |
| B2 | CarPlay Sim / AA DHU | driving-safe 自动禁用生效 |
| B3 | Android TV / Apple TV Sim | 5 向导航 + 焦点环绕 |
| B4 | Watch Sim / Wear OS | 单列一屏、表冠滚动 |
| B5 | 五端 | p-nav 各形态正确 |
| B6 | DevTools | Profile 可视化切换 |

---

## 8. 单测用例（B1 示例）

```
✅ resolveProfile(1920, 1080, 'cursor')
   → { w:'xl', h:'lg', f:'cursor' }

✅ resolveProfile(400, 300, 'touch')
   → { w:'sm', h:'xs', f:'touch' }

✅ p-adaptive 匹配
   sheet(0,600,touch) 在 profile(sm,xs,touch) → 命中

✅ 二维兼容
   sheet(0,600) ≡ sheet(0,600,*) → true

✅ driving 子形态
   confirmation(∞,∞,driving) 在任意 W/H + driving → 命中
```

---

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 五端 TV 焦点 API 差异大 | Leanback / UIFocusSystem 抽象层 |
| 车机车速采集权限 | 降级：默认 driving=false |
| 手表性能敏感 | 并发症数据轻量化、避免复杂渲染 |
| 三维断点学习成本 | DevTools 可视化 + AI Agent 辅助 |

---

## 10. 小结

G-25 不是孤立方案，而是**现有架构的必然延伸**：
- 复用 G-21 IR / G-22 Layout / G-16 校验 / G-23 Agent / G-19 DevTools
- **一条原则 #10，覆盖全部客户端设备**
- B1 首发、B2-B4 并行、B5-B6 收尾 → 可执行路线图
