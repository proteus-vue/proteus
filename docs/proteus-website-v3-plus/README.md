# Proteus Website v3 — 官网重构设计文档

> 把「API 参考站」翻转为「语义模型的可体验证明场」。
> 配套：`PROTEUS-METHODOLOGY` + `proteus-positioning.md` v4 + G-27/28/29/30/31/32。
> 口径对齐：2026-09-02，规划体系 v2（49 份 plan + 1 哲学 + 1 规约）。

---

## 核心判断

**不是换皮，是信息架构翻转。**

| 维度 | 传统（uni-app/Taro/小程序） | **Proteus v3** |
|------|---------------------------|----------------|
| 起点 | 有哪些组件/API | **语义模型是什么** |
| 文档单元 | 单个组件属性表 | **语义原语 + 多后端剖面** |
| 对标 | 兼容性矩阵 | **conformance 报告** |
| Demo | 静态截图 | **可切换 Playground** |
| 可信度 | "我们测过" | **官网自己跑在 Proteus 上（dogfooding）** |

---

## ⭐ 柔性框架 · 全终端模拟展示（核心 Demo）

> **`flexible-multi-device.html`** — 单文件、零依赖、**双击即开**。
> 这是 G-22 柔性布局 + 方法论"语义优先"对外最直观的证明。

**它证明的事**：一份 `<p-adaptive>` 源码不改一行，六个完全不同形态的终端各自渲染出符合该端交互范式的 UI——

| 终端 | 形态触发 | Backend 自动选择的拓扑 |
|------|---------|----------------------|
| 📱 手机 | portrait · touch | 单列堆叠 + 底部 Tab + 悬浮 FAB |
| 📲 平板 | split-view · touch | 左 240 侧栏 + 2 列卡片 |
| 🖥️ PC | desktop · mouse+kb | 固定侧栏 + 3 列 + hover 展开 + 键盘可达 |
| 🚗 车机 | dashboard · dpad | 大热区焦点导航 + 驾驶降干扰（focus-tree） |
| 📺 TV | 10ft · 遥控器 | 全屏 Hero + 横向海报流（focus-row） |
| ⌚ 手表 | wearable · crown | 一屏一意 + 表冠缩放（single-glance） |

**关键交互**：点六个端按钮 → 左侧源码**零改动**（核心契约：源码只描述意图），右侧设备外观 + 布局拓扑实时重排，右侧 IR 面板同步显示 Backend 决策（`renderBackend` / `cols` / `nav.topology` / `BackendCapabilities`）。

**断点不是 CSS 媒体查询**：车机 / TV 由 `input`（dpad / 遥控器）与 `usage-distance`（10ft）触发——这正是柔性框架超越响应式布局的地方。

**逻辑级自测**（对标 G-27 conformance）：`node test-flexible.js` → **30/30 PASS**，含"切换终端源码零改动"契约断言。

---

## 文档清单（6 份设计文档 + 1 交互原型 + 1 测试）

| 文件 | 内容 |
|------|------|
| **flexible-multi-device.html** | ★ **柔性框架全终端模拟展示（可运行原型，527 行）** |
| **test-flexible.js** | 逻辑级自测（30 项，jsdom 驱动，可退化静态校验） |
| **01-website-rearchitecture.md** | ★ 总纲：翻转论证 + 新 IA + 设计原则 W-1~W-5 |
| **02-home-playground.md** | 首页 + Playground 交互规范（四维度切换、诚实降级、IR 面板） |
| **03-primitives-docs.md** | 语义原语页面范式（5 区块：语义/剖面/降级/对照/demo） |
| **04-compare-migrate.md** | 对标页（含 Lynx 专区）+ 迁移中心（三步工具化） |
| **05-dogfooding-conformance.md** | dogfooding 工程约束（D-1~D-4）+ conformance 可视化 |
| **06-roadmap-launch.md** | 分批 P0-P3 + 验收标准 15 条 + DoD |

---

## 五条设计原则（来自方法论）

- **W-1**：官网是 Proteus 的第一个 Showcase App（用自家框架建官网）
- **W-2**：文档单元 = 语义原语，不是平台 API
- **W-3**：可切换性必须可视化（四维度自由切换）
- **W-4**：证明先于宣称（每条 ✅ 都可点证据）
- **W-5**：迁移路径显式化（诚实优于包装）

---

## 新信息架构（关键差异）

**新增（竞品官网没有）：**
- `/primitives` — 语义原语目录（128 原语，G-32）
- `/backends` — 四层后端矩阵（可切换）+ `/conformance`
- `/methodology` — 方法论页
- `/compare` — 对标页（逐条证据）
- `/migrate` — 迁移中心（codemod 工具）

**降级/删除：**
- 传统的「组件文档」「API 文档」独立频道 → 合并进 `/primitives`
- 「兼容性表格」作为主内容 → 降级为 `/backends/conformance` 自动生成

---

## 打包 / 校验

```bash
./pack.sh       # 依据 MANIFEST 打包为 store 模式 zip
./verify.sh     # 自包含校验（完整性/MANIFEST 双向比对/SHA256/术语/引用/编号）
```

校验脚本打进 zip 内，可在任意隔离目录独立运行（3 种场景均 PASS）。

---

## 与既有体系的关系

```
PROTEUS-METHODOLOGY (原则 #0, 五支柱)
        ↓ 落地
    Website v3 (本文档)
        ↑ 归纳来源
proteus-positioning.md v4 (门面层)
        ↑ 交付产物
proteus-roadmap/ (M1/M2/M3)
        ↑ 编排
G-27 渲染 / G-28 能力 / G-29 编译 / G-30 端 / G-31·32 语义
```

**dogfooding 是最高级可信度证明**：`proteus.dev` 自身就是一个 Proteus App，跑在 `VueDomBackend` 上。
"我们用 Proteus 建了 Proteus 官网" — 比任何 benchmark 都有说服力。

---

*Architecture: `@proteus/architecture` · Plans: 49 · Status: v2 (2026-09-02)*
