# Proteus 跨设备一致性验证（G-52）

> **方法论第 16 次泛化**：不绑定设备形态 / 验证维度 —— 等价类 + 代表采样 + 四维漂移指纹 + ε 阈值比对
> **Status: Draft · 2026-09-04 · 决策 #385 整合入库（G-52=CMP140-146 · 泛化 14→16 修正）**

---

## 一句话

**同一份 TestSuite 在不同设备上不再"漂移不可解释"**——G-52 在 G-51 执行环境之上加"设备形态"维度：等价类划分 + 代表采样，任何跨设备 FAIL 都能归因到 screen/os/input/env 四维之一，归一化后报告可 diff。

## 依赖

- **G-51** TestIRRunner（主依赖，`proteus-test-ir-runner-plan`）——`execute()` → G-52 `executeOn()` 同构扩展
- **G-44** Test IR / TestSuite 基座（`proteus-testing-framework-plan`）
- **G-25** 三维断点先例（G-44 已自动化 100 profiles）——设备矩阵的断点语义来源
- **G-46 / G-47 / G-48 / G-49 / G-50** ——覆盖矩阵引用对象

## 快速开始

```bash
cd docs/proteus-cross-device-verification-plan   # 本目录
node reference-impl.cjs   # 零依赖，self-test 44/44，exit 0
bash verify.sh            # PASS=56
```

预期输出（node）：
```
...
self-test: 44/44
```

## 文件清单

```
01-problem.md               ★ 问题：四维漂移 + 组合爆炸，不做穷举
02-architecture.md          二维验证空间（执行环境 × 设备形态）
03-spi.md                   ★ SPI：DeviceMatrixRunner / DeviceProfile / DeviceEquivalenceClass / DriftFingerprint
04-implementation-gates.md  阶段 1（本份 44/44）+ 阶段 2/3 + 三平台真机覆盖
05-appendix.md              等价类示例 + 四维指纹对照 + 接缝命题 + 反模式 AP-22~25
conformance.md              ★ INV-D1~D5 + CMP140-146 映射 + 覆盖矩阵 + 接缝命题统一登记
rules.md                    G-52.1-6 铁律 + 编号避让登记（决策 #385）
architecture-update.md      原则 #13.54-56 + L0-L6 成熟度（统一口径）
reference-impl.cjs          ★ 可运行参考实现（零依赖，self-test 44/44）
verify.sh                   自包含验证
CHECKSUM.sha256             完整性清单（README 入库后已用 shasum -a 256 重算）
```

## 设计核心

- **四维等价类**（screen/os/input/env）：不做穷举，等价类 + 代表采样（INV-D2，偏差 ≤ ε）
- **DriftFingerprint + 归因**：跨设备 FAIL 必归因到四维之一（INV-D3，G-52.3）
- **归一化流水线**：原始结果 → 指纹 → 等价类比对 → 偏差≤ε? → 一致 / 漂移归因
- **本地优先**：核心验证不依赖云端；`ProfileSource` 按需补充（INV-D5，G-52.5）
- **与 G-51 接缝**：① CMP-146 = G-51 INV-06 ∧ G-52 INV-D4；② 承 G-51 INV-08（= G-47 INV-05 ∧ G-51 INV-05）延伸出 G-52 INV-D3 归因——统一登记见 conformance.md 接缝节

## 诚实边界

1. G-52 ≠ 完整设备云：云端调度、真机农场、视觉 diff 不在本份（L3 调度待 G-53）
2. ε 阈值（默认 0.01）是启发式，需按场景校准
3. 真实设备 profile 数据库是运营数据，不在本份
4. 计数以实测为准：reference-impl self-test 44/44

---

*规划体系 · G-52（cross-device-verification-plan）· CMP140-146 · 原则 #13.54-56*
