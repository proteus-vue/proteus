# Proteus 总体规划路线图（proteus-roadmap）

> **L5 交付层 · 规划体系总编排**（45 份 plan + 1 规约的编排文档，非新增功能 plan）
> 状态：v1 · 2026-09-02 · 与 `proteus-architecture`、`proteus-positioning` v3 口径对齐

---

## 这份文档解决什么问题

45 份 plan 已经齐全，但它们之间是**平铺清单**，缺少：
- 分层依赖关系（谁必须先做）
- 分批里程碑（什么时候做）
- 关键路径（总工期下限）
- 风险前瞻（什么会拖垮项目）

本路线图把这四件事补齐，让"45 份 plan"从**索引**变成**可执行计划**。

---

## 文件清单

| 文件 | 内容 |
|------|------|
| **01-master-roadmap.md** | ★ 主文档：六层分层 / 依赖总览 / M1-M3 分批 / 里程碑 / 关键路径 / 铁律 |
| **02-dependency-graph.md** | 依赖关系图：硬依赖边 / 可并行组合 / DAG 自检 |
| **03-milestones.md** | M1/M2/M3 分批：每阶段 plan、交付、退出标准、工时估算 |
| **04-critical-path.md** | 关键路径：最长链 / 瓶颈 / 浮动时间 / 加速策略 |
| **05-risk-horizon.md** | 风险登记册（10 项）/ 热力图 / 2-5 年演进前瞻 |
| **01-website-skeleton.md** | （附属）Website 骨架：把 positioning §5 做成落地页 |

---

## 核心结论速览

### 分层（6 层）
```
L0 规约 → L1 方法论(7) → L2 核心引擎(8) → L3 能力(14) → L4 工具链(6) → L5 交付(10)
```
**L1 方法论层是杠杆支点**——7 份定稿后，L3/L5 可按同一模式批量产出。

### 分批（3 里程碑 / 18 月 / 关键路径下限）
| 里程碑 | 周期 | 目标 |
|--------|------|------|
| M1 地基 | 0–3 月 | 双 SPI 原型 + 可演示 demo |
| M2 能力 | 4–9 月 | 全栈跑通 6 类终端 + 99% 零原生 |
| M3 生态 | 10–18 月 | 生态完整 + benchmark 领先 |

### 关键路径（18 月下限）
```
规约 → G-27 SPI → compiler IR → NativeBackend → FlutterBackend → 混合渲染 → G-28 生态 → benchmark
```
**唯一技术不确定项：G-27 B5 FlutterBackend** —— 最早启动 spike。

### 工时
- 总计 ≈ 150 人月
- 10 人团队 / 并行度 5 → 理论 3 年
- **但关键路径 = 18 月**（架构性下限，无法靠加人压缩）

---

## 使用方式

1. **决策者**：读 `01-master-roadmap.md` §0 TL;DR + §3 分批 + §5 关键路径
2. **架构师**：读 `02-dependency-graph.md` + `04-critical-path.md`
3. **项目经理**：读 `03-milestones.md`（退出标准 + 工时）
4. **风险管理**：读 `05-risk-horizon.md`

---

## 打包与校验

```bash
# 打包（store 模式，最大兼容）
bash pack.sh

# 独立校验（不依赖外部签名）
bash verify.sh
```

`verify.sh` 会自动：
- 列出 zip 内清单
- 对比 CHECKSUM.md
- 重算 SHA256
- 核对文件行数

---

## 与其他文档的关系

- `proteus-architecture`：真理来源，本路线图分层源于规约
- `proteus-positioning` v3：对外门面，本路线图的"可演示产物"即对外话术弹药
- 各 G-XX / M-X plan：具体执行细则，本路线图只做编排、不重复细节

---

## 下一步

1. ✅ 本路线图（本次交付）
2. ⬜ **Website 骨架落地**（`01-website-skeleton.md` → 可执行 issue 列表）
3. ⬜ M1.1 规约收口
4. ⬜ M1.4 `ProteusRenderBackend` SPI + conformance test 原型

---

## 校验（生成时填写）

- SHA256：`__SHA256__`
- `unzip -t`：__UNZIP_RESULT__
- 文件数：__FILE_COUNT__
- 生成时间：2026-09-02
