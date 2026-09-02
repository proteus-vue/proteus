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

## 文档清单（6 份设计文档）

| 文件 | 内容 |
|------|------|
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
