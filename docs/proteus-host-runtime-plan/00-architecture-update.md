# 规约增量：G-39 宿主运行时

> 待合并进 `proteus-architecture/`（最高层规约，原则 #0 派生）
> 本文件是 G-39 对规约的**增量**，合并时追加到对应章节

---

## 1. 新增原则（架构级）

### 原则 #13.8：宿主运行时为运行环境抽象，必须可替换
> 任何宿主（iOS/Android/Web/Flutter/Harmony/Terminal/TV/Watch）都通过实现 `ProteusHostRuntime` SPI 接入。框架内核、Backend 不感知具体宿主。

### 原则 #13.9：线程安全由 Runtime 唯一保证
> 线程创建、调度、销毁的唯一拥有者是 Host Runtime（G-39.2）。Backend/业务不得直接操作线程。

### 原则 #13.10：生命周期状态机必须确定性
> 生命周期转换由 Runtime 统一定义（`bootstrapping → running → suspended → destroyed`），幂等、可重入、非法转换抛错（G-39.6, CMP040）。

> 原则 #13（G-37 建立）：**可插拔必须有可验证支撑**。
> G-37 → G-38 → G-39 三次兑现，证明其为**架构级不变量**，非一次性规则。

---

## 2. 铁律追加（进铁律总表）

```
G-37.1-6 + CMP023-028  (渲染后端)
G-38.1-6 + CMP029-034  (编译后端)
G-39.1-6 + CMP035-043  (宿主运行时)   ← 本轮新增
```

**禁止冲突**：CMP035-043 已避让 G-38 最大编号 CMP034。

---

## 3. 全景图细化（L0-L4 五层）

```
L0  业务应用 (128 原语)
     ↓ 只能调 Framework
L1  Framework Core (IR/Diff/响应式/调度/桥编排)   ← 唯一拥有：IR 定义
     ↓ 调度
L2  CapabilityBackend (G-28)                      ← 唯一拥有：原生能力
L3  RenderBackend (G-37)                          ← 唯一拥有：UI 树
L4  Host Runtime (G-39)  ★本轮                     ← 唯一拥有：进程/线程/事件循环/原生桥
     ↓ 运行在
   原生宿主 (iOS/Android/Flutter/Skia/Harmony/Web/Terminal)
```

**关键**：职责边界由 `02-responsibility-matrix.md` 的**跨层调用规则**约束（CMP036 禁止跳层，CMP037 禁止循环），并由 `verify.sh` 步骤 10 自动扫描校验。

---

## 4. 体系计数更新

```
G-01 ~ G-26  既有 plan
G-27  渲染可插拔
G-28  能力后端
G-29  编译器可插拔
G-30  端接入
G-31  语义入口（组件/API）
G-32  原语库（128）
G-36  AI Agent
G-37  渲染后端 SPI
G-38  编译后端 SPI
G-39  宿主运行时 SPI   ← 本轮（+1，与 G-36/G-37/G-38 同批次）

总计：54 → 55 份 plan（★编号避让：规划文档原稿 G-36/G-34/G-35 均与已实现 plan 冲突，入库重编号 G-39 / 兄弟引用重指向 G-37·G-38·G-36，见 README）
      + 1 哲学（PROTEUS-METHODOLOGY，原则 #0 + #13.x）
      + 1 规约（proteus-architecture）
      + 1 官网（Website v3）
```

---

## 5. 路线图落点

| 里程碑 | 内容 | G-39 落点 |
|--------|------|----------|
| M1 | 核心 SPI + Conformance + 参考实现 | **B1 + B2 + B3** ✅（本轮） |
| M2 | 原生宿主（iOS/Android/Flutter/Harmony） | B4 + B5 |
| M3 | TV/Watch + 生态 | 复用宿主 + 柔性框架六端 |

**依赖关系**：G-39 B1 应在 G-37/G-38 B1 **之后**（Runtime 是 Backend 的运行载体，Backend 接口稳定后定义 Runtime 更准确）。

---

## 6. 合并说明

合并本文件到规约时：
1. 原则 #13.8-13.10 追加到「架构原则」章节
2. G-39.1-6 + CMP035-043 追加到「铁律总表」
3. L0-L4 全景图替换原有「渲染层」单图
4. 体系计数 54 → 55
5. 路线图 M1 补充 G-39 B1-B3
